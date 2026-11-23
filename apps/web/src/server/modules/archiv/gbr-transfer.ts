import { createHash } from "node:crypto";
import { periodRange, voucherField, type VatPeriod } from "@haben/core";
import { and, gt, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { withActor } from "../../db/actor.ts";
import { loadFile } from "../../storage.ts";
import { datevExport, datevQuellen, DatevExportError } from "../auswertungen/index.ts";
import { listGbrPartners, loadCompany } from "../stammdaten/index.ts";
import { csv } from "./csv.ts";
import { EXTENSIONS } from "./export-paths.ts";
import { zipArchive, type ArchiveFile } from "./export-zip.ts";

const encoder = new TextEncoder();
type Exporteur = { id: string; role: "inhaber" | "steuerberatung" };

/** DATEV-Buchungen und die Originale genau der enthaltenen Vorgänge, auch bei Zahlungen auf Vorjahresbelege. */
export async function gbrTransfer(year: number, now: Date, exporteur: Exporteur, period?: VatPeriod) {
  const company = await loadCompany();
  if (company.rechtsform !== "gbr") throw new DatevExportError("Das Gesellschafter-Übergabepaket gibt es nur für eine GbR.");
  if (exporteur.role !== "inhaber") throw new DatevExportError("Ein neues Übergabepaket erstellt nur der Inhaber.");
  const datev = await datevExport(year, now, exporteur, period);
  const { start, end } = period ? periodRange(period) : { start: `${year}-01-01`, end: `${year + 1}-01-01` };
  const refs = await datevQuellen(datev.entries);
  const documentIds = [...new Set([...refs.values()].flatMap((r) => (r.documentId ? [r.documentId] : [])))];
  const invoiceIds = [...new Set([...refs.values()].flatMap((r) => (r.invoiceId ? [r.invoiceId] : [])))];
  const documents = documentIds.length ? await db.select().from(schema.documents).where(inArray(schema.documents.id, documentIds)) : [];
  const invoices = invoiceIds.length ? await db.select().from(schema.invoices).where(inArray(schema.invoices.id, invoiceIds)) : [];
  const entryIds = datev.entries.map((e) => e.id);
  const fingerprint = createHash("sha256").update(JSON.stringify({ start, end, entryIds })).digest("hex");
  const warnings = [...datev.warnings];
  const { transfer, overlap } = await logTransfer(exporteur.id, start, end, entryIds, fingerprint);
  if (overlap)
    warnings.push(
      `${overlap} Journalbuchungen waren bereits in einem erstellten Übergabepaket. Beim Import Doppelbuchungen vermeiden; das Paket enthält sie weiterhin vollständig.`,
    );
  const paths = new Map<string, string[]>();
  const files: ArchiveFile[] = [];
  for (const doc of documents) {
    const path = `belege/${doc.id}.${EXTENSIONS[doc.mimeType] ?? "bin"}`;
    paths.set(doc.id, [path]);
    files.push({ path, content: checkedDocument(doc.sha256), compress: doc.mimeType === "application/xml" });
  }
  for (const invoice of invoices) {
    const invoicePaths: string[] = [];
    if (invoice.pdf) {
      const path = `rechnungen/${invoice.id}.pdf`;
      invoicePaths.push(path);
      files.push({ path, content: new Uint8Array(invoice.pdf), compress: false });
    }
    if (invoice.xml) {
      const path = `rechnungen/${invoice.id}.xml`;
      invoicePaths.push(path);
      files.push({ path, content: encoder.encode(invoice.xml), compress: true });
    }
    paths.set(invoice.id, invoicePaths);
    if (invoicePaths.length === 0) throw new DatevExportError(`Zur Rechnung ${invoice.number ?? invoice.id} fehlt das Original.`);
  }
  const index = csv(
    ["Journal-ID", "Datum", "Quelle", "Vorgangs-ID", "Belegfeld 1", "Originaldateien"],
    datev.entries.map((entry) => {
      const ref = refs.get(entry.sourceId);
      const id = ref?.documentId ?? ref?.invoiceId;
      const doc = documents.find((d) => d.id === id);
      const invoice = invoices.find((i) => i.id === id);
      return [
        entry.id,
        entry.date,
        entry.sourceType,
        entry.sourceId,
        voucherField(doc?.invoiceNumber || invoice?.number || doc?.filename || ""),
        id ? (paths.get(id) ?? []).join(" | ") : "",
      ];
    }),
  );
  const manifest = {
    version: 1,
    transferId: transfer.id,
    fingerprint,
    createdAt: now.toISOString(),
    from: start,
    toExclusive: end,
    kontenrahmen: company.kontenrahmen,
    datevFile: datev.filename,
    datevSha256: createHash("sha256").update(datev.bytes).digest("hex"),
    entryIds,
    warnings,
    partners: await listGbrPartners(),
  };
  async function* allFiles(): AsyncGenerator<ArchiveFile> {
    yield { path: datev.filename, content: datev.bytes, compress: true };
    yield { path: "belegzuordnung.csv", content: index, compress: true };
    yield { path: "uebergabe.json", content: encoder.encode(JSON.stringify(manifest, null, 2)), compress: true };
    yield {
      path: "LIESMICH.txt",
      content: encoder.encode(
        "GbR-Übergabe aus Haben\n\nDer DATEV-Stapel enthält bereits gebuchte Vorgänge einschließlich Festschreibungskennzeichen. Kontenplan, Steuerschlüssel und Importverhalten zuerst in einer Testfirma prüfen. Originale stehen in belege/ und rechnungen/; belegzuordnung.csv ordnet sie den Journalbuchungen zu. Eine automatische Verknüpfung in MonKey Office wird nicht zugesichert.\n\nuebergabe.json protokolliert die Erstellung, nicht den erfolgreichen Import. Zeiträume können sich überlappen; dieselben Journal-IDs nicht zweimal importieren. Korrekturen erfolgen durch zusätzliche Buchungen. Abschlusskorrekturen aus MonKey sind nicht automatisch in Haben enthalten.\n\nDie Prüfsummen stehen in pruefsummen.sha256.\n",
      ),
      compress: true,
    };
    for (const file of files) yield file;
  }
  return { filename: datev.filename.replace("EXTF_Buchungsstapel_", "Haben-GbR-").replace(/\.csv$/, ".zip"), chunks: zipArchive(allFiles(), now), warnings };
}

async function* checkedDocument(sha256: string): AsyncGenerator<Uint8Array> {
  const content = await loadFile(sha256);
  if (createHash("sha256").update(content).digest("hex") !== sha256)
    throw new DatevExportError("Die Prüfsumme eines Originalbelegs stimmt nicht; Übergabe abgebrochen.");
  yield new Uint8Array(content);
}

async function logTransfer(actor: string, start: string, end: string, entryIds: string[], fingerprint: string) {
  return withActor(actor, async (tx) => {
    await tx.execute(sql`select haben_lock_audit_chain()`);
    const previous = await tx
      .select()
      .from(schema.gbrTransfers)
      .where(and(lt(schema.gbrTransfers.dateFrom, end), gt(schema.gbrTransfers.dateTo, start)));
    const known = new Set(previous.flatMap((p) => p.entryIds));
    const overlap = entryIds.filter((id) => known.has(id)).length;
    const [transfer] = await tx.insert(schema.gbrTransfers).values({ fingerprint, dateFrom: start, dateTo: end, entryIds }).returning();
    return { transfer: transfer!, overlap };
  });
}
