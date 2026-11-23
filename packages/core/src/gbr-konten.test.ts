import { describe, expect, it } from "vitest";
import { isKapitalgesellschaft } from "./rechtsform.ts";
import { gbrAccount, gbrBaseAccount, gbrPostingLines } from "./gbr-konten.ts";
import { cashPosting, documentPosting } from "./posting.ts";

describe("GbR-Privatkonten", () => {
  it("behandelt die GbR nicht als Kapitalgesellschaft", () => {
    expect(isKapitalgesellschaft("gbr")).toBe(false);
    expect(isKapitalgesellschaft("gmbh")).toBe(true);
    expect(isKapitalgesellschaft("ug")).toBe(true);
  });

  it.each([
    ["SKR03", "1800", "1890", "1802", "1892"],
    ["SKR04", "2100", "2180", "2102", "2182"],
  ] as const)("%s: trennt Einlagen, Entnahmen und privat bezahlte Belege", (kr, entnahme, einlage, partnerEntnahme, partnerEinlage) => {
    expect(gbrAccount(kr, entnahme, 2)).toBe(partnerEntnahme);
    expect(gbrAccount(kr, einlage, 2)).toBe(partnerEinlage);
    const beleg = documentPosting(
      { net: 10000, tax: 1900, gross: 11900, taxes: [{ rate: 1900, base: 10000, tax: 1900 }] },
      "software",
      kr,
      "gbr",
      "privat",
      true,
    );
    const mapped = gbrPostingLines(beleg, kr, 2);
    expect(mapped.some((line) => line.account === partnerEinlage && line.credit === 11900)).toBe(true);
    expect(mapped.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(gbrPostingLines(cashPosting("privat", -5000, kr, "gbr"), kr, 2).some((line) => line.account === partnerEntnahme && line.debit === 5000)).toBe(true);
    expect(gbrBaseAccount(kr, partnerEntnahme)).toBe(entnahme);
  });

  it("erhält die Privatkontenart und lehnt fremde Konten ab", () => {
    expect(gbrAccount("SKR03", "1810", 3)).toBe("1813");
    expect(gbrAccount("SKR04", "2150", 3)).toBe("2153");
    expect(gbrAccount("SKR03", "1200", 3)).toBe("1200");
    expect(() => gbrAccount("SKR03", "1801", 2)).toThrow(/anderen Gesellschafters/);
    expect(() => gbrAccount("SKR03", "1800", 0)).toThrow(/1 und 9/);
  });
});
