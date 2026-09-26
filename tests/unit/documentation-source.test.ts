import { expect, test } from 'bun:test';
import { rawSha256Hex } from '../../src/contracts/canonical.ts';
import {
  compareDocumentationPaths, DOCUMENTATION_BASELINE, DOCUMENTATION_NON_SOURCE,
  documentationSourceDigest, parseDocumentationSourceContract
} from '../../src/contracts/documentation-source.ts';

function fixture() {
  const baseline = Buffer.from(JSON.stringify({
    schema: 'sec.documentation-baseline/2', source_root: '..',
    source_roots: ['.documentation', 'docs'], source_manifest: 'source-manifest.json',
    audited_namespaces: ['docs'], non_documentation_roots: [],
    excluded_from_source_hash: DOCUMENTATION_NON_SOURCE,
    entry: '../docs/main.md', delivery_number: 'fixture', archive_name: 'fixture.zip',
    scope: 'Byte identity only', authority_limit: 'Not approval'
  }));
  const members = [
    { path: DOCUMENTATION_BASELINE, bytes: baseline.byteLength, sha256: rawSha256Hex(baseline) },
    { path: 'docs/main.md', bytes: 0, sha256: rawSha256Hex('') }
  ];
  const manifest = { schema: 'sec.documentation-source-manifest/2', members,
    source_set_sha256: documentationSourceDigest(members) };
  return { baseline, manifest };
}
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

test('source manifest binds its boundary bytes and recomputed member digest', () => {
  const f = fixture();
  expect(parseDocumentationSourceContract(f.baseline, bytes(f.manifest)).sourceSetSha256)
    .toBe(f.manifest.source_set_sha256);
  f.manifest.source_set_sha256 = '7'.repeat(64);
  expect(() => parseDocumentationSourceContract(f.baseline, bytes(f.manifest))).toThrow('digest');
});

test('boundary changes cannot hide behind unchanged member names', () => {
  const f = fixture();
  const boundary = JSON.parse(f.baseline.toString());
  boundary.scope = 'Different scope';
  expect(() => parseDocumentationSourceContract(bytes(boundary), bytes(f.manifest))).toThrow('boundary bytes');
});

test('cache and index bytes cannot be promoted into authoritative members', () => {
  for (const path of DOCUMENTATION_NON_SOURCE) {
    const f = fixture();
    f.manifest.members.push({ path, bytes: 0, sha256: rawSha256Hex('') });
    f.manifest.members.sort((a, b) => compareDocumentationPaths(a.path, b.path));
    f.manifest.source_set_sha256 = documentationSourceDigest(f.manifest.members);
    expect(() => parseDocumentationSourceContract(f.baseline, bytes(f.manifest))).toThrow('member');
  }
});

test('the new source domain never silently accepts the old schema', () => {
  const f = fixture();
  f.manifest.schema = 'sec.documentation-source-manifest/1';
  expect(() => parseDocumentationSourceContract(f.baseline, bytes(f.manifest))).toThrow('Unsupported');
});

test('path order is UTF-8 scalar order, not UTF-16 order', () => {
  expect(compareDocumentationPaths('docs/\uE000.md', 'docs/\u{10000}.md')).toBeLessThan(0);
});

test('duplicate JSON keys, boolean lengths and negative zero fail closed', () => {
  const f = fixture();
  const text = JSON.stringify(f.manifest);
  expect(() => parseDocumentationSourceContract(
    Buffer.from(f.baseline.toString().replace('"scope":', '"scope":"hidden","scope":')),
    bytes(f.manifest))).toThrow('duplicate');
  expect(() => parseDocumentationSourceContract(f.baseline,
    Buffer.from(text.replace('"members":', '"members":[],"members":')))).toThrow('duplicate');
  expect(() => parseDocumentationSourceContract(f.baseline,
    Buffer.from(text.replace('"bytes":0', '"bytes":true')))).toThrow('member');
  expect(() => parseDocumentationSourceContract(f.baseline,
    Buffer.from(text.replace('"bytes":0', '"bytes":-0')))).toThrow('member');
});

test('unknown fields cannot create a second boundary policy', () => {
  const f = fixture();
  const boundary = JSON.parse(f.baseline.toString());
  boundary.untrustedExclusions = ['docs'];
  expect(() => parseDocumentationSourceContract(bytes(boundary), bytes(f.manifest))).toThrow();
});
