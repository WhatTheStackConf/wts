"""Public seams: deterministic manifest and safe publisher operations."""
import importlib.util
import contextlib
import copy
from datetime import datetime
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("agenda", ROOT / "main-day-agenda.py")
assert spec is not None and spec.loader is not None
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)
FIXTURE = json.loads((ROOT / "main-day-agenda.manifest.json").read_text())


def source_state():
    return {
        **{c: [] for c in agenda.WRITABLE},
        "appearance_events": [{"id": agenda.EVENT, "published": True}],
        "speakers": [copy.deepcopy(b["speaker"]) for b in FIXTURE["bindings"]],
        "sessions": [copy.deepcopy(b["session"]) for b in FIXTURE["bindings"]],
    }


def full_state(published=False):
    state = source_state()
    state.update(copy.deepcopy(FIXTURE["records"]))
    state["conference_days"][0]["published"] = published
    for slot in state["agenda_slots"]:
        slot["published"] = published
    return state


def local_time(instant):
    return datetime.fromisoformat(instant.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Skopje")).strftime("%H:%M")


class ManifestTests(unittest.TestCase):
    def test_reviewed_manifest_has_exact_27_unique_talk_links(self):
        manifest = json.loads((ROOT / "main-day-agenda.manifest.json").read_text())
        agenda.validate_manifest(manifest)
        links = [r["session"] for r in manifest["records"]["agenda_slots"] if r["kind"] == "session"]
        self.assertEqual(len(links), 27)
        self.assertEqual(len(set(links)), 27)
        self.assertNotIn("riste-stojanov", [b["speaker"]["slug"] for b in manifest["bindings"]])


    def test_timing_lineup_short_sessions_and_tbd_contract(self):
        slots = FIXTURE["records"]["agenda_slots"]
        bindings = {b["session"]["id"]: b for b in FIXTURE["bindings"]}
        tracks = {t["id"]: t["key"] for t in FIXTURE["records"]["agenda_tracks"]}
        self.assertEqual(len(slots), 39)
        self.assertEqual(len([s for s in slots if not s["track"]]), 5)
        self.assertEqual([t["name"] for t in FIXTURE["records"]["agenda_tracks"]],
                         ["Stage 3", "Stage 1", "Stage 2", "Stage 4", "Stage 5"])
        self.assertEqual([t["name"] for t in sorted(FIXTURE["records"]["agenda_tracks"], key=lambda t: t["display_order"])],
                         [f"Stage {i}" for i in range(1, 6)])
        actual = {}
        for slot in slots:
            if slot["session"]:
                binding = bindings[slot["session"]]
                actual[binding["speaker"]["slug"]] = (tracks[slot["track"]], local_time(slot["start_at"]))
                duration = (datetime.fromisoformat(slot["end_at"].replace("Z", "+00:00")) -
                            datetime.fromisoformat(slot["start_at"].replace("Z", "+00:00"))).total_seconds() / 60
                self.assertEqual(duration, 20 if binding["short_15_plus_5"] else 35)
        self.assertEqual(actual["gerald-versluis"], ("stage-3", "10:10"))
        self.assertEqual(actual["santosh-yadav"], ("stage-3", "10:55"))
        self.assertEqual(actual["ramona-schwering"], ("stage-3", "11:50"))
        self.assertEqual(actual["sam-vloeberghs"], ("stage-2", "11:50"))
        self.assertEqual(actual["alem-tuzlak"], ("stage-2", "10:55"))
        self.assertEqual(actual["alexander-lichter"], ("stage-2", "10:10"))
        self.assertEqual(actual["kiril-zafirov"], ("stage-2", "12:35"))
        self.assertEqual(actual["andjelina-maksimovic"], ("stage-4", "11:50"))
        self.assertEqual(actual["riste-oreshkovski"], ("stage-1", "14:45"))
        self.assertEqual(actual["dragan-shahpaski"], ("stage-1", "15:05"))
        stage5 = [s for s in slots if tracks.get(s["track"]) == "stage-5"]
        self.assertEqual([(local_time(s["start_at"]), local_time(s["end_at"])) for s in stage5],
                         [("10:10", "11:30"), ("11:50", "13:10"), ("13:50", "14:25"), ("14:45", "16:05")])
        self.assertTrue(all(s["title"] == "TBD" and not s["session"] for s in stage5))
        placeholders = [s for s in slots if s["track"] and not s["session"]]
        self.assertEqual(len(placeholders), 7)
        self.assertEqual({(s["title"], s["summary"]) for s in placeholders},
                         {("TBD", "Programme to be announced.")})
        short_placeholder = next(s for s in placeholders if tracks[s["track"]] == "stage-4")
        self.assertEqual((local_time(short_placeholder["start_at"]), local_time(short_placeholder["end_at"])),
                         ("12:10", "12:30"))

    def test_refuses_foreign_collision_and_owned_field_drift(self):
        for collection in agenda.WRITABLE:
            state = full_state()
            state[collection][0]["unexpected_business_field"] = "foreign"
            with self.subTest(collection=collection), self.assertRaises(agenda.SafetyError):
                agenda.inspect_state(FIXTURE, state)
        state = source_state()
        state["conference_days"] = [{**FIXTURE["records"]["conference_days"][0], "id": "f" * 15}]
        with self.assertRaisesRegex(agenda.SafetyError, "collision"):
            agenda.inspect_state(FIXTURE, state)

    def test_never_repairs_incomplete_published_day(self):
        state = full_state(True)
        state["agenda_slots"].pop()
        with self.assertRaisesRegex(agenda.SafetyError, "Published day is incomplete"):
            agenda.inspect_state(FIXTURE, state)

    def test_rejects_source_drift_and_modified_manifest(self):
        state = source_state()
        state["sessions"][0]["title"] = "Changed after review"
        with self.assertRaisesRegex(agenda.SafetyError, "drifted"):
            agenda.inspect_state(FIXTURE, state)
        modified = copy.deepcopy(FIXTURE)
        modified["records"]["agenda_slots"][0]["end_at"] = agenda.instant("11:30")
        with self.assertRaisesRegex(agenda.SafetyError, "reviewed schedule"):
            agenda.validate_manifest(modified)

    def test_cli_cannot_write_without_explicit_guards(self):
        with contextlib.redirect_stderr(io.StringIO()), patch.object(agenda, "credentials") as credentials:
            self.assertEqual(agenda.main(["stage"]), 1)
            self.assertEqual(agenda.main(["publish", "--execute"]), 1)
            self.assertEqual(agenda.main(["publish", "--execute", "--exclusive-writer", "--backup-dir", "/tmp/not-used"]), 1)
            self.assertEqual(agenda.main(["rollback", "--execute", "--exclusive-writer", "--backup-dir", "/tmp/not-used"]), 1)
            credentials.assert_not_called()

    def test_phase_validation_and_recovery_fail_closed(self):
        state = full_state()
        state["agenda_slots"][0]["published"] = True
        with self.assertRaisesRegex(agenda.SafetyError, "under unpublished Day"):
            agenda.inspect_state(FIXTURE, state)
        state["conference_days"][0]["published"] = True
        self.assertEqual(agenda.inspect_state(FIXTURE, state)["phase"], "partial")
        with self.assertRaisesRegex(agenda.SafetyError, "Expected published"):
            agenda.inspect_state(FIXTURE, state, complete=True, expect="published")
        state["sessions"][0]["published"] = False
        with self.assertRaisesRegex(agenda.SafetyError, "not published"):
            agenda.inspect_state(FIXTURE, state)
        # Session publication is never normalized out of the unrelated-data audit.
        self.assertNotEqual(agenda.unrelated(state, FIXTURE), agenda.unrelated(full_state(True), FIXTURE))
        state["sessions"][0]["published"] = True
        state["sessions"][0]["title"] = "Concurrent editor changed source"
        with self.assertRaisesRegex(agenda.SafetyError, "drifted"):
            agenda.inspect_state(FIXTURE, state)


class PocketBaseIntegrationTests(unittest.TestCase):
    def test_staging_resume_publication_and_unrelated_data_preservation(self):
        fixture_spec = importlib.util.spec_from_file_location("local_fixture", ROOT / "main-day-agenda.fixture.py")
        assert fixture_spec is not None and fixture_spec.loader is not None
        fixture = importlib.util.module_from_spec(fixture_spec)
        fixture_spec.loader.exec_module(fixture)
        with tempfile.TemporaryDirectory(prefix="wts-agenda-integration-") as root:
            root = Path(root)
            source = source_state()
            for event_id in sorted({event_id for speaker in source["speakers"] for event_id in speaker["appearance_events"]} - {agenda.EVENT}):
                source["appearance_events"].append({"id": event_id, "name": f"Fixture event {event_id}", "published": True})
            source["conference_days"] = [{"id": "d" * 15, "key": "monday", "local_date": "2026-09-14",
                                          "title": "Unpublished Monday fixture", "display_order": 1, "published": False}]
            source["appearance_events"].append({"id": "e" * 15, "name": "Monday fixture", "published": True})
            source["event_programmes"] = [{"id": "p" * 15, "day": "d" * 15,
                                           "appearance_event": "e" * 15, "display_order": 0}]
            source_path = root / "public-fixture.json"
            source_path.write_text(json.dumps(source))
            fixture.provision(root / "pb", source_path, "empty")
            process, url = fixture.start(root / "pb", fixture.free_port())
            try:
                pb = fixture.client(url)
                before = pb.snapshot()
                with self.assertRaisesRegex(agenda.SafetyError, "incomplete"):
                    agenda.run_operation(pb, FIXTURE, "publish", root / "backups")
                staged = agenda.run_operation(pb, FIXTURE, "stage", root / "backups")
                self.assertEqual(staged["writes"], 46)
                self.assertFalse(staged["day_published"])
                first = pb.snapshot()
                self.assertEqual(agenda.unrelated(first, FIXTURE), agenda.unrelated(before, FIXTURE))
                self.assertEqual(agenda.run_operation(pb, FIXTURE, "stage", root / "backups")["writes"], 0)
                # Simulate interrupted staging by removing one owned child in this disposable DB only.
                slot = FIXTURE["records"]["agenda_slots"][-1]
                request = urllib.request.Request(url + "/api/collections/agenda_slots/records/" + slot["id"],
                                                 method="DELETE", headers={"Authorization": pb.token})
                with urllib.request.urlopen(request, timeout=10) as response:
                    self.assertEqual(response.status, 204)
                # Sabotage the staging fix via the old published payload: the
                # actual constraints hook must reject it, not a mock validator.
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    fixture.local_request(url, "POST", "/api/collections/agenda_slots/records", slot, pb.token)
                self.assertEqual(caught.exception.code, 400)
                self.assertIn("Publish the Conference Day before", caught.exception.read().decode())
                repaired = agenda.run_operation(pb, FIXTURE, "stage", root / "backups")
                self.assertEqual(repaired["writes"], 1)
                agenda.inspect_state(FIXTURE, pb.snapshot(), complete=True, expect="staged")
                # Stop before first Slot commit: only the Day gate is public,
                # so rollback is safe and must leave all Session rows untouched.
                with patch.object(pb, "publication", side_effect=agenda.SafetyError("Injected before commit")):
                    with self.assertRaisesRegex(agenda.SafetyError, "before commit"):
                        agenda.run_operation(pb, FIXTURE, "publish", root / "backups")
                self.assertEqual(agenda.run_operation(pb, FIXTURE, "rollback", root / "backups")["writes"], 1)
                self.assertEqual(agenda.unrelated(pb.snapshot(), FIXTURE), agenda.unrelated(before, FIXTURE))
                # Lose a response AFTER the real transaction committed. Resume
                # only missing publication; never hide pre-existing public talks.
                publication = pb.publication
                def lost_response(slot, target, manifest):
                    publication(slot, target, manifest)
                    raise agenda.SafetyError("Injected lost committed response")
                with patch.object(pb, "publication", side_effect=lost_response):
                    with self.assertRaisesRegex(agenda.SafetyError, "lost committed response"):
                        agenda.run_operation(pb, FIXTURE, "publish", root / "backups")
                partial = agenda.run_operation(pb, FIXTURE, "dry-run")
                self.assertEqual((partial["phase"], partial["published_slots"]), ("partial", 1))
                snapshot = pb.snapshot()
                with self.assertRaisesRegex(agenda.SafetyError, "Rollback blocked"):
                    agenda.run_operation(pb, FIXTURE, "rollback", root / "backups")
                self.assertEqual(pb.snapshot(), snapshot)
                self.assertEqual(agenda.unrelated(snapshot, FIXTURE), agenda.unrelated(before, FIXTURE))
                with self.assertRaisesRegex(agenda.SafetyError, "Expected published"):
                    agenda.run_operation(pb, FIXTURE, "verify", expect="published")
                published = agenda.run_operation(pb, FIXTURE, "publish", root / "backups")
                self.assertEqual(published["writes"], 38)
                self.assertEqual(published["published_slots"], 39)
                self.assertTrue(published["day_published"])
                verified = agenda.run_operation(pb, FIXTURE, "verify", expect="published")
                self.assertEqual(verified["missing_records"], 0)
                self.assertEqual(agenda.run_operation(pb, FIXTURE, "publish", root / "backups")["writes"], 0)
                self.assertEqual(agenda.unrelated(pb.snapshot(), FIXTURE), agenda.unrelated(before, FIXTURE))
                self.assertEqual(Path(staged["backup"]).stat().st_mode & 0o777, 0o600)
                # Real hook refuses both direct Session Slot toggles and hiding
                # the Day first. Verify error text so a different failure cannot pass.
                first_slot = FIXTURE["records"]["agenda_slots"][0]
                def rejected(path, payload, message):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        fixture.local_request(url, "PATCH", path, payload, pb.token)
                    self.assertEqual(caught.exception.code, 400)
                    self.assertIn(message, caught.exception.read().decode())
                rejected("/api/collections/agenda_slots/records/" + first_slot["id"], {"published": False},
                         "coordinated programme operation")
                rejected("/api/collections/conference_days/records/" + agenda.stable_id("day"), {"published": False},
                         "Slots before unpublishing the Day")
                # Publication already completed: safe rollback must refuse before
                # any writes, because the real route would also hide public talks.
                snapshot = pb.snapshot()
                with self.assertRaisesRegex(agenda.SafetyError, "Rollback blocked"):
                    agenda.run_operation(pb, FIXTURE, "rollback", root / "backups")
                self.assertEqual(pb.snapshot(), snapshot)
                self.assertTrue(all(s["published"] for s in snapshot["sessions"]))
                with self.assertRaisesRegex(fixture.agenda.SafetyError, "Cannot unpublish Session Slots"):
                    pb.publication(first_slot, False, FIXTURE)
            finally:
                fixture.stop(process)


if __name__ == "__main__":
    unittest.main()
