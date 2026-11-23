import { isGbrPrivateAccount } from "./manual.ts";
import type { Kontenrahmen, PostingLine } from "./posting.ts";

/**
 * Privatkonten je Gesellschafter: die letzte Stelle unterscheidet neun Personen. Die Kontenart bleibt erhalten,
 * z. B. SKR03 1801/1891, SKR04 2101/2181. Quelle: DATEV SKR03/04 2026, Privatkonten sowie SKR04-Spenden 2250–2259.
 * Die Kennung ist nach Anlage fest; Buchungen und DATEV verwenden dieselbe Nummer. Keine Kapital- oder Gewinnverteilung.
 */
export const GBR_PARTNER_LIMIT = 9;

export function gbrAccount(kontenrahmen: Kontenrahmen, account: string, number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > GBR_PARTNER_LIMIT) throw new Error("Gesellschafterkennung zwischen 1 und 9 erwartet.");
  if (!isGbrPrivateAccount(kontenrahmen, account)) return account;
  const existing = Number(account) % 10;
  if (existing !== 0 && existing !== number) throw new Error("Die Buchung enthält ein Privatkonto eines anderen Gesellschafters.");
  return String(Number(account) - existing + number);
}

/** Grundkonto, nur für die fachliche Auswertung; die gespeicherten Kontonummern bleiben unverändert. */
export function gbrBaseAccount(kontenrahmen: Kontenrahmen, account: string): string {
  return isGbrPrivateAccount(kontenrahmen, account) ? String(Number(account) - (Number(account) % 10)) : account;
}

export function gbrAccountFamily(account: string): string[] {
  return Array.from({ length: 10 }, (_, number) => String(Number(account) + number));
}

export function gbrPostingLines(lines: readonly PostingLine[], kontenrahmen: Kontenrahmen, number: number): PostingLine[] {
  return lines.map((line) => ({ ...line, account: gbrAccount(kontenrahmen, line.account, number) }));
}
