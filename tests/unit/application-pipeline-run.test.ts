import { describe, expect, test } from 'bun:test';

import { coordinatePipelineStages, type PipelineUseCaseOperations } from '../../src/application/pipeline-run.ts';
import type { PipelineStageId } from '../../src/compiler/pipeline/stages.ts';

function operations(trace: string[], failAt?: PipelineStageId): PipelineUseCaseOperations {
  const run = <T>(stage: PipelineStageId, value: T) => async (): Promise<T> => {
    trace.push(`run:${stage}`);
    if (stage === failAt) throw new Error(`failed:${stage}`);
    return value;
  };
  return {
    beforeStage: async (stage) => { trace.push(`before:${stage}`); },
    resolve: run('resolve', { plan: { schemaVersion: '1', app: { id: 'x', name: 'x' }, blocks: [], targets: [], acceptance: [] } as never }),
    semantic: run('semantic', { inputRevision: 'sha256:a', semanticRevision: 'sha256:b' } as never),
    compose: run('compose', { plan: { schemaVersion: '1', app: { id: 'x', name: 'x' }, blocks: [], targets: [], acceptance: [] } as never }),
    verify: run('verify', { report: { schemaVersion: '1' } as never }),
    lock: run('lock', undefined),
    emit: run('emit', { lock: {} as never, provenance: {} as never, graph: {} as never, reviewSummary: {} as never })
  };
}

describe('application pipeline coordination', () => {
  test('preserves admitted stage order and records completion only after success', async () => {
    const trace: string[] = [];
    const result = await coordinatePipelineStages(['resolve', 'semantic', 'compose'], operations(trace));
    expect(trace).toEqual([
      'before:resolve', 'run:resolve',
      'before:semantic', 'run:semantic',
      'before:compose', 'run:compose'
    ]);
    expect(result.completedStages).toEqual(['resolve', 'semantic', 'compose']);
    expect(Object.isFrozen(result.completedStages)).toBe(true);
    expect(result.semanticContext).toBeDefined();
    expect(result.plan).toBeDefined();
  });

  test('fails immediately and does not execute a later stage after an operation failure', async () => {
    const trace: string[] = [];
    await expect(coordinatePipelineStages(['resolve', 'semantic', 'compose', 'verify'], operations(trace, 'compose')))
      .rejects.toThrow('failed:compose');
    expect(trace).toEqual([
      'before:resolve', 'run:resolve',
      'before:semantic', 'run:semantic',
      'before:compose', 'run:compose'
    ]);
  });
});
