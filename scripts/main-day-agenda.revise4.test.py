"""Single-Slot revision safety, real validation hooks, and no-op replay."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


revise = load('revise4', 'main-day-agenda.revise4.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')


def state(manifest):
    value = copy.deepcopy(manifest['records'])
    value['conference_days'][0]['published'] = True
    value['appearance_events'] = [{'id': revise.agenda.EVENT, 'published': True}]
    value['speakers'] = [copy.deepcopy(b['speaker']) for b in manifest['bindings']]
    value['sessions'] = [copy.deepcopy(b['session']) for b in manifest['bindings']]
    return value


def changed_ids(before_rows, after_rows):
    return [r['id'] for r in before_rows if r != next(s for s in after_rows if s['id'] == r['id'])]


def stage_rows(rows, stages, name):
    return [r for r in rows if stages.get(r['track']) == name]


class PlanTests(unittest.TestCase):
    def test_exact_single_slot_delta_and_stage_endings(self):
        before, after = state(revise.baseline()), state(revise.TARGET)
        revise.verify_delta(before, after)
        requests = revise.plan(before)
        self.assertEqual(requests, [{'method': 'PATCH',
            'path': '/api/collections/agenda_slots/records/md26ebe1331a8a6',
            'payload': {'track': 'md2678bf170448b', 'start_at': '2026-09-19 13:05:00.000Z',
                        'end_at': '2026-09-19 13:25:00.000Z', 'display_order': 1505}}])
        self.assertEqual(revise.plan(after), [])
        for collection in revise.agenda.COLLECTIONS:
            changed = changed_ids(before[collection], after[collection])
            self.assertEqual(changed, [revise.SLOT_ID] if collection == 'agenda_slots' else [])
        stages = {t['id']: t['name'] for t in after['agenda_tracks']}
        rows = after['agenda_slots']
        self.assertEqual(max(s['end_at'] for s in stage_rows(rows, stages, 'Stage 3')), revise.agenda.instant('15:25'))
        self.assertEqual(max(s['end_at'] for s in stage_rows(rows, stages, 'Stage 4')), revise.agenda.instant('15:20'))
        names = {b['session']['id']: b['speaker']['slug'] for b in revise.TARGET['bindings']}
        stage3 = sorted(stage_rows(rows, stages, 'Stage 3'), key=lambda r: r['start_at'])
        self.assertEqual([names[r['session']] for r in stage3[-2:]], ['dragan-shahpaski', 'andjelina-maksimovic'])
        self.assertEqual(stage3[-2]['end_at'], stage3[-1]['start_at'])

    def test_rejects_source_slot_and_unrelated_drift(self):
        for collection in revise.agenda.COLLECTIONS:
            before = state(revise.baseline())
            before[collection][0]['unexpected'] = 'changed'
            after = state(revise.TARGET)
            with self.subTest(collection=collection), self.assertRaises(revise.agenda.SafetyError):
                revise.verify_delta(before, after)
        for field, value in [('published', False), ('start_at', revise.agenda.instant('15:06')),
                             ('session', 'z' * 15), ('track', 'z' * 15)]:
            before = state(revise.baseline())
            next(r for r in before['agenda_slots'] if r['id'] == revise.SLOT_ID)[field] = value
            with self.subTest(field=field), self.assertRaises(revise.agenda.SafetyError):
                revise.plan(before)


class RealHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wts-revise4-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture.provision(self.root / 'pb', stage='empty')
        process, self.url = fixture.start(self.root / 'pb', fixture.free_port())
        self.addCleanup(fixture.stop, process)
        self.pb = fixture.client(self.url)
        revise.agenda.run_operation(self.pb, revise.baseline(), 'stage', self.root / 'backups')
        revise.agenda.run_operation(self.pb, revise.baseline(), 'publish', self.root / 'backups')

    def test_applies_real_hook_without_batch_and_noop_rerun(self):
        before = self.pb.snapshot()
        self.assertEqual(revise.run(self.pb)['requests'], 1)
        self.assertEqual(before, self.pb.snapshot())
        self.assertTrue(revise.run(self.pb, True, self.root / 'backups')['verified'])
        after = self.pb.snapshot()
        revise.verify_delta(before, after)
        self.assertEqual(revise.run(self.pb, True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_overlap_rejection_rolls_back_all_fields(self):
        before = self.pb.snapshot()
        request = revise.plan(before)[0]
        payload = {**request['payload'], 'start_at': revise.agenda.instant('14:45')}
        with self.assertRaises(urllib.error.HTTPError) as caught:
            fixture.local_request(self.url, 'PATCH', request['path'], payload, self.pb.token)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('overlap', caught.exception.read().decode().lower())
        self.assertEqual(before, self.pb.snapshot())

    def test_backup_and_concurrent_drift_refuse_before_write(self):
        before = self.pb.snapshot()
        with self.assertRaises(revise.agenda.SafetyError): revise.run(self.pb, True)
        drifted = copy.deepcopy(before)
        drifted['speakers'][0]['updated'] = 'concurrent change'
        with patch.object(self.pb, 'snapshot', side_effect=[before, drifted]):
            with self.assertRaisesRegex(revise.agenda.SafetyError, 'State changed'):
                revise.run(self.pb, True, self.root / 'backups')
        self.assertEqual(before, self.pb.snapshot())

    def test_lost_committed_response_is_noop_on_explicit_rerun(self):
        raw = self.pb.raw
        def lost_response(method, path, payload=None):
            result = raw(method, path, payload)
            if method == 'PATCH':
                raise revise.agenda.SafetyError('Injected lost committed response')
            return result
        before = self.pb.snapshot()
        with patch.object(self.pb, 'raw', side_effect=lost_response):
            with self.assertRaisesRegex(revise.agenda.SafetyError, 'lost committed response'):
                revise.run(self.pb, True, self.root / 'backups')
        after = self.pb.snapshot()
        revise.verify_delta(before, after)
        self.assertEqual(revise.run(self.pb, True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())


if __name__ == '__main__':
    unittest.main()
