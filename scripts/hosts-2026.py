#!/usr/bin/env python3
"""Add two hosts and their approved credits. Read-only by default.

Stage original photos as draft profiles; publish both profiles, six Session
credits and two shared Slot credits atomically. Existing guests/times stay put.
This verifier supersedes stage5-agenda.py after host publication.
"""
import argparse
import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stage5', ROOT / 'stage5-agenda.py')
assert spec and spec.loader
stage5 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage5)
agenda = stage5.agenda
MANIFEST = json.loads((ROOT / 'hosts-2026.manifest.json').read_text())
PROFILES = {p['record']['id']: p for p in MANIFEST['profiles']}


def photo_data(profile):
    path = (ROOT / profile['photo_asset']).resolve()
    agenda.require(path.parent == (ROOT / 'hosts-2026-assets').resolve(), 'Photo outside host assets.')
    data = path.read_bytes()
    agenda.require(data.startswith(b'\xff\xd8') and len(data) <= 5242880
                   and hashlib.sha256(data).hexdigest() == profile['photo_sha256'], 'Original photo integrity mismatch.')
    return data


def amendments():
    changes = []
    agenda.require(len(PROFILES) == 2 and all(re.fullmatch('[a-z0-9]{15}', rid) for rid in PROFILES), 'Invalid host identities.')
    agenda.require(set(MANIFEST['hosts']) == {s['id'] for s in stage5.TARGET['sessions']}, 'Must credit all six firesides.')
    for row in stage5.TARGET['sessions']:
        host = PROFILES[MANIFEST['hosts'][row['id']]]['record']
        before = {k: row[k] for k in ('speakers', 'abstract')}
        after = {'speakers': row['speakers'] + [host['id']],
                 'abstract': row['abstract'] + '<p>Hosted by ' + host['display_name'] + '.</p>'}
        changes.append(('sessions', row['id'], before, after))
    host = PROFILES[MANIFEST['shared_host']]['record']
    for row in stage5.BASE['records']['agenda_slots']:
        if row['kind'] in ('opening', 'closing'):
            changes.append(('agenda_slots', row['id'], {'summary': row['summary']},
                            {'summary': row['summary'] + ' Hosted by ' + host['display_name'] + '.'}))
    agenda.require(len(changes) == 8, 'Expected six firesides and opening/closing.')
    return changes


def host_only(desired):
    return (desired['published'] is False and desired['is_mc'] is True
            and desired['origin'] == 'invite' and not desired['user'] and not desired['cfp_applicant']
            and desired['appearance_events'] == [agenda.EVENT])


def require_host_profile(row, desired):
    agenda.require(row['id'] == desired['id'], 'Host identity collision.')
    agenda.require(all(row.get(k) == v for k, v in desired.items() if k != 'published')
                   and type(row.get('published')) is bool and row.get('photo'), 'Host profile drift.')
    agenda.require(row.get('is_dj', False) is False, 'Unexpected DJ designation on a fireside host.')
    agenda.require(set(row) <= set(desired) | {'photo', 'is_dj', 'collectionId', 'collectionName', 'created', 'updated'},
                   'Unexpected host profile fields.')


def uploaded_photo(client, row):
    url = client.url + '/api/files/speakers/' + row['id'] + '/' + urllib.parse.quote(row['photo'], safe='')
    request = urllib.request.Request(url, headers={'Authorization': client.token})
    try:
        with client.opener.open(request, timeout=30) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        raise agenda.SafetyError('Host photo readback failed; request suppressed.') from None


def staged_profile(client, state, profile):
    desired = profile['record']
    agenda.require(host_only(desired), 'Profile exceeds host-only scope.')
    photo_data(profile)
    matches = [r for r in state['speakers'] if r['id'] == desired['id'] or r['slug'] == desired['slug']
               or r.get('display_name', '').casefold() == desired['display_name'].casefold()]
    if not matches:
        return None
    row = agenda.one(matches, 'host identity')
    require_host_profile(row, desired)
    actual = uploaded_photo(client, row)
    agenda.require(hashlib.sha256(actual).hexdigest() == profile['photo_sha256'], 'Uploaded photo hash mismatch.')
    return row


def restore_credits(restored, final):
    for collection, rid, before, after in amendments():
        row = agenda.one([r for r in restored[collection] if r['id'] == rid], 'hosted programme record')
        agenda.require(all(row[k] == v for k, v in (after if final else before).items()), 'Host credit drift.')
        row.update(before)


def require_no_stray_links(state):
    allowed = set(MANIFEST['hosts'])
    agenda.require(not any(set(r['speakers']) & set(PROFILES) for r in state['sessions'] if r['id'] not in allowed),
                   'Host linked to an unexpected Session.')


