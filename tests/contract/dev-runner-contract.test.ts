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

function boundedOwnerReplacement(input: {
  readonly modulePrelude?: string;
  readonly boundedPrelude?: string;
  readonly dispatch?: string;
  readonly fastCalls?: string;
  readonly exportBounded?: boolean;
} = {}): string {
  return `
import { runCommandBytes } from '../shared/process.ts';
import { runDevCommand } from './command-runner.ts';
${input.modulePrelude ?? ''}
async function gitChangedFiles(): Promise<void> {
  await runCommandBytes('git', ['diff'], {});
  await runCommandBytes('git', ['status'], {});
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
void gitChangedFiles;
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
export async function runCommandBytes(..._args: unknown[]): Promise<void> {}
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
  'bun-reflect-destructure',
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
  'dynamic-immutable-template-specifier',
  'esm-named-import',
  'esm-namespace-import',
  'extra-shared-bytes-dispatch',
  'factory-returned-dispatch',
  'higher-order-dispatch',
  'import-equals-child-namespace',
  'import-equals-namespace',
  'js-extension-ts-index',
  'live',
  'local-wrapper-dispatch',
  'module-require-namespace',
  'module-second-reviewed-dispatch',
  'mutable-dynamic-module-specifier',
  'mutable-loader-target-fails-closed',
  'node-child-named-import',
  'package-barrel-surface',
  'package-import-require-conditions',
  'policy-alias-chain',
  'process-builtin-loader',
  'process-environment-read',
  'public-syntactic-diagnostics',
  'reviewed-dispatch-alias',
  'safe-runtime-consumers',
  'valid-bounded-owner',
  'valid-command-owner',
  'wrapper-consumer'
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
      'bun run imports:prepare && bun run typecheck && bun run docs:doctor && bun run test:full'
    );
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();
    expect(scripts['imports:prepare']).toBe('bun ./platform/dev-runner.ts imports:prepare');
    expect(scripts['imports:organize']).toBe('bun ./platform/dev-runner.ts imports:organize');
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');
    expect(scripts['imports:freeze']).toBe('bun ./platform/dev-runner.ts imports:freeze');
    expect(scripts['imports:staged']).toBe('bun ./platform/dev-runner.ts imports:staged');
    expect(scripts['deps:ensure']).toBe('bun ./platform/dev-runner.ts deps:ensure');
  });

  test('runner surface excludes contracts owned by direct package scripts', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    expectContainsNone(runnerSource, ['reference-clean', 'benchmark-contract']);
  });

  test('command runner preserves the fixed no-shell process boundary', async () => {
    const commandRunnerSource = await readCompilerFile('platform/dev-runner/command-runner.ts');
    const fastTestPolicySource = await readCompilerFile('platform/dev-runner/fast-test-policy.ts');
    const concurrencyProjectionSource = await readCompilerFile(
      'platform/dev-runner/test-concurrency-policy.ts'
    );
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');

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
    expect(scenarioIds).toHaveLength(41);
    expect(new Set(scenarioIds).size).toBe(41);
    expect(suite.scenarioProofs).toHaveLength(41);
    expect(suite.counters).toMatchObject({
      inventoryReadCount: 1,
      programBuildCount: 1,
      typeCheckerBuildCount: 1,
      moduleResolutionCacheBuildCount: 1,
      programSymbolIndexBuildCount: 1,
      topologyFreezeCount: 1,
      graphSolveCount: 1,
      moduleSccProjectionCount: 1,
      callSccProjectionCount: 1,
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
    expect({ accepted, rejected }).toEqual({ accepted: 4, rejected: 37 });

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
      'platform/consumer.d.ts'
    ]) {
      expect(isTrackedDevRunnerHostSource(includedPath)).toBe(true);
    }
    for (const excludedPath of [
      'tests/unit/consumer.ts',
      'docs/examples/consumer.mjs',
      'control/consumer.ts',
      '../platform/consumer.ts',
      'platform\\consumer.ts',
      'scripts/consumer.json'
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

  test('affected runner shares canonical changed-file parsing and impact ownership', async () => {
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');

    expectContainsAll(testRunnerSource, [
      'gitChangedFileDiffArgs',
      'gitUntrackedFileArgs',
      'parseGitChangedFileOutput',
      "from '../shared/affected-test-inventory.ts'",
      "from '../shared/ci-pr-risk-selection.ts'",
      'CodexDevelopmentAffectedInventoryInputsV1(files, (file) => currentTestFiles.has(file))',
      'selectCiPrRiskSlowSuites(files)',
      'selectCiPrRiskSlowSuites([file])'
    ]);
    expectContainsNone(testRunnerSource, [
      'isTestImpactSourceFile',
      'function impactSourceFile',
      "['diff', '--name-only', '--diff-filter=ACMR'"
    ]);
  });

  test('fast runner owns test dependency readiness without production runtime setup', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');
    const setupSource = await readCompilerFile('tests/setup/runtime-deps.setup.ts');
    const runtimeVerificationSource = await readCompilerFile(
      'platform/compiler/verify/run-runtime-verification.ts'
    );

    expectContainsAll(runnerSource, ['test:fast']);
    expectContainsAll(testRunnerSource, [
      'fastTestArgs',
      'ensureTestDependencies',
      'PLAYWRIGHT_BROWSERS_PATH',
      'SEC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    expectContainsAll(setupSource, [
      "process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureTestDependencies',
      'process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath',
      'await fs.rm(lockPath, { recursive: true, force: true });'
    ]);
    expectContainsNone(setupSource, ['ensureDevDependencies', 'ensurePlaywrightBrowserCacheReady']);
    expectContainsAll(runtimeVerificationSource, ['materializePlaywrightBrowserCache']);
    expectContainsNone(runtimeVerificationSource, [
      "path.join(projectRoot, 'node_modules', 'playwright', 'cli.js')",
      "path.join(compilerRoot, '.shared-deps', '.playwright-browsers')"
    ]);
  });

  test('runFastCheck runs docs:doctor in parallel with typecheck after imports:prepare', async () => {
    const checkRunnerSource = await readCompilerFile('platform/dev-runner/check-runner.ts');
    const fastCheckStart = checkRunnerSource.indexOf('export async function runFastCheck');
    expect(fastCheckStart).toBeGreaterThanOrEqual(0);
    const fastCheckSource = checkRunnerSource.slice(fastCheckStart);

    expectContainsAll(fastCheckSource, [
      'imports:prepare -> docs:doctor + typecheck (parallel) -> test:fast',
      'await runImportPreparation()',
      'Promise.all([',
      "runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {})",
      'typecheck()',
      "namespace: 'test:fast'",
      'waitTimeoutMs: 5000'
    ]);
    expectContainsNone(fastCheckSource, [
      'imports:prepare + docs:doctor (parallel) -> typecheck'
    ]);

    const importsIndex = fastCheckSource.indexOf('await runImportPreparation()');
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
