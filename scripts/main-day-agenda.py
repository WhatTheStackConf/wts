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


def published_member(speaker):
    return speaker["published"] is True and EVENT in speaker["appearance_events"]


def talk_binding(source, slug, short):
    speaker = one([s for s in source["speakers"] if s["slug"] == slug], f"speaker {slug}")
    require(published_member(speaker), f"Speaker {slug} lacks published main-event membership.")
    candidates = [s for s in source["sessions"] if speaker["id"] in s["speakers"]
                  and s.get("format", "").lower() == "talk"]
    session = one(candidates, f"talk for {slug}")
    require(session["published"] is True, f"Talk for {slug} is not published.")
    # A co-speaker also needs an explicit published main-event appearance.
    for sid in session["speakers"]:
        co = one([s for s in source["speakers"] if s["id"] == sid], "session speaker")
        require(published_member(co), "Session co-speaker lacks published main-event membership.")
    return {"speaker": project(speaker, ("id", "slug", "published", "appearance_events")),
            "session": project(session, ("id", "slug", "title", "published", "format", "speakers")),
            "short_15_plus_5": short}


def retime(slot, times, **fields):
    start, end = times.split("-")
    slot.update(**fields, start_at=instant(start), end_at=instant(end), display_order=int(start.replace(":", "")))


def talk_slot(records, sessions_by_speaker, slug, label):
    return one([s for s in records["agenda_slots"] if s["session"] == sessions_by_speaker[slug]], label)


def revise_stage_order(records, bindings, sessions_by_speaker):
    # Keep immutable Track keys and Slot/Session identities from revision 1.
    # Only public stage labels/order and the four approved clock windows move.
    stage_numbers = {1: 3, 2: 1, 3: 2, 4: 4, 5: 5}
    for track in records["agenda_tracks"]:
        number = stage_numbers[track["display_order"]]
        track.update(name=f"Stage {number}", display_order=number)
    reordered = {"sam-vloeberghs": 2, "kiril-zafirov": 3, "alem-tuzlak": 1, "alexander-lichter": 0}
    for slug, index in reordered.items():
        retime(talk_slot(records, sessions_by_speaker, slug, "rescheduled talk"), TIMES[index])


def revise_stage_moves(records, bindings, sessions_by_speaker):
    # Public Stage 2 is immutable stage-3; public Stage 3 is stage-1.
    moves = {
        "riste-oreshkovski": (3, "14:45-15:20"),
        "dragan-shahpaski": (1, "14:45-15:05"),
        "andjelina-maksimovic": (4, "15:30-15:50"),
        "faris-aziz": (4, "11:50-12:25"),
        "stefan-andonov": (4, "12:35-13:10"),
        "bogdan-ilie": (4, "13:50-14:25"),
        "domagoj-maric": (4, "14:45-15:20"),
    }
    for slug, (stage, times) in moves.items():
        retime(talk_slot(records, sessions_by_speaker, slug, "revision-3 talk"), times, track=stable_id(f"stage-{stage}"))
    for binding in bindings:
        if binding["speaker"]["slug"] == "riste-oreshkovski":
            binding["short_15_plus_5"] = False
    records["agenda_slots"] = [s for s in records["agenda_slots"]
                              if s["session"] or not s["track"] or s["track"] == stable_id("stage-5")]


def revise_short_talk(records, bindings, sessions_by_speaker):
    slot = talk_slot(records, sessions_by_speaker, "andjelina-maksimovic", "revision-4 short talk")
    slot.update(track=stable_id("stage-1"), start_at=instant("15:05"), end_at=instant("15:25"), display_order=1505)


REVISIONS = ((2, revise_stage_order), (3, revise_stage_moves), (4, revise_short_talk))
SPLIT_TALKS = {
    "riste-oreshkovski": (("14:45-15:05", "riste-oreshkovski", True), ("15:05-15:25", "dragan-shahpaski", True)),
    "andjelina-maksimovic": (("11:50-12:10", "andjelina-maksimovic", True), ("12:10-12:30", None, False)),
}


def revision_one_grid():
    for stage, speakers in enumerate(LINEUP, 1):
        for index, slug in enumerate(speakers):
            for times, talk, short in SPLIT_TALKS.get(slug, ((TIMES[index], slug, False),)):
                yield stage, times, talk, short


