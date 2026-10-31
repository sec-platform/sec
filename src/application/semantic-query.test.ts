import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { executeSemanticQuery, prepareSemanticQuery } from './semantic-query.ts';

test('semantic application analysis avoids target loaders and generation requests both loaders', async () => {
  const input = {
    engineeringIRInput: {
      app: { id: 'loader-branch', name: 'loader-branch' },
      resolvedBlocks: [],
      manifests: [],
      acceptanceIds: [],
      policyDeclarations: []
    }
  };
  const calls: string[] = [];
  const unavailable = new Error('test target loader unavailable');
  const operations = {
    async loadGenerator(): Promise<never> { calls.push('generator'); throw unavailable; },
    async loadArtifactIdentity(): Promise<never> { calls.push('identity'); throw unavailable; }
  };
  const analyzed = await executeSemanticQuery(prepareSemanticQuery({ purpose: 'analyze', input }), operations);
  assert.equal(analyzed.purpose, 'analyze');
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeSemanticQuery(prepareSemanticQuery({ purpose: 'generate', input }), operations),
    (error: unknown) => error === unavailable
  );
  assert.deepEqual(calls.sort(), ['generator', 'identity']);
});
