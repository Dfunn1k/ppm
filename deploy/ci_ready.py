#!/usr/bin/env python3
"""Autoriza solo el HEAD de main con los tres workflows de push aprobados."""
import json
import os
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request, urlopen

WORKFLOWS = ("api.yml", "web.yml", "version.yml")


def ready(sha, main_head, workflow_runs):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Se requiere un SHA completo")
    if main_head() != sha:
        return False, "El commit ya no es el HEAD de main"
    for workflow in WORKFLOWS:
        runs = [r for r in workflow_runs(workflow)
                if r["head_sha"] == sha and r["head_branch"] == "main"
                and r["event"] == "push" and r["path"] == f".github/workflows/{workflow}"]
        if not runs:
            return False, f"Falta el workflow de push {workflow} para este SHA"
        latest = max(runs, key=lambda r: (r["id"], r.get("run_attempt", 1)))
        if latest["status"] != "completed" or latest["conclusion"] != "success":
            return False, f"{workflow} aún no aprobó este SHA"
    if main_head() != sha:
        return False, "Main cambió durante la comprobación"
    return True, "API, Web y Versión aprobaron el HEAD de main"


class GitHub:
    def __init__(self, sha):
        self.sha = sha
        repo = os.environ["GITHUB_REPOSITORY"]
        self.base = f"{os.environ['GITHUB_API_URL']}/repos/{repo}"
        self.token = os.environ["GITHUB_TOKEN"]

    def get(self, path):
        req = Request(self.base + path, headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urlopen(req, timeout=30) as response:
            return json.load(response)

    def main_head(self):
        return self.get("/git/ref/heads/main")["object"]["sha"]

    def workflow_runs(self, workflow):
        page = 1
        while True:
            query = urlencode({"head_sha": self.sha, "branch": "main", "event": "push",
                               "per_page": 100, "page": page})
            runs = self.get(f"/actions/workflows/{workflow}/runs?{query}")["workflow_runs"]
            yield from runs
            if len(runs) < 100:
                return
            page += 1


def main():
    sha = sys.argv[1]
    api = GitHub(sha)
    approved, reason = ready(sha, api.main_head, api.workflow_runs)
    print(reason)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"ready={'true' if approved else 'false'}\nsha={sha}\n")
    if not approved:
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(f"No se desplegó: {reason}.\n")


if __name__ == "__main__":
    main()