def build_manifest(source, revision=4):
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
            binding = talk_binding(source, slug, short)
            bindings.append(binding)
            session_id, kind, title, summary = binding["session"]["id"], "session", "", ""
        records["agenda_slots"].append({
            "id": stable_id(f"slot:{stage}:{start}"), "programme": programme_id,
            "track": stable_id(f"stage-{stage}") if stage else "",
            "start_at": instant(start), "end_at": instant(end), "kind": kind,
            "published": True, "display_order": int(start.replace(":", "")),
            "location_label": "", "session": session_id, "title": title, "summary": summary,
        })

    for stage, times, talk, short in revision_one_grid():
        add(stage, times, talk, short=short)
    for times in ("10:10-11:30", "11:50-13:10", "13:50-14:25", "14:45-16:05"):
        add(5, times)
    for kind, times, title, summary in SHARED:
        add(0, times, kind=kind, title=title, summary=summary)
    require(revision in (1, 2, 3, 4), "Unknown main-day schedule revision.")
    sessions_by_speaker = {b["speaker"]["slug"]: b["session"]["id"] for b in bindings}
    for number, revise in REVISIONS:
        if revision >= number:
            revise(records, bindings, sessions_by_speaker)
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
    require_owned_ids(records)
    links = [s["session"] for s in slots if s["kind"] == "session"]
    require(len(links) == len(set(links)) == 27, "Expected exactly 27 unique talk links.")
    for i, slot in enumerate(slots):
        require(slot["end_at"] > slot["start_at"], "Nonpositive slot duration.")
        require(slot_content_valid(slot), "Slot violates title/summary/session constraints.")
        for other in slots[i + 1:]:
            require(not slots_collide(slot, other), "Overlapping track or shared slots.")


def require_owned_ids(records):
    ids = [r["id"] for rows in records.values() for r in rows]
    require(len(ids) == len(set(ids)) and all(re.fullmatch(r"[a-z0-9]{15}", x) for x in ids), "Invalid/duplicate owned IDs.")


def slot_content_valid(slot):
    if slot["kind"] == "session":
        return not slot["title"] and not slot["summary"]
    return not slot["session"] and slot["title"] and slot["summary"]


def slots_collide(slot, other):
    conflicts = not slot["track"] or not other["track"] or slot["track"] == other["track"]
    overlap = slot["start_at"] < other["end_at"] and slot["end_at"] > other["start_at"]
    return conflicts and overlap


def normalized(key, value):
    if key in ("start_at", "end_at") and isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    return value


def same_record(expected, actual):
    return expected.keys() == actual.keys() and all(
        normalized(k, v) == normalized(k, actual[k]) for k, v in expected.items())


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


def require_snapshot(state):
    for name in COLLECTIONS:
        require(name in state and isinstance(state[name], list), f"Missing collection snapshot: {name}.")
        ids = [r["id"] for r in state[name]]
        require(len(ids) == len(set(ids)), f"Duplicate record IDs in {name} snapshot.")


def scope_rules(expected):
    """Per collection, the predicates that put a foreign row inside the owned agenda scope."""
    day = expected["conference_days"][0]
    programme = expected["event_programmes"][0]
    track_ids = {t["id"] for t in expected["agenda_tracks"]}
    session_ids = {s["session"] for s in expected["agenda_slots"] if s["session"]}

    def in_programme(row):
        return row.get("programme") == programme["id"]

    return {
        "conference_days": (lambda row: row.get("key") == day["key"] or row.get("local_date") == DATE,),
        "event_programmes": (lambda row: row.get("day") == day["id"] or row.get("appearance_event") == EVENT,),
        "agenda_tracks": (in_programme,),
        "agenda_slots": (in_programme, lambda row: row.get("track") in track_ids,
                         lambda row: row.get("session") in session_ids),
    }


def require_no_collisions(collection, rows, expected_rows, rules):
    allowed = {r["id"] for r in expected_rows}
    for row in rows:
        rid = row["id"]
        related = any([rule(row) for rule in rules])
        require(rid in allowed or not (rid.startswith(PREFIX) or related),
                f"Unexpected owned/scope/unique-session collision: {collection}/{rid}.")


def missing_owned(collection, expected_rows, actual_by_id):
    missing = []
    for row in expected_rows:
        actual = actual_by_id.get(row["id"])
        if actual is None:
            missing.append((collection, row))
        else:
            require(matches(actual, row, collection in ("conference_days", "agenda_slots")),
                    f"Owned ID collision or field drift: {collection}/{row['id']}.")
    return missing


def pinned_source(manifest, state):
    # A speaker may also have a weekday talk. Verify the explicitly pinned
    # Session identities rather than requiring one talk across the whole week.
    pinned_sessions = {b["session"]["id"] for b in manifest["bindings"]}
    return {**state, "sessions": [s for s in state["sessions"] if s["id"] in pinned_sessions]}


