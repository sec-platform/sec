import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
  observeLocalContainerEngineReadiness,
  settleLocalContainerEngineReadinessCompletion
} from './readiness.ts';

test('readiness settlement preserves primary presence and release failure ordering', async () => {
  const primary = new Error('primary readiness failure');
  const release = new Error('journal release failure');
  let dual: unknown;
  try {
    await settleLocalContainerEngineReadinessCompletion({
      completion: Promise.reject(primary),
      release: async () => { throw release; }
    });
  } catch (error) {
    dual = error;
  }
  expect(dual).toBeInstanceOf(AggregateError);
  expect((dual as AggregateError).errors).toEqual([primary, release]);

  let undefinedPrimaryObserved = false;
  try {
    await settleLocalContainerEngineReadinessCompletion({
      completion: Promise.reject(undefined),
      release: async () => {}
    });
  } catch (error) {
    undefinedPrimaryObserved = true;
    expect(error).toBeUndefined();
  }
  expect(undefinedPrimaryObserved).toBe(true);

  let releaseOnly: unknown;
  try {
    await settleLocalContainerEngineReadinessCompletion({
      completion: Promise.resolve('ready'),
      release: async () => { throw release; }
    });
  } catch (error) {
    releaseOnly = error;
  }
  expect(releaseOnly).toBe(release);
});

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
