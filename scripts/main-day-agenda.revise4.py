#!/usr/bin/env python3
"""Revision 3 -> 4: move only Andjelina's existing Slot; read-only by default.

A single record PATCH atomically changes track, start/end and display order.
No batch, temporary track, deletion, publication or Session change is needed.
"""
import argparse
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('agenda', ROOT / 'main-day-agenda.py')
assert spec is not None and spec.loader is not None
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)
TARGET = json.loads(agenda.MANIFEST.read_text())
SLOT_ID = 'md26ebe1331a8a6'
FIELDS = ('track', 'start_at', 'end_at', 'display_order')


def baseline():
    return agenda.build_manifest({
        'appearance_events': [{'id': agenda.EVENT, 'published': True}],
        'speakers': [b['speaker'] for b in TARGET['bindings']],
        'sessions': [b['session'] for b in TARGET['bindings']],
    }, revision=3)


def plan(state):
    agenda.validate_manifest(TARGET)
    agenda.require(TARGET['version'] == 4, 'This migration only applies revision 4.')
    try:
        agenda.inspect_state(TARGET, state, complete=True, expect='published')
        return []
    except agenda.SafetyError:
        agenda.inspect_state(baseline(), state, complete=True, expect='published')
    row = agenda.one([r for r in TARGET['records']['agenda_slots'] if r['id'] == SLOT_ID], 'Andjelina Slot')
    return [{'method': 'PATCH', 'path': f'/api/collections/agenda_slots/records/{SLOT_ID}',
             'payload': agenda.project(row, FIELDS)}]


def require_record_delta(collection, rid, previous, actual, target):
    expected = copy.deepcopy(previous)
    if collection == 'agenda_slots' and rid == SLOT_ID:
        expected.update(agenda.project(target, FIELDS))
        expected.pop('updated', None)
        actual = {k: v for k, v in actual.items() if k != 'updated'}
    agenda.require(agenda.same_record(expected, actual), f'Unexpected change to {collection}/{rid}.')


def verify_delta(before, after):
    agenda.inspect_state(TARGET, after, complete=True, expect='published')
    target = agenda.one([r for r in TARGET['records']['agenda_slots'] if r['id'] == SLOT_ID], 'Andjelina Slot')
    for collection in agenda.COLLECTIONS:
        previous = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        agenda.require(previous.keys() == current.keys(), 'Revision must not create or delete records.')
        for rid, actual in current.items():
            require_record_delta(collection, rid, previous[rid], actual, target)


def run(client, execute=False, backup_dir=None):
    schemas = client.schemas(TARGET)
    before = client.snapshot()
    requests = plan(before)
    report = {'revision': 4, 'requests': len(requests), 'writes': 0, 'complete': not requests}
    if not requests or not execute:
        return report
    agenda.require(backup_dir is not None, 'Execution requires a private audit directory after a verified native backup.')
    audit = agenda.secure_backup(backup_dir, before, schemas, TARGET, 'revision-4', client.url)
    agenda.require(client.snapshot() == before, 'State changed since preflight; no writes attempted.')
    request = agenda.one(requests, 'single-Slot update')
    client.raw(request['method'], request['path'], request['payload'])
    after = client.snapshot()
    verify_delta(before, after)
    agenda.require(not plan(after), 'Revision failed to converge.')
    return {**report, 'writes': 1, 'complete': True, 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--native-backup-verified', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    if args.execute:
        agenda.require(args.exclusive_writer and args.native_backup_verified and args.backup_dir is not None,
                       'Execute requires --exclusive-writer --native-backup-verified --backup-dir.')
    lockpath = Path.home() / '.cache' / 'wts-main-day-agenda.lock'
    lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(agenda.PocketBase(*agenda.credentials('~/.zshrc')), args.execute, args.backup_dir), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (agenda.SafetyError, BlockingIOError) as error:
        print(f'REFUSED: {error}', file=sys.stderr)
        sys.exit(1)
