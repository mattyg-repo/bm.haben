"""Bestehende Compose-Dateien und Schlüssel behalten; nur den eigenen Release-Override ergänzen."""
import json
from pathlib import Path
import re
import subprocess
import sys


COMPOSE_FILE_ASSIGNMENT = re.compile(r"^\s*(?:export\s+)?COMPOSE_FILE\s*=")


def configure(directory):
    directory = directory.resolve()
    env = directory / ".env"
    original = env.read_text()
    configured = [line.partition("=")[2].strip().strip("\"'") for line in original.splitlines() if COMPOSE_FILE_ASSIGNMENT.match(line)]
    if configured:
        files = configured[-1].split(":")
    else:
        files = ["compose.yml"]
        if (directory / "compose.override.yml").exists():
            files.append("compose.override.yml")
    for name in files:
        if name != "compose.fork.yml" and not (directory / name).is_file():
            raise ValueError("Bestehende Compose-Datei fehlt: " + name)
    fork = directory / "compose.fork.yml"
    if not fork.exists():
        command = ["docker", "compose", "--project-directory", str(directory)]
        container = subprocess.check_output(command + ["ps", "-q", "app"], cwd=directory, text=True).strip()
        if not container:
            raise ValueError("Die vorhandene App läuft nicht")
        metadata = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
        fork.write_text(json.dumps({"services": {"app": {"image": metadata["Image"]}}}, indent=2) + "\n")
        fork.chmod(0o600)
    files = [name for name in files if name != "compose.fork.yml"] + ["compose.fork.yml"]
    lines = [line for line in original.splitlines() if not COMPOSE_FILE_ASSIGNMENT.match(line)]
    lines.append("COMPOSE_FILE=" + ":".join(files))
    temporary = env.with_name(".env.fork-new")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.chmod(0o600)
    temporary.replace(env)
    return ("[Unit]\nDescription=Geprüfte Releases von bm.haben installieren\nAfter=docker.service network-online.target\n"
            "Wants=network-online.target\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/haben-fork-update --directory "
            + json.dumps(str(directory)) + "\nTimeoutStartSec=30min\n")


if __name__ == "__main__":
    print(configure(Path(sys.argv[1])), end="")
