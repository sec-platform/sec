import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseFrontmatter as directParser, VALID_STATUS as directStatuses, FRONTMATTER_MAX_INPUT_BYTES } from '../../src/control/documentation/doctor/frontmatter.ts';
import { ACTIVE_POINTER_STATUS, parseFrontmatter, VALID_STATUS } from '../../src/control/documentation/doctor/shared.ts';
const wrap = (header: string, body = '# Document\n') => `---\n${header}\n---\n${body}`;

test('all existing document lifecycle values still parse with the same projection', () => {
  for (const status of VALID_STATUS) assert.deepEqual(parseFrontmatter(wrap(`status: ${status}\ndomain: compiler\ngenerated-from: docs/product.md`)),
    { ok: true, status, domain: 'compiler', generatedFrom: 'docs/product.md' });
});

test('active pointer status remains an explicit caller decision', () => {
  assert.equal(parseFrontmatter(wrap('status: conditional')).ok, false);
  assert.equal(parseFrontmatter(wrap('status: conditional'), ACTIVE_POINTER_STATUS).ok, true);
});

for (const header of ['status: stable\nstatus: active', 'status: stable\n"status": active', 'status: stable\ndomain: one\ndomain: two']) {
  test(`duplicate metadata cannot select a different field occurrence: ${JSON.stringify(header)}`, () => {
    const result = parseFrontmatter(wrap(header)); assert.equal(result.ok, false); assert.match(result.reason!, /YAML/);
  });
}

test('quotes, escapes and inline comments follow YAML rather than a one-token regex', () => {
  const result = parseFrontmatter(wrap('status: "act\\u0069ve" # comment\ndomain: "compiler # details"\ngenerated-from: "docs/a b.md"'));
  assert.deepEqual(result, { ok: true, status: 'active', domain: 'compiler # details', generatedFrom: 'docs/a b.md' });
});

test('scalar block syntax is parsed by YAML, not a regex approximation', () => {
  const result = parseFrontmatter(wrap('status: |-\n  stable\ndomain: >-\n  language\n  tools'));
  assert.equal(result.ok, true); assert.equal(result.domain, 'language tools');
});

test('headers retain CRLF and comments while unrelated metadata does not become a second schema owner', () => {
  const result = parseFrontmatter(wrap('title: Document\n# header comment\nstatus: active\ncustom: {owner: another}').replaceAll('\n', '\r\n'));
  assert.equal(result.ok, true); assert.equal(result.domain, undefined);
});

test('plain boolean/string distinction, malformed tags and unfinished YAML are rejected', () => {
  for (const header of ['status: true', 'status: [stable]', 'status: !unknown stable', 'status: "stable', 'status: active\ndomain: [compiler]']) {
    assert.equal(parseFrontmatter(wrap(header)).ok, false);
  }
});

test('only the header is parsed and byte-limited; code examples in the body do not alter status', () => {
  const body = '```yaml\nstatus: wrong\n```\n' + 'x'.repeat(FRONTMATTER_MAX_INPUT_BYTES * 2);
  assert.equal(parseFrontmatter(wrap('status: active', body)).status, 'active');
  assert.equal(parseFrontmatter(wrap('status: active\n#' + '好'.repeat(FRONTMATTER_MAX_INPUT_BYTES))).ok, false);
});

test('missing or unterminated envelopes stay ordinary doctor issues, not thrown parse errors', () => {
  assert.deepEqual(parseFrontmatter('# No header'), { ok: false, reason: 'missing frontmatter' });
  assert.deepEqual(parseFrontmatter('---\nstatus: active'), { ok: false, reason: 'unterminated frontmatter' });
  assert.equal(parseFrontmatter('---\n---\n# Empty header').ok, false);
});

test('shared public exports are the same parser and status policy, not a second implementation', () => {
  assert.equal(parseFrontmatter, directParser); assert.equal(VALID_STATUS, directStatuses);
});