def published_slot_count(expected_slots, actual_by_id):
    owned_slots = [actual_by_id[s["id"]] for s in expected_slots if s["id"] in actual_by_id]
    return sum(s["published"] is True for s in owned_slots)


def phase_of(published, published_slots, slot_count, staged):
    if published_slots == slot_count:
        return "published"
    if published:
        return "partial"
    return "staged" if staged else "incomplete"


def inspect_state(manifest, state, complete=False, expect=None):
    """Validate pins, collisions, exact owned fields, extras and publication gate."""
    require_snapshot(state)
    require(build_manifest(pinned_source(manifest, state), revision=manifest["version"]) == manifest, "Live source bindings/titles/membership drifted; review a new manifest.")
    expected = manifest["records"]
    day = expected["conference_days"][0]
    by_id = {c: {r["id"]: r for r in state[c]} for c in WRITABLE}
    rules = scope_rules(expected)
    missing = []
    for collection in WRITABLE:
        require_no_collisions(collection, state[collection], expected[collection], rules[collection])
        missing += missing_owned(collection, expected[collection], by_id[collection])
    current_day = by_id["conference_days"].get(day["id"])
    published = current_day is not None and current_day["published"] is True
    require(not (published and missing), "Published day is incomplete; refusing any automatic repair.")
    published_slots = published_slot_count(expected["agenda_slots"], by_id["agenda_slots"])
    require(published or not published_slots, "Published Slots under unpublished Day; inconsistent hook state.")
    require(not complete or not missing, f"Staging incomplete: {len(missing)} records missing.")
    phase = phase_of(published, published_slots, len(expected["agenda_slots"]), current_day and not missing)

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


def draft_create(collection, payload):
    return (payload.get("id", "").startswith(PREFIX)
            and (collection not in ("conference_days", "agenda_slots") or payload.get("published") is False))


def day_publication(collection, rid, payload):
    return (collection == "conference_days" and rid == stable_id("day")
            and set(payload) == {"published"} and type(payload["published"]) is bool)


RELATIONS = {("event_programmes", "day"): "conference_days",
             ("event_programmes", "appearance_event"): "appearance_events",
             ("agenda_tracks", "programme"): "event_programmes",
             ("agenda_slots", "programme"): "event_programmes",
             ("agenda_slots", "track"): "agenda_tracks", ("agenda_slots", "session"): "sessions"}
LOCKED_RULES = ("listRule", "viewRule", "createRule", "updateRule", "deleteRule")


def field_type(name, key, value):
    if (name, key) in RELATIONS:
        return "relation"
    if key in ("start_at", "end_at"):
        return "date"
    if key == "kind":
        return "select"
    if isinstance(value, bool):
        return "bool"
    return "number" if isinstance(value, int) else "text"


