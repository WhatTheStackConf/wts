"""Revision 3 safety and real-hook atomicity; no production credentials."""
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


revise = load('revise3', 'main-day-agenda.revise3.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')


def state(revision=2):
    manifest = revise.baseline() if revision == 2 else revise.TARGET
    value = copy.deepcopy(manifest['records'])
    value['conference_days'][0]['published'] = True
    value['appearance_events'] = [{'id': revise.agenda.EVENT, 'published': True}]
    value['speakers'] = [copy.deepcopy(b['speaker']) for b in manifest['bindings']]
    value['sessions'] = [copy.deepcopy(b['session']) for b in manifest['bindings']]
    return value


def instants(times):
    return [revise.agenda.instant(t) for t in times]


def stage_rows(slots, stages, name):
    return sorted([s for s in slots if stages.get(s['track']) == name], key=lambda s: s['start_at'])


def placeholder_mutations():
    agenda = revise.agenda
    return {
        'timing': lambda value, placeholder: value['agenda_slots'][0].update(start_at=agenda.instant('10:11')),
        'track': lambda value, placeholder: value['agenda_tracks'][0].update(name='Unexpected'),
        'holding': lambda value, placeholder: value['agenda_tracks'].append(
            {**value['agenda_tracks'][0], 'id': revise.HOLDING, 'key': 'holding'}),
        'unpublished': lambda value, placeholder: value['agenda_slots'][0].update(published=False),
        'linked-placeholder': lambda value, placeholder: placeholder.update(session=value['sessions'][0]['id']),
        'missing-placeholder': lambda value, placeholder: value['agenda_slots'].remove(placeholder),
    }


class PlanTests(unittest.TestCase):
    def assert_only_placeholders_unpublished(self, requests, removed):
        for request in requests:
            body = request.get('body', {})
            self.assertNotIn('session', body)
            if 'published' in body:
                self.assertEqual(body, {'published': False})
                self.assertIn(request['url'].split('/')[-1], removed)

    def test_exact_changes_and_only_unlinked_placeholder_deletions(self):
        before, after = state(), state(3)
        revise.verify_delta(before, after)
        requests = revise.plan(before)
        self.assertEqual(len(requests), 16)
        self.assertEqual(revise.plan(after), [])
        removed = {r['id'] for r in revise.removed_slots()}
        deleted = {r['url'].split('/')[-1] for r in requests if r['method'] == 'DELETE'}
        self.assertEqual(deleted, removed | {revise.HOLDING})
        self.assert_only_placeholders_unpublished(requests, removed)
        self.assertEqual(before['sessions'], after['sessions'])
        self.assertEqual(before['speakers'], after['speakers'])
        self.assertEqual(before['agenda_tracks'], after['agenda_tracks'])
        unaffected_tracks = {revise.agenda.stable_id('stage-2'), revise.agenda.stable_id('stage-5'), ''}
        self.assertEqual([r for r in before['agenda_slots'] if r['track'] in unaffected_tracks],
                         [r for r in after['agenda_slots'] if r['track'] in unaffected_tracks])

    def test_independently_pinned_programme_and_early_finishes(self):
        actual = state(3)
        sessions = {b['session']['id']: b['speaker']['slug'] for b in revise.TARGET['bindings']}
        stages = {t['id']: t['name'] for t in actual['agenda_tracks']}
        expected = {
            'Stage 1': ['alexander-lichter', 'alem-tuzlak', 'sam-vloeberghs', 'kiril-zafirov', 'konrad-reczko', 'iwo-plaza', 'wekoslav-stefanovski'],
            'Stage 2': ['gerald-versluis', 'santosh-yadav', 'ramona-schwering', 'andrej-acevski', 'bozidar-spirovski', 'riste-oreshkovski', 'miroslav-janeski'],
            'Stage 3': ['igor-trajkovski', 'elena-kolevska', 'nino-risteski', 'bojan-jakimovski', 'dushko-klincharov', 'dragan-shahpaski'],
            'Stage 4': ['goran-david', 'serena-sensini', 'faris-aziz', 'stefan-andonov', 'bogdan-ilie', 'domagoj-maric', 'andjelina-maksimovic'],
        }
        starts = ['10:10', '10:55', '11:50', '12:35', '13:50', '14:45', '15:30']
        ends = ['10:45', '11:30', '12:25', '13:10', '14:25', '15:20', '16:05']
        early_finishes = {'Stage 3': '15:05', 'Stage 4': '15:50'}
        for stage, slugs in expected.items():
            rows = stage_rows(actual['agenda_slots'], stages, stage)
            last = len(slugs) - 1
            self.assertEqual([sessions[s['session']] for s in rows], slugs)
            self.assertEqual([s['start_at'] for s in rows], instants(starts[:len(slugs)]))
            expected_ends = ends[:last] + [early_finishes.get(stage, ends[last])]
            self.assertEqual([s['end_at'] for s in rows], instants(expected_ends))
        self.assertEqual({b['speaker']['slug'] for b in revise.TARGET['bindings'] if b['short_15_plus_5']},
                         {'dragan-shahpaski', 'andjelina-maksimovic'})

    def test_rejects_partial_drift_and_holding_collision(self):
        for kind, mutate in placeholder_mutations().items():
            with self.subTest(kind=kind):
                value = state()
                placeholder = next(r for r in value['agenda_slots'] if r['id'] == revise.removed_slots()[0]['id'])
                mutate(value, placeholder)
                with self.assertRaises(revise.agenda.SafetyError): revise.plan(value)

    def test_delta_rejects_unrelated_or_identity_changes(self):
        for collection in revise.agenda.COLLECTIONS:
            before, after = state(), state(3)
            after[collection][0]['unexpected'] = 'changed'
            with self.subTest(collection=collection), self.assertRaises(revise.agenda.SafetyError):
                revise.verify_delta(before, after)


class RealBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wts-revise3-test-')
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
        self.assertEqual(revise.run(self.pb)['requests'], 16)
        self.assertEqual(before, self.pb.snapshot())
        result = revise.run(self.pb, True, self.root / 'backups')
        self.assertTrue(result['verified'])
        after = self.pb.snapshot()
        revise.verify_delta(before, after)
        self.assertEqual(revise.run(self.pb, True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_late_batch_failure_rolls_deletions_and_moves_back(self):
        before = self.pb.snapshot()
        requests = revise.plan(before)
        requests.append({'method': 'PATCH', 'url': '/api/collections/agenda_tracks/records/' + before['agenda_tracks'][0]['id'],
                         'body': {'programme': 'zzzzzzzzzzzzzzz'}})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            fixture.local_request(self.url, 'POST', '/api/batch', {'requests': requests}, self.pb.token)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('programme', caught.exception.read().decode().lower())
        self.assertEqual(before, self.pb.snapshot())
        self.assertTrue(revise.run(self.pb, True, self.root / 'backups')['verified'])

    def test_without_holding_step_real_overlap_guard_rejects_batch(self):
        before = self.pb.snapshot()
        requests = revise.plan(before)
        sabotaged = [r for r in requests if r.get('body') != {'track': revise.HOLDING}]
        with self.assertRaises(urllib.error.HTTPError) as caught:
            fixture.local_request(self.url, 'POST', '/api/batch', {'requests': sabotaged}, self.pb.token)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn('overlap', caught.exception.read().decode().lower())
        self.assertEqual(before, self.pb.snapshot())

    def test_missing_backup_and_disabled_batch_do_not_write(self):
        before = self.pb.snapshot()
        with self.assertRaises(revise.agenda.SafetyError): revise.run(self.pb, True)
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': False}})
        with self.assertRaises(revise.agenda.SafetyError): revise.run(self.pb, True, self.root / 'backups')
        self.assertEqual(before, self.pb.snapshot())

    def test_lost_committed_response_is_noop_on_explicit_rerun(self):
        raw = self.pb.raw
        def lost_response(method, path, payload=None):
            value = raw(method, path, payload)
            if method == 'POST' and path == '/api/batch':
                raise revise.agenda.SafetyError('Injected lost committed response')
            return value
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
