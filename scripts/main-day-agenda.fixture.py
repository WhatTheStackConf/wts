#!/usr/bin/env python3
"""Disposable loopback PocketBase fixture. NEVER reads production credentials.

Copies the repo's real migrations to a NEW directory and seeds the read-only public
snapshot. Missing abstract/origin values are explicitly TEST-ONLY fixture defaults.
No production database, auth, file storage, private CFP records, or tokens copied.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("WTS_FIXTURE_PB_BINARY", ROOT / "pocketbase/pocketbase")).resolve()
spec = importlib.util.spec_from_file_location("agenda", ROOT / "scripts/main-day-agenda.py")
assert spec is not None and spec.loader is not None
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)
EMAIL = "main-day-local@example.test"
PASSWORD = "Local-only-main-day-2026!"
MARKER = "main-day-agenda-fixture.json"
HOOKS = ("programme_public_fields.pb.js", "agenda_constraints.pb.js", "appearance_event_constraints.pb.js")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def arguments(directory):
    return [f"--dir={directory / 'pb_data'}", f"--migrationsDir={directory / 'pb_migrations'}",
            f"--hooksDir={directory / 'pb_hooks'}"]


def environment():
    # Do not even pass production credentials into the fixture child process.
    return {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "TMPDIR") if k in os.environ}


def start(directory, port):
    url = f"http://127.0.0.1:{port}"
    log = open(directory / "server.log", "ab")
    process = subprocess.Popen([str(BINARY), "serve", f"--http=127.0.0.1:{port}",
                                *arguments(directory), "--automigrate=false", "--hooksWatch=false"],
                               stdout=log, stderr=subprocess.STDOUT, env=environment())
    log.close()
    try:
        for _ in range(120):
            if process.poll() is not None:
                raise RuntimeError(f"Local PocketBase exited; see {directory / 'server.log'}")
            try:
                with urllib.request.urlopen(url + "/api/health", timeout=0.2) as response:
                    if response.status == 200:
                        return process, url
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.05)
        raise RuntimeError("Local PocketBase readiness timeout")
    except BaseException:
        stop(process)
        raise


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def local_request(url, method, path, payload=None, token=None):
    if not url.startswith("http://127.0.0.1:"):
        raise RuntimeError("Fixture writes are restricted to literal IPv4 loopback.")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    req = urllib.request.Request(url + path, method=method, headers=headers,
                                 data=None if payload is None else json.dumps(payload).encode())
    opener = urllib.request.build_opener(agenda.NoRedirect())
    with opener.open(req, timeout=10) as response:
        return json.load(response)


def client(url):
    auth = local_request(url, "POST", "/api/collections/_superusers/auth-with-password",
                         {"identity": EMAIL, "password": PASSWORD})
    return agenda.PocketBase(url, auth["token"])


def provision(directory, snapshot=None, stage="empty"):
    directory = Path(directory).resolve()
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    # Exact repository migrations, including current programme relations/indexes.
    shutil.copytree(ROOT / "pocketbase/pb_migrations", directory / "pb_migrations")
    (directory / "pb_hooks").mkdir()
    # All real hooks touching this publication graph, byte-for-byte. Unrelated
    # CFP/mail/listmonk/cron hooks are intentionally not started in a fixture.
    for name in HOOKS:
        shutil.copyfile(ROOT / "pocketbase/pb_hooks" / name, directory / "pb_hooks" / name)
    (directory / "pb_data").mkdir()
    logpath = directory / "setup.log"
    with logpath.open("wb") as log:
        for args in (["migrate", "up"], ["superuser", "create", EMAIL, PASSWORD]):
            result = subprocess.run([str(BINARY), *args, *arguments(directory)],
                                    stdout=log, stderr=subprocess.STDOUT, env=environment())
            if result.returncode:
                raise RuntimeError(f"Fixture migration failed; see {logpath}")
    process, url = start(directory, free_port())
    try:
        pb = client(url)
        # Only public allowlisted snapshot fields are seeded; these are not private DB backups.
        manifest = json.loads(agenda.MANIFEST.read_text())
        if snapshot is None:
            # Explicit synthetic test source from the reviewed public bindings;
            # never represent these generated records as production API data.
            state = {**{c: [] for c in agenda.WRITABLE},
                     "speakers": [b["speaker"] for b in manifest["bindings"]],
                     "sessions": [b["session"] for b in manifest["bindings"]],
                     "appearance_events": [{"id": event_id, "name": f"TEST event {event_id}", "published": True}
                                           for event_id in sorted({agenda.EVENT} | {event_id for b in manifest["bindings"]
                                                                                  for event_id in b["speaker"]["appearance_events"]})]}
        else:
            state = json.loads(Path(snapshot).read_text())
        (directory / "fixture-source.json").write_text(json.dumps(state, indent=2))
        counts = {}
        for collection in ("appearance_events", "speakers", "sessions", *agenda.WRITABLE):
            counts[collection] = 0
            for original in state[collection]:
                row = dict(original)
                if collection == "speakers":
                    row.setdefault("origin", "invite")  # TEST ONLY; snapshot omits private provenance.
                if collection == "sessions":
                    row.setdefault("abstract", "<p>TEST FIXTURE: abstract not included in the public preflight snapshot.</p>")
                if collection == "appearance_events" and row["id"] == agenda.EVENT:
                    method, suffix = "PATCH", "/" + row["id"]  # migration already seeds main event.
                else:
                    method, suffix = "POST", ""
                local_request(url, method, f"/api/collections/{collection}/records{suffix}", row, pb.token)
                counts[collection] += 1
        agenda.run_operation(pb, manifest, "dry-run")
        if stage in ("staged", "published"):
            agenda.run_operation(pb, manifest, "stage", directory / "backups")
        if stage == "published":
            agenda.run_operation(pb, manifest, "publish", directory / "backups")
        if stage != "empty":
            agenda.run_operation(pb, manifest, "verify", expect=stage)
        # Keep public fixture source available for deterministic future test runs.
        (directory / MARKER).write_text(json.dumps({"local_fixture_only": True, "state": stage,
                                                   "binary": str(BINARY),
                                                   "binary_version": subprocess.check_output([str(BINARY), "--version"], text=True).strip(),
                                                   "source": "synthetic-manifest-bindings" if snapshot is None else str(snapshot),
                                                   "hooks_sha256": {name: hashlib.sha256((directory / "pb_hooks" / name).read_bytes()).hexdigest()
                                                                    for name in HOOKS},
                                                   "snapshot_counts": counts, "manifest_sha256": agenda.digest(manifest)}, indent=2))
    finally:
        stop(process)
    return {"directory": str(directory), "state": stage, "snapshot_counts": counts,
            "login_email": EMAIL, "login_password": PASSWORD,
            "warning": "Nonsecret LOCAL credentials only. Abstract/origin are labeled test defaults; photos are not copied."}


def exercise(directory, snapshot=None):
    """Exercise the actual CLI with loopback-only credentials and keep evidence."""
    provision(directory, snapshot, "empty")
    process, url = start(directory, free_port())
    try:
        pb = client(url)
        before = pb.snapshot()
        reports = []
        for mode, expected in (("dry-run", None), ("stage", None), ("verify", "staged"),
                               ("stage", None), ("publish", None), ("verify", "published"),
                               ("publish", None), ("rollback", None), ("verify", "published"),
                               ("publish", None), ("verify", "published")):
            command = ["python3", str(ROOT / "scripts/main-day-agenda.py"), mode]
            if mode in ("stage", "publish", "rollback"):
                command += ["--execute", "--exclusive-writer", "--backup-dir", str(directory / "backups")]
            if mode in ("publish", "rollback"):
                command += ["--accept-partial-publication"]
            if expected:
                command += ["--expect", expected]
            result = subprocess.run(command, capture_output=True, text=True,
                                    env={**environment(), "PYTHONDONTWRITEBYTECODE": "1",
                                         "WTS_PB_URL": url, "WTS_PB_API_KEY": pb.token})
            if mode == "rollback":
                if result.returncode != 1 or "Rollback blocked" not in result.stderr:
                    raise RuntimeError("Rollback did not safely refuse published Session Slots")
                reports.append({"command": command, "result": {"refused": True, "writes": 0, "reason": result.stderr.strip()}})
            elif result.returncode:
                raise RuntimeError(result.stderr)
            else:
                reports.append({"command": command, "result": json.loads(result.stdout)})
            (directory / "exercise-report.json").write_text(json.dumps(reports, indent=2))
        after = pb.snapshot()
        manifest = json.loads(agenda.MANIFEST.read_text())
        agenda.inspect_state(manifest, after, complete=True, expect="published")
        if agenda.unrelated(before, manifest) != agenda.unrelated(after, manifest):
            raise RuntimeError("Unrelated source data changed during CLI exercise")
        (directory / "verified-final-snapshot.json").write_text(json.dumps(after, indent=2))
        return {"directory": str(directory), "report": str(directory / "exercise-report.json"),
                "verified": True, "operations": len(reports), "published_slots": 39, "local_only": True}
    finally:
        stop(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("setup", "serve", "exercise"))
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--snapshot", type=Path, help="Optional public snapshot; otherwise uses synthetic manifest bindings")
    parser.add_argument("--state", choices=("empty", "staged", "published"), default="published")
    parser.add_argument("--port", type=int, default=8098)
    args = parser.parse_args()
    if args.mode == "exercise":
        print(json.dumps(exercise(args.directory.resolve(), args.snapshot), indent=2))
    elif args.mode == "setup":
        print(json.dumps(provision(args.directory, args.snapshot, args.state), indent=2))
    else:
        if not (args.directory / MARKER).is_file():
            raise RuntimeError("Not a provisioned disposable fixture directory")
        process, url = start(args.directory.resolve(), args.port)
        print(json.dumps({"url": url, "email": EMAIL, "password": PASSWORD, "local_only": True}), flush=True)
        try:
            process.wait()
        except KeyboardInterrupt:
            pass
        finally:
            stop(process)


if __name__ == "__main__":
    main()
