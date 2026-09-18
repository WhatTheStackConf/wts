"""DJ import: real PocketBase, original photo, isolated credentials."""
import copy
import importlib.util
from pathlib import Path
from typing import Any
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load('dj', 'dj-2026.py')
setup = load('mctests', 'mc-2026.test.py')


class DJImport(unittest.TestCase):
    pb: Any
    root: Path

    def setUp(self):
        setup.RealImportTests.setUp(self)
        self.pb = m.agenda.PocketBase(self.pb.url, self.pb.token)
        self.before = self.pb.snapshot()

    def run_mode(self, mode):
        return m.run(self.pb, mode, True, self.root / 'audit')

    def test_exact_profile_photo_and_idempotent_publication(self):
        self.assertTrue(m.run(self.pb)['missing'])
        self.assertEqual(self.before, self.pb.snapshot())
        self.assertEqual(self.run_mode('stage')['writes'], 1)
        staged = self.pb.snapshot()
        m.verify_delta(self.before, staged, 'stage')
        self.assertEqual(self.run_mode('stage')['writes'], 0)
        self.assertEqual(self.run_mode('publish')['writes'], 1)
        after = self.pb.snapshot()
        m.verify_delta(staged, after, 'publish')
        self.assertTrue(m.run(self.pb, 'verify')['published'])
        self.assertEqual(self.run_mode('publish')['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())
        row = m.inspect(self.pb, after)
        self.assertEqual(row['display_name'], 'DinaShantina')
        self.assertEqual(row['social_handles'], ['https://www.instagram.com/dinashantina/', 'https://www.linkedin.com/in/dina-damjanovikj/'])
        self.assertFalse(row['is_mc'])
        self.assertTrue(row['is_dj'])
        self.assertEqual(after['sessions'], self.before['sessions'])

    def test_committed_upload_and_publish_response_loss_recover_noop(self):
        upload = m.upload
        def lost_upload(client, profile):
            upload(client, profile)
            raise m.agenda.SafetyError('lost upload')
        with patch.object(m, 'upload', side_effect=lost_upload):
            with self.assertRaisesRegex(m.agenda.SafetyError, 'lost upload'): self.run_mode('stage')
        self.assertEqual(self.run_mode('stage')['writes'], 0)
        staged = self.pb.snapshot()
        raw = self.pb.raw
        def lost_publish(method, path, payload=None):
            result = raw(method, path, payload)
            if method == 'PATCH': raise m.agenda.SafetyError('lost publication')
            return result
        with patch.object(self.pb, 'raw', side_effect=lost_publish):
            with self.assertRaisesRegex(m.agenda.SafetyError, 'lost publication'): self.run_mode('publish')
        m.verify_delta(staged, self.pb.snapshot(), 'publish')
        self.assertEqual(self.run_mode('publish')['writes'], 0)

    def test_backup_collision_and_unrelated_change_guards(self):
        with self.assertRaises(m.agenda.SafetyError): m.run(self.pb, 'stage', True)
        with self.assertRaises(m.agenda.SafetyError): self.run_mode('publish')
        self.assertEqual(self.before, self.pb.snapshot())
        profile = copy.deepcopy(m.PROFILE)
        profile['record']['id'] = 'z' * 15
        m.upload(self.pb, profile)
        before = self.pb.snapshot()
        with self.assertRaisesRegex(m.agenda.SafetyError, 'collision'): self.run_mode('stage')
        self.assertEqual(before, self.pb.snapshot())
    def test_unrelated_field_changes_rejected_after_valid_staging(self):
        self.run_mode('stage')
        after = self.pb.snapshot()
        m.verify_delta(self.before, after, 'stage')
        for collection in m.agenda.COLLECTIONS:
            if not self.before[collection]: continue
            altered = copy.deepcopy(after)
            altered[collection][0]['unexpected'] = 'change'
            with self.subTest(collection=collection), self.assertRaises(m.agenda.SafetyError):
                m.verify_delta(self.before, altered, 'stage')


if __name__ == '__main__':
    unittest.main()
