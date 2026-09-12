#!/usr/bin/env python3
"""Import four reviewed 2025 public profiles as 2026 MCs; dry-run by default.

Stage creates unpublished profiles with copied originals. Publish changes only
these four publication flags in one existing-enabled batch. No Sessions, users,
CFP records, stage assignments or agenda records are written. Native backup and
external-upload recovery must be verified separately before execution.
"""
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
spec = importlib.util.spec_from_file_location('agenda', ROOT / 'main-day-agenda.py')
assert spec is not None and spec.loader is not None
agenda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agenda)
MANIFEST = json.loads((ROOT / 'mc-2026.manifest.json').read_text())
NAMES = ('Tony Edwards', 'Stojan Ezhov', 'Nikola Dinevski', 'Dimitar Grozdanov')


def photo_data(profile):
    path = (ROOT / profile['photo_asset']).resolve()
    agenda.require(path.parent == (ROOT / 'mc-2026-assets').resolve(), 'Photo outside reviewed asset directory.')
    data = path.read_bytes()
    agenda.require(data.startswith(b'\xff\xd8') and len(data) <= 5242880
                   and hashlib.sha256(data).hexdigest() == profile['photo_sha256'], 'Photo integrity/format mismatch.')
    return data


def inspect(client, state):
    fields = client.raw('GET', '/api/collections/speakers')['fields']
    role = [f for f in fields if f['name'] == 'is_mc']
    agenda.require(len(role) == 1 and role[0]['type'] == 'bool', 'Deploy the compatible is_mc schema first.')
    agenda.require(tuple(p['record']['display_name'] for p in MANIFEST['profiles']) == NAMES, 'Reviewed MC roster changed.')
    event = agenda.one([e for e in state['appearance_events'] if e['id'] == MANIFEST['event_id']], 'main event')
    agenda.require(event['published'] is True, 'Main event is not published.')
    ids = {p['record']['id'] for p in MANIFEST['profiles']}
    agenda.require(len(ids) == 4, 'Expected four unique MC identities.')
    missing, existing = [], []
    for profile in MANIFEST['profiles']:
        desired = profile['record']
        agenda.require(desired['is_mc'] is True and desired['published'] is False and desired['origin'] == 'invite'
                       and desired['appearance_events'] == ['wts2026appevent'] and not desired['user']
                       and not desired['cfp_applicant'], 'Profile exceeds reviewed MC-only scope.')
        photo_data(profile)
        matches = [r for r in state['speakers'] if r['id'] == desired['id'] or r['slug'] == desired['slug']
                   or r.get('display_name', '').casefold() == desired['display_name'].casefold()]
        if not matches:
            missing.append(profile)
            continue
        actual = agenda.one(matches, 'existing MC profile')
        agenda.require(actual['id'] == desired['id'], 'Existing profile identity collision; review instead of duplicating.')
        agenda.require(all(actual.get(k) == v for k, v in desired.items() if k != 'published')
                       and type(actual.get('published')) is bool and bool(actual.get('photo')), 'MC profile drift; refusing overwrite.')
        allowed = set(desired) | {'photo', 'collectionId', 'collectionName', 'created', 'updated'}
        agenda.require(set(actual) <= allowed, 'Unexpected MC profile fields.')
        url = client.url + '/api/files/speakers/' + actual['id'] + '/' + urllib.parse.quote(actual['photo'], safe='')
        request = urllib.request.Request(url, headers={'Authorization': client.token})
        try:
            with client.opener.open(request, timeout=30) as response:
                data = response.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            raise agenda.SafetyError('MC photo readback failed; raw request suppressed.') from None
        agenda.require(hashlib.sha256(data).hexdigest() == profile['photo_sha256'], 'Uploaded MC photo differs from reviewed original.')
        existing.append(actual)
    agenda.require(not any(ids.intersection(s.get('speakers', [])) for s in state['sessions']),
                   'MC unexpectedly linked to a Session; review before publishing.')
    published = sum(r['published'] for r in existing)
    agenda.require(published in (0, 4), 'Partial MC publication; inspect concurrent writes.')
    return missing, existing


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
        raise agenda.SafetyError(f'MC upload HTTP {error.code}; inspect state before retry.') from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise agenda.SafetyError('MC upload outcome uncertain; inspect state before retry.') from None


