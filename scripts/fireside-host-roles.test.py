import copy
import importlib.util
from pathlib import Path
from typing import Any
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


roles = load('roles', 'fireside-host-roles.py')
setup = load('transfertests', 'main-day-transfer-gaps.test.py')


class RealRoles(unittest.TestCase):
    pb: Any
    root: Path

    def setUp(self):
        setup.RealTransferGaps.setUp(self)
        self.pb = roles.agenda.PocketBase(self.pb.url, self.pb.token)
        roles.transfer.run(self.pb, True, self.root / 'audit')
        self.before = self.pb.snapshot()

    def run_roles(self):
        return roles.run(self.pb, True, self.root / 'audit')

    def test_exact_two_flags_and_noop(self):
        self.assertEqual(roles.run(self.pb)['requests'], 2)
        self.assertEqual(self.before, self.pb.snapshot())
        self.assertEqual(self.run_roles()['writes'], 2)
        after = self.pb.snapshot()
        roles.verify_delta(self.before, after)
        self.assertTrue(roles.run(self.pb, verify=True)['complete'])
        self.assertEqual(self.run_roles()['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())
        self.assertTrue(all(not r['is_mc'] for r in after['speakers'] if r['id'] in roles.HOSTS))
        self.assertEqual(self.before['sessions'], after['sessions'])
        self.assertEqual(self.before['agenda_slots'], after['agenda_slots'])

    def test_atomic_rollback_and_committed_response_replay(self):
        raw = self.pb.raw
        def fail(method, path, payload=None):
            if path == '/api/batch':
                assert payload is not None
                payload = copy.deepcopy(payload)
                payload['requests'][-1]['body']['origin'] = 'invalid'
            return raw(method, path, payload)
        with patch.object(self.pb, 'raw', side_effect=fail):
            with self.assertRaises(roles.agenda.SafetyError): self.run_roles()
        self.assertEqual(self.before, self.pb.snapshot())
        def lose(method, path, payload=None):
            result = raw(method, path, payload)
            if path == '/api/batch': raise roles.agenda.SafetyError('Lost committed response')
            return result
        with patch.object(self.pb, 'raw', side_effect=lose):
            with self.assertRaisesRegex(roles.agenda.SafetyError, 'Lost committed'): self.run_roles()
        roles.verify_delta(self.before, self.pb.snapshot())
        self.assertEqual(self.run_roles()['writes'], 0)

    def test_backup_partial_and_unrelated_drift_guards(self):
        with self.assertRaises(roles.agenda.SafetyError): roles.run(self.pb, True)
        altered = copy.deepcopy(self.before)
        next(r for r in altered['speakers'] if r['id'] in roles.HOSTS)['is_mc'] = False
        with self.assertRaisesRegex(roles.agenda.SafetyError, 'Partial'): roles.plan(self.pb, altered)
        self.run_roles()
        after = self.pb.snapshot()
        for c in roles.agenda.COLLECTIONS:
            changed = copy.deepcopy(after)
            changed[c][0]['unrelated'] = True
            with self.subTest(collection=c), self.assertRaises(roles.agenda.SafetyError): roles.verify_delta(self.before, changed)


if __name__ == '__main__':
    unittest.main()
