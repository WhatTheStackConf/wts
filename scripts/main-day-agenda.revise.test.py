"""Revision safety and real-hook batch atomicity; no production credentials."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


revise = load('revise', 'main-day-agenda.revise.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')


def state(revision=1):
    manifest = revise.baseline() if revision == 1 else revise.TARGET
    value = copy.deepcopy(manifest['records'])
    value['conference_days'][0]['published'] = True
    value['appearance_events'] = [{'id': revise.agenda.EVENT, 'published': True}]
    value['speakers'] = [copy.deepcopy(b['speaker']) for b in manifest['bindings']]
    value['sessions'] = [copy.deepcopy(b['session']) for b in manifest['bindings']]
    return value


class PlanTests(unittest.TestCase):
    def test_exact_changes_keep_identities_and_publication(self):
        before, after = state(), state(2)
        revise.verify_delta(before, after)
        requests = revise.plan(before)
        self.assertEqual(len(requests), 10)
        self.assertEqual(revise.plan(after), [])
        for request in requests:
            self.assertNotIn('published', request.get('body', {}))
            self.assertNotIn('session', request.get('body', {}))
        ordered = sorted(after['agenda_tracks'], key=lambda r: r['display_order'])
        self.assertEqual([t['key'] for t in ordered], ['stage-2', 'stage-3', 'stage-1', 'stage-4', 'stage-5'])
        slots = sorted([r for r in after['agenda_slots'] if r['track'] == ordered[0]['id']], key=lambda r:r['start_at'])
        names = {b['session']['id']: b['speaker']['slug'] for b in revise.TARGET['bindings']}
        self.assertEqual([names[s['session']] for s in slots[:4]], ['alexander-lichter', 'alem-tuzlak', 'sam-vloeberghs', 'kiril-zafirov'])

    def test_rejects_partial_drift_and_holding_collision(self):
        for kind in ('timing', 'track', 'holding', 'unpublished'):
            with self.subTest(kind=kind):
                value = state()
                if kind == 'timing': value['agenda_slots'][0]['start_at'] = revise.agenda.instant('10:11')
                if kind == 'track': value['agenda_tracks'][0]['name'] = 'Unexpected'
                if kind == 'holding': value['agenda_tracks'].append({**value['agenda_tracks'][0], 'id': revise.HOLDING, 'key': 'holding'})
                if kind == 'unpublished': value['agenda_slots'][0]['published'] = False
                with self.assertRaises(revise.agenda.SafetyError): revise.plan(value)


class RealBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wts-revise-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture.provision(self.root / 'pb', stage='empty')
        process, self.url = fixture.start(self.root / 'pb', fixture.free_port())
        self.addCleanup(fixture.stop, process)
        self.pb = fixture.client(self.url)
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': True, 'maxRequests': 50, 'timeout': 3, 'maxBodySize': 0}})
        revise.agenda.run_operation(self.pb, revise.baseline(), 'stage', self.root / 'backups')
        revise.agenda.run_operation(self.pb, revise.baseline(), 'publish', self.root / 'backups')

    def test_applies_real_hooks_and_noop_rerun(self):
        before = self.pb.snapshot()
        self.assertEqual(revise.run(self.pb)['requests'], 10)
        self.assertEqual(before, self.pb.snapshot())
        result = revise.run(self.pb, True, self.root / 'backups')
        self.assertTrue(result['verified'])
        after = self.pb.snapshot()
        revise.verify_delta(before, after)
        self.assertFalse(any(r['id'] == revise.HOLDING for r in after['agenda_tracks']))
        self.assertEqual(revise.run(self.pb, True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_late_batch_failure_rolls_every_change_back(self):
        before = self.pb.snapshot()
        requests = revise.plan(before)
        requests.append({'method': 'PATCH', 'url': '/api/collections/agenda_tracks/records/' + before['agenda_tracks'][0]['id'],
                         'body': {'programme': 'zzzzzzzzzzzzzzz'}})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            fixture.local_request(self.url, 'POST', '/api/batch', {'requests': requests}, self.pb.token)
        self.assertEqual(caught.exception.code, 400)
        error = caught.exception.read().decode()
        self.assertIn('programme', error.lower())
        self.assertEqual(before, self.pb.snapshot())
        # The same preflight can still be applied after the failed transaction.
        self.assertTrue(revise.run(self.pb, True, self.root / 'backups')['verified'])

    def test_without_holding_step_real_overlap_guard_rejects_batch(self):
        before = self.pb.snapshot()
        requests = revise.plan(before)
        # Kiril cannot move to Alex's occupied window until Alex is held elsewhere.
        sabotaged = requests[2:]
        with self.assertRaises(urllib.error.HTTPError) as caught:
            fixture.local_request(self.url, 'POST', '/api/batch', {'requests': sabotaged}, self.pb.token)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('overlap', caught.exception.read().decode().lower())
        self.assertEqual(before, self.pb.snapshot())


if __name__ == '__main__':
    unittest.main()