def verify_delta(before, after, mode):
    ids = {p['record']['id'] for p in MANIFEST['profiles']}
    for collection in agenda.COLLECTIONS:
        previous = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        agenda.require(current.keys() == (previous.keys() | ids if collection == 'speakers' else previous.keys()),
                       'Unexpected record creation/deletion.')
        for rid, old in previous.items():
            actual = current[rid]
            if collection == 'speakers' and rid in ids and mode == 'publish' and not old['published']:
                old = {k: v for k, v in {**old, 'published': True}.items() if k != 'updated'}
                actual = {k: v for k, v in actual.items() if k != 'updated'}
            agenda.require(actual == old, f'Unexpected change to {collection}/{rid}.')


def run(client, mode='dry-run', execute=False, backup_dir=None):
    before = client.snapshot()
    missing, existing = inspect(client, before)
    report = {'mode': mode, 'profiles': 4, 'missing': len(missing), 'published': sum(r['published'] for r in existing), 'writes': 0}
    if mode == 'verify':
        agenda.require(not missing and report['published'] == 4, 'All four MC profiles must be published.')
        return {**report, 'verified': True}
    if mode == 'dry-run' or not execute:
        return report
    agenda.require(mode in ('stage', 'publish'), 'Unsupported MC operation.')
    if mode == 'publish':
        agenda.require(not missing, 'Stage and verify all profiles before publication.')
    if (mode == 'stage' and not missing) or (mode == 'publish' and report['published'] == 4):
        return report
    agenda.require(backup_dir is not None, 'Verified native backup and private audit directory required.')
    schema = client.raw('GET', '/api/collections/speakers')
    audit = agenda.secure_backup(backup_dir, before, {'speakers': schema}, MANIFEST, mode, client.url)
    agenda.require(client.snapshot() == before, 'State changed since preflight; no writes attempted.')
    if mode == 'stage':
        for profile in missing:
            upload(client, profile)
            # Re-read exact target plus all reviewed profiles after each upload.
            inspect(client, client.snapshot())
            report['writes'] += 1
    else:
        batch = client.raw('GET', '/api/settings')['batch']
        agenda.require(batch['enabled'] and batch['maxRequests'] >= 4, 'Publication requires existing enabled batch API.')
        requests = [{'method': 'PATCH', 'url': f'/api/collections/speakers/records/{r["id"]}', 'body': {'published': True}} for r in existing]
        result = client.raw('POST', '/api/batch', {'requests': requests})
        agenda.require(len(result) == 4 and all(200 <= r['status'] < 300 for r in result), 'Incomplete batch response; inspect state.')
        report['writes'] = 4
    after = client.snapshot()
    missing, existing = inspect(client, after)
    agenda.require(not missing, 'Import incomplete; re-run read-only preflight.')
    verify_delta(before, after, mode)
    return {**report, 'missing': 0, 'published': sum(r['published'] for r in existing), 'verified': True, 'audit': audit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('dry-run', 'stage', 'publish', 'verify'), nargs='?', default='dry-run')
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--exclusive-writer', action='store_true')
    parser.add_argument('--native-backup-verified', action='store_true')
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    if args.mode in ('stage', 'publish'):
        agenda.require(args.execute and args.exclusive_writer and args.native_backup_verified and args.backup_dir,
                       'Writes require --execute --exclusive-writer --native-backup-verified --backup-dir.')
    else:
        agenda.require(not args.execute, 'Read-only mode does not accept --execute.')
    lockpath = Path.home() / '.cache' / 'wts-main-day-agenda.lock'
    lockpath.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run(agenda.PocketBase(*agenda.credentials('~/.zshrc')), args.mode, args.execute, args.backup_dir), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (agenda.SafetyError, BlockingIOError) as error:
        print(f'REFUSED: {error}', file=sys.stderr)
        sys.exit(1)
