#!/usr/bin/env python3
"""Publish the organizer-supplied DJ; no Session or stage assignments."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mc', ROOT / 'mc-2026.py')
assert spec and spec.loader
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)
agenda = mc.agenda
PROFILE = json.loads((ROOT / 'dj-2026.manifest.json').read_text())


def photo_data(profile):
    path = (ROOT / profile['photo_asset']).resolve()
    agenda.require(path.parent == (ROOT / 'dj-2026-assets').resolve(), 'Photo outside reviewed asset directory.')
    data = path.read_bytes()
    agenda.require(data.startswith(b'\xff\xd8') and len(data) <= 5242880
                   and hashlib.sha256(data).hexdigest() == profile['photo_sha256'], 'Photo integrity/format mismatch.')
    return data


def upload(client, profile):
    boundary = 'wts-mc-' + uuid.uuid4().hex
    parts = []
    for key, value in profile['record'].items():
        encoded = value if isinstance(value, str) else json.dumps(value)
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{encoded}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="{profile["record"]["slug"]}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode())
    parts.extend((photo_data(profile), f'\r\n--{boundary}--\r\n'.encode()))
    request = urllib.request.Request(client.url + '/api/collections/speakers/records', method='POST',
              headers={'Authorization': client.token, 'Content-Type': 'multipart/form-data; boundary=' + boundary}, data=b''.join(parts))
    try:
        with client.opener.open(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise agenda.SafetyError(f'DJ upload HTTP {error.code}; inspect state before retry.') from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise agenda.SafetyError('DJ upload outcome uncertain; inspect state before retry.') from None


def inspect(client, state):
    desired = PROFILE['record']
    photo_data(PROFILE)
    agenda.require(agenda.one([r for r in state['appearance_events'] if r['id'] == agenda.EVENT], 'main event')['published'],
                   'Main event must be public.')
    rows = [r for r in state['speakers'] if r['id'] == desired['id'] or r['slug'] == desired['slug']
            or r.get('display_name', '').casefold() == desired['display_name'].casefold()]
    agenda.require(not any(desired['id'] in r.get('speakers', []) for r in state['sessions']), 'DJ unexpectedly linked to Session.')
    if not rows:
        return None
    row = agenda.one(rows, 'DJ identity')
    agenda.require(row['id'] == desired['id'], 'Existing identity collision; refusing duplicate.')
    agenda.require(all(row.get(k) == v for k, v in desired.items() if k != 'published')
                   and type(row.get('published')) is bool and bool(row.get('photo')), 'DJ profile drift.')
    agenda.require(set(row) <= set(desired) | {'photo', 'collectionId', 'collectionName', 'created', 'updated'}, 'Unknown DJ fields.')
    path = '/api/files/speakers/' + row['id'] + '/' + urllib.parse.quote(row['photo'], safe='')
    req = urllib.request.Request(client.url + path, headers={'Authorization': client.token})
    try:
        with client.opener.open(req, timeout=30) as response:
            data = response.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        raise agenda.SafetyError('Portrait readback failed; raw request suppressed.') from None
    agenda.require(hashlib.sha256(data).hexdigest() == PROFILE['photo_sha256'], 'Portrait differs from supplied original.')
    return row


def verify_delta(before, after, mode):
    rid = PROFILE['record']['id']
    for collection in agenda.COLLECTIONS:
        old = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        agenda.require(set(current) == set(old) | ({rid} if collection == 'speakers' else set()), 'Unexpected record creation/deletion.')
        for key, original in old.items():
            expected, actual = dict(original), dict(current[key])
            if collection == 'speakers' and key == rid and mode == 'publish' and not original['published']:
                expected['published'] = True
                expected.pop('updated', None)
                actual.pop('updated', None)
            agenda.require(expected == actual, 'Unrelated record changed: ' + collection + '/' + key)


def run(client, mode='dry-run', execute=False, backup_dir=None):
    schema = client.raw('GET', '/api/collections/speakers')
    agenda.require(any(f['name'] == 'is_dj' and f['type'] == 'bool' for f in schema['fields']), 'Compatible DJ schema required.')
    before = client.snapshot()
    row = inspect(client, before)
    published = bool(row and row['published'])
    report = {'mode': mode, 'missing': row is None, 'published': published, 'writes': 0}
    if mode == 'verify':
        agenda.require(published, 'Final DJ is not yet published.')
        return report
    if not execute or mode == 'dry-run' or published or (mode == 'stage' and row):
        return report
    agenda.require(mode in ('stage', 'publish') and backup_dir is not None, 'Private verified backup required for writes.')
    if mode == 'publish':
        agenda.require(row is not None, 'Stage portrait/profile first.')
    audit = agenda.secure_backup(backup_dir, before, {'speakers': schema}, PROFILE, mode, client.url)
    agenda.require(client.snapshot() == before, 'Concurrent state drift; no writes attempted.')
    if mode == 'stage':
        upload(client, PROFILE)
    else:
        client.raw('PATCH', '/api/collections/speakers/records/' + PROFILE['record']['id'], {'published': True})
    after = client.snapshot()
    row = inspect(client, after)
    agenda.require(row is not None and (mode != 'publish' or row['published']), 'Incomplete DJ write.')
    assert row is not None
    verify_delta(before, after, mode)
    return {**report, 'missing': False, 'published': row['published'], 'writes': 1, 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('dry-run', 'stage', 'publish', 'verify'), nargs='?', default='dry-run')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--native-backup-verified', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    if args.mode in ('stage', 'publish'):
        agenda.require(args.execute and args.native_backup_verified and args.exclusive_writer and args.backup_dir,
                       'Write modes require explicit execute, exclusive writer, verified native backup and private audit directory.')
    else:
        agenda.require(not args.execute, 'Read-only mode refuses execute.')
    lockpath = Path.home() / '.cache/wts-main-day-agenda.lock'
    lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(agenda.PocketBase(*agenda.credentials('~/.zshrc')), args.mode, args.execute, args.backup_dir), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (agenda.SafetyError, BlockingIOError) as error:
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(1)
