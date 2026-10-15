"""Atomic main-day transfer gaps on the production-pinned real PocketBase hooks."""
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


revision = load('transfer', 'main-day-transfer-gaps.py')
setup = load('hosttests', 'hosts-2026.test.py')


def clock(row):
    return row['start_at'][11:16], row['end_at'][11:16]


class RealTransferGaps(unittest.TestCase):
    pb: Any
    root: Path

    def setUp(self):
        setup.RealHosts.setUp(self)
        self.pb = revision.agenda.PocketBase(self.pb.url, self.pb.token)
        revision.hosts.run(self.pb, 'stage', True, self.root / 'audit')
        revision.hosts.run(self.pb, 'publish', True, self.root / 'audit')
        self.before = self.pb.snapshot()

    def run_revision(self):
        return revision.run(self.pb, True, self.root / 'audit')

    def test_approved_times_exact_delta_and_noop(self):
        self.assertEqual(revision.run(self.pb)['requests'], 39)
        self.assertEqual(self.before, self.pb.snapshot())
        self.assertEqual(self.run_revision()['writes'], 39)
        after = self.pb.snapshot()
        revision.verify_delta(self.before, after)
        self.assertTrue(revision.run(self.pb, verify=True)['complete'])
        self.assertEqual(self.run_revision()['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())
        slots = [r for r in after['agenda_slots'] if r['programme'] == revision.PROGRAMME]
        self.assertEqual(len(slots), 40)
        self.assert_fireside_times(slots)
        self.assert_regular_talks_shifted(slots)
        self.assert_programme_edges(slots)

    def assert_fireside_times(self, slots):
        firesides = sorted([r for r in slots if r['track'] == revision.agenda.stable_id('stage-5')], key=lambda r: r['start_at'])
        self.assertEqual([(r['session'], *clock(r)) for r in firesides], [
            ('fs2674cf818b29b', '08:20', '08:55'),
            ('fs26513e80f4656', '09:05', '09:30'),
            ('fs26f7995331c81', '10:00', '10:35'),
            ('fs263c3cbc9227b', '10:45', '11:10'),
            ('fs26ef8a9c617d3', '12:00', '12:35'),
            ('fs262ce9f31b4f2', '12:55', '13:15'),
        ])

    def assert_regular_talks_shifted(self, slots):
        by_id = {r['id']: r for r in slots}
        regular = [r for r in revision.baseline() if r['session'] and r['session'] not in revision.FIRESIDES]
        self.assertEqual(len(regular), 27)
        for old in regular:
            new = by_id[old['id']]
            self.assertEqual(revision.instant(new['start_at']) - revision.instant(old['start_at']), revision.timedelta(minutes=10))
            self.assertEqual(new['session'], old['session'])

    def assert_programme_edges(self, slots):
        opening = next(r for r in slots if r['kind'] == 'opening')
        closing = next(r for r in slots if r['kind'] == 'closing')
        self.assertEqual(clock(opening), ('08:00', '08:10'))
        self.assertEqual(clock(closing), ('14:25', '14:35'))
        gaps = [r for r in slots if r['title'] == 'Stage changeover']
        self.assertEqual(sorted(clock(r) for r in gaps), [('08:10', '08:20'), ('14:15', '14:25')])

    def test_late_failure_rolls_back_all_37_moves_and_first_gap(self):
        raw = self.pb.raw
        def fail(method, path, payload=None):
            if path == '/api/batch':
                assert payload is not None
                payload = copy.deepcopy(payload)
                payload['requests'][-1]['body']['kind'] = 'invalid-kind'
            return raw(method, path, payload)
        with patch.object(self.pb, 'raw', side_effect=fail):
            with self.assertRaises(revision.agenda.SafetyError): self.run_revision()
        self.assertEqual(self.before, self.pb.snapshot())

    def test_lost_committed_response_recovers_without_writes(self):
        raw = self.pb.raw
        def lose(method, path, payload=None):
            result = raw(method, path, payload)
            if path == '/api/batch': raise revision.agenda.SafetyError('Lost committed response')
            return result
        with patch.object(self.pb, 'raw', side_effect=lose):
            with self.assertRaisesRegex(revision.agenda.SafetyError, 'Lost committed'): self.run_revision()
        after = self.pb.snapshot()
        revision.verify_delta(self.before, after)
        self.assertEqual(self.run_revision()['writes'], 0)
        self.assertEqual(after, self.pb.snapshot())

    def test_preflight_backup_and_drift_guards(self):
        with self.assertRaises(revision.agenda.SafetyError): revision.run(self.pb, True)
        changed = copy.deepcopy(self.before)
        row = next(r for r in changed['agenda_slots'] if r['programme'] == revision.PROGRAMME)
        row['title'] += ' drift'
        with self.assertRaises(revision.agenda.SafetyError): revision.plan(self.pb, changed)
        self.assertEqual(self.before, self.pb.snapshot())
        self.pb.raw('PATCH', '/api/settings', {'batch': {'enabled': True, 'maxRequests': 38, 'timeout': 3, 'maxBodySize': 0}})
        with self.assertRaisesRegex(revision.agenda.SafetyError, 'insufficient'): self.run_revision()
        self.assertEqual(self.before, self.pb.snapshot())

    def test_no_unrelated_mutations_and_transfer_guards(self):
        self.run_revision()
        after = self.pb.snapshot()
        for collection in revision.agenda.COLLECTIONS:
            altered = copy.deepcopy(after)
            altered[collection][0]['unexpected'] = 'drift'
            with self.subTest(collection=collection), self.assertRaises(revision.agenda.SafetyError):
                revision.verify_delta(self.before, altered)
        bad = copy.deepcopy(revision.FIRESIDES)
        bad['fs26513e80f4656'] = ('10:55', '11:20')  # Gerald's shifted talk ends at 10:55.
        with patch.object(revision, 'FIRESIDES', bad):
            with self.assertRaisesRegex(revision.agenda.SafetyError, 'transfer below'): revision.validate(self.before)


if __name__ == '__main__':
    unittest.main()
