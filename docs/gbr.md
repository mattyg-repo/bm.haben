---
title: "GbR mit EÜR: Gesellschafterkonten und DATEV-Übergabe"
description: >-
  Belege und Privatbewegungen je GbR-Gesellschafter führen und mit Originalen an MonKey Office
  übergeben. Gewinnverteilung und Feststellung bleiben zunächst außerhalb von Haben.
---

# GbR mit EÜR

Haben führt die laufende Buchhaltung einer GbR mit Einnahmen-Überschuss-Rechnung und getrennten Privatkonten je Gesellschafter. Abschluss, Gewinnverteilung und Feststellungserklärung erledigst du in dieser Ausbaustufe außerhalb von Haben, etwa mit MonKey Office und der Steuerberatung. Eine bilanzierende GbR wird nicht unterstützt.

## Einrichten

1. Vor der ersten Buchung unter **Einstellungen › Firma** die Rechtsform **GbR (EÜR)** und den Kontenrahmen der bisherigen Buchhaltung wählen. Eine schon bebuchte Instanz lässt sich nicht nachträglich vom Einzelunternehmen auf GbR umstellen. Auch der Kontenrahmen ist bei der GbR ab der ersten Buchung fest.
2. Unter **Einstellungen › Eigene Konten** die Gesellschafter mit Name und Eintritt anlegen. Haben vergibt feste Kennungen von 1 bis 9. Jede Kennung bleibt bei derselben Person, auch nach ihrem Austritt; die erste Ausbaustufe unterstützt insgesamt neun Kennungen.
3. Die angezeigten Konten mit MonKey Office abstimmen: etwa SKR03 1801/1891 und 1802/1892 für Entnahmen/Einlagen, in SKR04 2101/2181 und 2102/2182. Auch andere Privatkontenarten behalten ihre Bedeutung und bekommen dieselbe letzte Ziffer. Grundlage sind die Privatkonten im [DATEV SKR03](https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11174%20SKR03%20BilrUg.pdf) beziehungsweise [SKR04](https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/mandant/unternehmer/branche/bau/11175%20SKR04%20BilrUg.pdf) 2026.

Name, Eintritt und Austritt lassen sich bearbeiten. Kontenkennungen lassen sich weder ändern noch löschen. Eintritt oder Austritt dürfen bestehende Privatbuchungen nicht ausschließen; neue Buchungen außerhalb der Beteiligungszeit werden abgelehnt. Stornos bleiben auch nach dem Austritt möglich.

## Belege, Bank und Kasse

- **Beleg:** Den Gesellschafter im Abschnitt **Bezahlung** wählen. Die Auswahl wird sofort gespeichert. Sie ist erforderlich, wenn ein Gesellschafter die Rechnung der GbR ausgelegt hat oder ein Privatanteil auf sein Konto gebucht wird.
- **Bank:** Vor einer Privatbewegung den Gesellschafter am Umsatz wählen. Das gilt auch für Geschäftsvorfälle auf einem privaten Bankkonto. Dort kann vor der ersten Zuordnung eine feste Person als Kontovorgabe gewählt werden; eine ausdrückliche Wahl am Umsatz oder Teil geht vor. Bei **Aufteilen** lässt sich für jeden Teil eine andere Person wählen; ohne eigene Wahl gilt die Zuordnung des Umsatzes.
- **Kasse:** Bei Einlage und Entnahme den Gesellschafter wählen.

Ab der Buchung bleibt die Zuordnung fest. Korrekturen laufen über Storno und Neuerfassung beziehungsweise eine neue Bankzuordnung. Nach dem ersten gebuchten Teil lässt sich die Gesellschafterwahl eines Bankumsatzes nicht mehr ändern; einzelne Teile können weiterhin eine ausdrückliche eigene Wahl tragen.

Ein privat bezahlter Beleg der GbR ist nicht automatisch eine Sonderbetriebsausgabe. Sonderbetriebseinnahmen und -ausgaben, Sondervergütungen und persönliche Steuern der Gesellschafter müssen außerhalb dieser laufenden GbR-Buchhaltung beurteilt und erfasst werden; siehe die [ELSTER-Hilfe zur Feststellung](https://www.elster.de/eportal/helpGlobal?themaGlobal=help_fein_2025).

## Konten und Anfangsbestände

Die Gesellschafterübersicht unter **Einstellungen › Eigene Konten** zeigt Anfangssaldo, Soll-/Habenbewegungen und Endsaldo des gewählten Jahres. Vorjahre bleiben enthalten. Ein positiver Saldo bedeutet mehr Haben- als Sollbewegungen auf den Privatkonten; er enthält keine Gewinnverteilung und bestimmt keinen abschließenden Zahlungsanspruch. Einzelne Buchungen stehen im [Kontenblatt](buchhaltung.md#die-seite-konten).

Anfangsbestände aus der bisherigen Buchhaltung erfasst du unter **Buchungen › Buchung erfassen › Eröffnungsbuchung** zum 1. Januar des ersten Jahres, etwa **9000 an 1891** für einen übernommenen Habenbestand. Die Eröffnung übernimmt ausschließlich Bestände. Bereits vorhandene Salden dürfen nicht noch einmal gebucht werden. Entnahmen und Einlagen der Eröffnung sind keine laufenden Bewegungen des neuen Jahres.

## Übergabe an MonKey Office

1. Unter **Einstellungen › Export › DATEV-Export** Berater- und Mandantennummer speichern und Jahr, Quartal oder Monat wählen.
2. **GbR-Übergabepaket mit Originalbelegen** herunterladen. Das ZIP enthält den DATEV-Stapel, die zugehörigen Originalbelege und Rechnungen, `belegzuordnung.csv`, `uebergabe.json` und Prüfsummen. Auch ein Vorjahresbeleg gehört dazu, wenn seine Zahlung im gewählten Zeitraum liegt.
3. Den Import zuerst in einer Testfirma prüfen: Konten, Steuerschlüssel, Festschreibung und Kontensalden. Haben exportiert bereits gebuchte Journaleinträge mit ihrem Festschreibungskennzeichen. Eine automatische Verknüpfung der Originaldateien in MonKey Office ist nicht zugesichert; die Zuordnungsliste nennt die Dateien je Journalbuchung.

Haben protokolliert die **Erstellung** des Pakets, nicht den erfolgreichen Import im Fremdprogramm. Bei erneut enthaltenen Journal-IDs erscheint eine Warnung. Ein Paket enthält seinen Zeitraum trotzdem vollständig: Überlappende Pakete dürfen nicht vollständig nebeneinander importiert werden. Die Buchungen eines früheren Pakets werden nicht still ausgelassen.

Abschlusskorrekturen aus MonKey Office werden nicht automatisch nach Haben zurückübertragen. Bis zur abgestimmten Rückübernahme enthält Haben den laufenden Buchungsstand; für den Abschluss gilt der in MonKey Office geprüfte Stand. Ein vollständiger GbR-Abschluss einschließlich Feststellung in Haben bleibt ein weiterer Ausbauschritt.
