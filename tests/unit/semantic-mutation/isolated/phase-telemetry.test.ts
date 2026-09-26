import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ISOLATED_PHASES,
  readSemanticMutationIsolatedPhaseTelemetry,
  resetSemanticMutationIsolatedExecutionPhaseTelemetry,
  resetSemanticMutationIsolatedPhaseTelemetry,
  isolatedPhaseTelemetryOwnedPaths,
  withSemanticMutationIsolatedPhaseTelemetry,
  type IsolatedPhase
} from '../../../../src/adapters/verification/semantic-mutation/isolated/phase-telemetry.ts';
import { withTempWorkspace } from '../../../testkit/workspace.ts';

const RUNTIME_PRECOMMAND_PHASES = [
  'runtime-test-discovery',
  'runtime-dependency-validation',
  'runtime-process-environment-materialize',
  'runtime-staging-tree-validation'
] as const satisfies readonly IsolatedPhase[];

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('isolated phase telemetry is durable, path-free, reset-scoped, and non-authoritative', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await resetSemanticMutationIsolatedPhaseTelemetry(workspaceRoot);
    for (const phase of RUNTIME_PRECOMMAND_PHASES) {
      expect(ISOLATED_PHASES).toContain(phase);
      const failure = Object.assign(new Error(`sentinel:${phase}`), {
        code: `SENTINEL:${phase}`
      });
      await expect(withSemanticMutationIsolatedPhaseTelemetry(
        workspaceRoot,
        phase,
        async () => {
          throw failure;
        }
      )).rejects.toBe(failure);
    }
    expect(await readSemanticMutationIsolatedPhaseTelemetry(workspaceRoot)).toMatchObject({
      status: 'valid',
      events: RUNTIME_PRECOMMAND_PHASES.flatMap((phase) => [
        { phase, state: 'started', durationMs: 0 },
        { phase, state: 'completed' }
      ])
    });

    const ownedPaths = isolatedPhaseTelemetryOwnedPaths(workspaceRoot);
    expect(ownedPaths).toHaveLength(ISOLATED_PHASES.length * 4);
    const ownedNames = new Set(ownedPaths.map((filePath) => path.basename(filePath)));
    for (const phase of RUNTIME_PRECOMMAND_PHASES) {
      for (const state of ['started', 'completed'] as const) {
        expect(ownedNames.has(
          `${phase}-${state}.json`
        )).toBe(true);
        expect(ownedNames.has(
          `.${phase}-${state}.json`
        )).toBe(true);
      }
    }

    for (const phase of [
      'source-snapshot-revalidate',
      'source-snapshot-capture',
      'source-snapshot-single-flight-wait',
      'runtime-materialize',
      'compile-workspace',
      'unit'
    ] as const satisfies readonly IsolatedPhase[]) {
      await withSemanticMutationIsolatedPhaseTelemetry(workspaceRoot, phase, async () => undefined);
    }

    await resetSemanticMutationIsolatedExecutionPhaseTelemetry(workspaceRoot);
    expect(await readSemanticMutationIsolatedPhaseTelemetry(workspaceRoot)).toMatchObject({
      status: 'valid',
      events: [
        { phase: 'source-snapshot-revalidate', state: 'started', durationMs: 0 },
        { phase: 'source-snapshot-revalidate', state: 'completed' },
        { phase: 'source-snapshot-capture', state: 'started', durationMs: 0 },
        { phase: 'source-snapshot-capture', state: 'completed' },
        { phase: 'source-snapshot-single-flight-wait', state: 'started', durationMs: 0 },
        { phase: 'source-snapshot-single-flight-wait', state: 'completed' }
      ]
    });

    for (const phase of [
      'runtime-materialize',
      'compile-workspace',
      'unit'
    ] as const satisfies readonly IsolatedPhase[]) {
      await withSemanticMutationIsolatedPhaseTelemetry(workspaceRoot, phase, async () => undefined);
    }

    const release = deferred();
    const entered = deferred();
    await resetSemanticMutationIsolatedExecutionPhaseTelemetry(workspaceRoot);
    const running = withSemanticMutationIsolatedPhaseTelemetry(
      workspaceRoot,
      'unit',
      async () => {
        entered.resolve();
        await release.promise;
      }
    );
    await entered.promise;

    const during = await readSemanticMutationIsolatedPhaseTelemetry(workspaceRoot);
    expect(during.status).toBe('valid');
    if (during.status !== 'valid') throw new Error('Phase telemetry was not readable');
    expect(during.events.at(-1)).toEqual({
      formatVersion: 'semantic-mutation-isolated-phase-telemetry-v1',
      phase: 'unit',
      state: 'started',
      durationMs: 0
    });

    const payloads = (await Promise.all(
      isolatedPhaseTelemetryOwnedPaths(workspaceRoot).map(async (filePath) => {
        try {
          return await readFile(filePath, 'utf8');
        } catch {
          return '';
        }
      })
    )).filter(Boolean);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(payload).not.toContain(path.resolve(workspaceRoot));
      expect(payload).not.toMatch(/"(?:path|message|stdout|stderr)"/u);
      expect(Object.keys(JSON.parse(payload) as Record<string, unknown>).sort()).toEqual([
        'durationMs', 'formatVersion', 'phase', 'state'
      ]);
    }

    release.resolve();
    await running;
    const completed = await readSemanticMutationIsolatedPhaseTelemetry(workspaceRoot);
    expect(completed.status).toBe('valid');
    if (completed.status !== 'valid') throw new Error('Completed phase telemetry was not readable');
    expect(completed.events.at(-1)).toMatchObject({
      phase: 'unit',
      state: 'completed'
    });
    expect(completed.events.at(-1)!.durationMs).toBeGreaterThanOrEqual(0);

    const unwritableRoot = path.join(workspaceRoot, 'not-a-directory');
    await writeFile(unwritableRoot, 'occupied', 'utf8');
    expect(await withSemanticMutationIsolatedPhaseTelemetry(
      unwritableRoot,
      'runtime-materialize',
      async () => 42
    )).toBe(42);

    await resetSemanticMutationIsolatedPhaseTelemetry(workspaceRoot);
    expect(await readSemanticMutationIsolatedPhaseTelemetry(workspaceRoot)).toEqual({
      status: 'valid',
      events: []
    });
    for (const filePath of ownedPaths) {
      await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 'engineering-compiler-sm3-phase-telemetry-');
});
