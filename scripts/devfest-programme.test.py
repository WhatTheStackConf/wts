"""Offline planning/resumption tests; no credentials or production requests."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('devfest', Path(__file__).with_name('devfest-programme.py'))
assert spec is not None and spec.loader is not None
devfest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(devfest)


class FakePocketBase:
    def __init__(self):
        self.state = {key: [] for key in devfest.agenda.COLLECTIONS}
        self.state['appearance_events'] = [{'id': devfest.DATA['event_id'], 'name': 'DevFest', 'published': True, 'destination_url': ''}]
        self.state['sessions'] = [{'id': 'unrelated000001', 'slug': 'other', 'title': 'Other', 'published': False}]
        self.state['speakers'] = [
            {'id': devfest.record_id(slug), 'slug': slug, 'published': True, 'appearance_events': [devfest.DATA['event_id']]}
            for slug in ['josefine-schaefer', 'roushanak-rahmat', 'akshata-mohanty']
        ]

    def snapshot(self):
        return copy.deepcopy(self.state)

    def raw(self, method, path, payload):
        collection = path.split('/')[3]
        if method == 'POST':
            self.state[collection].append(copy.deepcopy(payload))
        else:
            rid = path.split('/')[-1]
            next(row for row in self.state[collection] if row['id'] == rid).update(payload)

    def request(self, method, collection, rid):
        assert method == 'GET'
        return copy.deepcopy(next(row for row in self.state[collection] if row['id'] == rid))


class DevFestTests(unittest.TestCase):
    def test_dry_run_uses_confirmed_assignments_without_timed_slots(self):
        pb = FakePocketBase()
        before = pb.snapshot()
        self.assertEqual(devfest.run(pb)['pending'], 5)
        self.assertEqual(pb.snapshot(), before)
        operations = devfest.plan(before)
        self.assertNotIn('agenda_slots', [op[1] for op in operations])
        sessions = [op[3] for op in operations if op[1] == 'sessions']
        self.assertEqual(len(sessions), 2)
        self.assertEqual([row['speakers'] for row in sessions], [
            [devfest.record_id('josefine-schaefer')], [devfest.record_id('roushanak-rahmat')],
        ])
        self.assertTrue(all(len(row['id']) == 15 for row in sessions))

    def test_apply_preserves_unrelated_data_and_rerun_is_noop(self):
        pb = FakePocketBase()
        unrelated = pb.snapshot()['sessions'][0]
        with tempfile.TemporaryDirectory() as root:
            result = devfest.run(pb, True, root)
            self.assertTrue(result['verified'])
            self.assertEqual(result['writes'], 5)
            self.assertTrue(Path(result['backup']).exists())
        after = pb.snapshot()
        self.assertIn(unrelated, after['sessions'])
        self.assertEqual(devfest.run(pb, True)['writes'], 0)
        self.assertEqual(pb.snapshot(), after)

    def test_links_unassigned_sessions_without_changing_content_or_other_speakers(self):
        pb = FakePocketBase()
        with tempfile.TemporaryDirectory() as root:
            devfest.run(pb, True, root)
            for row in pb.state['sessions']:
                if row['id'].startswith('df26'):
                    row['speakers'] = []
            before = pb.snapshot()
            operations = devfest.plan(before)
            self.assertEqual(len(operations), 2)
            self.assertTrue(all(method == 'PATCH' and collection == 'sessions' and set(payload) == {'speakers'}
                                for method, collection, _, payload in operations))
            self.assertEqual(devfest.run(pb, True, root)['writes'], 2)
        after = pb.snapshot()
        self.assertEqual(after['speakers'], before['speakers'])
        for previous, current in zip(before['sessions'], after['sessions']):
            self.assertEqual({k:v for k,v in previous.items() if k != 'speakers'},
                             {k:v for k,v in current.items() if k != 'speakers'})
        self.assertEqual(devfest.run(pb, True)['writes'], 0)

    def test_rejects_hidden_unrelated_missing_or_duplicate_speakers(self):
        for kind in ['hidden', 'unrelated', 'missing', 'duplicate']:
            with self.subTest(kind=kind):
                pb = FakePocketBase()
                if kind == 'hidden': pb.state['speakers'][0]['published'] = False
                if kind == 'unrelated': pb.state['speakers'][0]['appearance_events'] = []
                if kind == 'missing': pb.state['speakers'].pop(0)
                if kind == 'duplicate': pb.state['speakers'].append(copy.deepcopy(pb.state['speakers'][0]))
                with self.assertRaises(devfest.agenda.SafetyError): devfest.plan(pb.snapshot())

    def test_refuses_to_replace_existing_assignment(self):
        pb = FakePocketBase()
        with tempfile.TemporaryDirectory() as root:
            devfest.run(pb, True, root)
        pb.state['sessions'][1]['speakers'] = [devfest.record_id('akshata-mohanty')]
        with self.assertRaises(devfest.agenda.SafetyError): devfest.plan(pb.snapshot())

    def test_partial_apply_resumes(self):
        pb = FakePocketBase()
        method, collection, _, row = devfest.plan(pb.snapshot())[0]
        pb.raw(method, f'/api/collections/{collection}/records', row)
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(devfest.run(pb, True, root)['writes'], 4)
        self.assertEqual(devfest.plan(pb.snapshot()), [])

    def test_rejects_duplicate_date_and_session_title(self):
        for collection, row in [
            ('conference_days', {'id': 'otherday0000001', 'key': 'other', 'local_date': devfest.DATA['date']}),
            ('sessions', {'id': 'othersession001', 'slug': 'other-slug', 'title': devfest.DATA['sessions'][0]['title']}),
        ]:
            with self.subTest(collection=collection):
                pb = FakePocketBase()
                pb.state[collection].append(row)
                with self.assertRaises(devfest.agenda.SafetyError):
                    devfest.plan(pb.snapshot())

    def test_rejects_hidden_event_and_destination_drift(self):
        for change in [{'published': False}, {'destination_url': 'https://other.test'}]:
            pb = FakePocketBase()
            pb.state['appearance_events'][0].update(change)
            with self.assertRaises(devfest.agenda.SafetyError):
                devfest.plan(pb.snapshot())


if __name__ == '__main__':
    unittest.main()
