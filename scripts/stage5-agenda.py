#!/usr/bin/env python3
"""Publish approved Stage 5 chats in one batch; read-only by default.

The revision-4 main-day manifest remains the frozen baseline. This additive
manifest supersedes only its four unlinked Stage 5 placeholders.
"""
import argparse
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('agenda', ROOT / 'main-day-agenda.py')
assert spec and spec.loader
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)
BASE = json.loads(agenda.MANIFEST.read_text())
TARGET = json.loads((ROOT / 'stage5-agenda.manifest.json').read_text())
OPEN_SOURCE = 'fs26f7995331c81'
SANTOSH = 'hcylucb8r3b5usi'
ORIGINAL_OPEN_SOURCE_GUESTS = ['ma8p9bv90wl2llh', 'h73wmh5udfljxmn', 'kleqx55avrqboa7']


def require_appearance_counts(guests):
    agenda.require(TARGET['version'] == 2 and len(guests) == 16 and len(set(guests)) == 15,
                   'Expected 15 guests and 16 appearances.')
    agenda.require(all(guests.count(sid) == (2 if sid == SANTOSH else 1) for sid in set(guests)),
                   'Only Santosh has an approved second appearance.')


def require_guest_roster():
    guests = [sid for session in TARGET['sessions'] for sid in session['speakers']]
    require_appearance_counts(guests)
    open_source = agenda.one([s for s in TARGET['sessions'] if s['id'] == OPEN_SOURCE], 'open-source chat')
    agenda.require(open_source['speakers'] == ORIGINAL_OPEN_SOURCE_GUESTS + [SANTOSH], 'Open-source guest drift.')
    agenda.require(set(guests) == {s['id'] for s in TARGET['speaker_bindings']}, 'Guest binding mismatch.')
    agenda.require(all(1 <= len(s['speakers']) <= 4 for s in TARGET['sessions']), 'Guest cap exceeded.')


def require_clear_of(old, slot, a, b, sessions, regular):
    if not old['track']:
        agenda.require(slot['end_at'] <= old['start_at'] or slot['start_at'] >= old['end_at'], 'Shared break overlap.')
    elif old.get('session') in regular and set(sessions[slot['session']]['speakers']) & set(regular[old['session']]['speakers']):
        start = agenda.datetime.fromisoformat(agenda.normalized('start_at', old['start_at']))
        end = agenda.datetime.fromisoformat(agenda.normalized('end_at', old['end_at']))
        gap = max((start - agenda.datetime.fromisoformat(b)).total_seconds(),
                  (agenda.datetime.fromisoformat(a) - end).total_seconds())
        agenda.require(gap >= 600, 'Own-talk transfer below ten minutes.')


def require_chat_schedule():
    sessions = {s['id']: s for s in TARGET['sessions']}
    regular = {b['session']['id']: b['session'] for b in BASE['bindings']}
    previous = None
    for slot in TARGET['slots']:
        a, b = (agenda.normalized(k, slot[k]) for k in ('start_at', 'end_at'))
        agenda.require(a < b and slot['published'] and slot['kind'] == 'session', 'Invalid chat slot.')
        if previous:
            agenda.require((agenda.datetime.fromisoformat(a) - agenda.datetime.fromisoformat(previous)).total_seconds() >= 300,
                           'Insufficient changeover.')
        previous = b
        agenda.require(any(w['start_at'] <= slot['start_at'] < slot['end_at'] <= w['end_at']
                           for w in TARGET['removed_placeholders']), 'Chat outside original Stage 5 window.')
        for old in BASE['records']['agenda_slots']:
            require_clear_of(old, slot, a, b, sessions, regular)


def validate():
    agenda.validate_manifest(BASE)
    agenda.require(agenda.digest(BASE) == TARGET['baseline_manifest_sha256'], 'Baseline drift.')
    agenda.require(len(TARGET['slots']) == len(TARGET['sessions']) == 6, 'Expected six chats.')
    require_guest_roster()
    agenda.require(len(TARGET['membership_updates']) == 2, 'Expected two attendance confirmations.')
    agenda.require(TARGET['removed_placeholders'] == [s for s in BASE['records']['agenda_slots']
                   if s['track'] == agenda.stable_id('stage-5')], 'Placeholder drift.')
    require_chat_schedule()


