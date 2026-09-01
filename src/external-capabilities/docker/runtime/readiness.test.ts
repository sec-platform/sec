import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
  observeLocalContainerEngineReadiness
} from './readiness.ts';

test('local Container Engine readiness rejects caller path and mode ambiguity before provider Effects', async () => {
  const relative = await observeLocalContainerEngineReadiness({ cwd: '.' });
  expect(relative).toMatchObject({
    schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
    status: 'unavailable',
    mode: 'observe',
    loginStart: { status: 'unavailable', reason: 'operation-input-invalid' },
    reason: 'invalid-input',
    phase: 'provider-admission'
  });
  if (relative.status !== 'unavailable') throw new Error('Expected typed unavailable result.');
  expect(relative.detailDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

  const invalidMode = await observeLocalContainerEngineReadiness({
    cwd: process.cwd(),
    mode: 'restart' as 'observe'
  });
  expect(invalidMode).toMatchObject({
    status: 'unavailable',
    reason: 'invalid-input',
    phase: 'provider-admission'
  });
});

test('local Container Engine readiness returns a typed provider blocker without fallback', async () => {
  const result = await observeLocalContainerEngineReadiness({
    cwd: path.join(tmpdir(), `sec-container-engine-missing-${randomUUID()}`)
  });
  expect(result).toMatchObject({
    schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
    status: 'unavailable',
    mode: 'observe',
    loginStart: {
      configurationOwner: 'docker-desktop-settings-ui',
      automatedReconciliation: 'unsupported-by-admitted-provider'
    },
    reason: 'command-provider-unavailable',
    phase: 'provider-admission'
  });
});
