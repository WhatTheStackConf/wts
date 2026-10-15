#!/usr/bin/env python3
"""Clear only the two fireside hosts' public MC designations; no auth roles.

Verifies the current transfer-gap programme and preserves all host appearances,
profiles, photos, Session relations and schedule. Supersedes its verifier by
restoring only these two historical flags in memory before baseline validation.
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
spec = importlib.util.spec_from_file_location('transfer', ROOT / 'main-day-transfer-gaps.py')
assert spec and spec.loader
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)
agenda = transfer.agenda
HOSTS = {'host26darko0001': 'darko-bozhinovski', 'host26miodrag01': 'miodrag-cekikj'}


def host_intact(row):
    return row['slug'] == HOSTS[row['id']] and row['published'] and type(row.get('is_mc')) is bool


def plan(client, state):
    restored = copy.deepcopy(state)
    rows = [r for r in restored['speakers'] if r['id'] in HOSTS]
    agenda.require(len(rows) == 2 and all(host_intact(r) for r in rows), 'Host identity/publication drift.')
    flags = [r['is_mc'] for r in rows]
    agenda.require(all(flags) or not any(flags), 'Partial role correction; inspect before retry.')
    for row in rows:
        row['is_mc'] = True
    transfer.inspect(client, restored, True)
    if not any(flags):
        return []
    return [{'method': 'PATCH', 'url': '/api/collections/speakers/records/' + rid, 'body': {'is_mc': False}} for rid in HOSTS]


def verify_delta(before, after):
    for collection in agenda.COLLECTIONS:
        old = {r['id']: r for r in before[collection]}
        actual = {r['id']: r for r in after[collection]}
        agenda.require(old.keys() == actual.keys(), 'Record identity drift.')
        for rid, row in old.items():
            expected, current = dict(row), dict(actual[rid])
            if collection == 'speakers' and rid in HOSTS and row['is_mc']:
                expected['is_mc'] = False
                expected.pop('updated', None)
                current.pop('updated', None)
            agenda.require(expected == current, 'Unexpected change: ' + collection + '/' + rid)


def run(client, execute=False, backup_dir=None, verify=False):
    before = client.snapshot()
    requests = plan(client, before)
    report = {'requests': len(requests), 'writes': 0, 'complete': not requests}
    if verify:
        agenda.require(not requests, 'Role correction not yet published.')
    if not requests or not execute:
        return report
    agenda.require(backup_dir is not None, 'Verified native backup and private audit directory required.')
    batch = client.raw('GET', '/api/settings')['batch']
    agenda.require(batch['enabled'] and batch['maxRequests'] >= 2, 'Existing batch API insufficient.')
    audit = agenda.secure_backup(backup_dir, before, {}, {'hosts': HOSTS, 'is_mc': False}, 'fireside-host-roles', client.url)
    agenda.require(client.snapshot() == before, 'Concurrent state drift; no writes attempted.')
    result = client.raw('POST', '/api/batch', {'requests': requests})
    agenda.require(len(result) == 2 and all(200 <= r['status'] < 300 for r in result), 'Incomplete response; inspect state.')
    after = client.snapshot()
    verify_delta(before, after)
    agenda.require(not plan(client, after), 'Role correction incomplete.')
    return {**report, 'writes': 2, 'complete': True, 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--native-backup-verified', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    agenda.require(not (args.execute and args.verify), 'Verify is read-only.')
    if args.execute:
        agenda.require(args.native_backup_verified and args.exclusive_writer and args.backup_dir, 'Explicit backup/exclusive-writer acknowledgements required.')
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
