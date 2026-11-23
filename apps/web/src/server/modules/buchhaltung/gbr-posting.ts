import { gbrPostingLines, isGbrPrivateAccount, type PostingLine } from "@haben/core";
import { eq, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { GbrError, gbrSourcePartner, listGbrPartners } from "../stammdaten/index.ts";
import type { Books, Posting } from "./ledger.ts";

/** Die Zuordnung wird vor dem Sperren des Journals auf echte Sachkonten angewandt. Keine Änderung an bestehenden Buchungen. */
export async function gbrPostingLinesIn(
  q: Db | Tx,
  books: Books,
  posting: Pick<Posting, "sourceType" | "sourceId" | "lines" | "date" | "reversesId" | "partnerId">,
): Promise<PostingLine[]> {
  const privateLines = posting.lines.filter((line) => isGbrPrivateAccount(books.kontenrahmen, line.account));
  if (books.rechtsform !== "gbr" || privateLines.length === 0) return posting.lines;
  const partners = await listGbrPartners(q);
  let partnerId = posting.partnerId ?? null;
  if (!posting.reversesId && !partnerId && posting.sourceType === "document") partnerId = await gbrSourcePartner("document", posting.sourceId, q);
  if (!posting.reversesId && !partnerId && posting.sourceType === "allocation") {
    const [row] = await q
      .select({ transactionId: schema.allocations.transactionId, accountId: schema.bankTransactions.bankAccountId, purpose: schema.bankAccounts.purpose })
      .from(schema.allocations)
      .innerJoin(schema.bankTransactions, eq(schema.allocations.transactionId, schema.bankTransactions.id))
      .innerJoin(schema.bankAccounts, eq(schema.bankTransactions.bankAccountId, schema.bankAccounts.id))
      .where(eq(schema.allocations.id, posting.sourceId));
    if (row)
      partnerId =
        (await gbrSourcePartner("bank", row.transactionId, q)) ?? (row.purpose === "privat" ? await gbrSourcePartner("bankkonto", row.accountId, q) : null);
  }
  let number = partnerId ? partners.find((p) => p.id === partnerId)?.number : undefined;
  // Stornos verwenden die Originalkennung statt einer Bankvorgabe; die Kasse baut ihre Zeilen aus der Buchungsart neu.
  if (number === undefined && posting.reversesId) {
    const originals = await q
      .select({ account: schema.journalLines.account })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.entryId, posting.reversesId));
    const numbers = new Set(originals.filter((l) => isGbrPrivateAccount(books.kontenrahmen, l.account)).map((l) => Number(l.account) % 10));
    if (numbers.size === 1) number = [...numbers][0];
  }
  if (partnerId && number === undefined) throw new GbrError("Gesellschafter nicht gefunden.");
  if (number === undefined && privateLines.some((line) => Number(line.account) % 10 === 0)) {
    throw new GbrError("Wähle den Gesellschafter für diese Privatbewegung vor dem Buchen.");
  }
  const lines = number === undefined ? posting.lines : gbrPostingLines(posting.lines, books.kontenrahmen, number);
  const numbers = [...new Set(lines.filter((l) => isGbrPrivateAccount(books.kontenrahmen, l.account)).map((l) => Number(l.account) % 10))];
  const used = partners.filter((p) => numbers.includes(p.number));
  if (used.length !== numbers.length) throw new GbrError("Das Privatkonto gehört keinem angelegten Gesellschafter.");
  // Während der Buchung sperren: Austritt und Buchung dürfen sich nicht überholen.
  const lockedPartners = await q
    .select()
    .from(schema.gbrPartners)
    .where(
      inArray(
        schema.gbrPartners.id,
        used.map((p) => p.id),
      ),
    )
    .for("share");
  if (!posting.reversesId && lockedPartners.some((p) => posting.date < p.startsOn || (p.endsOn && posting.date > p.endsOn))) {
    throw new GbrError("Das Buchungsdatum liegt außerhalb der Beteiligung des Gesellschafters.");
  }
  return lines;
}
