---
title: "bm.haben: eigene Releases und Produktionsupdates"
description: >-
  Releases des Forks mattyg-repo/bm.haben bauen und eine vorhandene Docker-Installation nach Backup automatisch aktualisieren.
---

# Eigene Releases von bm.haben

Dieser Release-Kanal gehört zu [mattyg-repo/bm.haben](https://github.com/mattyg-repo/bm.haben).
Ein Push auf `main` oder einen Entwicklungsbranch aktualisiert den Produktionsserver nicht.

## Entwickeln und veröffentlichen

1. Änderungen auf einem eigenen Branch entwickeln, prüfen und per Pull Request in den Fork übernehmen. Ein Beitrag zu Haben geht getrennt nach `Speicherstadt/haben`.
2. In GitHub unter **Releases → Draft a new release** den geprüften Commit oder Branch wählen. Der Tag besteht aus `bm-v`, der Haben-Basisversion und einer eigenen laufenden Nummer, etwa `bm-v0.11.0.1`, danach `bm-v0.11.0.2`.
3. Für einen Teststand `-rc.1` anhängen und **Set as a pre-release** wählen. Der Produktionsserver übernimmt keine Pre-releases. Bei einer neuen Haben-Basis mit Migrationen zuerst den Teststand mit einem wiederhergestellten Backup in einer getrennten Instanz prüfen.
4. Ein freigegebenes Release ohne RC-Suffix als **Latest release** veröffentlichen. Der Workflow **Fork-Release** prüft den Quellcode mit der CI und baut das App-Image für amd64 und arm64 unter `ghcr.io/mattyg-repo/bm.haben:<tag>`.
5. Erst wenn der Workflow erfolgreich ist und `haben-image.json` am Release hängt, ist das Release für den Server verfügbar. Bei fehlgeschlagenem Build läuft der bisherige Stand weiter. Einen veröffentlichten Tag nicht verschieben oder wiederverwenden.

Die offiziellen Release-Workflows für Docker Hub und Haben-Versionen werden dafür nicht benutzt; `bm-v…` löst sie nicht aus. Für GHCR nutzt der Workflow seinen kurzlebigen `GITHUB_TOKEN`, keinen Zugang zum Produktionsserver.

Nach dem ersten Build das Paket **bm.haben** in GitHub unter **Package settings → Change visibility → Public** stellen. Der Server lädt das bereits öffentliche Programm dann ohne GitHub-Zugangsdaten. [GitHub: Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## Bestehenden Server umstellen

Die vorhandene Installation unter `/root/haben` mit `compose.yml`, `.env`, optional `compose.override.yml` und den Diensten `app`, `db` und `backup` bleibt bestehen. Vorher ein [Backup](installation-backup.md) anlegen. Die Dateien aus `deploy/fork/` eines geprüften Stands auf den Server kopieren und dort als root ausführen:

```sh
sh deploy/fork/install.sh /root/haben
```

Das richtet `/usr/local/sbin/haben-fork-update` und einen systemd-Timer ein. Es ergänzt `compose.fork.yml` und den Eintrag `COMPOSE_FILE` in `.env`; eigene Caddy-Einstellungen, Schlüssel und Datenvolumes bleiben erhalten. Zunächst bleibt das laufende Image ausgewählt. Der Installer startet die App nicht neu.

Der Timer prüft täglich zwischen **04:30 und 04:40 Uhr, Europe/Berlin**. Ein verpasster Termin wird beim nächsten Serverstart nachgeholt. Nur das neueste stabile `bm-v…`-Release mit fertigem Manifest wird übernommen, keine Entwicklungsstände oder älteren Versionen.

```sh
# Nur das verfügbare Release ansehen
haben-fork-update --directory /root/haben --check

# Dasselbe Update sofort ausführen
systemctl start haben-fork-update.service

# Stand und Protokoll
systemctl list-timers haben-fork-update.timer
journalctl -u haben-fork-update.service -n 60 --no-pager
```

Ein laufender Umzug verschiebt das Update. Ansonsten lädt der Updater das Image über seinen SHA-256-Digest, prüft Quell-Repository und Commit, sichert mit `backup.sh` und startet nur die App neu. Datenbank, Backup- und Proxy-Container werden nicht aktualisiert. Der neue Stand muss gesund starten. Die installierte Version steht in `/root/haben/.fork-release.json`.

## Fehlgeschlagenes Update

Schlägt der App-Start oder die Gesundheitsprüfung fehl, blockiert `.fork-update-failed.json` weitere automatische Updates. `.fork-update-before.json` nennt das bisherige Image und die vorherige Compose-Ergänzung. Es gibt kein automatisches Zurücksetzen nur des Images: Eine Migration kann die Datenbank bereits verändert haben.

Dann Timer anhalten und Logs prüfen:

```sh
systemctl disable --now haben-fork-update.timer
```

Vor dem Wiederherstellen die vorherige Fork-Konfiguration zurückschreiben. `compose.fork.yml` wird zuletzt geladen und hätte sonst Vorrang vor der Image-Angabe in `compose.override.yml` aus der allgemeinen Wiederherstellungsanleitung:

```sh
cd /root/haben
python3 - <<'PY'
import json
from pathlib import Path
before = json.loads(Path(".fork-update-before.json").read_text())
previous = before["previousCompose"]
if previous is None:
    previous = json.dumps({"services": {"app": {"image": before["previousImage"]}}})
Path("compose.fork.yml").write_text(previous + "\n")
Path(".fork-release.json").write_text(json.dumps(before["previous"]) + "\n")
PY
```

Danach nach [Update zurücknehmen](installation-backup.md#update-zurücknehmen) Datenbank und Belege aus der Sicherung vor dem fehlgeschlagenen Update mit diesem App-Image gemeinsam wiederherstellen. Die Fehlermarkierung erst nach erfolgreicher Wiederherstellung entfernen und den Timer wieder aktivieren.

Die Update-Skripte selbst werden bei einem App-Release nicht ersetzt; Änderungen daran werden nach Prüfung erneut mit `install.sh` installiert.
