#!/usr/bin/env python3
"""Atomic revision-2 to revision-3 agenda update; read-only by default.

Requires an existing enabled batch API, a verified native backup and exclusive
agenda editing. Preserves every linked Slot/Session/Track identity and visibility;
only the three explicitly reviewed, unlinked regular-stage TBDs are removed.
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
_bindings = json.loads(agenda.MANIFEST.read_text())['bindings']
TARGET = agenda.build_manifest({'appearance_events': [{'id': agenda.EVENT, 'published': True}],
                               'speakers': [b['speaker'] for b in _bindings],
                               'sessions': [b['session'] for b in _bindings]}, revision=3)
HOLDING = agenda.stable_id('revision-3-holding-track')
FIELDS = ('track', 'start_at', 'end_at', 'display_order')


def baseline():
    return agenda.build_manifest({
        'appearance_events': [{'id': agenda.EVENT, 'published': True}],
        'speakers': [b['speaker'] for b in TARGET['bindings']],
        'sessions': [b['session'] for b in TARGET['bindings']],
    }, revision=2)


def removed_slots():
    keep = {r['id'] for r in TARGET['records']['agenda_slots']}
    removed = [r for r in baseline()['records']['agenda_slots'] if r['id'] not in keep]
    agenda.require(len(removed) == 3 and all(r['kind'] == 'other' and not r['session'] and r['title'] == 'TBD'
                   and r['track'] and r['track'] != agenda.stable_id('stage-5') for r in removed),
                   'Only the three reviewed unlinked regular-stage TBDs may be removed.')
    return removed


def plan(state):
    agenda.validate_manifest(TARGET)
    agenda.require(TARGET['version'] == 3, 'This migration only applies revision 3.')
    try:
        agenda.inspect_state(TARGET, state, complete=True, expect='published')
        return []
    except agenda.SafetyError:
        agenda.inspect_state(baseline(), state, complete=True, expect='published')
    requests = []

    def request(method, collection, rid='', body=None):
        row = {'method': method, 'url': f'/api/collections/{collection}/records' + (f'/{rid}' if rid else '')}
        if body is not None:
            row['body'] = body
        requests.append(row)

    # Published placeholders must be unpublished before deletion. Both steps are
    # inside the batch transaction; no Session publication endpoint is involved.
    for row in removed_slots():
        request('PATCH', 'agenda_slots', row['id'], {'published': False})
        request('DELETE', 'agenda_slots', row['id'])
    request('POST', 'agenda_tracks', body={
        'id': HOLDING, 'programme': TARGET['records']['event_programmes'][0]['id'],
        'key': 'revision-3-holding', 'name': 'Transaction holding track',
        'location_label': '', 'display_order': 99,
    })
    sessions = {b['speaker']['slug']: b['session']['id'] for b in TARGET['bindings']}

    def slot(slug):
        return agenda.one([s for s in TARGET['records']['agenda_slots'] if s['session'] == sessions[slug]], 'revision-3 Slot')

    # Free Andjelina's old window; her target is still occupied by Domagoj.
    request('PATCH', 'agenda_slots', slot('andjelina-maksimovic')['id'], {'track': HOLDING})
    # Fill Stage 2 before advancing Dragan, then rotate Stage 4 into the freed window.
    for slug in ('riste-oreshkovski', 'dragan-shahpaski', 'faris-aziz', 'stefan-andonov',
                 'bogdan-ilie', 'domagoj-maric', 'andjelina-maksimovic'):
        row = slot(slug)
        request('PATCH', 'agenda_slots', row['id'], agenda.project(row, FIELDS))
    request('DELETE', 'agenda_tracks', HOLDING)
    return requests


def require_record_delta(collection, rid, previous, actual, target):
    expected = copy.deepcopy(previous)
    changes = {k: target[k] for k in FIELDS
               if agenda.normalized(k, target[k]) != agenda.normalized(k, expected[k])} if target else {}
    if changes:
        expected.update(changes)
        expected.pop('updated', None)
        actual = {k: v for k, v in actual.items() if k != 'updated'}
    agenda.require(agenda.same_record(expected, actual), f'Unexpected change to {collection}/{rid}.')


def verify_delta(before, after):
    agenda.inspect_state(TARGET, after, complete=True, expect='published')
    targets = {r['id']: r for r in TARGET['records']['agenda_slots']}
    deleted = {r['id'] for r in removed_slots()}
    for collection in agenda.COLLECTIONS:
        previous = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        expected_ids = previous.keys() - deleted if collection == 'agenda_slots' else previous.keys()
        agenda.require(current.keys() == expected_ids, 'Unexpected record creation/deletion or leftover holding track.')
        for rid, actual in current.items():
            target = targets.get(rid) if collection == 'agenda_slots' else None
            require_record_delta(collection, rid, previous[rid], actual, target)


def run(client, execute=False, backup_dir=None):
    schemas = client.schemas(TARGET)
    before = client.snapshot()
    requests = plan(before)
    report = {'revision': 3, 'requests': len(requests), 'writes': 0, 'complete': not requests}
    if not requests:
        return report
    batch = client.raw('GET', '/api/settings')['batch']
    agenda.require(batch['enabled'] and batch['maxRequests'] >= len(requests),
                   'Required batch API is not enabled/capable; no settings changed.')
    if not execute:
        return report
    agenda.require(backup_dir is not None, 'Execution requires a private audit directory after a verified native backup.')
    audit = agenda.secure_backup(backup_dir, before, schemas, TARGET, 'revision-3', client.url)
    agenda.require(client.snapshot() == before, 'State changed since preflight; no writes attempted.')
    result = client.raw('POST', '/api/batch', {'requests': requests})
    agenda.require(len(result) == len(requests) and all(200 <= r['status'] < 300 for r in result),
                   'Batch response incomplete; inspect state before retry.')
    after = client.snapshot()
    verify_delta(before, after)
    agenda.require(not plan(after), 'Revision failed to converge.')
    return {**report, 'writes': len(requests), 'complete': True, 'verified': True, 'audit': audit}


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
    # Same local lock as the initial publisher; editors on other hosts must pause.
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
