import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  mutateTrustedCheckerSource, observeBundledCheckerIdentityFixture,
  TRUSTED_CHECKER_HOSTILE_MUTATIONS, withTrustedBootstrapCheckerFixture
} from '../helpers/trusted-bootstrap-checker-fixture.ts';

test.serial('trusted checker materialization emits and reads back one bounded exact-source program', async () => {
  await withTrustedBootstrapCheckerFixture(null, async fixture => {
    const result = await fixture.materialize();
    const bytes = await readFile(path.join(fixture.evidenceRoot, 'checker.mjs'));
    expect(result.path).toBe(path.join(fixture.evidenceRoot, 'checker.mjs'));
    expect(result.byteLength).toBe(bytes.length);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(result.byteDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    expect(existsSync(path.join(fixture.evidenceRoot, 'pre-receipt.json'))).toBe(false);
  });
});

test.serial('Bun imported-module identity reads the loaded bundle bytes independently of caller argv', async () => {
  const result = await observeBundledCheckerIdentityFixture();
  expect(result.observedPath).toBe(result.artifactPath);
  expect(result.observedPath).not.toBe(result.sourcePath);
  expect(result.observedDigest).toBe(createHash('sha256').update(result.bundleBytes).digest('hex'));
});

for (const mutation of TRUSTED_CHECKER_HOSTILE_MUTATIONS) {
  test.serial(`trusted checker materialization rejects ${mutation.name}`, async () => {
    await withTrustedBootstrapCheckerFixture(root => mutateTrustedCheckerSource(root, mutation), async fixture => {
      let failure: unknown = null;
      try { await fixture.materialize(); } catch (error) { failure = error; }
      const messages = failure instanceof AggregateError
        ? Array.from(failure.errors, error => error instanceof Error ? error.message : String(error)) : [];
      expect(messages.some(message =>
        message === 'Trusted checker bundle lost its exact native artifact identity site.'
        || message === 'Trusted checker bundle would relocate a source-relative import.meta resource.')).toBe(true);
      expect(existsSync(path.join(fixture.evidenceRoot, 'checker.mjs'))).toBe(false);
    });
  });
}
