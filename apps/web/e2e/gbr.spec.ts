import { expect, test } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { unzipSync } from "fflate";
import { gehe } from "./einrichtung.ts";

/** Eigene EÜR-GbR: zwei Privatkonten, Kasse und DATEV-Paket. Keine Daten der anderen Durchläufe. */
test("GbR: Gesellschafter, Privatbewegungen und protokolliertes Übergabepaket", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const baseURL = String(test.info().project.use.baseURL);
  const setup = await page.request.post(`${baseURL}/api/auth/sign-up/email`, {
    headers: { "x-haben-setup-code": "e2e-einrichtungscode", origin: baseURL },
    data: { name: "Erika Beispiel", email: "gbr@example.test", password: "GbR-Testkonto-2026!" },
  });
  expect(setup.ok(), `Einrichtung: HTTP ${setup.status()}`).toBe(true);
  await gehe(page, "/einstellungen");
  const firma = page.getByRole("form", { name: "Firmendaten" });
  // Das Formular erst nach der Hydrierung befüllen; die Rechtsform ändert dann auch den sichtbaren Hinweis.
  await expect(async () => {
    await firma.getByLabel("Rechtsform", { exact: true }).selectOption("gbr");
    await expect(firma).toContainText("EÜR-GbR mit Gesellschafterkonten");
  }).toPass({ timeout: 30000 });
  await firma.getByLabel("Name", { exact: true }).fill("Beispiel GbR");
  await firma.getByLabel("E-Mail", { exact: true }).fill("rechnung@example.test");
  await firma.getByLabel("Straße und Hausnummer").fill("Musterstraße 12");
  await firma.getByLabel("PLZ").fill("93047");
  await firma.getByLabel("Ort").fill("Regensburg");
  await firma.getByLabel("Bundesland").selectOption("BY");
  await firma.getByLabel(/^Steuernummer/).fill("198/113/10010");
  await firma.getByLabel("IBAN").fill("DE89370400440532013000");
  await firma.getByLabel("Rechtsform", { exact: true }).selectOption("gbr");
  await firma.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Firmendaten gespeichert.")).toBeVisible();
  await gehe(page, "/einstellungen?bereich=konten");
  const year = new Date().getFullYear();
  const overview = page.getByRole("region", { name: "GbR-Gesellschafterkonten" });
  const form = page.getByRole("form", { name: "Gesellschafter anlegen", exact: true });
  for (const name of ["Erika Beispiel", "Max Muster"]) {
    await form.getByLabel("Name des Gesellschafters").fill(name);
    await form.getByLabel("Eintritt", { exact: true }).fill(`${year}-01-01`);
    await form.getByRole("button", { name: "Gesellschafter anlegen" }).click();
    await expect(form.getByLabel("Name des Gesellschafters")).toHaveValue("");
    await expect(overview.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Entnahmen 1801 · Einlagen 1891")).toBeVisible();
  await expect(page.getByText("Entnahmen 1802 · Einlagen 1892")).toBeVisible();

  await gehe(page, "/kasse");
  for (const [name, amount] of [
    ["Erika Beispiel · 1801 / 1891", "100,00"],
    ["Max Muster · 1802 / 1892", "200,00"],
  ]) {
    await page.getByLabel("Gesellschafter", { exact: true }).selectOption({ label: name });
    await page.getByLabel("Betrag (€)", { exact: true }).fill(amount);
    await page.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("gebucht");
  }
  await page.getByRole("button", { name: "Entnahme eines Gesellschafters", exact: true }).click();
  await page.getByLabel("Gesellschafter", { exact: true }).selectOption({ label: "Max Muster · 1802 / 1892" });
  await page.getByLabel("Betrag (€)", { exact: true }).fill("50,00");
  await page.getByRole("button", { name: "Buchen", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("gebucht");

  await gehe(page, "/einstellungen?bereich=konten");
  await expect(overview).toContainText("150,00");
  await expect(overview).toContainText("100,00");
  if (process.env.GBR_SCREENSHOTS_DIR) {
    await mkdir(process.env.GBR_SCREENSHOTS_DIR, { recursive: true });
    for (const modus of ["hell", "dunkel"])
      for (const [size, width, height] of [
        ["desktop", 1280, 1000],
        ["handy", 375, 812],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.evaluate((value) => localStorage.setItem("haben-modus", value), modus);
        await page.reload();
        await expect(overview).toContainText("Max Muster");
        await page.screenshot({ path: `${process.env.GBR_SCREENSHOTS_DIR}/gesellschafter-${modus}-${size}-nachher.png`, fullPage: true });
      }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }
  await gehe(page, "/einstellungen?bereich=export");
  const datev = page.getByRole("form", { name: "DATEV-Export", exact: true });
  await datev.getByLabel("Beraternummer").fill("12345");
  await datev.getByLabel("Mandantennummer").fill("123");
  await datev.getByRole("button", { name: "Speichern", exact: true }).click();
  const download = page.waitForEvent("download");
  await datev.getByRole("link", { name: "GbR-Übergabepaket mit Originalbelegen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`Haben-GbR-${year}.zip`);
  const files = unzipSync(new Uint8Array(await readFile((await file.path())!)));
  const manifest = JSON.parse(new TextDecoder().decode(files["uebergabe.json"]!));
  expect(manifest.entryIds).toHaveLength(3);
  const csv = new TextDecoder("windows-1252").decode(files[`EXTF_Buchungsstapel_${year}.csv`]!);
  expect(csv).toContain("1891");
  expect(csv).toContain("1892");
  expect(csv).toContain("1802");
  const repeated = page.waitForEvent("download");
  await datev.getByRole("link", { name: "GbR-Übergabepaket mit Originalbelegen" }).click();
  await repeated;
  await expect(datev).toContainText("bereits in einem erstellten Übergabepaket");
  expect(errors).toEqual([]);
});
