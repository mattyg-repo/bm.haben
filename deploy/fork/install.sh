#!/bin/sh
# Ergänzt die bestehende Installation; Datenbank, Schlüssel, Caddy und eigene Overrides bleiben erhalten.
set -eu
test "$(id -u)" = 0
cd "$(dirname "$0")"
directory=${1:-/root/haben}
test -f "$directory/compose.yml"
test -f "$directory/.env"
install -m 755 update.py /usr/local/sbin/haben-fork-update
python3 - "$directory" <<'PY'
import json, pathlib, subprocess, sys
directory = pathlib.Path(sys.argv[1]).resolve()
files = ["compose.yml"]
if (directory / "compose.override.yml").exists():
    files.append("compose.override.yml")
command = ["docker", "compose", "--project-directory", str(directory)]
for name in files:
    command += ["-f", str(directory / name)]
fork = directory / "compose.fork.yml"
if not fork.exists():
    container = subprocess.check_output(command + ["ps", "-q", "app"], text=True).strip()
    metadata = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
    fork.write_text(json.dumps({"services": {"app": {"image": metadata["Image"]}}}, indent=2) + "\n")
    fork.chmod(0o600)
files.append("compose.fork.yml")
env = directory / ".env"
old = env.read_text()
value = ":".join(files)
lines = [line for line in old.splitlines() if not line.startswith("COMPOSE_FILE=")]
lines.append("COMPOSE_FILE=" + value)
temporary = env.with_name(".env.fork-new")
temporary.write_text("\n".join(lines) + "\n")
temporary.chmod(0o600)
temporary.replace(env)
unit = pathlib.Path("/etc/systemd/system/haben-fork-update.service")
unit.write_text("[Unit]\nDescription=Geprüfte Releases von bm.haben installieren\nAfter=docker.service network-online.target\nWants=network-online.target\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/haben-fork-update --directory " + str(directory) + "\nTimeoutStartSec=30min\n")
PY
install -m 644 haben-fork-update.timer /etc/systemd/system/haben-fork-update.timer
systemctl daemon-reload
systemctl enable --now haben-fork-update.timer
/usr/local/sbin/haben-fork-update --directory "$directory" --check
