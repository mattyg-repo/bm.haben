#!/bin/sh
# Ergänzt die bestehende Installation; Datenbank, Schlüssel, Caddy und eigene Overrides bleiben erhalten.
set -eu
test "$(id -u)" = 0
cd "$(dirname "$0")"
directory=${1:-/root/haben}
test -f "$directory/compose.yml"
test -f "$directory/.env"
install -m 755 update.py /usr/local/sbin/haben-fork-update
fork_unit=/etc/systemd/system/haben-fork-update.service
python3 configure.py "$directory" > "$fork_unit.new"
chmod 644 "$fork_unit.new"
mv "$fork_unit.new" "$fork_unit"
install -m 644 haben-fork-update.timer /etc/systemd/system/haben-fork-update.timer
systemctl daemon-reload
systemctl enable --now haben-fork-update.timer
/usr/local/sbin/haben-fork-update --directory "$directory" --check