def inspect(client, state):
    """Accept only untouched baseline, staged drafts, or fully committed output."""
    restored = copy.deepcopy(state)
    missing, existing = [], []
    for profile in MANIFEST['profiles']:
        row = staged_profile(client, state, profile)
        if row is None:
            missing.append(profile)
        else:
            existing.append(row)
    flags = [r['published'] for r in existing]
    final = len(existing) == 2 and all(flags)
    agenda.require(final or not any(flags), 'Partial host publication.')
    restore_credits(restored, final)
    restored['speakers'] = [r for r in restored['speakers'] if r['id'] not in PROFILES]
    require_no_stray_links(state)
    stage5.inspect(restored, True)
    return missing, existing, final


def upload(client, profile):
    boundary = 'wts-host-' + uuid.uuid4().hex
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
        raise agenda.SafetyError(f'Host upload HTTP {error.code}; inspect before retry.') from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise agenda.SafetyError('Host upload outcome uncertain; inspect before retry.') from None


def require_record_delta(collection, rid, original, current, desired, mode):
    expected, actual = dict(original), dict(current)
    if mode == 'publish' and (desired or (collection == 'speakers' and rid in PROFILES)):
        expected.update(desired or {'published': True})
        expected.pop('updated', None)
        actual.pop('updated', None)
    agenda.require(expected == actual, 'Unexpected change to ' + collection + '/' + rid)


def verify_delta(before, after, mode):
    changes = {(c, rid): desired for c, rid, _, desired in amendments()}
    for collection in agenda.COLLECTIONS:
        old = {r['id']: r for r in before[collection]}
        current = {r['id']: r for r in after[collection]}
        agenda.require(current.keys() == (old.keys() | PROFILES.keys() if collection == 'speakers' else old.keys()),
                       'Unexpected record creation/deletion.')
        for rid, original in old.items():
            require_record_delta(collection, rid, original, current[rid], changes.get((collection, rid)), mode)


def nothing_to_write(mode, execute, final, missing):
    return not execute or mode == 'dry-run' or final or (mode == 'stage' and not missing)


def publish_batch(client, existing):
    requests = [{'method': 'PATCH', 'url': '/api/collections/speakers/records/' + r['id'],
                 'body': {'published': True}} for r in existing]
    requests += [{'method': 'PATCH', 'url': '/api/collections/' + c + '/records/' + rid, 'body': after}
                 for c, rid, _, after in amendments()]
    batch = client.raw('GET', '/api/settings')['batch']
    agenda.require(batch['enabled'] and batch['maxRequests'] >= len(requests), 'Existing batch capacity insufficient.')
    result = client.raw('POST', '/api/batch', {'requests': requests})
    agenda.require(len(result) == len(requests) and all(200 <= r['status'] < 300 for r in result), 'Incomplete batch response.')
    return len(requests)


def run(client, mode='dry-run', execute=False, backup_dir=None):
    schema = client.raw('GET', '/api/collections/speakers')
    agenda.require(any(f['name'] == 'is_mc' and f['type'] == 'bool' for f in schema['fields']), 'MC schema required.')
    before = client.snapshot()
    missing, existing, final = inspect(client, before)
    report = {'mode': mode, 'missing': len(missing), 'complete': final, 'writes': 0}
    if mode == 'verify':
        agenda.require(final, 'Host publication incomplete.')
        return report
    if nothing_to_write(mode, execute, final, missing):
        return report
    agenda.require(mode in ('stage', 'publish') and backup_dir is not None, 'Write mode and private backup required.')
    if mode == 'publish':
        agenda.require(not missing, 'Stage both profiles first.')
    audit = agenda.secure_backup(backup_dir, before, {'speakers': schema}, MANIFEST, mode, client.url)
    agenda.require(client.snapshot() == before, 'Concurrent state drift; no writes attempted.')
    if mode == 'stage':
        for profile in missing:
            upload(client, profile)
            inspect(client, client.snapshot())
            report['writes'] += 1
    else:
        report['writes'] = publish_batch(client, existing)
    after = client.snapshot()
    missing, existing, final = inspect(client, after)
    verify_delta(before, after, mode)
    return {**report, 'missing': len(missing), 'complete': final, 'verified': True, 'audit': audit}


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
                       'Writes require execution, exclusive writer, verified native backup and private audit directory.')
    else:
        agenda.require(not args.execute, 'Read-only mode refuses --execute.')
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
        print('REFUSED: ' + str(error), file=sys.stderr)
        sys.exit(1)
