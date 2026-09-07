#!/usr/bin/env python3
"""Reviewed WTS main-day publication; stdlib only, read-only by default.

No deletes, speaker/event writes, or settings API. See companion README.
Slot publication uses the real coordinated Slot+Session route. Rollback refuses
to hide any already-public Session. Whole-Day publication is NOT atomic.
"""
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

EVENT = "wts2026appevent"
DATE = "2026-09-19"
ZONE = "Europe/Skopje"
PREFIX = "md26"
WRITABLE = ("conference_days", "event_programmes", "agenda_tracks", "agenda_slots")
COLLECTIONS = WRITABLE + ("appearance_events", "speakers", "sessions")
MANIFEST = Path(__file__).with_name("main-day-agenda.manifest.json")
TIMES = ("10:10-10:45", "10:55-11:30", "11:50-12:25", "12:35-13:10",
         "13:50-14:25", "14:45-15:20", "15:30-16:05")
LINEUP = (
    ("igor-trajkovski", "elena-kolevska", "nino-risteski", "bojan-jakimovski",
     "dushko-klincharov", "riste-oreshkovski", "TBD"),
    ("sam-vloeberghs", "kiril-zafirov", "alem-tuzlak", "alexander-lichter",
     "konrad-reczko", "iwo-plaza", "wekoslav-stefanovski"),
    ("gerald-versluis", "santosh-yadav", "ramona-schwering", "andrej-acevski",
     "bozidar-spirovski", "TBD", "miroslav-janeski"),
    ("goran-david", "serena-sensini", "andjelina-maksimovic", "faris-aziz",
     "stefan-andonov", "bogdan-ilie", "domagoj-maric"),
)
SHARED = (("opening", "10:00-10:10", "Opening", "Opening of WhatTheStack 2026."),
          ("break", "11:30-11:50", "Coffee break", "Programme-wide coffee break."),
          ("meal", "13:10-13:50", "Lunch", "Programme-wide lunch break."),
          ("break", "14:25-14:45", "Coffee break", "Programme-wide coffee break."),
          ("closing", "16:05-16:15", "Closing", "Closing of WhatTheStack 2026."))


class SafetyError(Exception):
    """Safe-to-print diagnostic, never contains HTTP bodies or credentials."""


def require(condition, message):
    if not condition:
        raise SafetyError(message)


def stable_id(label):
    return PREFIX + hashlib.sha256(("wts-main-day-v1:" + label).encode()).hexdigest()[:11]


def instant(local_time):
    local = datetime.fromisoformat(f"{DATE}T{local_time}").replace(tzinfo=ZoneInfo(ZONE))
    return local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def project(row, keys):
    return {key: row[key] for key in keys}


def one(rows, label):
    require(len(rows) == 1, f"Expected exactly one {label}; found {len(rows)}.")
    return rows[0]


