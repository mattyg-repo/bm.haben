#!/usr/bin/env python3
"""Nur freigegebene Fork-Releases einspielen; keine Quelltexte oder Shell-Befehle aus Release-Daten ausführen."""
import argparse
import fcntl
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPOSITORY = "mattyg-repo/bm.haben"
IMAGE = "ghcr.io/mattyg-repo/bm.haben"
TAG = re.compile(r"bm-v\d+\.\d+\.\d+\.[1-9]\d*")


def get_json(url):
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "bm-haben-fork-update"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def validate_manifest(release, manifest):
    tag = release.get("tag_name", "")
    if release.get("draft") or release.get("prerelease") or not TAG.fullmatch(tag):
        raise ValueError("Kein stabiles Fork-Release")
    if manifest.get("schema") != 1 or manifest.get("repository") != REPOSITORY or manifest.get("tag") != tag:
        raise ValueError("Release und Image-Manifest passen nicht zusammen")
    if not re.fullmatch(re.escape(IMAGE) + r"@sha256:[0-9a-f]{64}", manifest.get("image", "")):
        raise ValueError("Unerwartetes Image oder fehlender Digest")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("commit", "")):
        raise ValueError("Ungültiger Quellcode-Commit")
    return manifest


def latest_release():
    try:
        release = get_json(f"https://api.github.com/repos/{REPOSITORY}/releases/latest")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    tag = release.get("tag_name", "")
    if release.get("draft") or release.get("prerelease") or not TAG.fullmatch(tag):
        return None
    if not any(asset.get("name") == "haben-image.json" for asset in release.get("assets", [])):
        print("Das neueste Release wird noch geprüft oder gebaut; kein Update.", flush=True)
        return None
    manifest = get_json(f"https://github.com/{REPOSITORY}/releases/download/{tag}/haben-image.json")
    return validate_manifest(release, manifest)


def run(*args):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def compose(directory, *args):
    files = ["compose.yml"]
    if (directory / "compose.override.yml").exists():
        files.append("compose.override.yml")
    if (directory / "compose.fork.yml").exists():
        files.append("compose.fork.yml")
    command = ["docker", "compose", "--project-directory", str(directory)]
    for name in files:
        command.extend(["-f", str(directory / name)])
    return run(*command, *args)


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".new")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def check_image(manifest):
    run("docker", "pull", manifest["image"])
    metadata = json.loads(run("docker", "image", "inspect", manifest["image"]))[0]
    labels = metadata.get("Config", {}).get("Labels", {}) or {}
    if labels.get("org.opencontainers.image.source") != f"https://github.com/{REPOSITORY}" or labels.get("org.opencontainers.image.revision") != manifest["commit"]:
        raise ValueError("Das geladene Image gehört nicht zum angekündigten Quellcode")


def app_healthy(container):
    if not container:
        return False
    state = json.loads(run("docker", "inspect", container))[0]["State"]
    return state.get("Running", False) and state.get("Health", {}).get("Status") == "healthy"


def apply_release(directory, manifest):
    failed = directory / ".fork-update-failed.json"
    if failed.exists():
        raise ValueError("Ein früheres Update ist fehlgeschlagen; erst prüfen und die Fehlermarkierung nach Wiederherstellung entfernen")
    state_file = directory / ".fork-release.json"
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
    if TAG.fullmatch(state.get("tag", "")):
        version = lambda tag: tuple(map(int, tag.removeprefix("bm-v").split(".")))
        if version(manifest["tag"]) < version(state["tag"]):
            raise ValueError("Ein älteres Release wird nicht automatisch eingespielt; Datenbank aus dem Backup wiederherstellen")
    if state.get("image") == manifest["image"]:
        print("Das freigegebene Fork-Release ist bereits installiert.", flush=True)
        return
    container = compose(directory, "ps", "-q", "app")
    if not app_healthy(container):
        raise ValueError("Die bisherige App ist nicht gesund; kein automatisches Update")
    busy = compose(directory, "exec", "-T", "db", "psql", "-U", "haben", "-d", "haben", "-Atc",
                   "SELECT EXISTS (SELECT 1 FROM lexoffice_imports WHERE status = 'laeuft')")
    if busy != "f":
        print("Ein Umzug läuft oder sein Zustand ist unklar; Update auf den nächsten Lauf verschoben.", flush=True)
        return
    check_image(manifest)
    compose(directory, "exec", "-T", "backup", "backup.sh")
    override = directory / "compose.fork.yml"
    previous = override.read_text() if override.exists() else None
    before = {"previous": state, "target": manifest, "previousCompose": previous,
              "previousImage": json.loads(run("docker", "inspect", container))[0]["Image"]}
    atomic_json(directory / ".fork-update-before.json", before)
    # Kein automatisches Zurücksetzen nur des Images: Migrationen könnten die Datenbank schon verändert haben.
    # Bei einem Fehler bleibt die Sicherung erhalten, und weitere automatische Versuche werden gesperrt.
    try:
        atomic_json(override, {"services": {"app": {"image": manifest["image"]}}})
        compose(directory, "config", "-q")
        compose(directory, "up", "-d", "--no-deps", "--wait", "--wait-timeout", "240", "app")
        if not app_healthy(compose(directory, "ps", "-q", "app")):
            raise ValueError("Die App ist nach dem Update nicht gesund")
    except Exception:
        atomic_json(failed, before)
        raise
    atomic_json(state_file, manifest)
    print(f"Fork-Release {manifest['tag']} ist gesund installiert ({manifest['commit'][:12]}).", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("/root/haben"))
    parser.add_argument("--check", action="store_true", help="Nur das veröffentlichte Release prüfen, nichts installieren")
    args = parser.parse_args()
    directory = args.directory.resolve()
    with (directory / ".fork-update.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Ein Update läuft bereits.", flush=True)
            return
        manifest = latest_release()
        if manifest is None:
            print("Kein freigegebenes Fork-Release mit fertigem Image vorhanden.", flush=True)
        elif args.check:
            print(json.dumps(manifest, indent=2), flush=True)
        else:
            apply_release(directory, manifest)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Fork-Update abgebrochen: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
