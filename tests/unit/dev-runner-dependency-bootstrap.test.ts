import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runCheckAffectedCommand } from '../../src/development/runner/cli.ts';
import { runLocalAffectedCheck } from '../../src/development/runner/check-runner.ts';
import {
  createDependencyFreshProcessHandoff,
  DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV,
  ensureOperationDependencies,
  reuseOperationDependencies
} from '../../src/development/runner/dependency-bootstrap.ts';
import { affectedTestPlanExitCode } from '../../src/development/runner/test-runner.ts';
import { compileSecOperationDemandGraph } from '../../src/control/operation/demand.ts';
import { compilerRoot } from '../../src/workspace/paths.ts';

function compilerReady(source: 'existing' | 'installed') {
  return {
    manifestHash: 'manifest-hash',
    nodeModulesPath: 'compiler-node-modules',
    packageManager: 'bun' as const,
    requiresFreshProcess: source === 'installed',
    root: 'compiler-root',
    source,
    transitionDigest: `sha256:${source === 'installed' ? 'b'.repeat(64) : 'a'.repeat(64)}` as const
  };
}

for (const source of ['existing', 'installed'] as const) {
  test(`dependency bootstrap exposes the manifest-bound compiler tree (${source})`, async () => {
    const hookRoots: string[] = [];
    const result = await ensureOperationDependencies(compileSecOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'always'
    }), {
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(result).toEqual({
      manifestHash: 'manifest-hash',
      nodeModulesPath: 'compiler-node-modules',
      requiresFreshProcess: source === 'installed',
      source,
      transitionDigest: `sha256:${source === 'installed' ? 'b'.repeat(64) : 'a'.repeat(64)}`
    });
    expect(hookRoots).toEqual(['compiler-root']);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`warmed hook policy only closes hooks after compiler installation (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileSecOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'if-installed'
    }), {
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(hookRoots).toEqual(source === 'installed' ? ['compiler-root'] : []);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`active Git hook execution never recursively installs hooks (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileSecOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'never'
    }), {
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot) => {
        hookRoots.push(repoRoot);
      }
    });

    expect(hookRoots).toEqual([]);
  });
}

test('operation demand materializes only the compiler dependency capability', async () => {
  const calls: string[] = [];
  const result = await ensureOperationDependencies(compileSecOperationDemandGraph({
    operation: 'test-fast',
    terminalWorkIds: []
  }), {
    ensureCompilerDeps: async () => {
      calls.push('compiler');
      return compilerReady('existing');
    }
  });

  expect(result).toEqual({
    manifestHash: 'manifest-hash',
    nodeModulesPath: 'compiler-node-modules',
    requiresFreshProcess: false,
    source: 'existing',
    transitionDigest: `sha256:${'a'.repeat(64)}`
  });
  expect(calls).toEqual(['compiler']);
});

test('dependency bootstrap rejects a valid graph that does not demand compiler dependencies', async () => {
  await expect(ensureOperationDependencies(compileSecOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: []
}))).rejects.toThrow('requires an operation demand for compiler-dependency-tree');
});

test('one process-local materialization is reusable only for a covered demand closure', async () => {
  const fastGraph = compileSecOperationDemandGraph({
    operation: 'test-fast',
    terminalWorkIds: []
  });
  const result = await ensureOperationDependencies(fastGraph, {
    ensureCompilerDeps: async () => compilerReady('existing')
  });

  expect(reuseOperationDependencies(result, fastGraph)).toBe(result);
  expect(() => reuseOperationDependencies(result, compileSecOperationDemandGraph({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'always'
  }))).toThrow('does not cover the requested capability closure');
  expect(() => reuseOperationDependencies({ ...result }, fastGraph))
    .toThrow('was not materialized by this process');
});

test('dependency generation transitions require one exact fresh-process handoff', () => {
  const transitioned = compilerReady('installed');
  expect(createDependencyFreshProcessHandoff(transitioned, {})).toEqual({
    schema: 'sec-dependency-fresh-process-handoff-v1',
    transitionDigest: transitioned.transitionDigest
  });
  expect(createDependencyFreshProcessHandoff(compilerReady('existing'), {})).toBeNull();
  expect(() => createDependencyFreshProcessHandoff({
    ...transitioned,
    transitionDigest: 'sha256:not-a-digest'
  } as typeof transitioned, {})).toThrow('transition digest is invalid');
  expect(() => createDependencyFreshProcessHandoff(transitioned, {
    [DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV]: transitioned.transitionDigest
  })).toThrow('repeated the same fresh-process transition');
  expect(() => createDependencyFreshProcessHandoff(transitioned, {
    [DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV]: `sha256:${'c'.repeat(64)}`
  })).toThrow('attempted more than one fresh-process transition');
});

test('check:affected --plan performs zero dependency materialization or fresh-process handoff', async () => {
  const calls: string[] = [];
  const exitCode = await runCheckAffectedCommand(['--plan'], {
    runPlan: async () => {
      calls.push('plan');
      return 0;
    },
    ensureDependencies: async () => {
      calls.push('dependency-effect');
      throw new Error('plan crossed dependency admission');
    },
    handoff: async () => {
      calls.push('handoff-effect');
      throw new Error('plan crossed handoff admission');
    },
    runExecution: async () => {
      calls.push('execution');
      throw new Error('plan crossed execution admission');
    }
  });

  expect(exitCode).toBe(0);
  expect(calls).toEqual(['plan']);
});

test.serial('check:affected --plan full call chain is non-persistent and uses the canonical trust exit', async () => {
  const cachePath = path.join(compilerRoot, '.tmp', 'test-impact-cache.json');
  const cacheBefore = fs.existsSync(cachePath)
    ? Object.freeze({
        bytes: fs.readFileSync(cachePath),
        mtimeMs: fs.statSync(cachePath).mtimeMs
      })
    : null;
  const calls: string[] = [];
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(' '));
  };
  try {
    const exitCode = await runCheckAffectedCommand(['--plan'], {
      runPlan: async () => {
        calls.push('plan');
        return runLocalAffectedCheck(['--plan']);
      },
      ensureDependencies: async () => {
        calls.push('dependency-effect');
        throw new Error('plan crossed dependency admission');
      },
      handoff: async () => {
        calls.push('handoff-effect');
        throw new Error('plan crossed handoff admission');
      },
      runExecution: async () => {
        calls.push('execution');
        throw new Error('plan crossed execution admission');
      }
    });
    const plan = JSON.parse(output.join('\n')) as {
      affectedPlan: Parameters<typeof affectedTestPlanExitCode>[0];
    };
    expect(exitCode).toBe(affectedTestPlanExitCode(plan.affectedPlan));
    expect(calls).toEqual(['plan']);
  } finally {
    console.log = originalLog;
  }

  if (cacheBefore === null) {
    expect(fs.existsSync(cachePath)).toBe(false);
  } else {
    const cacheAfter = fs.statSync(cachePath);
    expect(fs.readFileSync(cachePath)).toEqual(cacheBefore.bytes);
    expect(cacheAfter.mtimeMs).toBe(cacheBefore.mtimeMs);
  }
});
