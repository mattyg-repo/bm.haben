---
title: "GbR: Umsetzungsstand und offene Ausbauschritte"
description: >-
  Stand der GbR-Erweiterung im Fork: umgesetzte Belegführung, Gesellschafterkonten und
  DATEV-Übergabe, geprüfte Abläufe und noch fehlende Funktionen.
---

# GbR: Umsetzungsstand

Stand: **23. November 2026**. Funktionsstand: `f008819a`, einschließlich der Erstumsetzung `f4f71312`; Basis ist Upstream `33c9555f`. Die Erweiterung gehört zum Fork `mattyg-repo/bm.haben`; eine Übernahme durch `Speicherstadt/haben` ist nicht erfolgt.

Das Ziel der ersten Stufe ist die laufende Belegführung einer **GbR mit EÜR**, mit getrennten Privatbewegungen je Gesellschafter und Übergabe an MonKey Office. Dort erfolgen Abschlusskorrekturen und die abschließenden Buchungen. Der vollständige GbR-Abschluss innerhalb von Haben ist noch nicht umgesetzt.

## Umgesetzt

| Bereich | Verfügbarer Umfang |
| --- | --- |
| Einrichtung | Rechtsform **GbR (EÜR)**, SKR03 und SKR04, Ist- und Soll-Versteuerung |
| Gesellschafter | Stammdaten mit Name, Eintritt und Austritt sowie festen Kontenkennungen; insgesamt bis zu neun Kennungen, auch über Gesellschafterwechsel hinweg |
| Belege | Gesellschafterwahl für privat ausgelegte Rechnungen der GbR und Privatanteile |
| Bank | Gesellschafterwahl am Umsatz, Vorgabe am privaten Bankkonto und abweichende Personen je Teil einer Aufteilung |
| Kasse | Personenbezogene Einlagen und Entnahmen |
| Konten | Gesellschafternamen im Journal und Kontenblatt; Jahresübersicht mit Anfangssaldo, Soll/Haben und Endsaldo ohne Gewinnverteilung |
| Anfangsbestände | Manuelle Eröffnung der Gesellschafterkonten und Berücksichtigung der Vorjahressalden |
| Korrekturen | Stornos mit der ursprünglichen Personenkennung, auch nach Austritt; Schutz gebuchter Zuordnungen gegen nachträgliche Änderung |
| DATEV | Gebuchte Kontonummern im bestehenden DATEV-Stapel; zusätzlich ein ZIP mit Originalbelegen, Rechnungen, Zuordnungsliste, Manifest und Prüfsummen |
| Übergabeprotokoll | Protokollierte Paketerstellung mit Journal-IDs und Warnung bei erneut enthaltenen Buchungen; Vorjahresbelege werden bei Zahlungen im Exportzeitraum berücksichtigt |
| Schutzmechanismen | Audit und SQL-Sperren für die neuen Tabellen; bestehende Journal- und Belegsiegel bleiben erhalten |

Die Bedienung und die verbindlichen Grenzen der Kontenbelegung stehen in [GbR mit EÜR](gbr.md). Insbesondere sind die Konten mit MonKey Office abzustimmen: Die Endziffer als Gesellschafterkennung ist eine eigene Belegung von Haben.

Gesellschafter sind fachliche Stammdaten. Ihre Anlage erzeugt keinen eigenen Benutzerzugang und keine auf die jeweilige Person begrenzten Zugriffsrechte.

## Noch offen: Übergabe im Alltag

| Priorität | Fehlender Nachweis oder Ausbau | Erledigt, wenn … |
| --- | --- | --- |
| 1 | **Tatsächlicher Import in MonKey Office** | Ein Paket in einer Testfirma importiert wurde und Konten, Steuerschlüssel, Festschreibung und Salden für beide Kontenrahmen geprüft sind. Dazu gehören Anfangsbestände, Vorjahreszahlungen, Aufteilungen und Stornos. |
| 1 | **Betriebsübernahme der Erweiterung** | Der gewünschte Fork-Stand als eigene Version gebaut, in einer getrennten Instanz mit Testdaten geprüft und der Weg für Backup, Migration und Aktualisierung festgelegt ist. Ein Git-Push allein ist kein Nachweis einer erfolgreichen Produktivinstallation. |
| 2 | **Belegverknüpfung im Zielprogramm** | Ein bestätigter Arbeitsablauf oder eine Anbindung die Originaldateien den importierten MonKey-Buchungen zuordnet. Die vorhandene CSV-Zuordnungsliste allein erzeugt keine automatische Verknüpfung. |
| 2 | **Rückübernahme der Abschlusskorrekturen** | Ein abgestimmter Import oder manueller Ablauf Korrekturen aus MonKey nachvollziehbar nach Haben übernimmt und Doppelbuchungen verhindert. Eine automatische Rücksynchronisierung fehlt. |
| 2 | **Gesellschaftervorgabe an Dauerbelegen** | Die Vorlage eine Person an nachfolgende Belege weitergeben kann. Derzeit muss die Person am erzeugten Beleg vor der Privatbuchung gewählt werden. |

