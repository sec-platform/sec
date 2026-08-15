import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  acquireHeavyVerificationGateLease,
  heavyVerificationGateMutexName
} from '../../platform/shared/heavy-verification-gate-lease.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import {
  DEV_RUNNER_EXECUTABLE_SOURCE_EXTENSIONS,
  DEV_RUNNER_HOST_MANIFEST_MAX_BYTES,
  DEV_RUNNER_HOST_MODULE_MAX_COUNT,
  DEV_RUNNER_HOST_SOURCE_MAX_BYTES,
  DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES,
  analyzeDevRunnerAuthorityProof,
  assertDevRunnerHostBudget,
  canonicalDevRunnerScenarioProjection,
  compareCanonicalText,
  devRunnerScenarioModuleId,
  isDevRunnerExecutableSource,
  isTrackedDevRunnerHostSource,
  type DevRunnerAuthorityProofSuite,
  type DevRunnerAuthorityScenario,
  type DevRunnerPackageSurface,
  type DevRunnerScenarioModule
} from '../helpers/dev-runner-authority-proof.ts';

function jsonProgramSource(value: unknown): string {
  const source = JSON.stringify(value);
  if (source === undefined) throw new Error('Program suite JSON source is not serializable.');
  return source;
}

function exactRevisionReplacement(input: {
  readonly decoderOptions?: string;
  readonly pattern?: string;
  readonly returnSource?: string;
} = {}): string {
  if (input.returnSource !== undefined) {
    return `function exactRevision(stdout: Uint8Array): string | null {
  ${input.returnSource}
}`;
  }
  return `function exactRevision(stdout: Uint8Array): string | null {
  try {
    const value = new TextDecoder('utf-8', ${input.decoderOptions ?? '{ fatal: true }'})
      .decode(stdout).trim();
    return ${input.pattern ?? '/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u'}.test(value) ? value : null;
  } catch {
    return null;
  }
}`;
}

function boundedOwnerReplacement(input: {
  readonly baseRefInitializer?: string;
  readonly modulePrelude?: string;
  readonly boundedPrelude?: string;
  readonly diffArguments?: string;
  readonly exactRevisionSource?: string;
  readonly gitChangedExtra?: string;
  readonly gitChangedPrelude?: string;
  readonly gitChangedOwnerPrefix?: string;
  readonly moduleEnvironmentMutation?: string;
  readonly pathBlobArguments?: string;
  readonly resolveAffectedPrelude?: string;
  readonly dispatch?: string;
  readonly fastCalls?: string;
  readonly exportBounded?: boolean;
} = {}): string {
  return `
import { runCommandBytes } from '../shared/process.ts';
import {
  gitChangedFileDiffArgs,
  gitPathBlobArgs,
  gitUntrackedFileArgs,
  parseGitChangedRecordsOutput
} from '../shared/ci-git-changed-files.ts';
import { uniqueSorted } from '../shared/collections.ts';
import { compilerRoot } from '../shared/paths.ts';
import { runDevCommand } from './command-runner.ts';
${input.modulePrelude ?? ''}
${input.moduleEnvironmentMutation ?? ''}
function affectedTestsBaseRef(): string | undefined {
  return process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE;
}
${input.exactRevisionSource ?? exactRevisionReplacement()}
${input.gitChangedOwnerPrefix ?? 'async function'} gitChangedFiles(): Promise<void> {
  ${input.gitChangedPrelude ?? ''}
  const baseRef = ${input.baseRefInitializer ?? 'affectedTestsBaseRef()'};
  const [baseRevision, headRevision] = baseRef === undefined
    ? [null, null]
    : await Promise.all([
        runCommandBytes('git', ['rev-parse', '--verify', \`\${baseRef}^{commit}\`], { cwd: compilerRoot }),
        runCommandBytes('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: compilerRoot })
      ]);
  const baseSha = baseRevision?.code === 0 ? exactRevision(baseRevision.stdout) : null;
  const headSha = headRevision?.code === 0 ? exactRevision(headRevision.stdout) : null;
  const [tracked, untracked] = await Promise.all([
    runCommandBytes(
      'git',
      gitChangedFileDiffArgs(${input.diffArguments ?? "baseSha ?? undefined, headSha ?? 'HEAD'"}),
      { cwd: compilerRoot }
    ),
    runCommandBytes('git', gitUntrackedFileArgs(), { cwd: compilerRoot })
  ]);
  const records = parseGitChangedRecordsOutput(tracked.stdout);
  const removedPaths = uniqueSorted(records
    .filter((record) => record.status === 'removed')
    .map((record) => record.path));
  for (const repositoryPath of removedPaths) {
    for (const revision of [baseSha, headSha]) {
      await runCommandBytes(
        'git',
        gitPathBlobArgs(${input.pathBlobArguments ?? 'revision, repositoryPath'}),
        { cwd: compilerRoot }
      );
    }
  }
  void untracked;
  ${input.gitChangedExtra ?? ''}
}
export async function scheduleBoundedFastTestInvocations<T>(
  values: readonly T[],
  concurrency: number,
  dispatch: (value: T) => Promise<unknown>,
  isFailure: (value: unknown) => boolean
): Promise<null> {
  void concurrency;
  void isFailure;
  for (const value of values) await dispatch(value);
  return null;
}
${input.exportBounded ? 'export ' : ''}async function runBoundedFastTestInvocations(
  invocations: readonly unknown[] = [],
  env: Record<string, string> = {},
  concurrency = 1
): Promise<number> {
  ${input.boundedPrelude ?? ''}
  await scheduleBoundedFastTestInvocations(
    invocations,
    concurrency,
    () => ${input.dispatch ?? "runDevCommand('bun', [], env, { observe: true })"},
    () => false
  );
  return 0;
}
export async function runFastTests(): Promise<number> {
  ${input.fastCalls ?? `
  await runBoundedFastTestInvocations();
  await runBoundedFastTestInvocations();`}
  return 0;
}
export async function resolveAffectedTestExecution(): Promise<void> {
  ${input.resolveAffectedPrelude ?? ''}
  await gitChangedFiles();
}
`;
}

function commandOwnerReplacement(input: { readonly suffix?: string } = {}): string {
  return `
import { spawn } from 'node:child_process';
export function runDevCommand(): void {
  spawn('bun', [], { shell: false });
}
${input.suffix ?? ''}
`;
}

const STANDARD_PROCESS_OWNER_SOURCE = `
export async function runCommandBytes(..._args: unknown[]): Promise<{
  code: number;
  stdout: Uint8Array;
}> { return { code: 0, stdout: new Uint8Array() }; }
export function runCommand(..._args: unknown[]): void {}
export async function runCommandWithRetry(..._args: unknown[]): Promise<void> {}
`;
const STANDARD_FAST_POLICY_SOURCE = `
export const DEFAULT_FAST_TEST_CONCURRENCY_BUDGET = 1;
`;
const STANDARD_CONCURRENCY_POLICY_SOURCE = `
export const PROJECTED_FAST_TEST_CONCURRENCY = 1;
`;

interface ScenarioCatalogInput {
  readonly scenarioId: string;
  readonly label: string;
  readonly boundedSource?: string;
  readonly commandSource?: string;
  readonly extraModules?: readonly DevRunnerScenarioModule[];
  readonly packageSurfaces?: readonly DevRunnerPackageSurface[];
  readonly expectedValidation: DevRunnerAuthorityScenario['expectedValidation'];
  readonly expectedViolationCodes?: readonly string[];
}

