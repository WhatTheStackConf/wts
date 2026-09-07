#!/usr/bin/env python3
"""Source-pinned DevFest setup. Dry-run by default; no inferred speaker/timing links.

Reuse the Appearance Event; create a Day, Event Programme and two public Sessions.
The untimed session association lives in src/lib/conference-week-agenda.ts.
Take a native PocketBase backup before production --execute. JSON snapshots here
are private audit evidence, not a complete database backup.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import html
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
DATA = json.loads((ROOT / 'devfest-programme.json').read_text())


def record_id(label):
    return 'df26' + hashlib.sha256(label.encode()).hexdigest()[:11]


def plan(state):
    event = agenda.one([r for r in state['appearance_events'] if r['id'] == DATA['event_id']], 'DevFest event')
    agenda.require(event['name'] == DATA['event_name'] and event['published'], 'DevFest identity/publication drift.')
    agenda.require(event.get('destination_url', '') in ('', DATA['source']), 'DevFest destination drift.')
    day = {'id': record_id('day'), 'key': 'devfest-wednesday', 'local_date': DATA['date'],
           'title': DATA['event_name'], 'display_order': 3, 'published': True}
    programme = {'id': record_id('programme'), 'day': day['id'], 'appearance_event': event['id'], 'display_order': 0}
    wanted = [('conference_days', day), ('event_programmes', programme)]
    wanted += [('sessions', {'id': record_id(s['slug']), 'slug': s['slug'], 'title': s['title'],
                            'abstract': '<p>' + html.escape(s['description']) + '</p>',
                            'format': 'talk', 'speakers': [], 'published': True}) for s in DATA['sessions']]
    operations = []
    for collection, row in wanted:
        for actual in state[collection]:
            related = (collection == 'conference_days' and (actual['key'] == day['key'] or actual['local_date'] == day['local_date']))
            related |= collection == 'event_programmes' and actual['appearance_event'] == event['id']
            related |= collection == 'sessions' and (actual['slug'] == row['slug'] or actual['title'] == row['title'])
            agenda.require(not related or actual['id'] == row['id'], f'Review existing {collection} identity before creating a duplicate.')
        actual = next((r for r in state[collection] if r['id'] == row['id']), None)
        if actual:
            agenda.require(all(actual.get(k) == v for k, v in row.items()), f'Existing {collection} fields drifted.')
        else:
            operations.append(('POST', collection, row['id'], row))
    if event.get('destination_url') != DATA['source']:
        operations.append(('PATCH', 'appearance_events', event['id'], {'destination_url': DATA['source']}))
    return operations


def run(client, execute=False, backup_dir=None):
    before = client.snapshot()
    operations = plan(before)
    report = {'source': DATA['source'], 'writes': 0, 'pending': len(operations),
              'records': [{'collection': c, 'id': rid, 'method': m} for m, c, rid, _ in operations]}
    if not execute or not operations:
        return report
    if backup_dir is None:
        raise agenda.SafetyError('Execution requires a private backup directory.')
    root = Path(backup_dir).expanduser()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    agenda.require(not root.is_symlink() and root.stat().st_mode & 0o077 == 0, 'Backup directory must be private.')
    backup = root / ('devfest-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(before, handle); handle.flush(); os.fsync(handle.fileno())
    agenda.require(json.loads(backup.read_text()) == before, 'Snapshot readback failed.')
    agenda.require(client.snapshot() == before, 'State changed before writes.')
    expected = copy.deepcopy(before)
    for method, collection, rid, payload in operations:
        path = f'/api/collections/{collection}/records' + (f'/{rid}' if method == 'PATCH' else '')
        client.raw(method, path, payload)
        actual = client.request('GET', collection, rid)
        agenda.require(all(actual.get(k) == v for k, v in payload.items()), 'Record readback mismatch.')
        expected[collection] = [r for r in expected[collection] if r['id'] != rid] + [actual]
        report['writes'] += 1
    after = client.snapshot()
    for collection in agenda.COLLECTIONS:
        agenda.require(sorted(expected[collection], key=lambda r:r['id']) == sorted(after[collection], key=lambda r:r['id']),
                       f'Unexpected {collection} change during operation.')
    agenda.require(not plan(after), 'DevFest verification incomplete.')
    return {**report, 'pending': 0, 'verified': True, 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    agenda.require(not args.execute or args.backup_dir is not None, '--execute requires --backup-dir after a native backup.')
    client = agenda.PocketBase(*agenda.credentials('~/.zshrc'))
    print(json.dumps(run(client, args.execute, args.backup_dir), indent=2))


if __name__ == '__main__':
    try:
        main()
    except agenda.SafetyError as error:
        print(f'REFUSED: {error}', file=sys.stderr); sys.exit(1)
