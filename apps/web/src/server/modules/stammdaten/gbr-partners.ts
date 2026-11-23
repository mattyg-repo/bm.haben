import { ACCOUNTS, ACCOUNT_NAMES, GBR_PARTNER_LIMIT, gbrAccount, isGbrPrivateAccount, type Kontenrahmen } from "@haben/core";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { withActor } from "../../db/actor.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "./company.ts";

export class GbrError extends UserError {}
export type GbrPartner = typeof schema.gbrPartners.$inferSelect;
export type GbrSourceKind = (typeof schema.gbrSourcePartners.$inferSelect)["kind"];

export const gbrPartnerInput = z
  .object({
    name: z.string().trim().min(1, "Name fehlt.").max(200),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().nullable().default(null),
  })
  .refine((p) => !p.endsOn || p.endsOn >= p.startsOn, "Austritt liegt vor dem Eintritt.");

export async function listGbrPartners(q: Db | Tx = db): Promise<GbrPartner[]> {
  return q.select().from(schema.gbrPartners).orderBy(asc(schema.gbrPartners.number));
}

export async function createGbrPartner(actor: string, input: z.input<typeof gbrPartnerInput>): Promise<GbrPartner> {
  const parsed = gbrPartnerInput.parse(input);
  return withActor(actor, async (tx) => {
    const [company] = await tx.select().from(schema.company).where(eq(schema.company.id, 1)).for("update");
    if (company?.rechtsform !== "gbr") throw new GbrError("Gesellschafterkonten gibt es hier nur für eine GbR.");
    const partners = await listGbrPartners(tx);
    const number = Math.max(0, ...partners.map((p) => p.number)) + 1;
    if (number > GBR_PARTNER_LIMIT)
      throw new GbrError("Die erste Ausbaustufe unterstützt neun Gesellschafterkennungen; ausgeschiedene werden nicht wieder vergeben.");
    const [partner] = await tx
      .insert(schema.gbrPartners)
      .values({ ...parsed, number })
      .returning();
    return partner!;
  });
}

export async function updateGbrPartner(actor: string, id: string, input: z.input<typeof gbrPartnerInput>): Promise<void> {
  const parsed = gbrPartnerInput.parse(input);
  await withActor(actor, async (tx) => {
    await tx.execute(sql`select haben_lock_audit_chain()`);
    const [partner] = await tx.update(schema.gbrPartners).set(parsed).where(eq(schema.gbrPartners.id, id)).returning();
    if (!partner) throw new GbrError("Gesellschafter nicht gefunden.");
  });
}

export async function gbrSourcePartner(kind: GbrSourceKind, sourceId: string, q: Db | Tx = db): Promise<string | null> {
  const [row] = await q
    .select()
    .from(schema.gbrSourcePartners)
    .where(and(eq(schema.gbrSourcePartners.kind, kind), eq(schema.gbrSourcePartners.sourceId, sourceId)));
  return row?.partnerId ?? null;
}

export async function gbrSourceOverview(kind: GbrSourceKind, sourceId: string) {
  const [partnerId, partners] = await Promise.all([gbrSourcePartner(kind, sourceId), listGbrPartners()]);
  let locked = false;
  if (kind === "document") {
    const [doc] = await db.select({ lockedAt: schema.documents.lockedAt }).from(schema.documents).where(eq(schema.documents.id, sourceId));
    locked = !doc || doc.lockedAt !== null;
  } else {
    const rows =
      kind === "bank"
        ? await db.select({ id: schema.allocations.id }).from(schema.allocations).where(eq(schema.allocations.transactionId, sourceId)).limit(1)
        : await db
            .select({ id: schema.allocations.id })
            .from(schema.allocations)
            .innerJoin(schema.bankTransactions, eq(schema.allocations.transactionId, schema.bankTransactions.id))
            .where(eq(schema.bankTransactions.bankAccountId, sourceId))
            .limit(1);
    locked = rows.length > 0;
  }
  let inheritedName: string | null = null;
  if (kind === "bank" && !partnerId) {
    const [transaction] = await db
      .select({ accountId: schema.bankTransactions.bankAccountId, purpose: schema.bankAccounts.purpose })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankAccounts, eq(schema.bankTransactions.bankAccountId, schema.bankAccounts.id))
      .where(eq(schema.bankTransactions.id, sourceId));
    const inheritedId = transaction?.purpose === "privat" ? await gbrSourcePartner("bankkonto", transaction.accountId) : null;
    inheritedName = partners.find((p) => p.id === inheritedId)?.name ?? null;
  }
  return { partnerId, partners, locked, inheritedName };
}

let names: Record<Kontenrahmen, Record<string, string>> = { SKR03: {}, SKR04: {} };
export function gbrAccountNames(kontenrahmen: Kontenrahmen): Record<string, string> {
  return names[kontenrahmen];
}