function createVirtualScenario(input: ScenarioCatalogInput): DevRunnerAuthorityScenario {
  const moduleScope = `__contract__/scenario/${input.scenarioId}`;
  const modules = new Map<string, DevRunnerScenarioModule>();
  const addModule = (logicalPath: string, source: string): void => {
    if (modules.has(logicalPath)) {
      throw new Error(`Scenario ${input.scenarioId} contains duplicate module ${logicalPath}.`);
    }
    modules.set(logicalPath, { logicalPath, source });
  };
  addModule(
    'platform/dev-runner/command-runner.ts',
    input.commandSource ?? commandOwnerReplacement()
  );
  addModule(
    'platform/dev-runner/test-runner.ts',
    input.boundedSource ?? boundedOwnerReplacement()
  );
  addModule('platform/shared/process.ts', STANDARD_PROCESS_OWNER_SOURCE);
  addModule(
    'platform/shared/ci-git-changed-files.ts',
    `
export function gitChangedFileDiffArgs(..._args: unknown[]): string[] { return []; }
export function gitPathBlobArgs(..._args: unknown[]): string[] { return []; }
export function gitUntrackedFileArgs(): string[] { return []; }
export function parseGitChangedRecordsOutput(_stdout: Uint8Array): Array<{
  status: string;
  path: string;
}> { return []; }
`
  );
  addModule(
    'platform/shared/collections.ts',
    'export function uniqueSorted<T>(values: readonly T[]): T[] { return [...values]; }'
  );
  addModule('platform/shared/paths.ts', "export const compilerRoot = '.';");
  addModule('platform/dev-runner/fast-test-policy.ts', STANDARD_FAST_POLICY_SOURCE);
  addModule(
    'platform/dev-runner/test-concurrency-policy.ts',
    STANDARD_CONCURRENCY_POLICY_SOURCE
  );
  for (const module of input.extraModules ?? []) addModule(module.logicalPath, module.source);
  return {
    scenarioId: input.scenarioId,
    label: input.label,
    moduleScope,
    commandOwnerModuleId: devRunnerScenarioModuleId(
      input.scenarioId,
      'platform/dev-runner/command-runner.ts'
    ),
    boundedOwnerModuleId: devRunnerScenarioModuleId(
      input.scenarioId,
      'platform/dev-runner/test-runner.ts'
    ),
    processOwnerModuleId: devRunnerScenarioModuleId(
      input.scenarioId,
      'platform/shared/process.ts'
    ),
    policyOwnerModuleIds: [
      devRunnerScenarioModuleId(input.scenarioId, 'platform/dev-runner/fast-test-policy.ts'),
      devRunnerScenarioModuleId(
        input.scenarioId,
        'platform/dev-runner/test-concurrency-policy.ts'
      )
    ],
    modules: [...modules.values()].sort((left, right) =>
      compareCanonicalText(left.logicalPath, right.logicalPath)),
    packageSurfaces: [...(input.packageSurfaces ?? [])].sort((left, right) =>
      compareCanonicalText(left.relativePath, right.relativePath)),
    expectedValidation: input.expectedValidation,
    expectedViolationCodes: [...(input.expectedViolationCodes ?? [])]
      .sort(compareCanonicalText)
  };
}

const EXPECTED_SCENARIO_IDS = Object.freeze([
  'alternate-shared-dispatcher',
  'available-parallelism-import',
  'bun-env-prewrite',
  'bun-module-dollar-import',
  'bun-module-named-env-prewrite',
  'bun-module-namespace-env-prewrite',
  'bun-module-spawn-import',
  'bun-module-spawn-sync-import',
  'bun-reflect-destructure',
  'changed-files-exported-owner',
  'changed-files-owner-env-prewrite',
  'changed-files-reexported-owner',
  'command-child-alias',
  'command-child-export',
  'command-child-pass',
  'command-namespace-acquisition',
  'commonjs-named-star-barrels',
  'commonjs-require-alias-destructure',
  'cross-live-import',
  'cross-scenario-import',
  'cyclic-multilevel-barrels',
  'default-through-named-barrel',
  'deno-global-this',
  'diff-builder-same-head',
  'diff-builder-undefined-base',
  'dynamic-env-prewrite',
  'dynamic-git-operation-args',
  'dynamic-immutable-template-specifier',
  'esm-named-import',
  'esm-namespace-import',
  'external-bun-star-benign-barrel',
  'external-bun-star-env-barrel',
  'external-bun-star-spawn-barrel',
  'external-bun-star-transitive-shell-barrel',
  'extra-mutating-git-operation',
  'extra-shared-bytes-dispatch',
  'factory-returned-dispatch',
  'forged-base-ref-provenance',
  'forged-revision-constant',
  'forged-revision-decoder',
  'forged-revision-pattern',
  'global-process-env-alias-prewrite',
  'global-process-env-prewrite',
  'global-process-slot-assign-prewrite',
  'global-process-slot-define-prewrite',
  'global-process-slot-node-alias-prewrite',
  'global-process-slot-reflect-prewrite',
  'global-process-slot-self-alias-assign-prewrite',
  'global-process-slot-self-alias-define-prewrite',
  'global-process-slot-self-alias-reflect-prewrite',
  'higher-order-dispatch',
  'import-equals-child-namespace',
  'import-equals-namespace',
  'import-meta-dynamic-property',
  'import-meta-env-alias-prewrite',
  'import-meta-env-prewrite',
  'import-meta-identity-mutation',
  'import-meta-safe-identities',
  'import-meta-unknown-property',
  'import-meta-whole-alias',
  'js-extension-ts-index',
  'live',
  'local-wrapper-dispatch',
  'module-env-alias-prewrite',
  'module-initializer-env-prewrite',
  'module-require-namespace',
  'module-second-reviewed-dispatch',
  'mutable-dynamic-module-specifier',
  'mutable-loader-target-fails-closed',
  'node-child-named-import',
  'node-process-default-env-prewrite',
  'node-process-named-env-prewrite',
  'package-barrel-surface',
  'package-import-require-conditions',
  'parser-exported-authority',
  'parser-imported-authority',
  'parser-reexported-authority',
  'path-blob-swapped-subject',
  'policy-alias-chain',
  'process-builtin-loader',
  'process-environment-read',
  'public-syntactic-diagnostics',
  'reviewed-dispatch-alias',
  'safe-runtime-consumers',
  'valid-bounded-owner',
  'valid-command-owner',
  'wrapper-consumer',
  'wrapper-env-prewrite'
] as const);

