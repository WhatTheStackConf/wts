"""Stage 5 publication tests against isolated production-pinned PocketBase hooks."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

stage5 = load('stage5', 'stage5-agenda.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')

class RealHooks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wts-stage5-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        fixture.provision(self.root / 'pb', stage='published')
        process, url = fixture.start(self.root / 'pb', fixture.free_port())
        self.addCleanup(fixture.stop, process)
        self.pb = fixture.client(url)
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': True, 'maxRequests': 50, 'timeout': 3, 'maxBodySize': 0}})
        existing = {s['id'] for s in self.pb.snapshot()['speakers']}
        for binding in stage5.TARGET['speaker_bindings']:
            if binding['id'] in existing:
                self.pb.raw('PATCH', '/api/collections/speakers/records/' + binding['id'], binding)
            else:
                self.pb.raw('POST', '/api/collections/speakers/records', {**binding, 'origin': 'invite'})

    def test_success_exact_delta_and_noop(self):
        before = self.pb.snapshot()
        self.assertEqual(stage5.run(self.pb)['requests'], 22)
        self.assertEqual(before, self.pb.snapshot())
        self.assertTrue(stage5.run(self.pb, True, self.root / 'audit')['verified'])
        after = self.pb.snapshot()
        stage5.verify_delta(before, after)
        self.assertEqual(stage5.run(self.pb, True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_late_failure_rolls_back_membership_sessions_and_deletions(self):
        before = self.pb.snapshot()
        requests = stage5.plan(before)
        requests[-1]['body'] = {**requests[-1]['body'], 'programme': 'zzzzzzzzzzzzzzz'}
        with self.assertRaises(fixture.agenda.SafetyError):
            self.pb.raw('POST', '/api/batch', {'requests': requests})
        self.assertEqual(before, self.pb.snapshot())

    def test_missing_membership_rejected_by_real_hooks(self):
        before = self.pb.snapshot()
        requests = [r for r in stage5.plan(before) if '/speakers/' not in r['url']]
        with self.assertRaises(fixture.agenda.SafetyError):
            self.pb.raw('POST', '/api/batch', {'requests': requests})
        self.assertEqual(before, self.pb.snapshot())

    def test_committed_response_loss_is_noop_on_resume(self):
        before = self.pb.snapshot()
        raw = self.pb.raw
        def lose_response(method, path, payload=None):
            result = raw(method, path, payload)
            if path == '/api/batch' and method == 'POST':
                raise stage5.agenda.SafetyError('Simulated committed response loss')
            return result
        with patch.object(self.pb, 'raw', side_effect=lose_response):
            with self.assertRaises(stage5.agenda.SafetyError):
                stage5.run(self.pb, True, self.root / 'audit')
        stage5.verify_delta(before, self.pb.snapshot())
        self.assertEqual(stage5.run(self.pb, True)['writes'], 0)

    def prepare_revision_one(self):
        stage5.run(self.pb, True, self.root / 'audit')
        self.pb.raw('PATCH', '/api/collections/sessions/records/' + stage5.OPEN_SOURCE,
                    {'speakers': stage5.ORIGINAL_OPEN_SOURCE_GUESTS})
        return self.pb.snapshot()

    def test_amendment_is_one_patch_and_preserves_every_other_record(self):
        before = self.prepare_revision_one()
        requests = stage5.plan(before)
        self.assertEqual(requests, [{'method': 'PATCH',
                         'url': '/api/collections/sessions/records/' + stage5.OPEN_SOURCE,
                         'body': {'speakers': stage5.ORIGINAL_OPEN_SOURCE_GUESTS + [stage5.SANTOSH]}}])
        result = stage5.run(self.pb, True, self.root / 'audit')
        self.assertEqual(result['writes'], 1)
        after = self.pb.snapshot()
        stage5.verify_delta(before, after)
        for collection in stage5.agenda.COLLECTIONS:
            self.assertEqual([r for r in before[collection] if r['id'] != stage5.OPEN_SOURCE],
                             [r for r in after[collection] if r['id'] != stage5.OPEN_SOURCE])
        self.assertEqual(stage5.run(self.pb, True)['writes'], 0)

    def test_amendment_lost_response_and_drift_guards(self):
        before = self.prepare_revision_one()
        changed = copy.deepcopy(before)
        row = next(r for r in changed['sessions'] if r['id'] == stage5.OPEN_SOURCE)
        row['title'] = 'Unapproved title'
        with self.assertRaises(stage5.agenda.SafetyError):
            stage5.plan(changed)
        raw = self.pb.raw
        def lose_response(method, path, payload=None):
            result = raw(method, path, payload)
            if method == 'PATCH' and path.endswith(stage5.OPEN_SOURCE):
                raise stage5.agenda.SafetyError('Simulated committed amendment response loss')
            return result
        with patch.object(self.pb, 'raw', side_effect=lose_response):
            with self.assertRaises(stage5.agenda.SafetyError):
                stage5.run(self.pb, True, self.root / 'audit')
        stage5.verify_delta(before, self.pb.snapshot())
        self.assertEqual(stage5.run(self.pb, True)['writes'], 0)

    def test_drift_and_missing_backup_refuse_without_writes(self):
        before = self.pb.snapshot()
        with self.assertRaises(stage5.agenda.SafetyError):
            stage5.run(self.pb, True)
        changed = copy.deepcopy(before)
        changed['agenda_slots'][0]['end_at'] = stage5.agenda.instant('16:15')
        with self.assertRaises(stage5.agenda.SafetyError):
            stage5.plan(changed)
        self.assertEqual(before, self.pb.snapshot())

if __name__ == '__main__':
    unittest.main()
