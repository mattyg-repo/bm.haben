import contextlib
import fcntl
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import configure
import update


class Configuration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / "compose.yml").write_text("services:\n  app:\n    image: example.invalid/base:old\n")
        self.original = "# Eigene Werte bleiben erhalten\nAUTH_SECRET='test-$secret'\nENCRYPTION_KEY=test-key\n"
        (self.directory / ".env").write_text(self.original)

    def configure(self):
        with patch.object(configure.subprocess, "check_output", side_effect=["app-container\n", json.dumps([{"Image": "sha256:previous"}])]):
            return configure.configure(self.directory)

    def test_preserves_keys_overrides_and_running_image_without_restart(self):
        override = self.directory / "compose.override.yml"
        override.write_text("services:\n  app:\n    image: example.invalid/local:old\n")
        unit = self.configure()
        self.assertEqual(override.read_text(), "services:\n  app:\n    image: example.invalid/local:old\n")
        self.assertEqual((self.directory / ".env").read_text(), self.original + "COMPOSE_FILE=compose.yml:compose.override.yml:compose.fork.yml\n")
        self.assertEqual(json.loads((self.directory / "compose.fork.yml").read_text())["services"]["app"]["image"], "sha256:previous")
        self.assertIn('ExecStart=/usr/local/sbin/haben-fork-update --directory "', unit)
        self.assertEqual((self.directory / ".env").stat().st_mode & 0o777, 0o600)

    def test_preserves_custom_compose_files_and_keeps_release_override_last(self):
        (self.directory / "extra.yml").write_text("services: {}\n")
        (self.directory / ".env").write_text(self.original + 'COMPOSE_FILE="compose.yml:extra.yml"\n')
        self.configure()
        self.assertIn("COMPOSE_FILE=compose.yml:extra.yml:compose.fork.yml\n", (self.directory / ".env").read_text())

    def test_reinstallation_does_not_replace_the_selected_release(self):
        self.configure()
        fork = self.directory / "compose.fork.yml"
        previous = fork.read_text()
        env = (self.directory / ".env").read_text()
        with patch.object(configure.subprocess, "check_output") as docker:
            configure.configure(self.directory)
        docker.assert_not_called()
        self.assertEqual(fork.read_text(), previous)
        self.assertEqual((self.directory / ".env").read_text(), env)

    def test_missing_existing_file_does_not_change_configuration(self):
        value = self.original + "COMPOSE_FILE=compose.yml:missing.yml\n"
        (self.directory / ".env").write_text(value)
        with self.assertRaises(ValueError):
            self.configure()
        self.assertEqual((self.directory / ".env").read_text(), value)
        self.assertFalse((self.directory / "compose.fork.yml").exists())

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose für den Konfigurationstest benötigt")
    def test_real_compose_uses_the_release_override_last(self):
        (self.directory / "compose.override.yml").write_text("services:\n  app:\n    image: example.invalid/local:old\n")
        self.configure()
        (self.directory / "compose.fork.yml").write_text(json.dumps({"services": {"app": {"image": "example.invalid/fork:release"}}}))
        images = subprocess.check_output(["docker", "compose", "--project-directory", str(self.directory), "config", "--images"], cwd=self.directory, text=True)
        self.assertEqual(images.strip(), "example.invalid/fork:release")


class Runtime(unittest.TestCase):
    def test_healthcheck_evaluates_running_and_health_status(self):
        for state, expected in [({"Running": True, "Health": {"Status": "healthy"}}, True),
                                ({"Running": False, "Health": {"Status": "healthy"}}, False),
                                ({"Running": True, "Health": {"Status": "unhealthy"}}, False),
                                ({"Running": True}, False)]:
            with self.subTest(state=state), patch.object(update, "run", return_value=json.dumps([{"State": state}])):
                self.assertEqual(update.app_healthy("app-container"), expected)

    def test_compose_uses_the_installation_directory_and_its_env(self):
        directory = Path("/installation")
        with patch.object(update, "run", return_value="app-container") as run:
            self.assertEqual(update.compose(directory, "ps", "-q", "app"), "app-container")
        run.assert_called_once_with("docker", "compose", "--project-directory", str(directory), "ps", "-q", "app", cwd=directory)

    def test_cli_lock_prevents_a_second_update_before_any_network_request(self):
        with tempfile.TemporaryDirectory() as temp:
            with (Path(temp) / ".fork-update.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(sys, "argv", ["update.py", "--directory", temp]), patch.object(update, "latest_release") as latest, contextlib.redirect_stdout(io.StringIO()):
                    update.main()
                latest.assert_not_called()

    def test_check_mode_does_not_activate_the_available_release(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(sys, "argv", ["update.py", "--directory", temp, "--check"]):
            with patch.object(update, "latest_release", return_value={"tag": "bm-v0.11.0.1"}), patch.object(update, "apply_release") as apply, contextlib.redirect_stdout(io.StringIO()):
                update.main()
            apply.assert_not_called()


if __name__ == "__main__":
    unittest.main()