def build_manifest(source, revision=2):
    """Resolve ONLY public speaker slugs with explicit main-event appearances + talk."""
    day_id, programme_id = stable_id("day"), stable_id("programme")
    records = {
        "conference_days": [{"id": day_id, "key": "main-day", "local_date": DATE,
                             "title": "Main Conference Day", "display_order": 6, "published": False}],
        "event_programmes": [{"id": programme_id, "day": day_id,
                              "appearance_event": EVENT, "display_order": 0}],
        "agenda_tracks": [{"id": stable_id(f"stage-{i}"), "programme": programme_id,
                           "key": f"stage-{i}", "name": f"Stage {i}",
                           "location_label": "", "display_order": i} for i in range(1, 6)],
        "agenda_slots": [],
    }
    bindings = []
    event = one([e for e in source["appearance_events"] if e["id"] == EVENT], "main event")
    require(event["published"] is True, "Main event is not published.")

    def add(stage, times, slug=None, kind="other", title="TBD", summary="Programme to be announced.", short=False):
        start, end = times.split("-")
        session_id = ""
        if slug and slug != "TBD":
            speaker = one([s for s in source["speakers"] if s["slug"] == slug], f"speaker {slug}")
            require(speaker["published"] is True and EVENT in speaker["appearance_events"],
                    f"Speaker {slug} lacks published main-event membership.")
            candidates = [s for s in source["sessions"] if speaker["id"] in s["speakers"]
                          and s.get("format", "").lower() == "talk"]
            session = one(candidates, f"talk for {slug}")
            require(session["published"] is True, f"Talk for {slug} is not published.")
            # A co-speaker also needs an explicit published main-event appearance.
            for sid in session["speakers"]:
                co = one([s for s in source["speakers"] if s["id"] == sid], "session speaker")
                require(co["published"] is True and EVENT in co["appearance_events"],
                        "Session co-speaker lacks published main-event membership.")
            bindings.append({"speaker": project(speaker, ("id", "slug", "published", "appearance_events")),
                             "session": project(session, ("id", "slug", "title", "published", "format", "speakers")),
                             "short_15_plus_5": short})
            session_id, kind, title, summary = session["id"], "session", "", ""
        records["agenda_slots"].append({
            "id": stable_id(f"slot:{stage}:{start}"), "programme": programme_id,
            "track": stable_id(f"stage-{stage}") if stage else "",
            "start_at": instant(start), "end_at": instant(end), "kind": kind,
            "published": True, "display_order": int(start.replace(":", "")),
            "location_label": "", "session": session_id, "title": title, "summary": summary,
        })

    for stage, speakers in enumerate(LINEUP, 1):
        for index, slug in enumerate(speakers):
            if slug == "riste-oreshkovski":
                add(stage, "14:45-15:05", slug, short=True)
                add(stage, "15:05-15:25", "dragan-shahpaski", short=True)
            elif slug == "andjelina-maksimovic":
                add(stage, "11:50-12:10", slug, short=True)
                add(stage, "12:10-12:30")
            else:
                add(stage, TIMES[index], slug)
    for times in ("10:10-11:30", "11:50-13:10", "13:50-14:25", "14:45-16:05"):
        add(5, times)
    for kind, times, title, summary in SHARED:
        add(0, times, kind=kind, title=title, summary=summary)
    require(revision in (1, 2), "Unknown main-day schedule revision.")
    if revision == 2:
        # Keep immutable Track keys and Slot/Session identities from revision 1.
        # Only public stage labels/order and the four approved clock windows move.
        stage_numbers = {1: 3, 2: 1, 3: 2, 4: 4, 5: 5}
        for track in records["agenda_tracks"]:
            number = stage_numbers[track["display_order"]]
            track.update(name=f"Stage {number}", display_order=number)
        reordered = {"sam-vloeberghs": 2, "kiril-zafirov": 3, "alem-tuzlak": 1, "alexander-lichter": 0}
        sessions_by_speaker = {b["speaker"]["slug"]: b["session"]["id"] for b in bindings}
        for slug, index in reordered.items():
            slot = one([s for s in records["agenda_slots"] if s["session"] == sessions_by_speaker[slug]], "rescheduled talk")
            start, end = TIMES[index].split("-")
            slot.update(start_at=instant(start), end_at=instant(end), display_order=int(start.replace(":", "")))
    return {"version": revision, "event_id": EVENT, "local_date": DATE, "timezone": ZONE,
            "ownership_prefix": PREFIX, "bindings": bindings, "records": records}


def validate_manifest(manifest):
    """Rebuild from frozen public bindings; arbitrary edited record payloads fail."""
    source = {"appearance_events": [{"id": EVENT, "published": True}],
              "speakers": [b["speaker"] for b in manifest["bindings"]],
              "sessions": [b["session"] for b in manifest["bindings"]]}
    require(build_manifest(source, revision=manifest["version"]) == manifest, "Manifest differs from deterministic reviewed schedule.")
    records = manifest["records"]
    slots = records["agenda_slots"]
    ids = [r["id"] for rows in records.values() for r in rows]
    require(len(ids) == len(set(ids)) and all(re.fullmatch(r"[a-z0-9]{15}", x) for x in ids), "Invalid/duplicate owned IDs.")
    links = [s["session"] for s in slots if s["kind"] == "session"]
    require(len(links) == len(set(links)) == 27, "Expected exactly 27 unique talk links.")
    for i, slot in enumerate(slots):
        require(slot["end_at"] > slot["start_at"], "Nonpositive slot duration.")
        require((slot["kind"] == "session" and not slot["title"] and not slot["summary"])
                or (slot["kind"] != "session" and not slot["session"] and slot["title"] and slot["summary"]),
                "Slot violates title/summary/session constraints.")
        for other in slots[i + 1:]:
            conflicts = not slot["track"] or not other["track"] or slot["track"] == other["track"]
            overlap = slot["start_at"] < other["end_at"] and slot["end_at"] > other["start_at"]
            require(not (conflicts and overlap), "Overlapping track or shared slots.")


