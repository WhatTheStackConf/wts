#!/usr/bin/env python3
"""Approved all-stage ten-minute shift and early Stage 5; read-only by default.

Preserves opening, every existing identity, duration, guest/host and publication
flag. Adds two explicit ten-minute programme-wide changeover Slots. Publishes
39 requests in one existing-enabled PocketBase transaction, with no settings,
Session, speaker or track writes. Supersedes hosts-2026.py verify afterwards.
"""
import argparse
import copy
from datetime import datetime, timedelta
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('hosts', ROOT / 'hosts-2026.py')
assert spec and spec.loader
hosts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosts)
agenda = hosts.agenda
PROGRAMME = agenda.stable_id('programme')
TIMING = ('start_at', 'end_at', 'display_order')
FIRESIDES = {
    'fs2674cf818b29b': ('10:20', '10:55'),
    'fs26513e80f4656': ('11:05', '11:30'),
    'fs26f7995331c81': ('12:00', '12:35'),
    'fs263c3cbc9227b': ('12:45', '13:10'),
    'fs26ef8a9c617d3': ('14:00', '14:35'),
    'fs262ce9f31b4f2': ('14:55', '15:15'),
}


def baseline():
    removed = {r['id'] for r in hosts.stage5.TARGET['removed_placeholders']}
    rows = copy.deepcopy([r for r in hosts.stage5.BASE['records']['agenda_slots'] if r['id'] not in removed]
                         + hosts.stage5.TARGET['slots'])
    credits = {rid: after for c, rid, _, after in hosts.amendments() if c == 'agenda_slots'}
    for row in rows:
        row.update(credits.get(row['id'], {}))
    return rows


def set_times(row, start, end):
    row.update(start_at=agenda.instant(start), end_at=agenda.instant(end), display_order=int(start.replace(':', '')))


