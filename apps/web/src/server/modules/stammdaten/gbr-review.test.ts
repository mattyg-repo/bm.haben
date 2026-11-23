import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("GbR-Regressionsfälle aus unabhängigem Review (Postgres)", () => {
  let sql: postgres.Sql;
  let partners: typeof import("./gbr-partners.ts");
  let bank: typeof import("../bank/allocation.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    partners = await import("./gbr-partners.ts");
    bank = await import("../bank/allocation.ts");
  }, 30000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate gbr_transfers, gbr_source_partners, gbr_partners, allocations, bank_transactions,
      bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, rechtsform, kontenrahmen, versteuerung)
      values (1, 'Beispiel GbR', 'gbr', 'SKR03', 'ist')`;
  });

  async function transaction(amount: number) {
    const [account] = await sql`insert into bank_accounts (name, purpose, iban)
      values ('Testkonto', 'geschaeft', ${crypto.randomUUID()}) returning id`;
    const [imported] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${account!.id}, 'test.csv', ${crypto.randomUUID()}, 'dkb', 1, 0) returning id`;
    const [tx] = await sql`insert into bank_transactions
      (bank_account_id, import_id, dedup_hash, booking_date, amount, counterparty_name, purpose)
      values (${account!.id}, ${imported!.id}, ${crypto.randomUUID()}, '2026-10-03', ${amount}, 'Beispiel', 'Testzahlung') returning id`;
    return tx!.id as string;
  }

  it("storniert eine Bankaufteilung mit abweichender Person trotz Umsatzvorgabe", async () => {
    const a = await partners.createGbrPartner(actor, { name: "Erika", startsOn: "2026-01-01" });
    const b = await partners.createGbrPartner(actor, { name: "Max", startsOn: "2026-01-01" });
    const tx = await transaction(-30000);
    await partners.saveGbrSourcePartner(actor, "bank", tx, a.id);
    await bank.allocateSplit(actor, {
      transactionId: tx,
      parts: [
        { kind: "privat", amount: -10000, partnerId: a.id },
        { kind: "privat", amount: -20000, partnerId: b.id },
      ],
    });
    const [allocation] = await sql`select id from allocations where transaction_id = ${tx} limit 1`;
    const { reverseAllocation } = await import("../bank/allocation-reversal.ts");
    await reverseAllocation(actor, allocation!.id, "2026-11-20");
    expect((await partners.gbrPartnerOverview(2026)).partners.map((p) => p.balance)).toEqual([0, 0]);
  });

  it("ordnet SKR04-Spenden dem gewählten Gesellschafter zu", async () => {
    // DATEV 1000181, Anlage: SKR04 2250 = Zuwendungen, Spenden (VH).
    // https://www.datev.de/dnlexom/v2/content/files/st72057608810363275_de.pdf
    await sql`update company set kontenrahmen = 'SKR04'`;
    const a = await partners.createGbrPartner(actor, { name: "Erika", startsOn: "2026-01-01" });
    const tx = await transaction(-5000);
    await bank.allocate(actor, { kind: "spende", transactionId: tx, amount: -5000, partnerId: a.id });
    expect((await partners.gbrPartnerOverview(2026)).partners[0]!.balance).toBe(-5000);
    const lines = await sql`select account from journal_lines where debit = 5000`;
    expect(lines.map((line) => line.account)).toContain("2251");
    const { euerYear } = await import("../jahreserklaerung/annual.ts");
    expect((await euerYear(2026)).figures.entnahmen).toBe(5000);
    const { kontenblatt } = await import("../buchhaltung/ledger.ts");
    expect((await kontenblatt("2251", { from: "2027-01-01", to: "2028-01-01" })).eroeffnung).toBe(5000);
    expect((await partners.gbrPartnerOverview(2027)).partners[0]!.opening).toBe(-5000);
    expect(partners.gbrAccountNames("SKR04")["2251"]).toBe("Zuwendungen, Spenden · Erika");
    await expect(partners.updateGbrPartner(actor, a.id, { name: a.name, startsOn: "2026-10-04" })).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/Privatbuchungen/) },
    });
  });

  it("übernimmt SKR04-Spendensalden ohne laufende Entnahme und sperrt ungekennzeichnete direkte Buchungen", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    await partners.createGbrPartner(actor, { name: "Erika", startsOn: "2026-01-01" });
    const { createManualEntry } = await import("../buchhaltung/manual.ts");
    await createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2026-01-01",
        description: "Übernahme Spendenkonto",
        lines: [
          { account: "2251", debit: 5000, credit: 0 },
          { account: "9000", debit: 0, credit: 5000 },
        ],
      },
      "2026-11-20",
    );
    expect((await partners.gbrPartnerOverview(2026)).partners[0]).toMatchObject({ opening: -5000, debit: 0, balance: -5000 });
    const { euerYear } = await import("../jahreserklaerung/annual.ts");
    expect((await euerYear(2026)).figures.entnahmen ?? 0).toBe(0);
    await expect(
      sql.begin(async (q) => {
        await q`select set_config('haben.actor', ${actor}, true)`;
        const [entry] = await q`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
          values ('2026-10-03', 'Direkte Spende ohne Person', 'manuell', ${crypto.randomUUID()}, 'SKR04') returning id`;
        await q`insert into journal_lines (entry_id, account, debit, credit) values (${entry!.id}, '2250', 5000, 0), (${entry!.id}, '1800', 0, 5000)`;
        await q`update journal_entries set locked_at = now() where id = ${entry!.id}`;
      }),
    ).rejects.toThrow(/angelegten Gesellschafter/);
  });
});
