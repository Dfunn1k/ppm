import sys
from pathlib import Path
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ci_ready import GitHub, WORKFLOWS, ready
from ssh_entrypoint import arguments

SHA = "a" * 40


def run(workflow, **changes):
    value = {"id": 100, "head_sha": SHA, "head_branch": "main", "event": "push",
             "path": f".github/workflows/{workflow}", "status": "completed", "conclusion": "success"}
    return value | changes


class GateTests(unittest.TestCase):
    def test_all_three_push_workflows_must_approve_the_current_main_sha(self):
        self.assertTrue(ready(SHA, lambda: SHA, lambda w: [run(w)])[0])

    def test_missing_failed_cancelled_or_running_ci_does_not_deploy(self):
        for changes in ({"conclusion": "failure"}, {"conclusion": "cancelled"},
                        {"status": "in_progress", "conclusion": None}, {"conclusion": "skipped"}):
            with self.subTest(changes=changes):
                self.assertFalse(ready(SHA, lambda: SHA, lambda w: [run(w, **changes)])[0])
        self.assertFalse(ready(SHA, lambda: SHA, lambda w: [] if w == "version.yml" else [run(w)])[0])

    def test_pr_or_other_branch_or_other_sha_success_is_insufficient(self):
        for changes in ({"event": "pull_request"}, {"head_branch": "feature"}, {"head_sha": "b" * 40},
                        {"path": ".github/workflows/another.yml"}):
            with self.subTest(changes=changes):
                self.assertFalse(ready(SHA, lambda: SHA, lambda w: [run(w, **changes)])[0])

    def test_older_success_cannot_hide_a_newer_failure_or_running_retry(self):
        for changes in ({"conclusion": "failure"}, {"status": "in_progress", "conclusion": None}):
            self.assertFalse(ready(SHA, lambda: SHA,
                                   lambda w: [run(w), run(w, id=101, **changes)])[0])

    def test_a_new_main_commit_during_checks_cannot_be_deployed(self):
        head = Mock(side_effect=[SHA, "b" * 40])
        self.assertFalse(ready(SHA, head, lambda w: [run(w)])[0])

    def test_an_outdated_commit_does_not_even_check_ci(self):
        runs = Mock()
        self.assertFalse(ready(SHA, lambda: "b" * 40, runs)[0])
        runs.assert_not_called()

    def test_pagination_is_not_limited_to_the_first_page(self):
        api = object.__new__(GitHub)
        api.sha = SHA
        api.get = Mock(side_effect=[{"workflow_runs": [run(WORKFLOWS[0])] * 100},
                                    {"workflow_runs": [run(WORKFLOWS[0], id=101)]}])
        self.assertEqual(len(list(api.workflow_runs(WORKFLOWS[0]))), 101)
        self.assertIn("page=2", api.get.call_args.args[0])


class SSHTests(unittest.TestCase):
    def test_only_check_and_a_full_sha_can_reach_the_release_command(self):
        self.assertEqual(arguments("check"), ["check"])
        self.assertEqual(arguments(f"deploy {SHA}"), ["deploy", "--sha", SHA])
        for command in ("", "bash", "deploy main", f"deploy {SHA}; id", f"deploy {SHA}\nwhoami",
                        f"deploy {SHA} --force", f"deploy {SHA.upper()}"):
            with self.subTest(command=command), self.assertRaises(ValueError):
                arguments(command)