def normalized(key, value):
    if key in ("start_at", "end_at") and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    return value


def matches(actual, expected, allow_day_gate=False):
    for key, value in expected.items():
        if allow_day_gate and key == "published":
            if actual.get(key) not in (True, False):
                return False
            continue
        if key not in actual or normalized(key, actual[key]) != normalized(key, value):
            return False
    # Schema validation also fails on unknown business fields. Metadata is harmless.
    return not (set(actual) - set(expected) - {"collectionId", "collectionName", "created", "updated"})


def inspect_state(manifest, state, complete=False, expect=None):
    """Validate pins, collisions, exact owned fields, extras and publication gate."""
    for name in COLLECTIONS:
        require(name in state and isinstance(state[name], list), f"Missing collection snapshot: {name}.")
        ids = [r["id"] for r in state[name]]
        require(len(ids) == len(set(ids)), f"Duplicate record IDs in {name} snapshot.")
    require(build_manifest(state, revision=manifest["version"]) == manifest, "Live source bindings/titles/membership drifted; review a new manifest.")
    expected = manifest["records"]
    day = expected["conference_days"][0]
    programme = expected["event_programmes"][0]
    by_id = {c: {r["id"]: r for r in state[c]} for c in WRITABLE}
    missing = []
    for collection in WRITABLE:
        allowed = {r["id"] for r in expected[collection]}
        for row in state[collection]:
            rid = row["id"]
            related = (collection == "conference_days" and (row.get("key") == day["key"] or row.get("local_date") == DATE))
            related |= collection == "event_programmes" and (row.get("day") == day["id"] or row.get("appearance_event") == EVENT)
            related |= collection in ("agenda_tracks", "agenda_slots") and row.get("programme") == programme["id"]
            related |= collection == "agenda_slots" and row.get("track") in {t["id"] for t in expected["agenda_tracks"]}
            related |= collection == "agenda_slots" and row.get("session") in {s["session"] for s in expected["agenda_slots"] if s["session"]}
            require(rid in allowed or not (rid.startswith(PREFIX) or related),
                    f"Unexpected owned/scope/unique-session collision: {collection}/{rid}.")
        for row in expected[collection]:
            actual = by_id[collection].get(row["id"])
            if actual is None:
                missing.append((collection, row))
            else:
                require(matches(actual, row, collection in ("conference_days", "agenda_slots")),
                        f"Owned ID collision or field drift: {collection}/{row['id']}.")
    current_day = by_id["conference_days"].get(day["id"])
    published = current_day is not None and current_day["published"] is True
    require(not (published and missing), "Published day is incomplete; refusing any automatic repair.")
    owned_slots = [by_id["agenda_slots"][s["id"]] for s in expected["agenda_slots"] if s["id"] in by_id["agenda_slots"]]
    published_slots = sum(s["published"] is True for s in owned_slots)
    require(published or not published_slots, "Published Slots under unpublished Day; inconsistent hook state.")
    require(not complete or not missing, f"Staging incomplete: {len(missing)} records missing.")
    phase = ("published" if published_slots == len(expected["agenda_slots"]) else "partial" if published
             else "staged" if current_day and not missing else "incomplete")

    if expect is not None:
        require(phase == expect, f"Expected {expect} state, found {phase}.")
    return {"missing": missing, "published": published, "published_slots": published_slots,
            "phase": phase}


def unrelated(state, manifest):
    result = {c: sorted((copy.deepcopy(r) for r in state[c] if r["id"] not in
                        {x["id"] for x in manifest["records"].get(c, [])}), key=lambda r: r["id"])
              for c in COLLECTIONS}
    # Coordinated publication saves the linked Session, advancing updated even
    # when already published. Every other field remains part of the audit.
    linked = {b["session"]["id"] for b in manifest["bindings"]}
    for row in result["sessions"]:
        if row["id"] in linked:
            row.pop("updated", None)
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SafetyError("Redirect refused; credentials were not forwarded.")


