#!/usr/bin/env python3
"""Atomic revision-1 to revision-2 agenda update; dry-run by default.

Requires existing enabled PocketBase batch API and a verified native backup.
Keeps every Session/Slot/Track identity and all publication flags unchanged.
A transaction-local holding track breaks the timing cycle without overlaps;
it is removed inside the same batch, never visible to public readers.
"""
import argparse
import copy
from datetime import datetime, timezone
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
HOLDING = agenda.stable_id('revision-2-holding-track')


def baseline():
    source = {'appearance_events': [{'id': agenda.EVENT, 'published': True}],
              'speakers': [b['speaker'] for b in TARGET['bindings']],
              'sessions': [b['session'] for b in TARGET['bindings']]}
    return agenda.build_manifest(source, revision=1)


def plan(state):
    agenda.validate_manifest(TARGET)
    agenda.require(TARGET['version'] == 2, 'This migration only applies revision 2.')
    try:
        agenda.inspect_state(TARGET, state, complete=True, expect='published')
        return []
    except agenda.SafetyError:
        agenda.inspect_state(baseline(), state, complete=True, expect='published')
    programme = TARGET['records']['event_programmes'][0]['id']
    requests = []

    def request(method, collection, rid='', body=None):
        row = {'method': method, 'url': f'/api/collections/{collection}/records' + (f'/{rid}' if rid else '')}
        if body is not None: row['body'] = body
        requests.append(row)

    request('POST', 'agenda_tracks', body={'id': HOLDING, 'programme': programme,
            'key': 'revision-2-holding', 'name': 'Transaction holding track', 'location_label': '', 'display_order': 99})
    by_slug = {b['speaker']['slug']: b['session']['id'] for b in TARGET['bindings']}

    def slot(slug):
        return agenda.one([r for r in TARGET['records']['agenda_slots'] if r['session'] == by_slug[slug]], 'revision target Slot')

    alex = slot('alexander-lichter')
    request('PATCH', 'agenda_slots', alex['id'], {'track': HOLDING})
    # Free old window 4, then 2, then 3, then 1. All linked Sessions stay public.
    for slug in ('kiril-zafirov', 'alem-tuzlak', 'sam-vloeberghs', 'alexander-lichter'):
        row = slot(slug)
        request('PATCH', 'agenda_slots', row['id'], agenda.project(row, ('track', 'start_at', 'end_at', 'display_order')))
    for row in TARGET['records']['agenda_tracks']:
        if row['key'] in ('stage-1', 'stage-2', 'stage-3'):
            request('PATCH', 'agenda_tracks', row['id'], agenda.project(row, ('name', 'display_order')))
    request('DELETE', 'agenda_tracks', HOLDING)
    return requests


def verify_delta(before, after):
    agenda.inspect_state(TARGET, after, complete=True, expect='published')
    desired = {c: {r['id']: r for r in rows} for c, rows in TARGET['records'].items()}
    for collection in agenda.COLLECTIONS:
        previous = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        agenda.require(previous.keys() == current.keys(), 'Migration changed record identities or left a holding track.')
        for rid, old in previous.items():
            expected = copy.deepcopy(old)
            target = desired.get(collection, {}).get(rid)
            if target and collection in ('agenda_tracks', 'agenda_slots'):
                keys = ('name', 'display_order') if collection == 'agenda_tracks' else ('start_at', 'end_at', 'display_order')
                changes = {k: target[k] for k in keys if agenda.normalized(k, target[k]) != agenda.normalized(k, old[k])}
                if changes:
                    expected.update(changes)
                    expected.pop('updated', None)
                    actual = {k: v for k, v in current[rid].items() if k != 'updated'}
                else:
                    actual = current[rid]
            else:
                actual = current[rid]
            agenda.require(all(agenda.normalized(k, v) == agenda.normalized(k, actual.get(k)) for k, v in expected.items())
                           and expected.keys() == actual.keys(), f'Unexpected change to {collection}/{rid}.')


def run(client, execute=False, backup_dir=None):
    before = client.snapshot()
    requests = plan(before)
    report = {'revision': 2, 'requests': len(requests), 'writes': 0, 'complete': not requests}
    if not requests or not execute:
        return report
    batch = client.raw('GET', '/api/settings')['batch']
    agenda.require(batch['enabled'] and batch['maxRequests'] >= len(requests), 'Required batch API is not enabled/capable; no settings changed.')
    if backup_dir is None:
        raise agenda.SafetyError('Execution requires a private audit directory after a native backup.')
    root = Path(backup_dir).expanduser()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    agenda.require(not root.is_symlink() and root.stat().st_mode & 0o077 == 0, 'Audit directory must be private.')
    path = root / ('main-day-revision-2-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(before, handle); handle.flush(); os.fsync(handle.fileno())
    agenda.require(json.loads(path.read_text()) == before, 'Audit snapshot readback failed.')
    agenda.require(client.snapshot() == before, 'State changed since preflight; refusing writes.')
    result = client.raw('POST', '/api/batch', {'requests': requests})
    agenda.require(len(result) == len(requests) and all(200 <= r['status'] < 300 for r in result), 'Batch response incomplete; inspect state before retry.')
    after = client.snapshot()
    verify_delta(before, after)
    agenda.require(not plan(after), 'Revision failed to converge.')
    return {**report, 'writes': len(requests), 'complete': True, 'verified': True, 'audit': str(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    print(json.dumps(run(agenda.PocketBase(*agenda.credentials('~/.zshrc')), args.execute, args.backup_dir), indent=2))


if __name__ == '__main__':
    try:
        main()
    except agenda.SafetyError as error:
        print(f'REFUSED: {error}', file=sys.stderr); sys.exit(1)
