import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("GbR-Sperrreihenfolge aus unabhängigem Review (Postgres)", () => {
  let sql: postgres.Sql;
  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30000);
  afterAll(async () => {
    await sql?.end();
  });

  async function waitForBlockedBy(pid: number, finished = () => false) {
    for (let i = 0; i < 200; i++) {
      const [waiting] = await sql<{ pid: number }[]>`select pid from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`;
      if (waiting) return waiting.pid;
      if (finished()) return null;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Die erwartete Sperrwartezeit ist ausgeblieben.");
  }

  it("bucht parallel zu einer Namensänderung ohne gegenseitige Partner- und Auditsperre", async () => {
    await sql`insert into company (id, name, rechtsform, kontenrahmen, versteuerung)
      values (1, 'Beispiel GbR', 'gbr', 'SKR03', 'ist')`;
    const { createGbrPartner, updateGbrPartner } = await import("./gbr-partners.ts");
    const partner = await createGbrPartner("test-user", { name: "Erika", startsOn: "2026-01-01" });
    const { createCashEntry } = await import("../bank/cash.ts");
    const blocker = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let tableLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      tableLocked = resolve;
    });
    const holding = blocker.begin(async (q) => {
      // Hält die Buchung direkt vor ihrem Journalschreiben an, ohne selbst Partner oder Audit zu sperren.
      await q`lock table journal_entries in share mode`;
      const [row] = await q<{ pid: number }[]>`select pg_backend_pid() as pid`;
      tableLocked(row!.pid);
      await held;
    });
    try {
      const blockerPid = await locked;
      const booking = createCashEntry("test-user", { kind: "einlage", date: "2026-10-01", amount: 5000, partnerId: partner.id }, "2026-11-20").then(
        () => null,
        (error: unknown) => error,
      );
      const bookingPid = await waitForBlockedBy(blockerPid);
      let edited = false;
      const editing = updateGbrPartner("test-user", partner.id, { name: "Erika Beispiel", startsOn: partner.startsOn })
        .then(
          () => null,
          (error: unknown) => error,
        )
        .finally(() => {
          edited = true;
        });
      await waitForBlockedBy(bookingPid!, () => edited);
      release();
      await holding;
      expect(await Promise.all([booking, editing])).toEqual([null, null]);
    } finally {
      release();
      await holding;
      await blocker.end();
    }
  }, 15000);
});