def target():
    rows = baseline()
    for row in rows:
        if row['kind'] == 'opening':
            continue
        if row['kind'] == 'closing':
            set_times(row, '16:25', '16:35')
        elif row['session'] in FIRESIDES:
            set_times(row, *FIRESIDES[row['session']])
        else:
            for key in ('start_at', 'end_at'):
                row[key] = (instant(row[key]) + timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S.000Z')
            row['display_order'] = int(instant(row['start_at']).astimezone(agenda.ZoneInfo(agenda.ZONE)).strftime('%H%M'))
    for label, start, end in [('after-opening', '10:10', '10:20'), ('before-closing', '16:15', '16:25')]:
        row = {'id': agenda.stable_id('transfer-gap:' + label), 'programme': PROGRAMME, 'track': '',
               'kind': 'break', 'session': '', 'title': 'Stage changeover',
               'summary': '10 minutes to move between stages.', 'published': True, 'location_label': ''}
        set_times(row, start, end)
        rows.append(row)
    return rows


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def overlap(a, b):
    return (a['id'] != b['id'] and (not a['track'] or not b['track'] or a['track'] == b['track'])
            and instant(a['start_at']) < instant(b['end_at']) and instant(a['end_at']) > instant(b['start_at']))


def duration(row):
    return instant(row['end_at']) - instant(row['start_at'])


def non_timing(row):
    return {k: v for k, v in row.items() if k not in TIMING}


def participants(sessions, row):
    if row['session']:
        return set(sessions[row['session']]['speakers'])
    return {hosts.MANIFEST['shared_host']} if row['kind'] in ('opening', 'closing') else set()


def require_transfers(rows, sessions):
    for index, row in enumerate(rows):
        agenda.require(instant(row['start_at']) < instant(row['end_at']), 'Invalid duration.')
        for other in rows[index + 1:]:
            agenda.require(not overlap(row, other), 'Programme/track overlap.')
            if participants(sessions, row) & participants(sessions, other):
                gap = max(instant(row['start_at']) - instant(other['end_at']), instant(other['start_at']) - instant(row['end_at']))
                agenda.require(gap >= timedelta(minutes=10), 'Participant transfer below ten minutes.')


def validate(state):
    old, new = baseline(), target()
    agenda.require(len(old) == 38 and len(new) == 40 and len({r['id'] for r in new}) == 40, 'Roster/Slot count drift.')
    for before, after in zip(old, new):
        agenda.require(duration(before) == duration(after), 'Session duration changed.')
        agenda.require(non_timing(before) == non_timing(after), 'Non-timing Slot fields changed.')
    require_transfers(new, {r['id']: r for r in state['sessions']})
    require_programme_gaps(new)


def require_programme_gaps(rows):
    talks = [r for r in rows if r['session']]
    opening = agenda.one([r for r in rows if r['kind'] == 'opening'], 'opening')
    closing = agenda.one([r for r in rows if r['kind'] == 'closing'], 'closing')
    agenda.require(min(instant(r['start_at']) for r in talks) - instant(opening['end_at']) == timedelta(minutes=10)
                   and instant(closing['start_at']) - max(instant(r['end_at']) for r in talks) == timedelta(minutes=10),
                   'Programme transfer gaps differ from ten minutes.')


def inspect(client, state, final):
    expected = target() if final else baseline()
    actual = [r for r in state['agenda_slots'] if r['programme'] == PROGRAMME]
    agenda.require({r['id'] for r in actual} == {r['id'] for r in expected}, 'Main-day Slot identity/count drift.')
    by_id = {r['id']: r for r in actual}
    agenda.require(all(agenda.matches(by_id[r['id']], r) for r in expected), 'Main-day Slot drift.')
    restored = copy.deepcopy(state)
    restored['agenda_slots'] = [r for r in restored['agenda_slots'] if r['programme'] != PROGRAMME] + baseline()
    _, _, published = hosts.inspect(client, restored)
    agenda.require(published, 'Existing hosts must be published.')
    validate(state)


def plan(client, state):
    try:
        inspect(client, state, True)
        return []
    except agenda.SafetyError:
        inspect(client, state, False)
    current = {r['id']: r for r in baseline()}
    desired = target()
    pending = [r for r in desired if r['id'] in current and r != current[r['id']]]
    requests = timing_requests(current, pending) + changeover_requests(current, desired)
    agenda.require(len(requests) == 39, 'Expected exactly 37 timing edits and two changeovers.')
    return requests


def clashes(row, current):
    return any(overlap(row, other) for other in current.values())


def timing_requests(current, pending):
    requests = []
    # Only issue an update if it is legal against every intermediate Slot. This
    # breaks no identities or visibility flags and needs no temporary tracks.
    while pending:
        ready = [r for r in pending if not clashes(r, current)]
        agenda.require(bool(ready), 'Timing cycle requires a separately reviewed transaction plan.')
        row = sorted(ready, key=lambda r: (r['start_at'], r['id']), reverse=True)[0]
        requests.append({'method': 'PATCH', 'url': '/api/collections/agenda_slots/records/' + row['id'],
                         'body': agenda.project(row, TIMING)})
        current[row['id']] = row
        pending.remove(row)
    return requests


def changeover_requests(current, desired):
    requests = []
    for row in desired:
        if row['id'] not in current:
            agenda.require(not clashes(row, current), 'New changeover overlaps.')
            requests.append({'method': 'POST', 'url': '/api/collections/agenda_slots/records', 'body': row})
            current[row['id']] = row
    return requests


def timing_changes(original, desired):
    return {k: desired[k] for k in TIMING if agenda.normalized(k, original[k]) != agenda.normalized(k, desired[k])}


def require_record_delta(collection, rid, original, actual, desired):
    expected, current = dict(original), dict(actual)
    changes = timing_changes(original, desired[rid]) if collection == 'agenda_slots' and rid in desired else {}
    if changes:
        expected.update(changes)
        expected.pop('updated', None)
        current.pop('updated', None)
    agenda.require(agenda.same_record(expected, current), 'Unexpected mutation to ' + collection + '/' + rid)


def verify_delta(before, after):
    desired = {r['id']: r for r in target()}
    added = set(desired) - {r['id'] for r in baseline()}
    for collection in agenda.COLLECTIONS:
        old = {r['id']: r for r in before[collection]}
        actual = {r['id']: r for r in after[collection]}
        agenda.require(set(actual) == set(old) | (added if collection == 'agenda_slots' else set()), 'Unexpected record creation/deletion.')
        for rid, original in old.items():
            require_record_delta(collection, rid, original, actual[rid], desired)
        if collection == 'agenda_slots':
            require_changeovers(actual, desired, added)


def require_changeovers(actual, desired, added):
    agenda.require(all(agenda.matches(actual[rid], desired[rid]) for rid in added), 'New changeover drift.')


def run(client, execute=False, backup_dir=None, verify=False):
    before = client.snapshot()
    requests = plan(client, before)
    report = {'requests': len(requests), 'writes': 0, 'complete': not requests}
    if verify:
        agenda.require(not requests, 'Reschedule not yet published.')
    if not requests or not execute:
        return report
    agenda.require(backup_dir is not None, 'Verified native backup and private audit directory required.')
    batch = client.raw('GET', '/api/settings')['batch']
    agenda.require(batch['enabled'] and batch['maxRequests'] >= len(requests), 'Existing batch API insufficient; no settings changed.')
    audit = agenda.secure_backup(backup_dir, before, {}, {'before': baseline(), 'after': target()}, 'transfer-gaps', client.url)
    agenda.require(client.snapshot() == before, 'Concurrent state drift; no writes attempted.')
    result = client.raw('POST', '/api/batch', {'requests': requests})
    agenda.require(len(result) == len(requests) and all(200 <= r['status'] < 300 for r in result), 'Incomplete response; inspect before retry.')
    after = client.snapshot()
    inspect(client, after, True)
    verify_delta(before, after)
    agenda.require(not plan(client, after), 'Reschedule failed to converge.')
    return {**report, 'writes': len(requests), 'complete': True, 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--native-backup-verified', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    agenda.require(not (args.execute and args.verify), 'Verify is read-only.')
    if args.execute:
        agenda.require(args.exclusive_writer and args.native_backup_verified and args.backup_dir, 'Execution requires backup and exclusive-writer acknowledgements.')
    lockpath = Path.home() / '.cache/wts-main-day-agenda.lock'
    lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(agenda.PocketBase(*agenda.credentials('~/.zshrc')), args.execute, args.backup_dir, args.verify), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (agenda.SafetyError, BlockingIOError) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(1)
