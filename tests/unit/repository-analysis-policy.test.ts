import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  captureRepositoryAnalysisPolicy as capture,
  repositoryAnalysisPolicyDigest as readDigest
} from '../../src/brownfield/source-program-model/repository-analysis-policy.ts';

const a = 'src/alpha.ts::function-declaration:run::spawn#1';
const b = 'src/beta.ts::function-declaration:run::spawn#1';

test('default and explicitly empty analysis inventories have the same exact policy', () => {
  assert.deepEqual(capture(undefined), capture([]));
  const expected = JSON.stringify({ reviewedProcessDispatchers: [], schema: 'sec-repository-analysis-policy-v1' });
  assert.equal(capture([]).policyDigest, `sha256:${createHash('sha256').update(expected).digest('hex')}`);
});

test('inventory order and multiplicity are not independent policy decisions', () => {
  const result = capture([b, a, a]);
  assert.deepEqual(result.reviewedProcessDispatchers, [a, b]);
  assert.deepEqual(result, capture([a, b]));
  assert.notEqual(capture([a]).policyDigest, result.policyDigest);
});

test('capture detaches data without freezing or mutating its caller', () => {
  const input = [b, a], result = capture(input);
  input[0] = 'changed'; input.push('later');
  assert.deepEqual(result.reviewedProcessDispatchers, [a, b]);
  assert.equal(Object.isFrozen(input), false);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.reviewedProcessDispatchers));
  assert.throws(() => (result.reviewedProcessDispatchers as string[]).pop(), TypeError);
});

test('capture does not invoke custom iteration or sparse/accessor elements', () => {
  const input = [a];
  input[Symbol.iterator] = () => [b].values();
  assert.deepEqual(capture(input).reviewedProcessDispatchers, [a]);
  const getter: string[] = [];
  Object.defineProperty(getter, '0', { get() { assert.fail('accessor evaluated'); } });
  for (const value of [new Array(1), getter, [null], [1], null, {}, 'inventory']) {
    assert.throws(() => capture(value as never), TypeError);
  }
});

test('capture does not reinterpret dispatcher address syntax as a new capability', () => {
  // The existing domain owns parsing. This projection preserves strings and
  // never silently canonicalizes a requested path or grants process access.
  for (const value of ['', './src/a.ts::run', 'src\\a.ts::run', 'arbitrary-observation']) {
    assert.deepEqual(capture([value]).reviewedProcessDispatchers, [value]);
  }
});

test('missing, malformed or forged analysis context is not an empty policy', () => {
  const good = capture([a]);
  for (const value of [undefined, null, false, {}, [],
    { ...good, policyDigest: capture([]).policyDigest },
    { ...good, reviewedProcessDispatchers: [b] },
    { ...good, reviewedProcessDispatchers: undefined },
    { ...capture([a, b]), reviewedProcessDispatchers: [b, a] },
    { ...good, reviewedProcessDispatchers: [a, a] }]) {
    assert.equal(readDigest(value), null);
  }
  assert.equal(readDigest(good), good.policyDigest);
  assert.equal(readDigest(JSON.parse(JSON.stringify(good))), good.policyDigest);
  // Plain context equivalence is not receipt or physical authority.
});

test('unreadable context never evaluates declared getters or manufactures comparison evidence', () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(readDigest(proxy), null);
  assert.equal(readDigest({
    get reviewedProcessDispatchers() { assert.fail('context getter'); throw new Error('unreachable'); },
    policyDigest: capture([]).policyDigest
  }), null);
});

test('all small inventory sets have stable order-independent identities', () => {
  const values = [a, b, 'src/gamma.ts::run'];
  const identities = new Set<string>();
  for (let mask = 0; mask < 8; mask++) {
    const selected = values.filter((_, i) => mask & (1 << i));
    const result = capture(selected);
    assert.deepEqual(result, capture([...selected].reverse().concat(selected)));
    identities.add(result.policyDigest);
  }
  assert.equal(identities.size, 8);
});
