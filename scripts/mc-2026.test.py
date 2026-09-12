"""Real PocketBase MC import safety; fixtures never load production credentials."""
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


mc = load('mc', 'mc-2026.py')
fixture = load('fixture', 'main-day-agenda.fixture.py')


class RealImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wts-mc-import-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixture.provision(self.root / 'pb', stage='empty')
        process, url = fixture.start(self.root / 'pb', fixture.free_port())
        self.addCleanup(fixture.stop, process)
        self.pb = mc.agenda.PocketBase(url, fixture.client(url).token)
        self.url = url
        # Equivalent additive schema for importer testing. The app migration has
        # separate tests; when already present, leave it untouched.
        schema = self.pb.raw('GET', '/api/collections/speakers')
        if not any(f['name'] == 'is_mc' for f in schema['fields']):
            self.pb.raw('PATCH', '/api/collections/speakers', {'fields': schema['fields'] + [
                {'name': 'is_mc', 'type': 'bool', 'required': False}]})
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': True, 'maxRequests': 50, 'timeout': 3, 'maxBodySize': 0}})
        self.before = self.pb.snapshot()

    def stage(self):
        return mc.run(self.pb, 'stage', True, self.root / 'backups')

    def test_four_profiles_photos_publication_and_noop(self):
        self.assertEqual(mc.run(self.pb)['missing'], 4)
        self.assertEqual(self.pb.snapshot(), self.before)
        self.assertEqual(self.stage()['writes'], 4)
        staged = self.pb.snapshot()
        mc.verify_delta(self.before, staged, 'stage')
        self.assertEqual(mc.run(self.pb, 'stage', True)['writes'], 0)
        self.assertEqual(mc.run(self.pb, 'publish', True, self.root / 'backups')['published'], 4)
        published = self.pb.snapshot()
        mc.verify_delta(staged, published, 'publish')
        self.assertTrue(mc.run(self.pb, 'verify')['verified'])
        self.assertEqual(mc.run(self.pb, 'publish', True)['writes'], 0)
        self.assertEqual(self.pb.snapshot(), published)

    def test_interrupted_upload_resumes_without_duplicate_or_reupload(self):
        upload = mc.upload
        def lost_response(client, profile):
            upload(client, profile)
            raise mc.agenda.SafetyError('Injected committed upload response loss')
        with patch.object(mc, 'upload', side_effect=lost_response):
            with self.assertRaisesRegex(mc.agenda.SafetyError, 'response loss'):
                self.stage()
        partial = self.pb.snapshot()
        self.assertEqual(mc.run(self.pb)['missing'], 3)
        self.assertEqual(self.stage()['writes'], 3)
        mc.verify_delta(partial, self.pb.snapshot(), 'stage')
        self.assertEqual(len(self.pb.snapshot()['speakers']), len(self.before['speakers']) + 4)

    def test_identity_collision_and_profile_drift_fail_closed(self):
        profile = copy.deepcopy(mc.MANIFEST['profiles'][0])
        profile['record']['id'] = 'z' * 15
        mc.upload(self.pb, profile)
        before = self.pb.snapshot()
        with self.assertRaisesRegex(mc.agenda.SafetyError, 'identity collision'):
            self.stage()
        self.assertEqual(before, self.pb.snapshot())

    def test_publication_late_failure_rolls_back_and_lost_response_replays_noop(self):
        self.stage()
        staged = self.pb.snapshot()
        raw = self.pb.raw
        def late_failure(method, path, payload=None):
            if method == 'POST' and path == '/api/batch':
                assert payload is not None
                payload = copy.deepcopy(payload)
                payload['requests'].append({'method': 'PATCH', 'url': '/api/collections/speakers/records/' + mc.MANIFEST['profiles'][0]['record']['id'],
                                            'body': {'origin': 'invalid-origin'}})
            return raw(method, path, payload)
        with patch.object(self.pb, 'raw', side_effect=late_failure):
            with self.assertRaises(mc.agenda.SafetyError):
                mc.run(self.pb, 'publish', True, self.root / 'backups')
        self.assertEqual(staged, self.pb.snapshot())
        def lost_response(method, path, payload=None):
            result = raw(method, path, payload)
            if method == 'POST' and path == '/api/batch':
                raise mc.agenda.SafetyError('Injected lost committed batch response')
            return result
        with patch.object(self.pb, 'raw', side_effect=lost_response):
            with self.assertRaisesRegex(mc.agenda.SafetyError, 'lost committed'):
                mc.run(self.pb, 'publish', True, self.root / 'backups')
        after = self.pb.snapshot()
        mc.verify_delta(staged, after, 'publish')
        self.assertEqual(mc.run(self.pb, 'publish', True)['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_backup_publication_and_unrelated_change_guards(self):
        with self.assertRaises(mc.agenda.SafetyError): mc.run(self.pb, 'stage', True)
        with self.assertRaises(mc.agenda.SafetyError): mc.run(self.pb, 'publish', True, self.root / 'backups')
        self.assertEqual(self.before, self.pb.snapshot())
        self.stage()
        staged = self.pb.snapshot()
        for collection in mc.agenda.COLLECTIONS:
            changed = copy.deepcopy(staged)
            if not changed[collection]: continue
            changed[collection][0]['unexpected'] = 'change'
            with self.subTest(collection=collection), self.assertRaises(mc.agenda.SafetyError):
                mc.verify_delta(self.before, changed, 'stage')


if __name__ == '__main__':
    unittest.main()