def require_approved_record(state, collection, row, final):
    existing = [r for r in state[collection] if r['id'] == row['id']]
    if final:
        agenda.require(len(existing) == 1 and agenda.matches(existing[0], row), 'Final record differs from approved manifest.')
    else:
        agenda.require(not existing, 'Unexpected partial publication or ID collision.')
    if collection == 'sessions':
        agenda.require(not any(r['slug'] == row['slug'] and r['id'] != row['id'] for r in state[collection]), 'Session slug collision.')


def require_guests(state, final):
    updates = {r['id']: r for r in TARGET['membership_updates']}
    for binding in TARGET['speaker_bindings']:
        speaker = agenda.one([r for r in state['speakers'] if r['id'] == binding['id']], 'guest')
        expected = dict(binding)
        if final and speaker['id'] in updates:
            expected['appearance_events'] = updates[speaker['id']]['after']
        agenda.require(agenda.matches(agenda.project(speaker, expected), expected), 'Guest identity, publication or membership drift.')


def strip_approved(state, restored, final):
    for collection, key in (('sessions', 'sessions'), ('agenda_slots', 'slots')):
        desired = TARGET[key]
        ids = {r['id'] for r in desired}
        for row in desired:
            require_approved_record(state, collection, row, final)
        restored[collection] = [r for r in restored[collection] if r['id'] not in ids]


def restore_placeholders(state, restored):
    removed = {r['id'] for r in TARGET['removed_placeholders']}
    agenda.require(not any(r['id'] in removed for r in state['agenda_slots']), 'Old placeholders remain.')
    restored['agenda_slots'].extend(TARGET['removed_placeholders'])


def require_stage5_slots(state, final):
    stage_slots = [r for r in state['agenda_slots'] if r['track'] == agenda.stable_id('stage-5')]
    agenda.require({s['id'] for s in stage_slots} == {s['id'] for s in (TARGET['slots'] if final else TARGET['removed_placeholders'])},
                   'Unexpected Stage 5 slot.')


def inspect(state, final):
    validate()
    restored = copy.deepcopy(state)
    strip_approved(state, restored, final)
    if final:
        restore_placeholders(state, restored)
    require_guests(state, final)
    agenda.inspect_state(BASE, restored, complete=True, expect='published')
    require_stage5_slots(state, final)


def record_request(method, collection, row, body=None):
    url = '/api/collections/' + collection + '/records'
    if method != 'POST':
        url += '/' + row['id']
    request = {'method': method, 'url': url}
    if body is not None:
        request['body'] = body
    return request


def open_source_amendment(state, existing):
    agenda.require(existing['speakers'] == ORIGINAL_OPEN_SOURCE_GUESTS,
                   'Unexpected open-source guest list; refuse amendment.')
    amended = copy.deepcopy(state)
    row = agenda.one([r for r in amended['sessions'] if r['id'] == OPEN_SOURCE], 'open-source chat')
    row['speakers'] = ORIGINAL_OPEN_SOURCE_GUESTS + [SANTOSH]
    inspect(amended, True)
    return [{'method': 'PATCH', 'url': '/api/collections/sessions/records/' + OPEN_SOURCE,
             'body': {'speakers': row['speakers']}}]


def publication_requests():
    requests = []
    for row in TARGET['membership_updates']:
        requests.append(record_request('PATCH', 'speakers', row, {'appearance_events': row['after']}))
    for row in TARGET['removed_placeholders']:
        agenda.require(not row['session'] and row['kind'] == 'other', 'Refuse linked placeholder deletion.')
        requests.append(record_request('PATCH', 'agenda_slots', row, {'published': False}))
        requests.append(record_request('DELETE', 'agenda_slots', row))
    for row in TARGET['sessions']:
        requests.append(record_request('POST', 'sessions', row, row))
    for row in TARGET['slots']:
        requests.append(record_request('POST', 'agenda_slots', row, row))
    return requests


