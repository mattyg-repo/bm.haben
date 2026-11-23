import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("GbR-Grenzen der ersten Ausbaustufe (Postgres)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate gbr_source_partners, gbr_partners, pauschalen, asset_depreciations, assets,
      journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, rechtsform, kontenrahmen, versteuerung)
      values (1, 'Beispiel GbR', 'gbr', 'SKR03', 'ist')`;
  });

  it("weist Sonderbetriebspauschalen der GbR vor dem Buchungsversuch ausdrücklich zurück", async () => {
    const { createPauschale } = await import("../buchhaltung/pauschalen.ts");
    await expect(createPauschale("test-user", { art: "homeoffice", month: "2026-03", tage: 12 }, "2026-11-20")).rejects.toThrow(/GbR.*außerhalb/);
    expect(await sql`select id from pauschalen`).toHaveLength(0);
  });

  it("weist Kfz-Privatnutzung einer GbR schon bei der Anlage ausdrücklich zurück", async () => {
    const { createAsset } = await import("../buchhaltung/assets.ts");
    await expect(
      createAsset("test-user", {
        name: "VW Passat",
        kind: "kfz",
        method: "linear",
        acquisitionDate: "2024-01-10",
        cost: 3_600_000,
        usefulLifeMonths: 72,
        openingDate: "2026-01-01",
        openingBookValue: 2_400_000,
        disposalDate: null,
        note: "",
        privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
      }),
    ).rejects.toThrow(/GbR.*außerhalb/);
    expect(await sql`select id from assets`).toHaveLength(0);
  });
});
