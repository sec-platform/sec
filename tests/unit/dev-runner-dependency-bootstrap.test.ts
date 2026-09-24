import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeAll, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { compileOperationDemandGraph } from '../../src/adapters/self-hosting/control/operation/demand.ts';
import {
  affectedTestPlanExitCode,
  compileAffectedTestSelectionSemanticOperation
} from '../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import { runLocalAffectedCheck } from '../../src/adapters/self-hosting/development/runner/check-runner.ts';
import {
  handoffDevRunnerToFreshProcess,
  runCheckAffectedCommand
} from '../../src/adapters/self-hosting/development/runner/cli.ts';
import {
  assertMaterializedOperationDependencyBootstrapResult,
  createDependencyFreshProcessHandoff,
  DEV_RUNNER_FRESH_PROCESS_TRANSITION_ENV,
  ensureOperationDependencies,
  reuseOperationDependencies
} from '../../src/adapters/self-hosting/development/runner/dependency-bootstrap.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyMaterializationInput,
  projectCompilerDepsReadyState,
  type CompilerDepsReadyState
} from '../../src/adapters/toolchain/dependencies/runtime.ts';
import { compilerRoot } from "../../src/adapters/workspace-context.ts";

const CROSS_PROCESS_BOOTSTRAP_ROOT = process.env.SEC_DEPENDENCY_BOOTSTRAP_ROOT;
const CROSS_PROCESS_ATTEMPT_LOG = process.env.SEC_DEPENDENCY_BOOTSTRAP_ATTEMPT_LOG;
const CROSS_PROCESS_READY_MARKER = process.env.SEC_DEPENDENCY_BOOTSTRAP_READY_MARKER;
const CROSS_PROCESS_RESULT = process.env.SEC_DEPENDENCY_BOOTSTRAP_RESULT;

let compilerDependencyFixture: CompilerDepsReadyState;

beforeAll(async () => {
  if (CROSS_PROCESS_BOOTSTRAP_ROOT === undefined) {
    const deadlineAtUnixMs = Date.now() + 10_000;
    const authority = await observeCompilerDependencyExecutionGenerationAuthority({
      deadlineAtUnixMs
    });
    if (authority === null) {
      throw new Error('Dependency bootstrap tests require one existing compiler generation authority.');
    }
    compilerDependencyFixture = projectCompilerDepsReadyState(authority);
    return;
  }
  compilerDependencyFixture = Object.freeze({
    executionGenerationAuthority: Object.freeze({
      generationDigest: `sha256:${'d'.repeat(64)}` as const
    }),
    manifestHash: `sha256:${'e'.repeat(64)}`,
    nodeModulesPath: path.join(CROSS_PROCESS_BOOTSTRAP_ROOT, 'node_modules'),
    packageManager: 'bun' as const,
    requiresFreshProcess: false,
    root: CROSS_PROCESS_BOOTSTRAP_ROOT,
    source: 'existing' as const,
    transitionDigest: `sha256:${'f'.repeat(64)}` as const
  });
});

function compilerReady(source: 'existing' | 'installed') {
  return {
    ...compilerDependencyFixture,
    requiresFreshProcess: source === 'installed',
    source,
    transitionDigest: `sha256:${source === 'installed' ? 'b'.repeat(64) : 'a'.repeat(64)}` as const
  };
}

const temporaryBootstrapRoots: string[] = [];
let bootstrapIdentitySequence = 0;

function createBootstrapIdentityRoot(): string {
  bootstrapIdentitySequence += 1;
  const root = fs.mkdtempSync(path.join(tmpdir(), 'sec-dependency-bootstrap-action-'));
  fs.writeFileSync(path.join(root, '.bun-version'), `${process.versions.bun}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    packageManager: `bun@${process.versions.bun}`
  }), 'utf8');
  fs.writeFileSync(
    path.join(root, 'bun.lock'),
    `lockfileVersion = 1\n# identity ${bootstrapIdentitySequence}\n`,
    'utf8'
  );
  temporaryBootstrapRoots.push(root);
  return root;
}

function isolatedBootstrapOptions<T extends Record<string, unknown>>(options: T): T & {
  repositoryRoot: string;
} {
  return { ...options, repositoryRoot: createBootstrapIdentityRoot() };
}

