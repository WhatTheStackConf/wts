"""Host import safety against real pinned PocketBase and programme hooks."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hosts = load('hosts', 'hosts-2026.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')


class RealHosts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wts-hosts-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        fixture.provision(self.root / 'pb', stage='published')
        process, url = fixture.start(self.root / 'pb', fixture.free_port())
        self.addCleanup(fixture.stop, process)
        self.pb = hosts.agenda.PocketBase(url, fixture.client(url).token)
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': True, 'maxRequests': 50, 'timeout': 3, 'maxBodySize': 0}})
        existing = {s['id'] for s in self.pb.snapshot()['speakers']}
        for binding in hosts.stage5.TARGET['speaker_bindings']:
            if binding['id'] in existing:
                self.pb.raw('PATCH', '/api/collections/speakers/records/' + binding['id'], binding)
            else:
                self.pb.raw('POST', '/api/collections/speakers/records', {**binding, 'origin': 'invite'})
        hosts.stage5.run(self.pb, True, self.root / 'audit')
        self.before = self.pb.snapshot()

    def run_mode(self, mode):
        return hosts.run(self.pb, mode, True, self.root / 'audit')

    def test_profiles_assignments_exact_delta_and_noop(self):
        self.assertEqual(hosts.run(self.pb)['missing'], 2)
        self.assertEqual(self.before, self.pb.snapshot())
        self.assertEqual(self.run_mode('stage')['writes'], 2)
        staged = self.pb.snapshot()
        hosts.verify_delta(self.before, staged, 'stage')
        self.assertEqual(self.run_mode('stage')['writes'], 0)
        self.assertEqual(self.run_mode('publish')['writes'], 10)
        final = self.pb.snapshot()
        hosts.verify_delta(staged, final, 'publish')
        self.assertTrue(hosts.run(self.pb, 'verify')['complete'])
        self.assertEqual(self.run_mode('publish')['writes'], 0)
        self.assertEqual(final, self.pb.snapshot())
        expected = {
            'fireside-who-owes-open-source-what': 'host26darko0001',
            'fireside-the-way-into-the-industry': 'host26darko0001',
            'fireside-building-our-own-products': 'host26darko0001',
            'fireside-being-a-good-developer': 'host26miodrag01',
            'fireside-software-development-complexity': 'host26miodrag01',
            'fireside-choosing-frameworks-with-ai': 'host26miodrag01',
        }
        for row in final['sessions']:
            if row['slug'] in expected:
                self.assertEqual(row['speakers'][-1], expected[row['slug']])
        shared = [r for r in final['agenda_slots'] if r['kind'] in ('opening', 'closing')]
        self.assertEqual(len(shared), 2)
        self.assertTrue(all(r['summary'].endswith('Hosted by Darko Bozhinovski.') for r in shared))

    def test_committed_upload_loss_resumes(self):
        upload = hosts.upload
        def lose(client, profile):
            upload(client, profile)
            raise hosts.agenda.SafetyError('lost upload response')
        with patch.object(hosts, 'upload', side_effect=lose):
            with self.assertRaisesRegex(hosts.agenda.SafetyError, 'lost upload'):
                self.run_mode('stage')
        self.assertEqual(hosts.run(self.pb)['missing'], 1)
        self.assertEqual(self.run_mode('stage')['writes'], 1)
        hosts.verify_delta(self.before, self.pb.snapshot(), 'stage')

    def test_late_batch_failure_rolls_back_then_lost_response_is_noop(self):
        self.run_mode('stage')
        before = self.pb.snapshot()
        raw = self.pb.raw
        def fail(method, path, payload=None):
            if path == '/api/batch':
                assert payload is not None
                payload = copy.deepcopy(payload)
                payload['requests'][-1]['body']['kind'] = 'invalid-kind'
            return raw(method, path, payload)
        with patch.object(self.pb, 'raw', side_effect=fail):
            with self.assertRaises(hosts.agenda.SafetyError): self.run_mode('publish')
        self.assertEqual(before, self.pb.snapshot())
        def lose(method, path, payload=None):
            result = raw(method, path, payload)
            if path == '/api/batch': raise hosts.agenda.SafetyError('lost batch response')
            return result
        with patch.object(self.pb, 'raw', side_effect=lose):
            with self.assertRaisesRegex(hosts.agenda.SafetyError, 'lost batch'):
                self.run_mode('publish')
        hosts.verify_delta(before, self.pb.snapshot(), 'publish')
        self.assertEqual(self.run_mode('publish')['writes'], 0)

    def test_collision_drift_and_backup_guards(self):
        with self.assertRaises(hosts.agenda.SafetyError): hosts.run(self.pb, 'stage', True)
        with self.assertRaises(hosts.agenda.SafetyError): self.run_mode('publish')
        self.assertEqual(self.before, self.pb.snapshot())
        profile = copy.deepcopy(hosts.MANIFEST['profiles'][0])
        profile['record']['id'] = 'z' * 15
        hosts.upload(self.pb, profile)
        before = self.pb.snapshot()
        with self.assertRaisesRegex(hosts.agenda.SafetyError, 'identity collision'): self.run_mode('stage')
        self.assertEqual(before, self.pb.snapshot())

    def test_guest_and_unrelated_drift_rejected(self):
        altered = copy.deepcopy(self.before)
        row = next(r for r in altered['sessions'] if r['id'] in hosts.MANIFEST['hosts'])
        row['speakers'] = row['speakers'][1:]
        with self.assertRaisesRegex(hosts.agenda.SafetyError, 'credit drift'): hosts.inspect(self.pb, altered)
        self.run_mode('stage')
        staged = self.pb.snapshot()
        for collection in hosts.agenda.COLLECTIONS:
            changed = copy.deepcopy(staged)
            changed[collection][0]['unexpected'] = 'change'
            with self.subTest(collection=collection), self.assertRaises(hosts.agenda.SafetyError):
                hosts.verify_delta(self.before, changed, 'stage')


if __name__ == '__main__':
    unittest.main()
