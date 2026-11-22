import contextlib
import io
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release

BEFORE = "a" * 40
TARGET = "b" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / ".env").write_text(f"PPM_DOMAIN={release.DOMAIN}\n")
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in (("REPO", root), ("STATE", root / "state")):
            self.stack.enter_context(patch.object(release, name, value))
        self.stack.enter_context(patch.object(sys, "argv", ["release.py", "deploy", "--sha", TARGET]))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stack.enter_context(patch.object(release, "preflight", return_value=(BEFORE, TARGET)))
        self.check = self.stack.enter_context(patch.object(release, "check", return_value={"status": "ok"}))
        self.events = []
        self.backup = self.stack.enter_context(patch.object(release, "backup", side_effect=self.back_up))
        self.run = self.stack.enter_context(patch.object(release, "run", side_effect=self.command))
        self.git = self.stack.enter_context(patch.object(release, "git", side_effect=self.git_command))

    def back_up(self):
        self.events.append("validated_backup")
        return ["test.dump", "test.tar.gz"]

    def command(self, args, **kwargs):
        self.events.append(args)
        return "test-container-or-image"

    def git_command(self, *args):
        self.events.append(args)
        return TARGET if args == ("rev-parse", "HEAD") else ""

    def test_backup_precedes_tagging_merge_build_and_health_checks(self):
        release.main()
        self.assertEqual(self.events[0], "validated_backup")
        self.assertIn(("merge", "--ff-only", TARGET), self.events)
        self.assertFalse(any(isinstance(e, tuple) and e[0] == "pull" for e in self.events))
        builds = [c for c in self.run.call_args_list if "up" in c.args[0]]
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0].args[0], release.COMPOSE + ["up", "-d", "--build"])
        self.check.assert_called_once()
        record = next(release.STATE.glob("*.json")).read_text()
        self.assertIn('"stage": "complete"', record)

    def test_a_backup_failure_prevents_all_production_mutations(self):
        self.backup.side_effect = RuntimeError("backup failed validation")
        with self.assertRaisesRegex(RuntimeError, "backup failed"):
            release.main()
        self.run.assert_not_called()
        self.git.assert_not_called()
        self.check.assert_not_called()

    def test_a_different_remote_candidate_requires_new_ci_validation(self):
        with patch.object(release, "preflight", return_value=(BEFORE, "c" * 40)):
            with self.assertRaisesRegex(RuntimeError, "candidato cambió"):
                release.main()
        self.backup.assert_not_called()
        self.run.assert_not_called()

    def test_an_already_deployed_sha_checks_health_without_build_or_backup(self):
        with patch.object(release, "preflight", return_value=(TARGET, TARGET)):
            release.main()
        self.backup.assert_not_called()
        self.run.assert_not_called()
        self.check.assert_called_once()