def plan(state):
    try:
        inspect(state, True)
        return []
    except agenda.SafetyError:
        pass
    existing = [r for r in state['sessions'] if r['id'] == OPEN_SOURCE]
    if existing:
        return open_source_amendment(state, existing[0])
    inspect(state, False)
    return publication_requests()


def expected_ids(collection, old, removed):
    added = TARGET['sessions'] if collection == 'sessions' else TARGET['slots'] if collection == 'agenda_slots' else []
    wanted_ids = set(old) | {r['id'] for r in added}
    if collection == 'agenda_slots':
        wanted_ids -= removed
    return wanted_ids


def require_record_delta(collection, rid, expected, current, updates):
    expected = dict(expected)
    if collection == 'speakers' and rid in updates:
        expected['appearance_events'] = updates[rid]['after']
    current = dict(current)
    amended_session = collection == 'sessions' and rid == OPEN_SOURCE
    if amended_session:
        agenda.require(expected['speakers'] in (ORIGINAL_OPEN_SOURCE_GUESTS,
                                               ORIGINAL_OPEN_SOURCE_GUESTS + [SANTOSH]),
                       'Unexpected prior open-source guest list.')
        expected['speakers'] = ORIGINAL_OPEN_SOURCE_GUESTS + [SANTOSH]
    # Only modified records may acquire an updated timestamp.
    if (collection == 'speakers' and rid in updates) or amended_session:
        expected.pop('updated', None)
        current.pop('updated', None)
    agenda.require(expected == current, 'Unrelated field or record changed: ' + collection + '/' + rid)


def verify_delta(before, after):
    inspect(after, True)
    removed = {s['id'] for s in TARGET['removed_placeholders']}
    updates = {s['id']: s for s in TARGET['membership_updates']}
    for collection in agenda.COLLECTIONS:
        old = {r['id']: r for r in before[collection]}
        actual = {r['id']: r for r in after[collection]}
        agenda.require(set(actual) == expected_ids(collection, old, removed), 'Unexpected create/delete outside approved delta.')
        for rid, expected in old.items():
            if collection == 'agenda_slots' and rid in removed:
                continue
            require_record_delta(collection, rid, expected, actual[rid], updates)


def run(client, execute=False, backup_dir=None):
    client.schemas(BASE)
    before = client.snapshot()
    requests = plan(before)
    if not requests or not execute:
        return {'requests': len(requests), 'writes': 0, 'complete': not requests}
    agenda.require(backup_dir is not None, 'Private backup directory required.')
    if len(requests) > 1:
        batch = client.raw('GET', '/api/settings')['batch']
        agenda.require(batch['enabled'] and batch['maxRequests'] >= len(requests), 'Existing batch API is insufficient.')
    schemas = client.schemas(BASE)
    audit = agenda.secure_backup(backup_dir, before, schemas, TARGET, 'stage5', client.url)
    agenda.require(client.snapshot() == before, 'State drifted after preflight; no writes attempted.')
    if len(requests) == 1:
        request = requests[0]
        client.raw(request['method'], request['url'], request['body'])
    else:
        client.raw('POST', '/api/batch', {'requests': requests})
    after = client.snapshot()
    verify_delta(before, after)
    agenda.require(not plan(after), 'Publication did not converge.')
    return {'requests': len(requests), 'writes': len(requests), 'complete': True, 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    if args.execute:
        agenda.require(args.exclusive_writer and args.backup_dir, 'Exclusive writer and backup required.')
        receipt = json.loads((args.backup_dir / 'independent-verification-receipt.json').read_text())
        agenda.require(receipt['verification'] == 'PASS', 'Verified native + uploaded-file backup required.')
        when = agenda.datetime.fromisoformat(receipt['verified_at'])
        agenda.require((agenda.datetime.now(agenda.timezone.utc) - when).total_seconds() < 3600, 'Backup verification is stale.')
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
        print('REFUSED: ' + str(error))
        raise SystemExit(1)