Das Übergabeprotokoll bestätigt die **Erstellung**, nicht den erfolgreichen Download oder Import. Überlappende Pakete enthalten ihre Buchungen weiterhin vollständig; sie dürfen nicht ungeprüft nebeneinander importiert werden.

## Noch offen: vollständiger GbR-Prozess in Haben

Diese Punkte sind weitere Ausbauschritte, keine bereits vorhandenen Abschlussfunktionen:

- **Gewinn- und Verlustverteilung:** Beteiligungsquoten, Verteilungsschlüssel, unterjährige Änderungen und zugehörige Buchungen.
- **Abschließende Gesellschafterabrechnung:** Kapitalkontenmodell, Ergebnisverwendung und verbindliche Abstimmung der Ansprüche je Gesellschafter. Die vorhandenen Privatkontensalden ersetzen diese Abrechnung nicht.
- **GbR-Jahreserklärungen:** Übermittlung der Anlage EÜR für die GbR, Feststellungserklärung und weitere benötigte GbR-Erklärungen. Die Jahreserklärungsseite bietet für GbR derzeit nur Umsatzsteuer an.
- **Sonderbereich der Gesellschafter:** Sonderbetriebseinnahmen, Sonderbetriebsausgaben, Sondervergütungen und die persönlichen Pauschalen. Die Pauschalenfunktion ist für GbR in dieser Stufe ausdrücklich gesperrt.
- **Automatische private Kfz-Nutzung:** Personenbezogene Zuordnung und Berechnung bei der GbR; derzeit gesperrt. Anlagen und AfA ohne Privatnutzung sind nutzbar.
- **Mehr als neun Gesellschafterkennungen:** Erweiterung des Kontenmodells mit Migration und unveränderter Zuordnung bestehender Buchungen.
- **Öffentliche GbR-Verwaltung über API/MCP:** Eigene Operationen zum Anlegen und Abfragen der Gesellschafter und ihrer Quellzuordnungen fehlen; derzeit erfolgt die Verwaltung über die Oberfläche und deren Serverfunktionen. Einzelne Buchungsschemas nehmen bereits eine `partnerId` an.
- **Bilanzierende GbR:** Eigenständiger Umfang mit geeignetem Abschluss- und Kapitalkontenmodell; die aktuelle Rechtsformoption gilt ausschließlich für EÜR.

## Geprüfter Stand

Für den Funktionsstand `f008819a` wurden erfolgreich ausgeführt:

- Gezielte Vitest- und PostgreSQL-Tests für Kernlogik und Buchhaltung sowie die betroffenen Auswertungen; SKR03/SKR04 und Ist/Soll sind in den GbR-Fällen abgedeckt.
- Regressionen für Aufteilungen mit mehreren Personen, Storno, SKR04-Spenden, Kontovorgaben, Vorjahresbelege, Anfangsbestände und gleichzeitige Buchung und Gesellschafteränderung über die Anwendung.
- SQL-Schutzprüfungen einschließlich Triggerbestand und `TRUNCATE`-Sperren.
- Browserablauf gegen den Produktionsbuild: Einrichtung, zwei Gesellschafter, Einlagen/Entnahme, Salden, ZIP-Download und Warnung bei wiederholter Übergabe.
- Sichtprüfung auf Desktop und Handy im hellen und dunklen Modus.
- Lint, Typprüfungen, Produktionsbuild und strenger Dokumentationsbuild; unabhängige Code- und Dokumentationsprüfung einschließlich der Review-Korrekturen.

Die vollständige Testsuite wurde lokal nicht ausgeführt. Der tatsächliche MonKey-Import und die Produktivinstallation dieser Erweiterung wurden nicht nachgewiesen. Ergebnisse späterer GitHub-CI-Läufe sind separat zu prüfen.

## Technische Anknüpfungspunkte

| Thema | Dateien im Repository |
| --- | --- |
| Kontenbelegung | `packages/core/src/gbr-konten.ts` |
| Stammdaten, Zuordnungen, Salden | `apps/web/src/server/modules/stammdaten/gbr-partners.ts` |
| Zentrale Buchungsprüfung | `apps/web/src/server/modules/buchhaltung/gbr-posting.ts`, `ledger.ts` im selben Modul |
| Übergabepaket | `apps/web/src/server/modules/archiv/gbr-transfer.ts` |
| Datenmodell und Schutz | Migrationen `0319` bis `0323` unter `apps/web/drizzle/` |
| Integrationstests | `gbr.test.ts`, `gbr-review.test.ts`, `gbr-lock-review.test.ts` und `gbr-scope-review.test.ts` unter `apps/web/src/server/modules/stammdaten/` |
| Browserablauf | `apps/web/e2e/gbr.spec.ts` |

Die GbR-Änderungen sind eigene Commits auf der genannten Upstream-Basis. Künftige Upstream-Änderungen müssen mit diesen Erweiterungen zusammengeführt und erneut geprüft werden; eine Synchronisierung des Forks ersetzt diese Prüfung nicht.