def require_schema(schemas, name, sample):
    fields = {f["name"]: f for f in schemas[name]["fields"] if f["name"] not in ("created", "updated")}
    require(set(fields) == set(sample), f"Unexpected live schema fields for {name}.")
    for key, value in sample.items():
        expected_type = field_type(name, key, value)
        require(fields[key]["type"] == expected_type, f"Schema field type drift: {name}/{key}.")
        if expected_type == "relation":
            require(fields[key]["collectionId"] == schemas[RELATIONS[name, key]]["id"]
                    and fields[key]["maxSelect"] == 1 and not fields[key].get("cascadeDelete"),
                    f"Schema relation drift: {name}/{key}.")
    require(all(schemas[name].get(rule) is None for rule in LOCKED_RULES), f"Raw agenda rules are not locked: {name}.")


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
            require(payload is not None and ((method == "POST" and draft_create(collection, payload))
                                             or (method == "PATCH" and day_publication(collection, rid, payload))),
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
        for name in WRITABLE:
            require_schema(schemas, name, manifest["records"][name][0])
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


def operation_report(manifest, mode, inspection):
    return {"mode": mode, "manifest_sha256": digest(manifest),
            "records": {c: len(v) for c, v in manifest["records"].items()},
            "session_links": len(manifest["bindings"]), "missing_records": len(inspection["missing"]),
            "day_published": inspection["published"], "published_slots": inspection["published_slots"],
            "phase": inspection["phase"], "atomic": False, "writes": 0}


def require_writable(mode, inspection, before, manifest):
    if mode == "stage":
        require(not inspection["published"], "Stage cannot modify a public Day; use publish to resume or rollback.")
    if mode == "rollback":
        owned = {r["id"] for r in manifest["records"]["agenda_slots"]}
        require(not any(s["published"] and s["session"] for s in before["agenda_slots"] if s["id"] in owned),
                "Rollback blocked: coordinated unpublish would hide existing public talks. Resume publish instead; no writes attempted.")


CONVERGED = {"publish": lambda i: i["phase"] == "published",
             "rollback": lambda i: i["phase"] == "staged",
             "stage": lambda i: not i["missing"]}


def stage_missing(client, missing, expected_day, report):
    for collection, desired in missing:
        row = {**desired, "published": False} if collection == "agenda_slots" else desired
        if collection != "conference_days":
            require(matches(client.request("GET", "conference_days", stable_id("day")), expected_day),
                    "Day gate changed during staging.")
        client.request("POST", collection, payload=row)
        require(matches(client.request("GET", collection, row["id"]), row),
                f"Created record readback mismatch: {collection}/{row['id']}.")
        report["writes"] += 1


def set_day_gate(client, expected_day, published, report):
    day_id = stable_id("day")
    client.request("PATCH", "conference_days", day_id, payload={"published": published})
    report["writes"] += 1
    require(matches(client.request("GET", "conference_days", day_id), {**expected_day, "published": published}),
            "Day publication readback mismatch.")


def publish_slots(client, manifest, before, target, report):
    slots = {s["id"]: s for s in before["agenda_slots"]}
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


def toggle_publication(client, manifest, mode, inspection, before, report):
    # Existing API transactions cover ONE Slot + Session, not a Day.
    # Publication intentionally exposes a resumable partial programme.
    expected_day = manifest["records"]["conference_days"][0]
    if mode == "publish" and not inspection["published"]:
        set_day_gate(client, expected_day, True, report)
    publish_slots(client, manifest, before, mode == "publish", report)
    if mode == "rollback" and inspection["published"]:
        # The hook rejects hiding a Day with published Slots. Do this last.
        set_day_gate(client, expected_day, False, report)


def run_operation(client, manifest, mode, backup_dir=None, expect=None):
    require(mode in ("dry-run", "verify", "stage", "publish", "rollback"), "Unsupported operation.")
    validate_manifest(manifest)
    schemas = client.schemas(manifest)
    before = client.snapshot()
    inspection = inspect_state(manifest, before, complete=mode in ("publish", "verify", "rollback"), expect=expect)
    report = operation_report(manifest, mode, inspection)
    if mode in ("dry-run", "verify"):
        return report
    require_writable(mode, inspection, before, manifest)
    if CONVERGED[mode](inspection):
        return report
    require(backup_dir is not None, "An explicit private backup directory is required.")
    report["backup"] = secure_backup(backup_dir, before, schemas, manifest, mode, client.url)
    # Read again after backup: a non-transactional REST client must not act on a stale baseline.
    require(client.snapshot() == before, "State drifted during backup; no writes attempted.")
    try:
        if mode == "stage":
            stage_missing(client, inspection["missing"], manifest["records"]["conference_days"][0], report)
        else:
            toggle_publication(client, manifest, mode, inspection, before, report)
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


def offline_dry_run(manifest, args):
    require(args.mode == "dry-run" and not args.execute, "Offline snapshots can only dry-run.")
    state = json.loads(args.snapshot.read_text())
    result = inspect_state(manifest, state)
    print(json.dumps({"mode": "offline-dry-run", "manifest_sha256": digest(manifest),
                      "records": {c: len(v) for c, v in manifest["records"].items()},
                      "session_links": len(manifest["bindings"]), "missing_records": len(result["missing"]),
                      "day_published": result["published"], "writes": 0}, indent=2))
    return 0


def require_write_guards(args, writes):
    require(not writes or (args.execute and args.exclusive_writer and args.backup_dir is not None),
            "Writes require --execute --exclusive-writer --backup-dir PRIVATE_DIRECTORY.")
    require(args.mode not in ("publish", "rollback") or args.accept_partial_publication,
            "Publish/rollback require --accept-partial-publication; the supported API is not Day-atomic.")
    require(writes or not args.execute, "--execute is only for stage/publish/rollback.")


def locked_operation(client, manifest, args):
    lockpath = Path.home() / ".cache" / "wts-main-day-agenda.lock"
    lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_operation(client, manifest, args.mode, args.backup_dir)


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
            return offline_dry_run(manifest, args)
        writes = args.mode in ("stage", "publish", "rollback")
        require_write_guards(args, writes)
        client = PocketBase(*credentials(args.credentials_file))
        # Same-user, same-host exclusion only. Cross-host exclusivity is an operator prerequisite.
        if writes:
            report = locked_operation(client, manifest, args)
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