function buildProgramProofCatalog(packageJson: unknown): readonly DevRunnerAuthorityScenario[] {
  const scenarios: DevRunnerAuthorityScenario[] = [{
    scenarioId: 'live',
    label: 'complete live host',
    moduleScope: '',
    commandOwnerModuleId: 'platform/dev-runner/command-runner.ts',
    boundedOwnerModuleId: 'platform/dev-runner/test-runner.ts',
    processOwnerModuleId: 'platform/shared/process.ts',
    policyOwnerModuleIds: [
      'platform/dev-runner/fast-test-policy.ts',
      'platform/dev-runner/test-concurrency-policy.ts'
    ],
    modules: [],
    packageSurfaces: [{ relativePath: 'package.json', value: packageJson }],
    expectedValidation: 'accepted',
    expectedViolationCodes: []
  }];
  const add = (input: ScenarioCatalogInput): void => {
    scenarios.push(createVirtualScenario(input));
  };

  add({
    scenarioId: 'valid-bounded-owner',
    label: 'valid bounded owner replacement',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: `
        const process = { env: 'ordinary' };
        const Bun = { spawn: 'ordinary' };
        void process.env;
        void Bun.spawn;
      `
    }),
    expectedValidation: 'accepted'
  });
  for (const input of [
    {
      scenarioId: 'reviewed-dispatch-alias',
      label: 'reviewed dispatch alias',
      source: boundedOwnerReplacement({
        modulePrelude: 'const start = runDevCommand;',
        dispatch: "start('bun', [], env, { observe: true })"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'local-wrapper-dispatch',
      label: 'local wrapper dispatch',
      source: boundedOwnerReplacement({
        modulePrelude: `
          const start = (...args: Parameters<typeof runDevCommand>) => runDevCommand(...args);
        `,
        dispatch: "start('bun', [], env, { observe: true })"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'factory-returned-dispatch',
      label: 'factory returned dispatch',
      source: boundedOwnerReplacement({
        modulePrelude: 'const makeStart = () => runDevCommand; const start = makeStart();',
        dispatch: "start('bun', [], env, { observe: true })"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'higher-order-dispatch',
      label: 'higher order dispatch',
      source: boundedOwnerReplacement({
        modulePrelude: `
          const invoke = (start: typeof runDevCommand) => start('bun', [], {}, { observe: true });
        `,
        dispatch: 'invoke(runDevCommand)'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'node-child-named-import',
      label: 'node child named import',
      source: boundedOwnerReplacement({
        modulePrelude: "import { spawn as start } from 'node:child_process';",
        boundedPrelude: 'void start;'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'import-equals-child-namespace',
      label: 'import equals child namespace',
      source: boundedOwnerReplacement({
        modulePrelude: "import child = require('node:child_process');",
        boundedPrelude: 'void child.spawn;'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'bun-reflect-destructure',
      label: 'Bun Reflect destructure',
      source: boundedOwnerReplacement({
        boundedPrelude: "const { spawn: start } = Bun; void Reflect.get({ start }, 'start');"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'deno-global-this',
      label: 'Deno through globalThis',
      source: boundedOwnerReplacement({
        boundedPrelude: 'const start = globalThis.Deno.Command; void start;'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'process-builtin-loader',
      label: 'process builtin loader',
      source: boundedOwnerReplacement({
        boundedPrelude: "const child = process.getBuiltinModule('node:child_process'); void child;"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'process-environment-read',
      label: 'process environment read',
      source: boundedOwnerReplacement({
        boundedPrelude: 'void process.env.SEC_FAST_TEST_CONCURRENCY;'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'available-parallelism-import',
      label: 'available parallelism import',
      source: boundedOwnerReplacement({
        modulePrelude: "import { availableParallelism } from 'node:os';",
        boundedPrelude: 'void availableParallelism();'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'policy-alias-chain',
      label: 'policy alias chain',
      source: boundedOwnerReplacement({
        modulePrelude: [
          "import { DEFAULT_FAST_TEST_CONCURRENCY_BUDGET } from './fast-test-policy.ts';",
          'const selectedBudget = DEFAULT_FAST_TEST_CONCURRENCY_BUDGET;',
          'const forwardedBudget = selectedBudget;'
        ].join('\n'),
        boundedPrelude: 'void forwardedBudget;'
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'mutable-dynamic-module-specifier',
      label: 'mutable dynamic module specifier',
      source: boundedOwnerReplacement({
        boundedPrelude: "let target = 'node:child_process'; target += ''; await import(target);"
      }),
      code: 'UNTRUSTED_SPECIFIER'
    },
    {
      scenarioId: 'alternate-shared-dispatcher',
      label: 'alternate shared dispatcher',
      source: boundedOwnerReplacement({
        modulePrelude: "import { runCommand } from '../shared/process.ts';",
        boundedPrelude: "void runCommand('git', ['status']);"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'module-second-reviewed-dispatch',
      label: 'module second reviewed dispatch',
      source: boundedOwnerReplacement({
        modulePrelude: "void runDevCommand('bun', [], {}, { observe: true });"
      }),
      code: 'BOUNDED_OWNER_CONTRACT'
    },
    {
      scenarioId: 'diff-builder-same-head',
      label: 'approved diff builder receives head as both subjects',
      source: boundedOwnerReplacement({
        diffArguments: "headSha ?? undefined, headSha ?? 'HEAD'"
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'diff-builder-undefined-base',
      label: 'approved diff builder discards the observed base subject',
      source: boundedOwnerReplacement({
        diffArguments: "undefined, headSha ?? 'HEAD'"
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'dynamic-git-operation-args',
      label: 'dynamic Git operation args in the exact process owner',
      source: boundedOwnerReplacement({
        gitChangedExtra: "const args = ['show']; await runCommandBytes('git', args, { cwd: compilerRoot });"
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'extra-mutating-git-operation',
      label: 'mutating Git operation in the exact process owner',
      source: boundedOwnerReplacement({
        gitChangedExtra: "await runCommandBytes('git', ['clean', '-fdx'], { cwd: compilerRoot });"
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'forged-base-ref-provenance',
      label: 'base ref name retains a forged constant source',
      source: boundedOwnerReplacement({ baseRefInitializer: "'HEAD'" }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'forged-revision-constant',
      label: 'exact revision parser returns one forged constant SHA',
      source: boundedOwnerReplacement({
        exactRevisionSource: exactRevisionReplacement({
          returnSource: "void stdout; return 'a'.repeat(40);"
        })
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'forged-revision-decoder',
      label: 'exact revision parser disables fatal UTF-8 decoding',
      source: boundedOwnerReplacement({
        exactRevisionSource: exactRevisionReplacement({ decoderOptions: '{}' })
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'forged-revision-pattern',
      label: 'exact revision parser accepts unbounded lowercase hex',
      source: boundedOwnerReplacement({
        exactRevisionSource: exactRevisionReplacement({ pattern: '/^[0-9a-f]+$/u' })
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'path-blob-swapped-subject',
      label: 'approved path blob builder swaps revision and path subjects',
      source: boundedOwnerReplacement({ pathBlobArguments: 'repositoryPath, revision' }),
      code: 'PROCESS_OWNER_CONTRACT'
    },
    {
      scenarioId: 'extra-shared-bytes-dispatch',
      label: 'extra shared bytes dispatch',
      source: boundedOwnerReplacement({
        boundedPrelude: "void runCommandBytes('git', ['rev-parse'], {});"
      }),
      code: 'PROCESS_OWNER_CONTRACT'
    }
  ] as const) {
    add({
      scenarioId: input.scenarioId,
      label: input.label,
      boundedSource: input.source,
      expectedValidation: 'rejected',
      expectedViolationCodes: [input.code]
    });
  }

  add({
    scenarioId: 'changed-files-exported-owner',
    label: 'changed file observation owner is directly exported',
    boundedSource: boundedOwnerReplacement({
      gitChangedOwnerPrefix: 'export async function'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'changed-files-reexported-owner',
    label: 'changed file observation owner is separately renamed and exported',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: 'export { gitChangedFiles as observeChangedFiles };'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'changed-files-owner-env-prewrite',
    label: 'changed file observation owner overwrites its base environment',
    boundedSource: boundedOwnerReplacement({
      gitChangedPrelude: "process.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'dynamic-env-prewrite',
    label: 'dynamic environment access may overwrite the changed file base',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const affectedBaseKey = 'SEC_' + 'CHANGED_BASE';",
        "process.env[affectedBaseKey] = 'HEAD';"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-safe-identities',
    label: 'frozen Bun import meta scalar identities remain readable',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: [
        'void import.meta.url;',
        'void import.meta.path;',
        'void import.meta.dir;',
        'void import.meta.file;',
        'void import.meta.main;',
        'void import.meta.dirname;',
        'void import.meta.filename;'
      ].join('\n')
    }),
    expectedValidation: 'accepted'
  });
  add({
    scenarioId: 'import-meta-unknown-property',
    label: 'unclassified import meta property is not ordinary identity',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: 'void import.meta.futureIdentity;'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-dynamic-property',
    label: 'dynamic import meta property cannot escape the closed identity vocabulary',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: [
        "let importMetaKey = 'url';",
        "importMetaKey += '';",
        'void import.meta[importMetaKey];'
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-identity-mutation',
    label: 'reviewed import meta identity remains immutable',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: "import.meta.url = 'file:///forged.ts';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-whole-alias',
    label: 'whole import meta namespace cannot escape the closed property vocabulary',
    boundedSource: boundedOwnerReplacement({
      boundedPrelude: 'const runtimeMeta = import.meta; void runtimeMeta;'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-env-prewrite',
    label: 'Bun environment acquisition overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: "Bun.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'external-bun-star-benign-barrel',
    label: 'external Bun star barrel leaves benign named exports unprivileged',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { file as bunFile } from './bun-barrel.ts';",
      boundedPrelude: 'void bunFile;'
    }),
    extraModules: [{
      logicalPath: 'platform/dev-runner/bun-barrel.ts',
      source: "export * from 'bun';"
    }],
    expectedValidation: 'accepted'
  });
  add({
    scenarioId: 'external-bun-star-env-barrel',
    label: 'external Bun star barrel retains named environment authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { env as runtimeEnvironment } from './bun-barrel.ts';",
      moduleEnvironmentMutation: "runtimeEnvironment.SEC_CHANGED_BASE = 'HEAD';"
    }),
    extraModules: [{
      logicalPath: 'platform/dev-runner/bun-barrel.ts',
      source: "export * from 'bun';"
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'external-bun-star-spawn-barrel',
    label: 'external Bun star barrel retains named child authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { spawn as start } from './bun-barrel.ts';",
      boundedPrelude: 'void start;'
    }),
    extraModules: [{
      logicalPath: 'platform/dev-runner/bun-barrel.ts',
      source: "export * from 'bun';"
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['BOUNDED_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'external-bun-star-transitive-shell-barrel',
    label: 'transitive external Bun star barrel retains named shell authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { $ as shell } from './bun-barrel-two.ts';",
      boundedPrelude: 'void shell;'
    }),
    extraModules: [
      {
        logicalPath: 'platform/dev-runner/bun-barrel-one.ts',
        source: "export * from 'bun';"
      },
      {
        logicalPath: 'platform/dev-runner/bun-barrel-two.ts',
        source: "export * from './bun-barrel-one.ts';"
      }
    ],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['BOUNDED_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-module-dollar-import',
    label: 'Bun module named shell export retains child authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { $ as shell } from 'bun';",
      boundedPrelude: 'void shell;'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['BOUNDED_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-module-named-env-prewrite',
    label: 'Bun module named environment export overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { env as runtimeEnvironment } from 'bun';",
      moduleEnvironmentMutation:
        "runtimeEnvironment.SEC_CHANGED_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-module-spawn-import',
    label: 'Bun module named spawn export retains child authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { spawn as start } from 'bun';",
      boundedPrelude: 'void start;'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['BOUNDED_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-module-spawn-sync-import',
    label: 'Bun module named spawnSync export retains child authority',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { spawnSync as start } from 'bun';",
      boundedPrelude: 'void start;'
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['BOUNDED_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'bun-module-namespace-env-prewrite',
    label: 'Bun module namespace environment export overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import * as BunRuntime from 'bun';",
      moduleEnvironmentMutation:
        "BunRuntime.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-env-prewrite',
    label: 'import meta environment acquisition overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: "import.meta.env.SEC_CHANGED_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'import-meta-env-alias-prewrite',
    label: 'import meta environment alias overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        'const runtimeEnvironment = import.meta.env;',
        "runtimeEnvironment.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'module-env-alias-prewrite',
    label: 'module initializer aliases and overwrites the process environment',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        'const mutableEnvironment = process.env;',
        "mutableEnvironment.SEC_CHANGED_BASE = 'HEAD';"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'module-initializer-env-prewrite',
    label: 'module initializer overwrites the changed file base environment',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: "process.env.SEC_CHANGED_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'wrapper-env-prewrite',
    label: 'only changed file observation wrapper overwrites its base environment',
    boundedSource: boundedOwnerReplacement({
      resolveAffectedPrelude: "process.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-env-prewrite',
    label: 'canonical global process path overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation:
        "globalThis.process.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-env-alias-prewrite',
    label: 'canonical global process path is aliased before an environment overwrite',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        'const runtimeProcess = globalThis.process;',
        "runtimeProcess.env.SEC_CHANGED_BASE = 'HEAD';"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-node-alias-prewrite',
    label: 'node global alias replaces the canonical process slot',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        'Object.assign(global, { process: forgedProcess });'
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-assign-prewrite',
    label: 'object property copy replaces the canonical global process slot',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        'Object.assign(globalThis, { process: forgedProcess });'
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-self-alias-assign-prewrite',
    label: 'global self alias cannot hide an object property-copy process replacement',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        'Object.assign((globalThis as any).globalThis, { process: forgedProcess });'
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-self-alias-define-prewrite',
    label: 'global self alias cannot hide a property-definition process replacement',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        "Object.defineProperty((globalThis as any).globalThis, 'process', { value: forgedProcess });"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-self-alias-reflect-prewrite',
    label: 'global self alias cannot hide a reflective process replacement',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        "Reflect.set((globalThis as any).globalThis, 'process', forgedProcess);"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-define-prewrite',
    label: 'property definition replaces the canonical global process slot',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        "Object.defineProperty(globalThis, 'process', { value: forgedProcess });"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'global-process-slot-reflect-prewrite',
    label: 'reflective write replaces the canonical global process slot',
    boundedSource: boundedOwnerReplacement({
      moduleEnvironmentMutation: [
        "const forgedProcess = { env: { SEC_CHANGED_BASE: 'HEAD' } };",
        "Reflect.set(globalThis, 'process', forgedProcess);"
      ].join('\n')
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'node-process-default-env-prewrite',
    label: 'node process default import overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import runtimeProcess from 'node:process';",
      moduleEnvironmentMutation:
        "runtimeProcess.env.SEC_AFFECTED_TESTS_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'node-process-named-env-prewrite',
    label: 'node process named environment import overwrites the changed file base',
    boundedSource: boundedOwnerReplacement({
      modulePrelude: "import { env as runtimeEnvironment } from 'node:process';",
      moduleEnvironmentMutation:
        "runtimeEnvironment.SEC_CHANGED_BASE = 'HEAD';"
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'parser-exported-authority',
    label: 'exact revision parser is exported from the bounded owner module',
    boundedSource: boundedOwnerReplacement({
      exactRevisionSource: exactRevisionReplacement().replace(
        'function exactRevision',
        'export function exactRevision'
      )
    }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'parser-imported-authority',
    label: 'exact revision parser is imported from another module',
    boundedSource: boundedOwnerReplacement({
      exactRevisionSource: '',
      modulePrelude: "import { exactRevision } from './exact-revision.ts';"
    }),
    extraModules: [{
      logicalPath: 'platform/dev-runner/exact-revision.ts',
      source: exactRevisionReplacement().replace(
        'function exactRevision',
        'export function exactRevision'
      )
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });
  add({
    scenarioId: 'parser-reexported-authority',
    label: 'private exact revision parser is re-exported by name',
    boundedSource: boundedOwnerReplacement({ modulePrelude: 'export { exactRevision };' }),
    expectedValidation: 'rejected',
    expectedViolationCodes: ['PROCESS_OWNER_CONTRACT']
  });

  add({
    scenarioId: 'valid-command-owner',
    label: 'valid command owner replacement',
    expectedValidation: 'accepted'
  });
  for (const input of [
    {
      scenarioId: 'command-child-alias',
      label: 'command child alias',
      source: commandOwnerReplacement({ suffix: 'const start = spawn; void start;' })
    },
    {
      scenarioId: 'command-child-export',
      label: 'command child export',
      source: commandOwnerReplacement({ suffix: 'export { spawn };' })
    },
    {
      scenarioId: 'command-child-pass',
      label: 'command child pass',
      source: commandOwnerReplacement({
        suffix: 'function sink(value: unknown): void { void value; } sink(spawn);'
      })
    },
    {
      scenarioId: 'command-namespace-acquisition',
      label: 'command namespace acquisition',
      source: `import * as child from 'node:child_process';
        export function runDevCommand(): void { child.spawn('bun', [], { shell: false }); }`
    }
  ] as const) {
    add({
      scenarioId: input.scenarioId,
      label: input.label,
      commandSource: input.source,
      expectedValidation: 'rejected',
      expectedViolationCodes: ['COMMAND_OWNER_CONTRACT']
    });
  }

  add({
    scenarioId: 'public-syntactic-diagnostics',
    label: 'public syntactic diagnostics',
    extraModules: [{
      logicalPath: 'platform/dev-runner/invalid.ts',
      source: 'export const = ;'
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['SYNTACTIC_DIAGNOSTIC']
  });

  const exposedBoundedSource = boundedOwnerReplacement({ exportBounded: true });
  const exposureScenarios: readonly ScenarioCatalogInput[] = [
    {
      scenarioId: 'esm-named-import',
      label: 'ESM named import',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.ts',
        source: "import { runBoundedFastTestInvocations as start } from './test-runner.ts'; void start;"
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'esm-namespace-import',
      label: 'ESM namespace import',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.ts',
        source: "import * as runner from './test-runner.ts'; void runner;"
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'default-through-named-barrel',
      label: 'default through named barrel',
      boundedSource: exposedBoundedSource,
      extraModules: [
        {
          logicalPath: 'platform/dev-runner/barrel.ts',
          source: "export { runBoundedFastTestInvocations as default } from './test-runner.ts';"
        },
        {
          logicalPath: 'platform/dev-runner/consumer.ts',
          source: "import start from './barrel.ts'; void start;"
        }
      ],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'dynamic-immutable-template-specifier',
      label: 'dynamic immutable template specifier',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.ts',
        source: [
          "const stem = './test-';",
          'const target = `${stem}runner.ts`;',
          'const { runBoundedFastTestInvocations: start } = await import(target);',
          'void start;'
        ].join('\n')
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'import-equals-namespace',
      label: 'import equals namespace',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.cts',
        source: "import runner = require('./test-runner.ts'); void runner;"
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'commonjs-require-alias-destructure',
      label: 'CommonJS require alias and destructure',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.cjs',
        source: [
          "const suffix = 'runner.ts';",
          'const load = require;',
          "const { runBoundedFastTestInvocations: start } = load('./test-' + suffix);",
          'void start;'
        ].join('\n')
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'module-require-namespace',
      label: 'module require namespace',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/consumer.cjs',
        source: "const runner = module.require('./test-runner.ts'); void runner;"
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'commonjs-named-star-barrels',
      label: 'CommonJS named and star barrels',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/barrel.cjs',
        source: [
          "const runner = require('./test-runner.ts');",
          'module.exports = runner;',
          'exports.start = runner.runBoundedFastTestInvocations;',
          "Object.assign(exports, require('./test-runner.ts'));",
          "Object.defineProperty(exports, 'bounded', { get: () => runner.runBoundedFastTestInvocations });"
        ].join('\n')
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'cyclic-multilevel-barrels',
      label: 'cyclic multilevel barrels',
      boundedSource: exposedBoundedSource,
      extraModules: [
        {
          logicalPath: 'platform/dev-runner/cycle-a.ts',
          source: "export * from './cycle-b.ts';"
        },
        {
          logicalPath: 'platform/dev-runner/cycle-b.ts',
          source: "export * from './cycle-a.ts'; export * from './test-runner.ts';"
        }
      ],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'js-extension-ts-index',
      label: 'js extension to TypeScript index identity',
      boundedSource: exposedBoundedSource,
      extraModules: [
        {
          logicalPath: 'platform/dev-runner/surface/index.ts',
          source: "export * from '../test-runner.ts';"
        },
        {
          logicalPath: 'platform/dev-runner/surface-consumer.ts',
          source: "import * as surface from './surface/index.js'; void surface;"
        }
      ],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'wrapper-consumer',
      label: 'wrapper consumer',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/wrapper.ts',
        source: [
          "import { runBoundedFastTestInvocations } from './test-runner.ts';",
          'export const start = () => runBoundedFastTestInvocations();'
        ].join('\n')
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'package-barrel-surface',
      label: 'package barrel surface',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/package-barrel.ts',
        source: "export * from './test-runner.ts';"
      }],
      packageSurfaces: [{
        relativePath: 'package.json',
        value: {
          type: 'module',
          exports: { '.': { import: './platform/dev-runner/package-barrel.ts' } },
          browser: { './runner': './platform/dev-runner/package-barrel.ts' }
        }
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['PACKAGE_EXPOSURE']
    },
    {
      scenarioId: 'package-import-require-conditions',
      label: 'package import and require conditions',
      boundedSource: exposedBoundedSource,
      extraModules: [
        {
          logicalPath: 'node_modules/sec-runner-surface/package.json',
          source: jsonProgramSource({
            name: 'sec-runner-surface',
            type: 'module',
            exports: { '.': { import: './import.mts', require: './require.cts' } }
          })
        },
        {
          logicalPath: 'node_modules/sec-runner-surface/import.mts',
          source: "export * from '../../platform/dev-runner/test-runner.ts';"
        },
        {
          logicalPath: 'node_modules/sec-runner-surface/require.cts',
          source: "module.exports = require('../../platform/dev-runner/test-runner.ts');"
        },
        {
          logicalPath: 'platform/dev-runner/package-import.mts',
          source: "import * as surface from 'sec-runner-surface'; void surface;"
        },
        {
          logicalPath: 'platform/dev-runner/package-require.cts',
          source: "import surface = require('sec-runner-surface'); void surface;"
        }
      ],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['BOUNDED_EXPOSURE']
    },
    {
      scenarioId: 'mutable-loader-target-fails-closed',
      label: 'mutable loader target fails closed',
      boundedSource: exposedBoundedSource,
      extraModules: [{
        logicalPath: 'platform/dev-runner/mutable-consumer.ts',
        source: "let target = './test-runner.ts'; target += ''; void import(target);"
      }],
      expectedValidation: 'rejected',
      expectedViolationCodes: ['UNTRUSTED_SPECIFIER']
    }
  ];
  for (const scenario of exposureScenarios) add(scenario);

  add({
    scenarioId: 'cross-scenario-import',
    label: 'cross scenario import fails closed',
    boundedSource: exposedBoundedSource,
    extraModules: [{
      logicalPath: 'platform/dev-runner/consumer.ts',
      source: [
        "import { runBoundedFastTestInvocations } from '../../../valid-command-owner/platform/dev-runner/test-runner.ts';",
        'void runBoundedFastTestInvocations;'
      ].join('\n')
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['CROSS_SCENARIO_EDGE']
  });
  add({
    scenarioId: 'cross-live-import',
    label: 'undeclared live import fails closed',
    boundedSource: exposedBoundedSource,
    extraModules: [{
      logicalPath: 'platform/dev-runner/consumer.ts',
      source: [
        "import { runFastTests } from '../../../../../platform/dev-runner/test-runner.ts';",
        'void runFastTests;'
      ].join('\n')
    }],
    expectedValidation: 'rejected',
    expectedViolationCodes: ['CROSS_SCENARIO_EDGE']
  });
  add({
    scenarioId: 'safe-runtime-consumers',
    label: 'safe runtime consumers',
    extraModules: [
      {
        logicalPath: 'platform/dev-runner/safe-esm.ts',
        source: [
          "import { runFastTests } from './test-runner.ts';",
          "import type { runBoundedFastTestInvocations as BoundedType } from './test-runner.ts';",
          "const text = 'runBoundedFastTestInvocations node:child_process';",
          '// runBoundedFastTestInvocations();',
          'void runFastTests; type T = BoundedType; void text;'
        ].join('\n')
      },
      {
        logicalPath: 'platform/dev-runner/safe-dynamic.ts',
        source: "const { runFastTests } = await import('./test-runner.ts'); void runFastTests;"
      },
      {
        logicalPath: 'platform/dev-runner/safe-commonjs.cjs',
        source: "const { runFastTests } = require('./test-runner.ts'); void runFastTests;"
      },
      {
        logicalPath: 'platform/dev-runner/safe-shadows.ts',
        source: [
          "function first() { const target = './ordinary.ts'; return target; }",
          "function second(process: { env: string }, Bun: { spawn: string }) {",
          "  const target = './test-runner.ts'; void process.env; void Bun.spawn; return target;",
          '}',
          'void first; void second;',
          'export {};'
        ].join('\n')
      }
    ],
    expectedValidation: 'accepted'
  });

  return scenarios.sort((left, right) => compareCanonicalText(left.scenarioId, right.scenarioId));
}

let suitePromise: Promise<DevRunnerAuthorityProofSuite> | null = null;

function completeProgramProofSuite(): Promise<DevRunnerAuthorityProofSuite> {
  suitePromise ??= (async () => {
    const packageJson = JSON.parse(await readCompilerFile('package.json')) as unknown;
    return analyzeDevRunnerAuthorityProof(buildProgramProofCatalog(packageJson));
  })();
  return suitePromise;
}

describe('dev-runner contract', () => {
  test('root package routes developer feedback through canonical runner commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts.dev).toBe('bun ./platform/dev-runner.ts');
    expect(scripts.typecheck).toBe('bun ./platform/dev-runner.ts typecheck');
    expect(scripts.test).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:affected']).toBe('bun ./platform/dev-runner.ts test:affected');
    expect(scripts['test:fast']).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:slow']).toBe('bun ./platform/dev-runner.ts test:slow');
    expect(scripts['test:full']).toBe('bun ./platform/dev-runner.ts test');
    expect(scripts.check).toBe('bun run check:fast');
    expect(scripts['check:affected']).toBe('bun ./platform/dev-runner.ts check:affected');
    expect(scripts['check:fast']).toBe('bun ./platform/dev-runner.ts check:fast');
    expect(scripts['check:full']).toBe(
      'bun run imports:check --all && bun run typecheck && bun run docs:doctor && bun run test:full'
    );
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');
    expect(scripts['imports:apply']).toBe('bun ./platform/dev-runner.ts imports:apply');
    expect(scripts['imports:freeze']).toBe('bun ./platform/dev-runner.ts imports:freeze');
    expect(scripts['imports:transform']).toBeUndefined();
    expect(scripts['imports:remove-unused']).toBeUndefined();
    expect(scripts['imports:staged']).toBeUndefined();
    expect(scripts['deps:ensure']).toBe('bun ./platform/dev-runner.ts deps:ensure');
    expect(scripts['imports:prepare']).toBeUndefined();
    expect(scripts['imports:organize']).toBeUndefined();
  });

  test('runner surface excludes contracts owned by direct package scripts', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    expectContainsNone(runnerSource, ['reference-clean', 'benchmark-contract']);
  });

  test('candidate import freeze recovery rebuilds the exact candidate after apply', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    expect(runnerSource).toContain('Run bun run imports:apply, stage the exact files, rebuild the exact candidate, then rerun bun run imports:freeze.');
    expectContainsNone(runnerSource, ['imports:transform', 'imports:remove-unused', 'imports:staged']);
  });

  test('command runner preserves the fixed no-shell process boundary', async () => {
    const commandRunnerSource = await readCompilerFile('platform/dev-runner/command-runner.ts');
    const fastTestPolicySource = await readCompilerFile('platform/dev-runner/fast-test-policy.ts');
    const concurrencyProjectionSource = await readCompilerFile(
      'platform/dev-runner/test-concurrency-policy.ts'
    );
    const devRunnerSource = await readCompilerFile('platform/dev-runner.ts');
    const envManagerSource = await readCompilerFile('platform/dev-runner/env-manager.ts');
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');
    const workPackageGateSource = await readCompilerFile('scripts/run-work-package-gate.ts');
    const workPackageGateExecutionTestSource = await readCompilerFile(
      'tests/unit/work-package-gate-execution.test.ts'
    );

    expectContainsAll(commandRunnerSource, [
      'child = spawn(command, effectiveArgs',
      'cwd: compilerRoot',
      'shell: false',
      "stdio: observed ? (['inherit', 'pipe', 'pipe'] as const) : 'inherit'",
      "schema: 'sec-dev-command-observation-v1'",
      'export function boundedUtf8TextTail(',
      'stdoutTail: boundedUtf8TextTail(stdoutTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)',
      'stderrTail: boundedUtf8TextTail(stderrTail, DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)',
      'effectiveArgv',
      'export type DevCommandTerminalOutcome',
      "readonly kind: 'exited'",
      "readonly kind: 'signaled'",
      "readonly kind: 'spawn-failed'",
      "readonly kind: 'unresolved'",
      'readonly terminal: DevCommandTerminalOutcome',
      'readonly observationIntegrity: DevCommandObservationIntegrity',
      'const finalize = (terminal: DevCommandTerminalOutcome',
      'durationMs',
      'stdoutTail',
      'stderrTail',
      "child.on('error', (error)",
      "child.on('close', (code, signal)"
    ]);
    expectContainsNone(commandRunnerSource, [
      'readonly exitCode: number | null',
      'readonly signal: NodeJS.Signals | null',
      'readonly spawnError: string | null',
      'readonly observationError: string | null'
    ]);
    expect(concurrencyProjectionSource).not.toContain('availableParallelism');
    expectContainsAll(testRunnerSource, [
      'FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER',
      'plan.resourceQueues[resourceClass]',
      'Promise.allSettled(',
      "SEC_FAST_TEST_FAILURE_RECEIPT '",
      "schema: 'sec-fast-test-failure-receipt-v2'",
      "replayAuthority: 'none-diagnostic-only'",
      'selectedTestFiles: invocationTestFiles(',
      'devCommandObservationExitCode',
      'boundedUtf8TextTail(value, maximumBytes)',
      'export async function scheduleBoundedFastTestInvocations<TResult>(',
      'async function runBoundedFastTestInvocations(',
      "readonly kind: 'observer-rejected'",
      'plannedArgv:',
      "failure.kind === 'observer-rejected'",
      'let hasPrimaryFailure = false',
      'if (!hasPrimaryFailure && exitCode === 0) exitCode = 1',
      'if (hasPrimaryFailure) throw primaryFailure'
    ]);
    expectContainsAll(envManagerSource, [
      "export const TEST_WORKSPACE_RUN_CHILD_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD'",
      "export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV = 'SEC_TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT'",
      "export const TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_SCHEMA_V1 = 'sec-test-workspace-run-child-assignment-v1'",
      "export const TEST_WORKSPACE_SUPERVISOR_LEASE_SCHEMA_V1 = 'sec-test-workspace-supervisor-lease-v1'",
      'export function createTestWorkspaceSupervisorLeaseV1(',
      'export function testWorkspaceSupervisorLeasePathV1(',
      'export function testWorkspaceGateSnapshotBindingV1(',
      'export function bindTestWorkspaceSupervisorLeaseV1(',
      'const supervisorLease = bindTestWorkspaceSupervisorLeaseV1(',
      'export async function acquireTestWorkspaceSupervisorChallengeServerV1(',
      'export async function consumeTestWorkspaceSupervisorChallengeV1(',
      "domain: 'sec-test-workspace-supervisor-challenge-endpoint-v1'",
      'state.authorizedDigest !== challenge.challengeDigest || state.consumedDigest !== null || state.closed',
      'state.authorizedDigest = null',
      'state.consumedDigest = challenge.challengeDigest',
      'assertConsumed: (assignment: TestWorkspaceRunChildAssignmentV1)',
      'state.consumedDigest !== challenge.challengeDigest',
      'state.consumptionAsserted = true',
      'canonicalFilesystemPath(leasePath) !== canonicalFilesystemPath(snapshot.supervisorLeasePath)',
      'export function createTestWorkspaceRunChildAssignmentV1(',
      'export function parseTestWorkspaceRunChildAssignmentV1(',
      'candidate.issuerProcessId !== process.ppid',
      'candidate.issuerProcessId !== supervisorLease.record.issuerProcessId',
      'candidate.supervisorLeaseDigest !== supervisorLease.record.leaseDigest',
      'candidate.supervisorLeasePath !== supervisorLease.path',
      'candidate.supervisorLeaseDevice !== supervisorLease.device',
      'candidate.supervisorLeaseInode !== supervisorLease.inode',
      "typeof candidate.namespaceDevice !== 'string'",
      "typeof candidate.namespaceInode !== 'string'",
      'inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(resolvedLeasePath))',
      "domain: 'sec-test-workspace-run-child-assignment-name-v1'",
      'candidate.assignmentDigest !== rawSha256(JSON.stringify(draft))',
      "if (!/^fast-[0-9a-f]{64}$/u.test(runChild))",
      'export function deriveTestWorkspaceRunNamespaceV1(',
      'parentNamespace: parentNamespace ?? null',
      "return `fast-${digest}`",
      'if (runChild && !namespace)',
      'path.join(root, namespace, runChild)',
      'const preparedTestWorkspaceRuns = new WeakMap<',
      'export function testWorkspaceCleanupModeForPlatformV1(',
      "if (platform === 'darwin' && !callerAssigned) return 'darwin-ordinary'",
      'export function prepareTestWorkspaceRunV1(',
      'if (expectedAssignment === null) mkdirSync(parentPath, { recursive: true })',
      'inspectNoFollowDirectoryChildV1(',
      'export function settlePreparedTestWorkspaceRunV1(',
      'scanNoFollowDirectoryTreeMetadataV1(state.target, {',
      'deadlineAtMs: performance.now() + TEST_WORKSPACE_CLEANUP_SCAN_BUDGET_MS',
      'deleteRetainedNoFollowEntryV1({'
    ]);
    expectContainsNone(envManagerSource, [
      'SEC_TEST_WORKSPACE_RUN_CHILD_AUTHORITY',
      "'work-package-gate-v1'",
      'cleanTestWorkspaces',
      'cleanStaleTestWorkspaces',
      'STALE_DIR_THRESHOLD',
      'STALE_MTIME_MS',
      'CLEANUP_TTL_MS',
      '.last-cleanup',
      '.cleanup-lock',
      'scanNoFollowDirectoryTreeInventoryV1(state.target)'
    ]);
    expectContainsAll(testRunnerSource, [
      'const fastTestProcessNonce = randomUUID()',
      'deriveTestWorkspaceRunNamespaceV1({',
      'parentNamespace,',
      'processNonce: fastTestProcessNonce',
      'parseTestWorkspaceRunChildAssignmentV1(',
      'await consumeTestWorkspaceSupervisorChallengeV1(callerAssignment)',
      'let callerAssignmentClaimed = false',
      'if (callerAssignmentClaimed) throw new Error(',
      '[TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace ?? runChild',
      '[TEST_WORKSPACE_RUN_CHILD_ENV]: parentNamespace === undefined ? undefined : runChild',
      '[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: undefined',
      'cleanup: prepareTestWorkspaceRunV1(env, callerAssignment)',
      'settlePreparedTestWorkspaceRunV1(workspace.cleanup)'
    ]);
    expectContainsAll(workPackageGateSource, [
      'createTestWorkspaceRunChildAssignmentV1({',
      'createTestWorkspaceSupervisorLeaseV1({',
      'acquireTestWorkspaceSupervisorChallengeServerV1({',
      'namespaceLease.authorizeRunChild(runChildAssignment)',
      'namespaceLease.assertRunChildChallengeConsumed(runChildAssignment)',
      'executionSnapshotRoot,',
      'TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV',
      'readonly runChildPreparation: WorkPackageGateRunChildPreparationV1 | null',
      'runChildPreparation: finalizeRunChildPreparation(',
      'supervisorLeasePath: preparation.supervisorLeasePath',
      'supervisorLeaseDevice: preparation.supervisorLeaseDevice',
      'supervisorLeaseInode: preparation.supervisorLeaseInode',
      'namespaceDevice: runChild.namespaceDevice',
      'namespaceInode: runChild.namespaceInode',
      'prepareRunChildNamespace(',
      'createExclusiveNoFollowDirectoryV1(retainedNamespace, name)',
      'prepareRunChild(',
      'retireUnconsumedRunChild(',
      'assertRunChild(namespaceRoot, checkpoint.runChild)',
      '[TEST_WORKSPACE_RUN_CHILD_ENV]: runChild.name',
      '[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: JSON.stringify(runChildAssignment)',
      'scanNamespaceStructure(namespaceRoot, deadlineAtMs, runChild)',
      'assertWorkspaceWithinRunChild(namespaceRoot, workspaceRoot, runChild)',
      'scanNoFollowDirectoryTreeMetadataV1(namespaceIdentity, {',
      'deleteRetainedNoFollowEntryV1({'
    ]);
    expectContainsAll(workPackageGateExecutionTestSource, [
      "test('hard-death fixture process'",
      "test('real supervisor hard death recovers both preparation and mkdir effect/result windows'",
      'await consumeTestWorkspaceSupervisorChallengeV1(assignment)',
      'const cleanup = prepareTestWorkspaceRunV1(process.env, assignment)',
      "spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']",
      "process.kill(pid, 'SIGKILL')"
    ]);
    expectContainsNone(workPackageGateSource, [
      'SEC_TEST_WORKSPACE_RUN_CHILD_AUTHORITY',
      "'work-package-gate-v1'",
      'runChildPreparationAttempted',
      'scanNoFollowDirectoryTreeInventoryV1(namespaceIdentity)',
      'rm(namespaceRoot, { recursive: true',
      'rmdir(namespaceRoot)'
    ]);
    expectContainsNone(devRunnerSource, ['clean-test-workspaces', 'cleanTestWorkspaces']);
    expect(testRunnerSource).not.toContain('[TEST_WORKSPACE_NAMESPACE_ENV]: configured ??');
    expect(testRunnerSource).not.toContain('cleanStaleTestWorkspaces');
    expect(envManagerSource.indexOf("if (cleanupMode === 'unavailable')"))
      .toBeLessThan(envManagerSource.indexOf('mkdirSync(parentPath, { recursive: true })'));
    expectContainsAll(fastTestPolicySource, [
      "file: 'tests/contract/dev-runner-contract.test.ts'",
      "reason: 'finite-program-proof-and-process-contract'",
      "file: 'tests/unit/ci-verification-execution.test.ts'",
      "reason: 'copied-tcb-cli-and-child-process-recovery'",
      "resourceClass: 'independent-process'"
    ]);
    expect(testRunnerSource).not.toContain(
      'export async function runBoundedFastTestInvocations('
    );
    expect(testRunnerSource).not.toContain('function rejectedObservation');
    expect(testRunnerSource).not.toContain('bytes.subarray(');
    expect(fastTestPolicySource).not.toContain('MAX_DEFAULT_FAST_TEST_PROCESS_WAVES');
  });

  test('finite suite Program proves exact catalog, partitions, bounds, and deterministic bytes', async () => {
    const suite = await completeProgramProofSuite();
    const scenarioIds = suite.scenarioIds;

    expect(scenarioIds).toEqual(EXPECTED_SCENARIO_IDS);
    expect(scenarioIds).toHaveLength(88);
    expect(new Set(scenarioIds).size).toBe(88);
    expect(suite.scenarioProofs).toHaveLength(88);
    expect(suite.counters).toMatchObject({
      inventoryReadCount: 1,
      injectedInventoryCount: 0,
      inventorySnapshotCount: 1,
      programBuildCount: 1,
      typeCheckerBuildCount: 1,
      moduleResolutionCacheBuildCount: 1,
      programSymbolIndexBuildCount: 1,
      topologyFreezeCount: 1,
      graphSolveCount: 1,
      moduleSccProjectionCount: 1,
      callSccProjectionCount: 1,
      compactValidationIndexBuildCount: 1,
      publicSuiteFreezeCount: 1,
      postSolveTopologyMutationCount: 0,
      arbitraryCallableFactCount: 0,
      arbitraryNamespaceFactCount: 0,
      ambientCrossProductSeedCount: 0
    });
    expect(suite.counters.emittedFactCount).toBe(suite.counters.processedFactCount);
    expect(suite.counters.emittedFactCount).toBeLessThanOrEqual(
      suite.bounds.atomicFactUpperBound
    );
    expect(suite.counters.edgeApplicationCount).toBeLessThanOrEqual(
      suite.bounds.edgeApplicationUpperBound
    );
    expect(suite.counters.ruleApplicationCount).toBeLessThanOrEqual(
      suite.bounds.ruleApplicationUpperBound
    );
    expect(suite.bounds.time).toBe('O(P * (V + E + R) + F + C + X)');
    expect(suite.bounds.memory).toBe('O(words(P) * V + E + R + F + C + X)');

    let accepted = 0;
    let rejected = 0;
    const catalog = buildProgramProofCatalog({});
    for (const scenario of catalog) {
      const proof = suite.scenarioProofsById.get(scenario.scenarioId);
      expect(proof).toBeDefined();
      if (scenario.expectedValidation === 'accepted') {
        accepted += 1;
        expect({ scenarioId: scenario.scenarioId, violations: proof!.violations })
          .toEqual({ scenarioId: scenario.scenarioId, violations: [] });
      } else {
        rejected += 1;
        expect(proof!.violations.length).toBeGreaterThan(0);
        for (const code of scenario.expectedViolationCodes ?? []) {
          expect({
            scenarioId: scenario.scenarioId,
            code,
            present: proof!.violationCodes.includes(code)
          }).toEqual({ scenarioId: scenario.scenarioId, code, present: true });
        }
      }
    }
    expect({ accepted, rejected }).toEqual({ accepted: 6, rejected: 82 });

    for (const edge of suite.moduleEdges) {
      expect(suite.moduleOwners[edge.sourceModuleId]).toBe(edge.scenarioId);
      expect(suite.moduleOwners[edge.targetModuleId]).toBe(edge.scenarioId);
    }
    expect(suite.moduleEdges.filter((edge) =>
      edge.scenarioId === 'package-barrel-surface' && edge.kind === 'package-surface'))
      .toEqual([{
        scenarioId: 'package-barrel-surface',
        sourceModuleId: '__contract__/scenario/package-barrel-surface/package.json',
        targetModuleId: '__contract__/scenario/package-barrel-surface/platform/dev-runner/package-barrel.ts',
        kind: 'package-surface'
      }]);
    const forward = canonicalDevRunnerScenarioProjection(suite, scenarioIds);
    const reverse = canonicalDevRunnerScenarioProjection(suite, [...scenarioIds].reverse());
    expect(forward).toEqual(reverse);
    expect(JSON.parse(suite.canonicalBytes)).toHaveProperty('finiteProofBytes');

    expect(suite.inventory.manifestBytes).toBeLessThanOrEqual(
      DEV_RUNNER_HOST_MANIFEST_MAX_BYTES
    );
    expect(suite.inventory.modules.length).toBeLessThanOrEqual(
      DEV_RUNNER_HOST_MODULE_MAX_COUNT
    );
    expect(suite.inventory.largestSourceBytes).toBeLessThanOrEqual(
      DEV_RUNNER_HOST_SOURCE_MAX_BYTES
    );
    expect(suite.inventory.totalSourceBytes).toBeLessThanOrEqual(
      DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES
    );
    expect(suite.inventory.modules.some(({ relativePath }) =>
      relativePath === 'scripts/publish-public.ts')).toBe(false);
    for (const extension of DEV_RUNNER_EXECUTABLE_SOURCE_EXTENSIONS) {
      expect(isTrackedDevRunnerHostSource(`scripts/consumer${extension}`)).toBe(true);
      expect(isTrackedDevRunnerHostSource(`platform/consumer${extension}`)).toBe(true);
      expect(isDevRunnerExecutableSource(`platform/consumer${extension}`)).toBe(true);
    }
    for (const includedPath of [
      'platform/registry/official/example/files/src/consumer.ts',
      'platform/fixtures/consumer.ts',
      'platform/vendor/consumer.js',
      'scripts/generated/consumer.mts',
      'scripts/consumer.spec.ts',
      'platform/source-model/slot.ts',
      'platform/consumer.min.js',
      'platform/consumer.d.ts',
      'scripts/consumer.json'
    ]) {
      expect(isTrackedDevRunnerHostSource(includedPath)).toBe(true);
    }
    for (const excludedPath of [
      'tests/unit/consumer.ts',
      'docs/examples/consumer.mjs',
      'control/consumer.ts',
      '../platform/consumer.ts',
      'platform\\consumer.ts'
    ]) {
      expect(isTrackedDevRunnerHostSource(excludedPath)).toBe(false);
    }
    for (const [label, actual, maximum] of [
      ['manifest', DEV_RUNNER_HOST_MANIFEST_MAX_BYTES + 1, DEV_RUNNER_HOST_MANIFEST_MAX_BYTES],
      ['modules', DEV_RUNNER_HOST_MODULE_MAX_COUNT + 1, DEV_RUNNER_HOST_MODULE_MAX_COUNT],
      ['source', DEV_RUNNER_HOST_SOURCE_MAX_BYTES + 1, DEV_RUNNER_HOST_SOURCE_MAX_BYTES],
      ['total', DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES + 1,
        DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES]
    ] as const) {
      expect(() => assertDevRunnerHostBudget(label, actual, maximum))
        .toThrow('exceeds its byte/count budget');
    }
  });

  test('typecheck uses one TypeScript-owned derived incremental cache', async () => {
    const tsconfig = JSON.parse(await readCompilerFile('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };
    const gitignore = await readCompilerFile('.gitignore');
    const typecheckRunnerSource = await readCompilerFile('platform/dev-runner/typecheck-runner.ts');

    expect(tsconfig.compilerOptions).toMatchObject({
      incremental: true,
      noEmit: true,
      strict: true,
      tsBuildInfoFile: '.tmp/typecheck/tsconfig.tsbuildinfo'
    });
    expect(gitignore.replaceAll('\r\n', '\n').split('\n')).toContain('.tmp/');
    expect(typecheckRunnerSource).toContain("['--noEmit', '-p', 'tsconfig.json', ...args]");
    expect(typecheckRunnerSource).not.toContain('tsbuildinfo');
    expect(typecheckRunnerSource).not.toContain('tsBuildInfoFile');
  });

  test('affected runner shares canonical transition observation and impact ownership', async () => {
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');

    expectContainsAll(testRunnerSource, [
      'gitChangedFileDiffArgs',
      'gitPathBlobArgs',
      'gitUntrackedFileArgs',
      'parseGitChangedRecordsOutput',
      'parseGitPathBlobOutput',
      'parseGitUntrackedFileOutput',
      'CodexDevelopmentCreateTestImpactTransitionObservationV1',
      "from '../shared/affected-test-inventory.ts'",
      "from '../shared/ci-pr-risk-selection.ts'",
      'CodexDevelopmentAffectedInventoryInputsV1(files, (file) => currentTestFiles.has(file))',
      'selectCiPrRiskSlowSuites(files, undefined, transition)',
      'selectCiPrRiskSlowSuites([file], undefined, transition)'
    ]);
    expectContainsNone(testRunnerSource, [
      'isTestImpactSourceFile',
      'function impactSourceFile',
      'parseGitChangedFileOutput',
      "['diff', '--name-only', '--diff-filter=ACMR'"
    ]);
  });

  test('fast runner owns compiler readiness and skips browser materialization before fanout', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');
    const setupSource = await readCompilerFile('tests/setup/runtime-deps.setup.ts');
    const runtimeVerificationSource = await readCompilerFile(
      'platform/compiler/verify/run-runtime-verification.ts'
    );

    expectContainsAll(runnerSource, ['test:fast']);
    expectContainsAll(testRunnerSource, [
      'fastTestArgs',
      'ensureFastTestDependencies',
      'ensureTestDependencies',
      'PLAYWRIGHT_BROWSERS_PATH',
      'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
      'SEC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    const fastStart = testRunnerSource.indexOf('export async function runFastTests');
    const slowStart = testRunnerSource.indexOf('export async function runSlowTests');
    expect(fastStart).toBeGreaterThanOrEqual(0);
    expect(slowStart).toBeGreaterThan(fastStart);
    const fastSource = testRunnerSource.slice(fastStart, slowStart);
    expectContainsAll(fastSource, [
      'withFastTestDependencies',
      'pathEnv(binPath, null, workspaceEnv)'
    ]);
    expectContainsNone(fastSource, ['withTestDependencies', 'browserCachePath']);
    expectContainsAll(setupSource, [
      "process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureTestDependencies',
      'process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath'
    ]);
    expectContainsNone(setupSource, [
      'ensureDevDependencies',
      'ensurePlaywrightBrowserCacheReady',
      'cleanStaleWorkspaces',
      'STALE_DIR_THRESHOLD',
      'STALE_MTIME_MS',
      'CLEANUP_TTL_MS',
      '.last-cleanup',
      '.cleanup-lock'
    ]);
    expectContainsAll(runtimeVerificationSource, ['materializePlaywrightBrowserCache']);
    expectContainsNone(runtimeVerificationSource, [
      "path.join(projectRoot, 'node_modules', 'playwright', 'cli.js')",
      "path.join(compilerRoot, '.shared-deps', '.playwright-browsers')"
    ]);
  });

  test('runFastCheck runs docs:doctor in parallel with typecheck after a pure imports:check', async () => {
    const checkRunnerSource = await readCompilerFile('platform/dev-runner/check-runner.ts');
    const fastCheckStart = checkRunnerSource.indexOf('export async function runFastCheck');
    expect(fastCheckStart).toBeGreaterThanOrEqual(0);
    const fastCheckSource = checkRunnerSource.slice(fastCheckStart);

    expectContainsAll(fastCheckSource, [
      'imports:check -> docs:doctor + typecheck (parallel) -> test:fast',
      'await runImportCheck({})',
      'Promise.all([',
      "runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {})",
      'typecheck()',
      "namespace: 'test:fast'",
      'waitTimeoutMs: 5000'
    ]);
    expectContainsNone(fastCheckSource, [
      'imports:prepare + docs:doctor (parallel) -> typecheck',
      'runImportPreparation'
    ]);

    const importsIndex = fastCheckSource.indexOf('await runImportCheck({})');
    const parallelIndex = fastCheckSource.indexOf('Promise.all([');
    const docsIndex = fastCheckSource.indexOf("runDevCommand('bun', ['docs/scripts/docs-doctor.ts']");
    const typecheckIndex = fastCheckSource.indexOf('typecheck()');
    expect(importsIndex).toBeGreaterThanOrEqual(0);
    expect(parallelIndex).toBeGreaterThan(importsIndex);
    expect(docsIndex).toBeGreaterThan(parallelIndex);
    expect(typecheckIndex).toBeGreaterThan(parallelIndex);
  });

  test('heavy verification gate lease exposes per-namespace isolation and a wait timeout option', async () => {
    const leaseSource = await readCompilerFile('platform/shared/heavy-verification-gate-lease.ts');

    expectContainsAll(leaseSource, [
      'export function heavyVerificationGateMutexName',
      'namespace?: string',
      'waitTimeoutMs?: number',
      'heavyVerificationGateNamespaceSegment',
      'WaitForSingleObject(handle, waitTimeoutMs)'
    ]);

    const fast = heavyVerificationGateMutexName('C:\\repo', 'test:fast');
    const affected = heavyVerificationGateMutexName('C:\\repo', 'test:affected');
    const unscoped = heavyVerificationGateMutexName('C:\\repo');
    expect(fast).not.toBe(affected);
    expect(fast).not.toBe(unscoped);
    expect(affected).not.toBe(unscoped);
    expect(fast).toContain('Global\\sec-heavy-verification-gate-');
    expect(affected).toContain('Global\\sec-heavy-verification-gate-');
    expect(unscoped).toContain('Global\\sec-heavy-verification-gate-');
  });

  test('two heavy verification gate leases with different namespaces can be held concurrently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-heavy-gate-ns-'));
    try {
      const fast = await acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 101,
        token: '11111111111111111111111111111111'
      });
      const affected = await acquireHeavyVerificationGateLease({
        gateId: 'test:affected',
        namespace: 'test:affected',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 202,
        token: '22222222222222222222222222222222'
      });
      expect(fast.owner.gateId).toBe('test:fast');
      expect(affected.owner.gateId).toBe('test:affected');
      await fast.release();
      await affected.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('two heavy verification gate leases with the same namespace still conflict', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-heavy-gate-same-'));
    try {
      const first = await acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 101,
        token: '11111111111111111111111111111111'
      });
      await expect(acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 202,
        token: '22222222222222222222222222222222'
      })).rejects.toThrow('is already active');
      await first.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
