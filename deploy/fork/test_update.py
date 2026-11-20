import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import update

CHECK_IMAGE = update.check_image


def manifest():
    return {"schema": 1, "repository": update.REPOSITORY, "tag": "bm-v0.11.0.1", "commit": "a" * 40,
            "image": update.IMAGE + "@sha256:" + "b" * 64}


class ReleaseValidation(unittest.TestCase):
    def test_stable_manifest(self):
        value = manifest()
        self.assertEqual(update.validate_manifest({"tag_name": value["tag"]}, value), value)

    def test_rejects_foreign_or_unpinned_images(self):
        for image in ["tristanteu/haben:latest", update.IMAGE + ":latest", update.IMAGE + "@sha256:bad", "evil.example/image@sha256:" + "b" * 64]:
            with self.subTest(image=image), self.assertRaises(ValueError):
                update.validate_manifest({"tag_name": manifest()["tag"]}, {**manifest(), "image": image})

    def test_rejects_mismatched_tag_repo_commit_and_schema(self):
        for change in [{"tag": "bm-v0.11.0.2"}, {"repository": "Speicherstadt/haben"}, {"commit": "main"}, {"schema": 2}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                update.validate_manifest({"tag_name": manifest()["tag"]}, {**manifest(), **change})

    def test_drafts_prereleases_and_nonfork_tags_do_not_reach_production(self):
        for release in [{"tag_name": "v0.11.0"}, {"tag_name": "bm-v0.11.0.1-rc.1"},
                        {"tag_name": manifest()["tag"], "draft": True}, {"tag_name": manifest()["tag"], "prerelease": True}]:
            with self.subTest(release=release), self.assertRaises(ValueError):
                update.validate_manifest(release, manifest())

    def test_pending_build_has_no_deployable_manifest(self):
        with patch.object(update, "get_json", return_value={"tag_name": manifest()["tag"], "assets": []}) as get:
            self.assertIsNone(update.latest_release())
            self.assertEqual(get.call_count, 1)

    def test_release_asset_uses_only_the_expected_repository(self):
        release = {"tag_name": manifest()["tag"], "assets": [{"name": "haben-image.json", "browser_download_url": "https://evil.example/image.json"}]}
        with patch.object(update, "get_json", side_effect=[release, manifest()]) as get:
            self.assertEqual(update.latest_release(), manifest())
            self.assertEqual(get.call_args.args, (f"https://github.com/{update.REPOSITORY}/releases/download/bm-v0.11.0.1/haben-image.json",))


class Deployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.commands = []
        self.healthy = patch.object(update, "app_healthy", return_value=True).start()
        self.image = patch.object(update, "check_image").start()
        self.run = patch.object(update, "run", return_value=json.dumps([{"Image": "sha256:previous"}])).start()
        self.compose = patch.object(update, "compose", side_effect=self.command).start()
        self.addCleanup(patch.stopall)

    def command(self, directory, *args):
        self.assertEqual(directory, self.directory)
        self.commands.append(args)
        if args == ("ps", "-q", "app"):
            return "test-container"
        if "psql" in args:
            return "f"
        return ""

    def test_backup_precedes_override_and_restart(self):
        def backup(directory, *args):
            if "backup.sh" in args:
                self.assertFalse((directory / "compose.fork.yml").exists())
            return self.command(directory, *args)
        self.compose.side_effect = backup
        update.apply_release(self.directory, manifest())
        self.assertEqual(json.loads((self.directory / ".fork-release.json").read_text()), manifest())
        self.assertEqual(json.loads((self.directory / "compose.fork.yml").read_text())["services"]["app"]["image"], manifest()["image"])
        backup_index = self.commands.index(("exec", "-T", "backup", "backup.sh"))
        restart_index = next(i for i, cmd in enumerate(self.commands) if cmd[0] == "up")
        self.assertLess(backup_index, restart_index)
        self.assertIn("--no-deps", self.commands[restart_index])

    def test_backup_failure_does_not_change_compose_or_restart(self):
        def fail(directory, *args):
            if "backup.sh" in args:
                raise RuntimeError("Backup fehlgeschlagen")
            return self.command(directory, *args)
        self.compose.side_effect = fail
        with self.assertRaises(RuntimeError):
            update.apply_release(self.directory, manifest())
        self.assertFalse((self.directory / "compose.fork.yml").exists())
        self.assertFalse(any(cmd[0] == "up" for cmd in self.commands))

    def test_running_import_defers_update(self):
        def busy(directory, *args):
            return "t" if "psql" in args else self.command(directory, *args)
        self.compose.side_effect = busy
        update.apply_release(self.directory, manifest())
        self.image.assert_not_called()
        self.assertFalse((self.directory / "compose.fork.yml").exists())

    def test_unhealthy_app_is_not_updated(self):
        self.healthy.return_value = False
        with self.assertRaises(ValueError):
            update.apply_release(self.directory, manifest())
        self.image.assert_not_called()

    def test_failed_activation_blocks_future_automatic_attempts(self):
        def fail(directory, *args):
            if args[0] == "up":
                raise RuntimeError("Migration oder Start fehlgeschlagen")
            return self.command(directory, *args)
        self.compose.side_effect = fail
        with self.assertRaises(RuntimeError):
            update.apply_release(self.directory, manifest())
        self.assertTrue((self.directory / ".fork-update-failed.json").exists())
        self.assertFalse((self.directory / ".fork-release.json").exists())
        count = len(self.commands)
        with self.assertRaises(ValueError):
            update.apply_release(self.directory, manifest())
        self.assertEqual(len(self.commands), count)

    def test_interrupted_activation_blocks_the_next_automatic_attempt(self):
        script = """
import json, os, sys
from pathlib import Path
from unittest.mock import patch
import update

def compose(directory, *args):
    if args[0] == "up":
        os._exit(143)
    return "f" if "psql" in args else "app-container"

with patch.object(update, "compose", side_effect=compose), patch.object(update, "app_healthy", return_value=True), patch.object(update, "check_image"), patch.object(update, "run", return_value='[{"Image":"sha256:previous"}]'):
    update.apply_release(Path(sys.argv[1]), json.loads(sys.argv[2]))
"""
        interrupted = subprocess.run([sys.executable, "-c", script, str(self.directory), json.dumps(manifest())], cwd=Path(update.__file__).parent)
        self.assertEqual(interrupted.returncode, 143)
        self.assertTrue((self.directory / ".fork-update-before.json").exists())
        self.assertTrue((self.directory / ".fork-update-failed.json").exists())
        with self.assertRaises(ValueError):
            update.apply_release(self.directory, manifest())
        self.assertEqual(self.commands, [])

    def test_unchanged_release_does_not_restart(self):
        update.atomic_json(self.directory / ".fork-release.json", manifest())
        update.apply_release(self.directory, manifest())
        self.assertEqual(self.commands, [])

    def test_no_automatic_downgrade_of_a_migrated_database(self):
        update.atomic_json(self.directory / ".fork-release.json", {**manifest(), "tag": "bm-v0.11.0.2"})
        with self.assertRaises(ValueError):
            update.apply_release(self.directory, manifest())
        self.assertEqual(self.commands, [])

    def test_image_with_wrong_source_or_commit_is_not_activated(self):
        with patch.object(update, "run", return_value=json.dumps([{"Config": {"Labels": {}}}])):
            with self.assertRaises(ValueError):
                CHECK_IMAGE(manifest())


if __name__ == "__main__":
    unittest.main()
