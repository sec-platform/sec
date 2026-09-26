import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDigest, parseDigest, type Digest } from './digest.ts';
import { gitBlobObjectId, isObjectFormat, isObjectId, parseObjectId, type ObjectId } from './git-object-id.ts';

test('Git object names require their repository format, not an application algorithm', () => {
  for (const [format, width] of [['sha1', 40], ['sha256', 64]] as const) {
    const value = 'a'.repeat(width);
    assert.equal(parseObjectId(value, format), value);
    assert.equal(isObjectId(value), true);
    assert.equal(isObjectId(value, format), true);
    assert.equal(isObjectId(value, format === 'sha1' ? 'sha256' : 'sha1'), false);
    for (const invalid of [null, undefined, 1, {}, new String(value), value.toUpperCase(),
      `${value}\n`, `${value}\r`, `${value}\u2028`, ` ${value}`, value.slice(1), `${value}a`,
      `${'a'.repeat(width - 1)}\n`, 'g'.repeat(width), `sha256:${value}`, `blake3:${value}`]) {
      assert.equal(isObjectId(invalid, format), false);
      assert.throws(() => parseObjectId(invalid, format), TypeError);
    }
  }
  assert.equal(isObjectFormat('sha1'), true);
  assert.equal(isObjectFormat('sha256'), true);
  assert.equal(isObjectFormat('blake3'), false);
  assert.equal(isObjectId('a'.repeat(40), '__proto__' as never), false);
  assert.throws(() => parseObjectId('a'.repeat(40), undefined as never), TypeError);
});

test('digest prefixes and Git names never silently convert', () => {
  const oid = parseObjectId('a'.repeat(64), 'sha256');
  const digest = parseDigest(`sha256:${'a'.repeat(64)}`, 'sha256');
  assert.equal(isDigest(oid, 'sha256'), false);
  assert.equal(isObjectId(digest, 'sha256'), false);
  // @ts-expect-error a parsed digest is not a Git object name
  const wrongObject: ObjectId<'sha256'> = digest;
  // @ts-expect-error a parsed Git name is not a content digest
  const wrongDigest: Digest<'sha256'> = oid;
  // @ts-expect-error repository formats remain distinct
  const wrongFormat: ObjectId<'sha1'> = oid;
  void wrongObject; void wrongDigest; void wrongFormat;
});

test('existing Git null/CAS spelling is preserved without asserting an object exists', () => {
  assert.equal(isObjectId('0'.repeat(40), 'sha1'), true);
  assert.equal(isObjectId('0'.repeat(64), 'sha256'), true);
});


test('Git blob identity uses the repository object format and exact Git framing', () => {
  const empty = new Uint8Array();
  assert.equal(gitBlobObjectId('sha1', empty), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(gitBlobObjectId('sha256', empty), '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813');
  assert.notEqual(gitBlobObjectId('sha1', new TextEncoder().encode('a')), gitBlobObjectId('sha1', empty));
  assert.throws(() => gitBlobObjectId('blake3' as never, empty), TypeError);
});
