import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("EÜR-GbR mit Gesellschafterkonten (Postgres)", () => {
  let sql: postgres.Sql;
  let partners: typeof import("./gbr-partners.ts");
  let documents: typeof import("../belege/documents.ts");
  let cash: typeof import("../bank/cash.ts");
  let bank: typeof import("../bank/allocation.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let exportDatev: typeof import("../auswertungen/datev-export.ts");
  const actor = "test-user";
  const today = "2026-11-20";

  beforeAll(async () => {
    sql = await setupTestDb();
    partners = await import("./gbr-partners.ts");
    documents = await import("../belege/documents.ts");
    cash = await import("../bank/cash.ts");
    bank = await import("../bank/allocation.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    exportDatev = await import("../auswertungen/datev-export.ts");
  }, 30000);
  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate gbr_transfers, gbr_source_partners, gbr_partners, allocations, bank_transactions, bank_accounts, cash_entries, document_cancellations,
      document_amounts, documents, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, rechtsform, kontenrahmen, versteuerung, datev_berater_nr, datev_mandant_nr)
      values (1, 'Beispiel GbR', 'gbr', 'SKR03', 'ist', '12345', '123')`;
  });

  async function addPartners() {
    const a = await partners.createGbrPartner(actor, { name: "Erika Beispiel", startsOn: "2025-01-01" });
    const b = await partners.createGbrPartner(actor, { name: "Max Muster", startsOn: "2025-01-01" });
    return { a, b };
  }

  async function beleg(partnerId: string, payment: "privat" | "bank" = "privat", gross = 11900, documentDate = "2026-10-02") {
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([255, 216, 255, 224, ...crypto.getRandomValues(new Uint8Array(12))]),
      filename: "rechnung.jpg",
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Bürobedarf Beispiel",
      supplierUstId: "",
      invoiceNumber: `R-${id.slice(0, 8)}`,
      documentDate,
      dueDate: null,
      category: "software",
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net: Math.round(gross / 1.19), tax: gross - Math.round(gross / 1.19) }],
    });
    await partners.saveGbrSourcePartner(actor, "document", id, partnerId);
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transaction(amount: number, purpose = "geschaeft") {
    const [account] = await sql`insert into bank_accounts (name, purpose, iban) values ('Testkonto', ${purpose}, ${crypto.randomUUID()}) returning id`;
    const [imported] =
      await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped) values (${account!.id}, 'test.csv', ${crypto.randomUUID()}, 'dkb', 1, 0) returning id`;
    const [tx] = await sql`insert into bank_transactions (bank_account_id, import_id, dedup_hash, booking_date, amount, counterparty_name, purpose)
      values (${account!.id}, ${imported!.id}, ${crypto.randomUUID()}, '2026-10-03', ${amount}, 'Beispiel', 'Testzahlung') returning id`;
    return tx!.id as string;
  }

  it.each([
    ["SKR03", "ist", "1891", "1892", "1802"],
    ["SKR04", "soll", "2181", "2182", "2102"],
  ] as const)(
    "%s/%s: Belege, Bank, Kasse, EÜR und DATEV behalten getrennte Personen",
    async (kr, versteuerung, einlageA, einlageB, entnahmeB) => {
      await sql`update company set kontenrahmen = ${kr}, versteuerung = ${versteuerung}`;
      const { a, b } = await addPartners();
      await beleg(a.id);
      const cashEntry = await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 50000, partnerId: b.id }, today);
      const tx = await transaction(-20000);
      await partners.saveGbrSourcePartner(actor, "bank", tx, b.id);
      await bank.allocate(actor, { kind: "privat", transactionId: tx, amount: -20000 });
      const accounts = await sql`select distinct account from journal_lines`;
      expect(accounts.map((r) => r.account)).toEqual(expect.arrayContaining([einlageA, einlageB, entnahmeB]));
      const overview = await partners.gbrPartnerOverview(2026);
      expect(overview.partners.map((p) => p.balance)).toEqual([11900, 30000]);
      const report = await annual.euerYear(2026);
      expect(report.figures).toMatchObject({ einlagen: 61900, entnahmen: 20000 });
      const exported = await exportDatev.datevExport(2026, new Date("2026-11-20T12:00:00Z"));
      const csv = new TextDecoder("windows-1252").decode(exported.bytes);
      expect(csv).toContain(`;${einlageA};`);
      expect(csv).toContain(`;${einlageB};`);
      expect(csv).toContain(`;${entnahmeB};`);
      await cash.reverseCashEntry(actor, cashEntry.id, today);
      expect((await partners.gbrPartnerOverview(2026)).partners[1]!.balance).toBe(-20000);
      expect((await partners.gbrPartnerOverview(2027)).partners[0]!.opening).toBe(11900);
    },
    30000,
  );

  it("verhindert Buchungen ohne Person und schützt gebuchte Zuordnungen auch gegen direktes SQL", async () => {
    const { a, b } = await addPartners();
    await expect(cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5000 }, today)).rejects.toThrow(/Gesellschafter/);
    const id = await beleg(a.id);
    await expect(partners.saveGbrSourcePartner(actor, "document", id, b.id)).rejects.toThrow();
    await expect(sql`update gbr_source_partners set partner_id = ${b.id} where source_id = ${id}`).rejects.toThrow();
    await expect(sql`update gbr_partners set number = 3 where id = ${a.id}`).rejects.toThrow();
    await expect(sql`delete from gbr_partners where id = ${a.id}`).rejects.toThrow();
    expect((await partners.gbrPartnerOverview(2026)).partners[0]!.balance).toBe(11900);
  });

  it("ordnet eine Bankaufteilung zwei verschiedenen Gesellschaftern zu", async () => {
    const { a, b } = await addPartners();
    const tx = await transaction(-30000);
    await bank.allocateSplit(actor, {
      transactionId: tx,
      parts: [
        { kind: "privat", amount: -10000, partnerId: a.id },
        { kind: "privat", amount: -20000, partnerId: b.id },
      ],
    });
    expect((await partners.gbrPartnerOverview(2026)).partners.map((p) => p.balance)).toEqual([-10000, -20000]);
  });

  it("bucht vom privaten Bankkonto gegen die richtige Person und erlaubt Belegstorno nach Austritt", async () => {
    const { a } = await addPartners();
    const id = await beleg(a.id, "bank");
    const tx = await transaction(-11900, "privat");
    await partners.saveGbrSourcePartner(actor, "bank", tx, a.id);
    await bank.allocate(actor, { kind: "document", transactionId: tx, documentId: id, amount: -11900 });
    expect((await partners.gbrPartnerOverview(2026)).partners[0]!.balance).toBe(11900);
    await partners.updateGbrPartner(actor, a.id, { name: a.name, startsOn: a.startsOn, endsOn: "2026-10-04" });
    const reversal = await import("../bank/allocation-reversal.ts");
    const [allocation] = await sql`select id from allocations where transaction_id = ${tx}`;
    await reversal.reverseAllocation(actor, allocation!.id, today);
    const cancellation = await import("../belege/cancellation.ts");
    await cancellation.cancelDocument(actor, id, { reason: "Teststorno" }, today);
    expect((await partners.gbrPartnerOverview(2026)).partners[0]!.balance).toBe(0);
  });

  it("liefert Originalbelege und stabile Journal-IDs im Paket und warnt vor erneuter Übergabe", async () => {
    const { a } = await addPartners();
    const documentId = await beleg(a.id);
    const { gbrTransfer } = await import("../archiv/gbr-transfer.ts");
    const { unzipSync } = await import("fflate");
    const result = await gbrTransfer(2026, new Date("2026-11-20T12:00:00Z"), { id: actor, role: "inhaber" });
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.chunks) chunks.push(chunk);
    const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["EXTF_Buchungsstapel_2026.csv", `belege/${documentId}.jpg`, "belegzuordnung.csv", "uebergabe.json", "pruefsummen.sha256"]),
    );
    const manifest = JSON.parse(new TextDecoder().decode(files["uebergabe.json"]!));
    expect(manifest.entryIds).toHaveLength(1);
    expect(new TextDecoder().decode(files["belegzuordnung.csv"]!)).toContain(documentId);
    const repeated = await gbrTransfer(2026, new Date("2026-11-21T12:00:00Z"), { id: actor, role: "inhaber" });
    expect(repeated.warnings.join(" ")).toMatch(/bereits.*Übergabepaket/);
    const transfers = await sql`select fingerprint from gbr_transfers order by created_at`;
    expect(transfers).toHaveLength(2);
    expect(transfers[0]!.fingerprint).toBe(transfers[1]!.fingerprint);
    await expect(sql`delete from gbr_transfers`).rejects.toThrow();
  });

  it("nutzt die Person des Privatkontos als Vorgabe, am Umsatz aber eine ausdrückliche Wahl", async () => {
    const { a, b } = await addPartners();
    const tx = await transaction(-11900, "privat");
    const [account] = await sql`select bank_account_id as id from bank_transactions where id = ${tx}`;
    await partners.saveGbrSourcePartner(actor, "bankkonto", account!.id, a.id);
    expect((await partners.gbrSourceOverview("bank", tx)).inheritedName).toBe(a.name);
    const id = await beleg(a.id, "bank");
    await bank.allocate(actor, { kind: "document", transactionId: tx, documentId: id, amount: -11900 });
    expect((await partners.gbrPartnerOverview(2026)).partners[0]!.balance).toBe(11900);
    await expect(partners.saveGbrSourcePartner(actor, "bankkonto", account!.id, b.id)).rejects.toThrow();

    const overridden = await transaction(-11900, "privat");
    const [otherAccount] = await sql`select bank_account_id as id from bank_transactions where id = ${overridden}`;
    await partners.saveGbrSourcePartner(actor, "bankkonto", otherAccount!.id, a.id);
    await partners.saveGbrSourcePartner(actor, "bank", overridden, b.id);
    const otherDocument = await beleg(b.id, "bank");
    await bank.allocate(actor, { kind: "document", transactionId: overridden, documentId: otherDocument, amount: -11900 });
    expect((await partners.gbrPartnerOverview(2026)).partners.map((p) => p.balance)).toEqual([11900, 11900]);
  });

  it("verwendet nach Umstellung auf Geschäftskonto keine unsichtbare Privatkonto-Vorgabe", async () => {
    const { a } = await addPartners();
    const tx = await transaction(-10000, "privat");
    const [account] = await sql`select bank_account_id as id from bank_transactions where id = ${tx}`;
    await partners.saveGbrSourcePartner(actor, "bankkonto", account!.id, a.id);
    const accounts = await import("../bank/accounts.ts");
    await accounts.updateAccount(actor, { id: account!.id, name: "Jetzt Geschäftskonto", purpose: "geschaeft" });
    expect((await partners.gbrSourceOverview("bank", tx)).inheritedName).toBeNull();
    await expect(bank.allocate(actor, { kind: "privat", transactionId: tx, amount: -10000 })).rejects.toThrow(/Gesellschafter/);
  });

  it("legt den Originalbeleg aus dem Vorjahr zur exportierten Zahlung des laufenden Jahres", async () => {
    const { a } = await addPartners();
    const id = await beleg(a.id, "bank", 11900, "2025-12-20");
    const tx = await transaction(-11900);
    await bank.allocate(actor, { kind: "document", transactionId: tx, documentId: id, amount: -11900 });
    const { gbrTransfer } = await import("../archiv/gbr-transfer.ts");
    const { unzipSync } = await import("fflate");
    const result = await gbrTransfer(2026, new Date("2026-11-20T12:00:00Z"), { id: actor, role: "inhaber" });
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.chunks) chunks.push(chunk);
    const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
    expect(files[`belege/${id}.jpg`]).toBeDefined();
    expect(new TextDecoder().decode(files["belegzuordnung.csv"]!)).toContain(id);
    const manifest = JSON.parse(new TextDecoder().decode(files["uebergabe.json"]!));
    expect(manifest.entryIds).toHaveLength(1);
  });

  it("übernimmt Anfangsbestände und zeigt den Vortrag im nächsten Kontenblatt", async () => {
    await addPartners();
    const manual = await import("../buchhaltung/manual.ts");
    const ledger = await import("../buchhaltung/ledger.ts");
    await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2026-01-01",
        description: "Übernahme Gesellschafter",
        lines: [
          { account: "9000", debit: 10000, credit: 0 },
          { account: "1891", debit: 0, credit: 10000 },
        ],
      },
      today,
    );
    expect((await partners.gbrPartnerOverview(2026)).partners[0]).toMatchObject({ opening: 10000, credit: 0, balance: 10000 });
    expect((await annual.euerYear(2026)).figures.einlagen ?? 0).toBe(0);
    expect((await partners.gbrPartnerOverview(2027)).partners[0]!.opening).toBe(10000);
    expect((await ledger.kontenblatt("1891", { from: "2027-01-01", to: "2028-01-01" })).eroeffnung).toBe(-10000);
  });
});