afterEach(() => {
  for (const root of temporaryBootstrapRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dependency runtime projection owns config presence and executable identity', async () => {
  const repositoryRoot = createBootstrapIdentityRoot();
  const absent = await observeCompilerDependencyMaterializationInput(repositoryRoot);
  expect(absent).toMatchObject({
    schema: 'sec-compiler-dependency-materialization-input-v1',
    installConfig: { presence: 'absent' }
  });
  expect(absent.projectionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(absent.toolchain.executableContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(absent.toolchain.executablePathDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(absent.toolchain.executablePhysicalIdentityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

  fs.writeFileSync(path.join(repositoryRoot, 'bunfig.toml'), '[install]\noptional = true\n', 'utf8');
  const present = await observeCompilerDependencyMaterializationInput(repositoryRoot);
  expect(present.installConfig.presence).toBe('present');
  expect(present.installConfig.semanticDigest).not.toBe(absent.installConfig.semanticDigest);
  expect(present.manifestHash).not.toBe(absent.manifestHash);
  expect(present.projectionDigest).not.toBe(absent.projectionDigest);
});

test.skipIf(
  CROSS_PROCESS_BOOTSTRAP_ROOT === undefined
  || CROSS_PROCESS_ATTEMPT_LOG === undefined
  || CROSS_PROCESS_READY_MARKER === undefined
  || CROSS_PROCESS_RESULT === undefined
)('dependency bootstrap child consumes one durable materialization Action', async () => {
  const result = await ensureOperationDependencies(compileOperationDemandGraph({
    operation: 'typecheck',
    terminalWorkIds: []
  }), {
    repositoryRoot: CROSS_PROCESS_BOOTSTRAP_ROOT!,
    deadlineAtUnixMs: Date.now() + 30_000,
    ensureCompilerDeps: async () => {
      if (fs.existsSync(CROSS_PROCESS_READY_MARKER!)) return compilerReady('existing');
      fs.appendFileSync(CROSS_PROCESS_ATTEMPT_LOG!, `${process.pid}\n`, 'utf8');
      await Bun.sleep(250);
      fs.writeFileSync(CROSS_PROCESS_READY_MARKER!, `${process.pid}\n`, {
        encoding: 'utf8',
        flag: 'wx'
      });
      return compilerReady('installed');
    }
  });
  fs.writeFileSync(CROSS_PROCESS_RESULT!, JSON.stringify({
    generationDigest: result.executionGenerationAuthority.generationDigest,
    manifestHash: result.manifestHash,
    source: result.source,
    transitionDigest: result.transitionDigest
  }), 'utf8');
});

async function runDependencyBootstrapChild(input: Readonly<{
  attemptLog: string;
  readyMarker: string;
  repositoryRoot: string;
  resultPath: string;
}>): Promise<void> {
  const child = Bun.spawn([
    process.execPath,
    'test',
    fileURLToPath(import.meta.url),
    '--test-name-pattern',
    '^dependency bootstrap child consumes one durable materialization Action$'
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEC_DEPENDENCY_BOOTSTRAP_ROOT: input.repositoryRoot,
      SEC_DEPENDENCY_BOOTSTRAP_ATTEMPT_LOG: input.attemptLog,
      SEC_DEPENDENCY_BOOTSTRAP_READY_MARKER: input.readyMarker,
      SEC_DEPENDENCY_BOOTSTRAP_RESULT: input.resultPath
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const exitCode = await child.exited;
  const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`;
  expect(exitCode, output).toBe(0);
}

test(
  'dependency bootstrap joins one cross-process materialization, reuses the same generation, and isolates changed lock identity',
  async () => {
    const repositoryRoot = createBootstrapIdentityRoot();
    const attemptLog = path.join(repositoryRoot, 'materialization-attempts.log');
    const firstReady = path.join(repositoryRoot, 'generation-one.ready');
    const firstResult = path.join(repositoryRoot, 'first-result.json');
    const secondResult = path.join(repositoryRoot, 'second-result.json');
    await Promise.all([
      runDependencyBootstrapChild({
        attemptLog,
        readyMarker: firstReady,
        repositoryRoot,
        resultPath: firstResult
      }),
      runDependencyBootstrapChild({
        attemptLog,
        readyMarker: firstReady,
        repositoryRoot,
        resultPath: secondResult
      })
    ]);
    const joinedResults = [firstResult, secondResult].map((resultPath) => (
      JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
        generationDigest: string;
        manifestHash: string;
        source: 'existing' | 'installed';
        transitionDigest: string;
      }
    ));
    expect(fs.readFileSync(attemptLog, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(new Set(joinedResults.map(({ source }) => source))).toEqual(
      new Set(['installed', 'existing'])
    );
    expect(new Set(joinedResults.map(({ generationDigest }) => generationDigest)).size).toBe(1);
    expect(new Set(joinedResults.map(({ manifestHash }) => manifestHash)).size).toBe(1);

    fs.appendFileSync(path.join(repositoryRoot, 'bun.lock'), '# changed dependency input\n', 'utf8');
    const changedReady = path.join(repositoryRoot, 'generation-two.ready');
    const changedResult = path.join(repositoryRoot, 'changed-result.json');
    await runDependencyBootstrapChild({
      attemptLog,
      readyMarker: changedReady,
      repositoryRoot,
      resultPath: changedResult
    });
    expect(fs.readFileSync(attemptLog, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(changedResult, 'utf8'))).toMatchObject({
      source: 'installed'
    });
  },
  60_000
);

for (const source of ['existing', 'installed'] as const) {
  test(`dependency bootstrap exposes the manifest-bound compiler tree (${source})`, async () => {
    const hookRoots: string[] = [];
    const result = await ensureOperationDependencies(compileOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'always'
    }), isolatedBootstrapOptions({
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot: string) => {
        hookRoots.push(repoRoot);
      }
    }));

    expect(result).toEqual({
      executionGenerationAuthority: compilerDependencyFixture.executionGenerationAuthority,
      manifestHash: compilerDependencyFixture.manifestHash,
      nodeModulesPath: compilerDependencyFixture.nodeModulesPath,
      requiresFreshProcess: source === 'installed',
      source,
      transitionDigest: `sha256:${source === 'installed' ? 'b'.repeat(64) : 'a'.repeat(64)}`
    });
    expect(hookRoots).toEqual([compilerDependencyFixture.root]);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`warmed hook policy only closes hooks after compiler installation (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'if-installed'
    }), isolatedBootstrapOptions({
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot: string) => {
        hookRoots.push(repoRoot);
      }
    }));

    expect(hookRoots).toEqual(source === 'installed' ? [compilerDependencyFixture.root] : []);
  });
}

for (const source of ['existing', 'installed'] as const) {
  test(`active Git hook execution never recursively installs hooks (${source})`, async () => {
    const hookRoots: string[] = [];
    await ensureOperationDependencies(compileOperationDemandGraph({
      operation: 'dependency-setup',
      terminalWorkIds: [],
      hookPolicy: 'never'
    }), isolatedBootstrapOptions({
      ensureCompilerDeps: async () => compilerReady(source),
      ensureHooks: async (repoRoot: string) => {
        hookRoots.push(repoRoot);
      }
    }));

    expect(hookRoots).toEqual([]);
  });
}

test('operation demand materializes only the compiler dependency capability', async () => {
  const calls: string[] = [];
  const result = await ensureOperationDependencies(compileOperationDemandGraph({
    operation: 'test-fast',
    terminalWorkIds: []
  }), isolatedBootstrapOptions({
    ensureCompilerDeps: async () => {
      calls.push('compiler');
      return compilerReady('existing');
    }
  }));

  expect(result).toEqual({
    executionGenerationAuthority: compilerDependencyFixture.executionGenerationAuthority,
    manifestHash: compilerDependencyFixture.manifestHash,
    nodeModulesPath: compilerDependencyFixture.nodeModulesPath,
    requiresFreshProcess: false,
    source: 'existing',
    transitionDigest: `sha256:${'a'.repeat(64)}`
  });
  expect(calls).toEqual(['compiler']);
});

test('dependency bootstrap rejects a valid graph that does not demand compiler dependencies', async () => {
  await expect(ensureOperationDependencies(compileOperationDemandGraph({
    operation: 'work-selection-observe',
    terminalWorkIds: []
}))).rejects.toThrow('requires an operation demand for compiler-dependency-tree');
});

test('one process-local materialization is reusable only for a covered demand closure', async () => {
  const fastGraph = compileOperationDemandGraph({
    operation: 'test-fast',
    terminalWorkIds: []
  });
  const result = await ensureOperationDependencies(fastGraph, isolatedBootstrapOptions({
    ensureCompilerDeps: async () => compilerReady('existing')
  }));

  expect(() => assertMaterializedOperationDependencyBootstrapResult(result)).not.toThrow();
  expect(() => assertMaterializedOperationDependencyBootstrapResult(
    Object.freeze({ ...result })
  )).toThrow('was not materialized by this process');
  expect(await handoffDevRunnerToFreshProcess(result)).toBeNull();
  expect(reuseOperationDependencies(result, fastGraph)).toBe(result);
  expect(() => reuseOperationDependencies(result, compileOperationDemandGraph({
    operation: 'dependency-setup',
    terminalWorkIds: [],
    hookPolicy: 'always'
  }))).toThrow('does not cover the requested capability closure');
  expect(() => reuseOperationDependencies({ ...result }, fastGraph))
    .toThrow('was not materialized by this process');
});

test('dependency generation transitions require one exact fresh-process handoff', async () => {
  const transitioned = compilerReady('installed');
  await expect(handoffDevRunnerToFreshProcess(compilerReady('existing')))
    .rejects.toThrow('was not materialized by this process');
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
        return runLocalAffectedCheck(['--plan'], {
          operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' })
        });
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
}, DEFAULT_TEST_TIMEOUT_MS);