class PocketBase:
    def __init__(self, url, token):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")),
                "Require HTTPS (or loopback HTTP for isolated tests).")
        require(bool(parsed.hostname) and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
                "Invalid PocketBase URL.")
        require(bool(token) and "\n" not in token and "\r" not in token, "Invalid PocketBase token.")
        self.url, self.token = url.rstrip("/"), token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, collection, rid="", payload=None, query=""):
        require(collection in COLLECTIONS, "Collection not allowlisted.")
        require(not rid or re.fullmatch(r"[a-z0-9]{15}", rid), "Invalid target ID.")
        if method != "GET":
            require(collection in WRITABLE and method in ("POST", "PATCH"), "Write outside exact agenda scope.")
            require(payload is not None and ((method == "POST" and payload.get("id", "").startswith(PREFIX)
                     and (collection not in ("conference_days", "agenda_slots") or payload.get("published") is False))
                    or (method == "PATCH" and collection == "conference_days" and rid == stable_id("day")
                        and set(payload) == {"published"} and type(payload["published"]) is bool)),
                    "Write payload outside allowed draft-create/day-publication scope.")
        path = f"/api/collections/{collection}/records" + (f"/{rid}" if rid else "") + query
        return self.raw(method, path, payload)

    def publication(self, slot, published, manifest):
        require(slot in manifest["records"]["agenda_slots"] and type(published) is bool,
                "Publication target outside reviewed Slots.")
        require(published or not slot["session"], "Cannot unpublish Session Slots: route would hide existing public talks.")
        return self.raw("POST", f"/api/wts/programme/agenda-slots/{slot['id']}/publication", {"published": published})

    def raw(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(self.url + path, data=body, method=method,
                                     headers={"Authorization": self.token, "Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Never emit response body, request/URL or token even on auth errors.
            raise SafetyError(f"PocketBase {method} failed with HTTP {exc.code}; no automatic retry.") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise SafetyError(f"PocketBase {method} transport/JSON failure; inspect state before retry.") from None

    def snapshot(self):
        result = {}
        for collection in COLLECTIONS:
            rows, page, total = [], 1, None
            while True:
                data = self.request("GET", collection, query=f"?page={page}&perPage=200&sort=id")
                if total is None:
                    total = data["totalItems"]
                require(data["totalItems"] == total and data["page"] == page, "Pagination changed; retry read-only.")
                rows.extend(data["items"])
                if page >= data["totalPages"]:
                    break
                require(bool(data["items"]), "Unexpected empty intermediate page.")
                page += 1
            require(len(rows) == total and len({r["id"] for r in rows}) == total, "Incomplete collection snapshot.")
            result[collection] = rows
        return result

    def schemas(self, manifest):
        schemas = {c: self.raw("GET", f"/api/collections/{c}") for c in COLLECTIONS}
        relations = {("event_programmes", "day"): "conference_days",
                     ("event_programmes", "appearance_event"): "appearance_events",
                     ("agenda_tracks", "programme"): "event_programmes",
                     ("agenda_slots", "programme"): "event_programmes",
                     ("agenda_slots", "track"): "agenda_tracks", ("agenda_slots", "session"): "sessions"}
        for name in WRITABLE:
            fields = {f["name"]: f for f in schemas[name]["fields"] if f["name"] not in ("created", "updated")}
            require(set(fields) == set(manifest["records"][name][0]), f"Unexpected live schema fields for {name}.")
            for key, value in manifest["records"][name][0].items():
                expected_type = ("relation" if (name, key) in relations else "date" if key in ("start_at", "end_at")
                                 else "select" if key == "kind" else "bool" if isinstance(value, bool)
                                 else "number" if isinstance(value, int) else "text")
                require(fields[key]["type"] == expected_type, f"Schema field type drift: {name}/{key}.")
                if expected_type == "relation":
                    require(fields[key]["collectionId"] == schemas[relations[name, key]]["id"]
                            and fields[key]["maxSelect"] == 1 and not fields[key].get("cascadeDelete"),
                            f"Schema relation drift: {name}/{key}.")
            require(all(schemas[name].get(rule) is None for rule in ("listRule", "viewRule", "createRule", "updateRule", "deleteRule")),
                    f"Raw agenda rules are not locked: {name}.")
        require(set(next(f for f in schemas["agenda_slots"]["fields"] if f["name"] == "kind")["values"])
                == {"session", "break", "meal", "networking", "opening", "closing", "other"}, "Slot kind schema drift.")
        return schemas


def credentials(path):
    """Never source shell code. Accept only a single literal assignment per key."""
    result = {k: os.environ[k] for k in ("WTS_PB_URL", "WTS_PB_API_KEY") if os.environ.get(k)}
    needed = {"WTS_PB_URL", "WTS_PB_API_KEY"} - set(result)
    if needed:
        text = Path(path).expanduser().read_text()
        for key in needed:
            found = re.findall(r"^\s*(?:export\s+)?" + key + r"=(.*?)\s*$", text, re.M)
            require(len(found) == 1, f"Need exactly one literal {key} assignment or environment value.")
            raw = found[0]
            require(not any(c in raw for c in ("$", "`", "\n", "\\")), f"Nonliteral {key} assignment refused.")
            tokens = shlex.split(raw, comments=True)
            require(len(tokens) == 1 and bool(tokens[0]), f"Invalid literal {key} assignment.")
            result[key] = tokens[0]
    return result["WTS_PB_URL"], result["WTS_PB_API_KEY"]


def secure_backup(directory, state, schemas, manifest, mode, target):
    """Local record snapshot, NOT PocketBase server backup/settings API."""
    directory = Path(directory).expanduser()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_mode & 0o077 == 0,
            "Backup directory must be private (chmod 700), not a symlink.")
    name = f"main-day-agenda-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{mode}.json"
    path = directory / name
    content = {"mode": mode, "manifest_sha256": digest(manifest), "target_sha256": digest(target),
               "collections": state, "schemas": schemas}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(content, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    # Verify the durable snapshot before any network mutation.
    require(json.loads(path.read_text()) == content, "Backup readback failed.")
    return str(path)


def run_operation(client, manifest, mode, backup_dir=None, expect=None):
    require(mode in ("dry-run", "verify", "stage", "publish", "rollback"), "Unsupported operation.")
    validate_manifest(manifest)
    schemas = client.schemas(manifest)
    before = client.snapshot()
    inspection = inspect_state(manifest, before, complete=mode in ("publish", "verify", "rollback"), expect=expect)
    report = {"mode": mode, "manifest_sha256": digest(manifest),
              "records": {c: len(v) for c, v in manifest["records"].items()},
              "session_links": len(manifest["bindings"]), "missing_records": len(inspection["missing"]),
              "day_published": inspection["published"], "published_slots": inspection["published_slots"],
              "phase": inspection["phase"], "atomic": False, "writes": 0}
    if mode in ("dry-run", "verify"):
        return report
    if mode == "stage":
        require(not inspection["published"], "Stage cannot modify a public Day; use publish to resume or rollback.")
    if mode == "rollback":
        require(not any(s["published"] and s["session"] for s in before["agenda_slots"]
                        if s["id"] in {r["id"] for r in manifest["records"]["agenda_slots"]}),
                "Rollback blocked: coordinated unpublish would hide existing public talks. Resume publish instead; no writes attempted.")
    if ((mode == "publish" and inspection["phase"] == "published")
            or (mode == "rollback" and inspection["phase"] == "staged")
            or (mode == "stage" and not inspection["missing"])):
        return report
    require(backup_dir is not None, "An explicit private backup directory is required.")
    report["backup"] = secure_backup(backup_dir, before, schemas, manifest, mode, client.url)
    # Read again after backup: a non-transactional REST client must not act on a stale baseline.
    require(client.snapshot() == before, "State drifted during backup; no writes attempted.")
    day_id = stable_id("day")
    expected_day = manifest["records"]["conference_days"][0]

    def day_gate(published):
        client.request("PATCH", "conference_days", day_id, payload={"published": published})
        report["writes"] += 1
        require(matches(client.request("GET", "conference_days", day_id), {**expected_day, "published": published}),
                "Day publication readback mismatch.")


    try:
        if mode == "stage":
            for collection, desired in inspection["missing"]:
                row = {**desired, "published": False} if collection == "agenda_slots" else desired
                if collection != "conference_days":
                    require(matches(client.request("GET", "conference_days", day_id), expected_day),
                            "Day gate changed during staging.")
                client.request("POST", collection, payload=row)
                require(matches(client.request("GET", collection, row["id"]), row),
                        f"Created record readback mismatch: {collection}/{row['id']}.")
                report["writes"] += 1
        else:
            # Existing API transactions cover ONE Slot + Session, not a Day.
            # Publication intentionally exposes a resumable partial programme.
            if mode == "publish" and not inspection["published"]:
                day_gate(True)

            slots = {s["id"]: s for s in before["agenda_slots"]}
            target = mode == "publish"
            for slot in manifest["records"]["agenda_slots"]:
                if slots[slot["id"]]["published"] is target:
                    continue
                client.publication(slot, target, manifest)
                report["writes"] += 1
                require(matches(client.request("GET", "agenda_slots", slot["id"]), {**slot, "published": target}),
                        "Slot publication readback mismatch.")
                if slot["session"]:
                    require(client.request("GET", "sessions", slot["session"])["published"] is target,
                            "Coordinated Session publication readback mismatch.")

            if mode == "rollback" and inspection["published"]:
                # The hook rejects hiding a Day with published Slots. Do this last.
                day_gate(False)
        after = client.snapshot()
        final = inspect_state(manifest, after, complete=True, expect="published" if mode == "publish" else "staged")
        require(unrelated(before, manifest) == unrelated(after, manifest),
                "Unrelated data changed during operation; investigate concurrent writer.")
    except SafetyError as exc:
        # Never guess whether a timed-out request committed, or automatically
        # roll back after an uncertain response. Next invocation re-reads state.
        raise SafetyError(f"{exc} Operation stopped; backup: {report['backup']}. "
                          "Read state before explicit stage/publish resume or rollback; partial publication may be visible.") from None
    report.update(missing_records=0, day_published=final["published"], published_slots=final["published_slots"],
                  phase=final["phase"], verified=True)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", nargs="?", choices=("dry-run", "stage", "publish", "rollback", "verify"), default="dry-run")
    parser.add_argument("--snapshot", type=Path, help="Offline dry-run only; never a write baseline")
    parser.add_argument("--credentials-file", default="~/.zshrc")
    parser.add_argument("--execute", action="store_true", help="Explicit write authorization")
    parser.add_argument("--accept-partial-publication", action="store_true",
                        help="Accept a visible partial agenda; rollback is blocked once any Session Slot is public")
    parser.add_argument("--exclusive-writer", action="store_true", help="Acknowledge external agenda editors are paused")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--expect", choices=("staged", "published"), help="Expected complete gate for verify")
    args = parser.parse_args(argv)
    try:
        require(args.expect is None or args.mode == "verify", "--expect is for verify only.")
        manifest = json.loads(MANIFEST.read_text())
        validate_manifest(manifest)
        if args.snapshot:
            require(args.mode == "dry-run" and not args.execute, "Offline snapshots can only dry-run.")
            state = json.loads(args.snapshot.read_text())
            result = inspect_state(manifest, state)
            print(json.dumps({"mode": "offline-dry-run", "manifest_sha256": digest(manifest),
                              "records": {c: len(v) for c, v in manifest["records"].items()},
                              "session_links": len(manifest["bindings"]), "missing_records": len(result["missing"]),
                              "day_published": result["published"], "writes": 0}, indent=2))
            return 0
        writes = args.mode in ("stage", "publish", "rollback")
        require(not writes or (args.execute and args.exclusive_writer and args.backup_dir is not None),
                "Writes require --execute --exclusive-writer --backup-dir PRIVATE_DIRECTORY.")
        require(args.mode not in ("publish", "rollback") or args.accept_partial_publication,
                "Publish/rollback require --accept-partial-publication; the supported API is not Day-atomic.")
        require(writes or not args.execute, "--execute is only for stage/publish/rollback.")
        client = PocketBase(*credentials(args.credentials_file))
        # Same-user, same-host exclusion only. Cross-host exclusivity is an operator prerequisite.
        if writes:
            lockpath = Path.home() / ".cache" / "wts-main-day-agenda.lock"
            lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                report = run_operation(client, manifest, args.mode, args.backup_dir)
        else:
            report = run_operation(client, manifest, args.mode, expect=(args.expect or "published") if args.mode == "verify" else None)
        print(json.dumps(report, indent=2))
        return 0
    except SafetyError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError):
        print("REFUSED: local input/lock/IO/JSON/schema error; credentials and raw response suppressed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