/** Wie die eigenen Aufwandskonten vor jedem Laden von Journal und Konten auffrischen, auch bei mehreren App-Prozessen. */
export async function refreshGbrAccountNames(): Promise<void> {
  const [company] = await db.select({ rechtsform: schema.company.rechtsform }).from(schema.company).where(eq(schema.company.id, 1));
  const next: typeof names = { SKR03: {}, SKR04: {} };
  if (company?.rechtsform === "gbr") {
    for (const p of await listGbrPartners())
      for (const kr of ["SKR03", "SKR04"] as const) {
        const start = kr === "SKR03" ? 1800 : 2100;
        const bases = Array.from({ length: 10 }, (_, i) => start + i * 10);
        if (kr === "SKR04") bases.push(Number(ACCOUNTS[kr].spenden));
        for (const base of bases) {
          const label =
            ACCOUNT_NAMES[kr][String(base)] ??
            (String(base) === ACCOUNTS[kr].privateinlagen
              ? "Privateinlagen"
              : String(base) === ACCOUNTS[kr].privatentnahmen
                ? "Privatentnahmen"
                : String(base) === ACCOUNTS[kr].spenden
                  ? "Zuwendungen, Spenden"
                  : "Privatkonto");
          next[kr][String(base + p.number)] = `${label} · ${p.name}`;
        }
      }
  }
  names = next;
}

/** Vor dem Audit dieselbe Quellzeile sperren wie der Buchungsweg. Der Trigger schützt zusätzlich vor direkten SQL-Änderungen. */
export async function saveGbrSourcePartner(actor: string, kind: GbrSourceKind, sourceId: string, partnerId: string | null): Promise<void> {
  await withActor(actor, async (tx) => {
    if ((await loadCompany(tx)).rechtsform !== "gbr") throw new GbrError("Gesellschafterzuordnung gibt es nur für eine GbR.");
    const table = kind === "document" ? schema.documents : kind === "bank" ? schema.bankTransactions : schema.bankAccounts;
    const rows = await tx.select({ id: table.id }).from(table).where(eq(table.id, sourceId)).for("update");
    if (!rows.length) throw new GbrError("Vorgang nicht gefunden.");
    if (partnerId) {
      const [partner] = await tx.select().from(schema.gbrPartners).where(eq(schema.gbrPartners.id, partnerId));
      if (!partner) throw new GbrError("Gesellschafter nicht gefunden.");
      await tx
        .insert(schema.gbrSourcePartners)
        .values({ kind, sourceId, partnerId })
        .onConflictDoUpdate({
          target: [schema.gbrSourcePartners.kind, schema.gbrSourcePartners.sourceId],
          set: { partnerId },
        });
    } else {
      await tx.delete(schema.gbrSourcePartners).where(and(eq(schema.gbrSourcePartners.kind, kind), eq(schema.gbrSourcePartners.sourceId, sourceId)));
    }
  });
}

export function gbrPartnerAccounts(kontenrahmen: Kontenrahmen, number: number) {
  const a = ACCOUNTS[kontenrahmen];
  return { deposit: gbrAccount(kontenrahmen, a.privateinlagen, number), withdrawal: gbrAccount(kontenrahmen, a.privatentnahmen, number) };
}

/** Cumulierte Privatbewegungen, ohne Gewinnverteilung; Vorjahre bleiben in derselben Kontenkennung enthalten. */
export async function gbrPartnerOverview(year: number) {
  const company = await loadCompany();
  const partners = await listGbrPartners();
  const e = schema.journalEntries;
  const l = schema.journalLines;
  const rows =
    company.rechtsform === "gbr"
      ? await db
          .select({
            account: l.account,
            opening: sql<string>`coalesce(sum(${l.credit} - ${l.debit}) filter (where ${e.date} < ${`${year}-01-01`} or ${e.sourceType} = 'eroeffnung'), 0)`,
            debit: sql<string>`coalesce(sum(${l.debit}) filter (where ${e.date} >= ${`${year}-01-01`} and ${e.sourceType} <> 'eroeffnung'), 0)`,
            credit: sql<string>`coalesce(sum(${l.credit}) filter (where ${e.date} >= ${`${year}-01-01`} and ${e.sourceType} <> 'eroeffnung'), 0)`,
          })
          .from(l)
          .innerJoin(e, eq(l.entryId, e.id))
          .where(and(lt(e.date, `${year + 1}-01-01`), eq(e.kontenrahmen, company.kontenrahmen)))
          .groupBy(l.account)
      : [];
  return {
    rechtsform: company.rechtsform,
    kontenrahmen: company.kontenrahmen,
    year,
    partners: partners.map((p) => {
      const movements = rows.filter((r) => isGbrPrivateAccount(company.kontenrahmen, r.account) && Number(r.account) % 10 === p.number);
      const sum = (key: "opening" | "debit" | "credit") => movements.reduce((total, r) => total + Number(r[key]), 0);
      return {
        ...p,
        ...gbrPartnerAccounts(company.kontenrahmen, p.number),
        opening: sum("opening"),
        debit: sum("debit"),
        credit: sum("credit"),
        balance: sum("opening") + sum("credit") - sum("debit"),
      };
    }),
  };
}
