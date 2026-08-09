import { describe, expect, test } from 'bun:test';

import {
  EffectBit,
  HandleBit,
  ProtectedRoleBit,
  analyzeDevRunnerAuthorityProofWithInventoryForTests,
  collectTrackedDevRunnerHostClosureForTests,
  computeFiniteSccProjection,
  solveFiniteAuthorityModel,
  type DevRunnerAuthorityScenario,
  type FiniteAuthorityModelInput,
  type FiniteProofConstraintInput,
  type FiniteProofNodeInput,
  type FiniteProofNodeRef,
  type TrackedDevRunnerHostInventory
} from '../helpers/dev-runner-authority-proof.ts';

const value = (id: string): FiniteProofNodeRef => ({ kind: 'value', id });
const slot = (id: string): FiniteProofNodeRef => ({ kind: 'export-slot', id });

function factMap(proof: ReturnType<typeof solveFiniteAuthorityModel>): Map<string, {
  handles: number;
  roles: number;
}> {
  return new Map(proof.facts.map((fact) => [
    `${fact.nodeKind}:${fact.nodeId}`,
    { handles: fact.handles, roles: fact.roles }
  ]));
}

function referenceClosure(
  nodes: readonly FiniteProofNodeInput[],
  constraints: readonly FiniteProofConstraintInput[]
): Map<string, { handles: number; roles: number }> {
  const states = new Map(nodes.map((node) => [
    `${node.kind}:${node.id}`,
    { handles: node.handles ?? 0, roles: node.roles ?? 0, scenarioId: node.scenarioId }
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const constraint of constraints) {
      if (constraint.kind === 'capability-derivation') continue;
      const source = states.get(`${constraint.source.kind}:${constraint.source.id}`)!;
      const target = states.get(`${constraint.target.kind}:${constraint.target.id}`)!;
      if (source.scenarioId !== constraint.scenarioId ||
        target.scenarioId !== constraint.scenarioId) continue;
      const nextHandles = target.handles | source.handles;
      const nextRoles = target.roles | source.roles;
      if (nextHandles !== target.handles || nextRoles !== target.roles) {
        target.handles = nextHandles;
        target.roles = nextRoles;
        changed = true;
      }
    }
  }
  return new Map([...states].map(([key, state]) => [
    key,
    { handles: state.handles, roles: state.roles }
  ]));
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

const EMPTY_TRACKED_INVENTORY: TrackedDevRunnerHostInventory = Object.freeze({
  modules: Object.freeze([]),
  manifestBytes: 0,
  totalSourceBytes: 0,
  largestSourceBytes: 0
});

function trackedCandidateInventory(
  inputs: readonly { readonly relativePath: string; readonly source: string;
    readonly sourceBytes?: number }[]
): TrackedDevRunnerHostInventory {
  const modules = inputs.map(({ relativePath, source, sourceBytes }) => ({
    relativePath,
    source,
    sourceBytes: sourceBytes ?? Buffer.byteLength(source, 'utf8')
  }));
  return {
    modules,
    manifestBytes: 256,
    totalSourceBytes: modules.reduce((total, module) => total + module.sourceBytes, 0),
    largestSourceBytes: modules.reduce(
      (largest, module) => Math.max(largest, module.sourceBytes),
      0
    )
  };
}

const CLOSURE_LIVE_SCENARIO: DevRunnerAuthorityScenario = Object.freeze({
  scenarioId: 'live',
  label: 'closure live scenario',
  moduleScope: '',
  commandOwnerModuleId: 'platform/dev-runner/command-runner.ts',
  boundedOwnerModuleId: 'platform/dev-runner/test-runner.ts',
  processOwnerModuleId: 'platform/shared/process.ts',
  policyOwnerModuleIds: Object.freeze([
    'platform/dev-runner/fast-test-policy.ts',
    'platform/dev-runner/test-concurrency-policy.ts'
  ]),
  modules: Object.freeze([]),
  packageSurfaces: Object.freeze([]),
  expectedValidation: 'accepted',
  expectedViolationCodes: Object.freeze([])
});

function mechanismScenario(
  scenarioId: string,
  boundedAddition = '',
  extraModules: DevRunnerAuthorityScenario['modules'] = []
): DevRunnerAuthorityScenario {
  const moduleScope = scenarioId === 'live'
    ? ''
    : `__contract__/scenario/${scenarioId}`;
  const modules = [
    {
      logicalPath: 'platform/dev-runner/command-runner.ts',
      source: [
        "import { spawn } from 'node:child_process';",
        'export function runDevCommand(command: string = \'bun\'): Promise<unknown> {',
        '  return new Promise((resolve) => {',
        '    resolve(spawn(command, [], { shell: false }));',
        '  });',
        '}'
      ].join('\n')
    },
    {
      logicalPath: 'platform/shared/process.ts',
      source: [
        'export function runCommandBytes(command: string): Uint8Array {',
        '  void command; return new Uint8Array();',
        '}',
        'export function runCommand(): number { return 0; }',
        'export function runCommandWithRetry(): number { return 0; }'
      ].join('\n')
    },
    {
      logicalPath: 'platform/dev-runner/fast-test-policy.ts',
      source: 'export const policy = 1;'
    },
    {
      logicalPath: 'platform/dev-runner/test-concurrency-policy.ts',
      source: 'export const concurrency = 1;'
    },
    {
      logicalPath: 'platform/dev-runner/test-runner.ts',
      source: [
        "import { runDevCommand } from './command-runner.ts';",
        "import { runCommandBytes } from '../shared/process.ts';",
        'async function runBoundedFastTestInvocations(): Promise<number> {',
        '  const dispatch = async (): Promise<number> => {',
        "    await runDevCommand('bun');",
        '    return 0;',
        '  };',
        boundedAddition,
        '  return dispatch();',
        '}',
        'function gitChangedFiles(): void {',
        "  runCommandBytes('git');",
        "  runCommandBytes('git');",
        '}',
        'async function nested(callback: () => Promise<void>): Promise<void> {',
        '  await callback();',
        '}',
        'type FiniteKey = \'left\' | \'right\';',
        'function finiteKey(record: Record<FiniteKey, number>, key: FiniteKey): number {',
        '  return record[key];',
        '}',
        'function numericKey(values: readonly number[]): number | undefined {',
        '  const zero = 0 as const;',
        '  return values[zero];',
        '}',
        'function unprotectedDynamic(record: Record<string, number>, key: string): number {',
        '  return record[key] ?? 0;',
        '}',
        'export async function runFastTests(): Promise<number> {',
        '  await nested(async () => {',
        '    await runBoundedFastTestInvocations();',
        '    await runBoundedFastTestInvocations();',
        '  });',
        '  void gitChangedFiles; void finiteKey; void numericKey; void unprotectedDynamic;',
        '  return 0;',
        '}'
      ].join('\n')
    },
    ...extraModules
  ];
  return Object.freeze({
    scenarioId,
    label: scenarioId,
    moduleScope,
    commandOwnerModuleId: `${moduleScope ? `${moduleScope}/` : ''}platform/dev-runner/command-runner.ts`,
    boundedOwnerModuleId: `${moduleScope ? `${moduleScope}/` : ''}platform/dev-runner/test-runner.ts`,
    processOwnerModuleId: `${moduleScope ? `${moduleScope}/` : ''}platform/shared/process.ts`,
    policyOwnerModuleIds: Object.freeze([
      `${moduleScope ? `${moduleScope}/` : ''}platform/dev-runner/fast-test-policy.ts`,
      `${moduleScope ? `${moduleScope}/` : ''}platform/dev-runner/test-concurrency-policy.ts`
    ]),
    modules: Object.freeze(modules),
    packageSurfaces: Object.freeze(scenarioId === 'live'
      ? [{ relativePath: 'package.json', value: { name: 'sec' } }]
      : []),
    expectedValidation: scenarioId === 'protected-unknown' ? 'rejected' : 'accepted',
    expectedViolationCodes: Object.freeze(
      scenarioId === 'protected-unknown' ? ['UNKNOWN_PROPERTY_FRONTIER'] : []
    )
  });
}

describe('finite dev-runner authority kernel', () => {
  test('live owner roots form one fail-closed executable, declaration, and JSON closure', async () => {
    const ownedCandidates = [
      {
        relativePath: 'platform/dev-runner/command-runner.ts',
        source: [
          "export { reached } from './reached.ts';",
          "import './shadowed-import.ts';",
          "import './shadowed-local.ts';",
          "import './shadowed-module.ts';",
          "import './shadowed-parameter.ts';"
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/reached.ts',
        source: [
          "import type { RuntimeMarker } from './runtime-contract.d.ts';",
          "import runtime from './runtime.json' with { type: 'json' };",
          'export const reached: RuntimeMarker = runtime.enabled;'
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/runtime-contract.d.ts',
        source: 'export type RuntimeMarker = boolean;'
      },
      {
        relativePath: 'platform/dev-runner/runtime.json',
        source: '{"enabled":true}'
      },
      {
        relativePath: 'platform/dev-runner/test-runner.ts',
        source: "export const bounded = require(`./bounded-leaf.ts`);"
      },
      {
        relativePath: 'platform/dev-runner/bounded-leaf.ts',
        source: 'export const boundedLeaf = true;'
      },
      {
        relativePath: 'platform/shared/process.ts',
        source: "import processLeaf = require('./process-leaf.ts'); export { processLeaf };"
      },
      {
        relativePath: 'platform/shared/process-leaf.ts',
        source: 'export = true;'
      },
      {
        relativePath: 'platform/dev-runner/fast-test-policy.ts',
        source: "export const policy = import('./policy-leaf.ts');"
      },
      {
        relativePath: 'platform/dev-runner/policy-leaf.ts',
        source: 'export const policyLeaf = true;'
      },
      {
        relativePath: 'platform/dev-runner/test-concurrency-policy.ts',
        source: [
          "export const concurrency = module.require('./module-require-leaf.ts');",
          'declare const loader: { require(path: string): unknown };',
          "void loader.require('./arbitrary-require-leaf.ts');"
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/module-require-leaf.ts',
        source: 'export const moduleRequireLeaf = true;'
      },
      {
        relativePath: 'platform/dev-runner/shadowed-import.ts',
        source: [
          "import require from 'node:module';",
          "void require('./shadowed-import-leaf.ts');"
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/shadowed-local.ts',
        source: [
          'export function shadowedLocal(): unknown {',
          '  const require = (specifier: string): string => specifier;',
          "  return require('./shadowed-local-leaf.ts');",
          '}'
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/shadowed-module.ts',
        source: [
          'export function shadowedModule(): unknown {',
          '  const module = { require: (specifier: string): string => specifier };',
          "  return module.require('./shadowed-module-leaf.ts');",
          '}'
        ].join('\n')
      },
      {
        relativePath: 'platform/dev-runner/shadowed-parameter.ts',
        source: [
          'export function shadowedParameter(',
          '  require: (specifier: string) => string',
          '): unknown {',
          "  return require('./shadowed-parameter-leaf.ts');",
          '}'
        ].join('\n')
      }
    ] as const;
    const unrelatedCandidates = [
      {
        relativePath: 'platform/dev-runner/arbitrary-require-leaf.ts',
        source: 'export const arbitraryRequireLeaf = true;'
      },
      ...[
        'shadowed-import-leaf.ts',
        'shadowed-local-leaf.ts',
        'shadowed-module-leaf.ts',
        'shadowed-parameter-leaf.ts'
      ].map((relativePath) => ({
        relativePath: `platform/dev-runner/${relativePath}`,
        source: 'export const mustRemainUnreached = true;'
      })),
      {
        relativePath: 'scripts/publish-public.ts',
        source: "import payload from './publish-public.json' with { type: 'json' }; void payload;"
      },
      { relativePath: 'scripts/publish-public.json', source: '{"unrelated":true}' }
    ] as const;
    const selected = await collectTrackedDevRunnerHostClosureForTests(
      trackedCandidateInventory([...ownedCandidates, ...unrelatedCandidates]),
      CLOSURE_LIVE_SCENARIO
    );
    const selectedWithoutUnrelated = await collectTrackedDevRunnerHostClosureForTests(
      trackedCandidateInventory(ownedCandidates),
      CLOSURE_LIVE_SCENARIO
    );

    expect(selected.modules.map(({ relativePath }) => relativePath)).toEqual([
      'platform/dev-runner/bounded-leaf.ts',
      'platform/dev-runner/command-runner.ts',
      'platform/dev-runner/fast-test-policy.ts',
      'platform/dev-runner/module-require-leaf.ts',
      'platform/dev-runner/policy-leaf.ts',
      'platform/dev-runner/reached.ts',
      'platform/dev-runner/runtime-contract.d.ts',
      'platform/dev-runner/runtime.json',
      'platform/dev-runner/shadowed-import.ts',
      'platform/dev-runner/shadowed-local.ts',
      'platform/dev-runner/shadowed-module.ts',
      'platform/dev-runner/shadowed-parameter.ts',
      'platform/dev-runner/test-concurrency-policy.ts',
      'platform/dev-runner/test-runner.ts',
      'platform/shared/process-leaf.ts',
      'platform/shared/process.ts'
    ]);
    expect(selected.modules).toEqual(selectedWithoutUnrelated.modules);
    expect(selected.modules.some(({ relativePath }) =>
      relativePath === 'scripts/publish-public.ts' ||
      relativePath === 'scripts/publish-public.json' ||
      relativePath === 'platform/dev-runner/arbitrary-require-leaf.ts' ||
      relativePath.includes('/shadowed-import-leaf.ts') ||
      relativePath.includes('/shadowed-local-leaf.ts') ||
      relativePath.includes('/shadowed-module-leaf.ts') ||
      relativePath.includes('/shadowed-parameter-leaf.ts'))).toBe(false);

    const replaceCandidateSource = (
      relativePath: string,
      source: string,
      sourceBytes?: number
    ) =>
      trackedCandidateInventory(ownedCandidates.map((candidate) =>
        candidate.relativePath === relativePath
          ? { ...candidate, source, ...(sourceBytes === undefined ? {} : { sourceBytes }) }
          : candidate));
    await expect(collectTrackedDevRunnerHostClosureForTests(
      replaceCandidateSource(
        CLOSURE_LIVE_SCENARIO.commandOwnerModuleId,
        "export { missing } from './missing.ts';"
      ),
      CLOSURE_LIVE_SCENARIO
    )).rejects.toThrow('dependency is unresolved');
    await expect(collectTrackedDevRunnerHostClosureForTests(
      replaceCandidateSource(
        CLOSURE_LIVE_SCENARIO.commandOwnerModuleId,
        "export { escaped } from '../../../outside.ts';"
      ),
      CLOSURE_LIVE_SCENARIO
    )).rejects.toThrow('escapes the repository root');
    await expect(collectTrackedDevRunnerHostClosureForTests(
      replaceCandidateSource(
        CLOSURE_LIVE_SCENARIO.commandOwnerModuleId,
        "export { reached } from './reached.ts';",
        1
      ),
      CLOSURE_LIVE_SCENARIO
    )).rejects.toThrow('stale byte count');
    await expect(collectTrackedDevRunnerHostClosureForTests(
      replaceCandidateSource('platform/dev-runner/runtime.json', '{"enabled":'),
      CLOSURE_LIVE_SCENARIO
    )).rejects.toThrow('Malformed tracked JSON closure resource');
    await expect(collectTrackedDevRunnerHostClosureForTests(
      replaceCandidateSource(
        'platform/dev-runner/runtime-contract.d.ts',
        'export type RuntimeMarker = ;'
      ),
      CLOSURE_LIVE_SCENARIO
    )).rejects.toThrow('Malformed tracked declaration closure resource');
  });

  test('random small fixed-bit graphs match a simple reference closure', () => {
    let random = 0x217227;
    const next = (): number => {
      random = (Math.imul(random, 1103515245) + 12345) >>> 0;
      return random;
    };
    for (let sample = 0; sample < 64; sample += 1) {
      const count = 2 + (next() % 7);
      const nodes: FiniteProofNodeInput[] = Array.from({ length: count }, (_, index) => ({
        id: `v${index}`,
        scenarioId: 's',
        kind: 'value',
        handles: index === 0 ? HandleBit.ChildAuthority : 0,
        roles: index === 1 ? ProtectedRoleBit.ReviewedDevCommand : 0
      }));
      const constraints: FiniteProofConstraintInput[] = [];
      const edgeCount = count + (next() % (count * 2));
      for (let edge = 0; edge < edgeCount; edge += 1) {
        const source = next() % count;
        const target = next() % count;
        constraints.push({
          id: `e${edge}`,
          scenarioId: 's',
          kind: edge % 2 === 0 ? 'alias' : 'join',
          source: value(`v${source}`),
          target: value(`v${target}`)
        });
      }
      const proof = solveFiniteAuthorityModel({ scenarioIds: ['s'], nodes, constraints });
      const expected = referenceClosure(nodes, constraints);
      const actual = factMap(proof);
      for (const [key, state] of expected) {
        expect(actual.get(key) ?? { handles: 0, roles: 0 }).toEqual(state);
      }
      expect(proof.counters.emittedFactCount).toBe(proof.counters.processedFactCount);
      expect(proof.counters.emittedFactCount).toBeLessThanOrEqual(
        proof.bounds.atomicFactUpperBound
      );
    }
  });

  test('duplicate edges, cycles, and repeated seeds are idempotent and exact-once', () => {
    const duplicate: FiniteProofConstraintInput = {
      id: 'a-to-b',
      scenarioId: 's',
      kind: 'alias',
      source: value('a'),
      target: value('b')
    };
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        {
          id: 'a',
          scenarioId: 's',
          kind: 'value',
          handles: HandleBit.ExecutableLoader,
          roles: ProtectedRoleBit.ReviewedDevCommand
        },
        { id: 'b', scenarioId: 's', kind: 'value' },
        { id: 'c', scenarioId: 's', kind: 'value' }
      ],
      constraints: [
        duplicate,
        duplicate,
        {
          id: 'b-to-c',
          scenarioId: 's',
          kind: 'alias',
          source: value('b'),
          target: value('c')
        },
        {
          id: 'c-to-a',
          scenarioId: 's',
          kind: 'alias',
          source: value('c'),
          target: value('a')
        }
      ]
    });

    expect([...factMap(proof).values()]).toEqual([
      { handles: HandleBit.ExecutableLoader, roles: ProtectedRoleBit.ReviewedDevCommand },
      { handles: HandleBit.ExecutableLoader, roles: ProtectedRoleBit.ReviewedDevCommand },
      { handles: HandleBit.ExecutableLoader, roles: ProtectedRoleBit.ReviewedDevCommand }
    ]);
    expect(proof.counters.emittedFactCount).toBe(6);
    expect(proof.counters.processedFactCount).toBe(6);
  });

  test('known property reads are field-sensitive and shorthand equals explicit writes', () => {
    const make = (writeId: string): FiniteAuthorityModelInput => ({
      scenarioIds: ['s'],
      nodes: [
        { id: 'object', scenarioId: 's', kind: 'value' },
        {
          id: 'source',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.BoundedExecutor
        },
        { id: 'ordinary', scenarioId: 's', kind: 'value' },
        { id: 'field-a', scenarioId: 's', kind: 'value' },
        { id: 'field-b', scenarioId: 's', kind: 'value' },
        { id: 'read-a', scenarioId: 's', kind: 'value' },
        { id: 'read-b', scenarioId: 's', kind: 'value' }
      ],
      constraints: [
        {
          id: writeId,
          scenarioId: 's',
          kind: 'property-write',
          owner: value('object'),
          property: 'a',
          source: value('source'),
          target: value('field-a')
        },
        {
          id: 'write-b',
          scenarioId: 's',
          kind: 'property-write',
          owner: value('object'),
          property: 'b',
          source: value('ordinary'),
          target: value('field-b')
        },
        {
          id: 'read-a',
          scenarioId: 's',
          kind: 'property-read',
          owner: value('object'),
          property: 'a',
          source: value('field-a'),
          target: value('read-a')
        },
        {
          id: 'read-b',
          scenarioId: 's',
          kind: 'property-read',
          owner: value('object'),
          property: 'b',
          source: value('field-b'),
          target: value('read-b')
        }
      ]
    });
    const explicit = solveFiniteAuthorityModel(make('explicit-write'));
    const shorthand = solveFiniteAuthorityModel(make('shorthand-write'));
    expect(factMap(explicit).get('value:read-a')?.roles).toBe(
      ProtectedRoleBit.BoundedExecutor
    );
    expect(factMap(explicit).get('value:read-b')).toBeUndefined();
    expect(explicit.canonicalBytes).toBe(shorthand.canonicalBytes);
  });

  test('typed unknown frontiers trigger only when protected facts cross a selected query', () => {
    const frontier = {
      id: 'unknown:property',
      scenarioId: 's',
      operation: 'property-read',
      policyRequiredClosure: true,
      base: value('base'),
      target: value('read'),
      code: 'UNKNOWN_PROPERTY_FRONTIER',
      message: 'opaque protected property'
    } as const;
    const ordinary = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        { id: 'base', scenarioId: 's', kind: 'value' },
        { id: 'read', scenarioId: 's', kind: 'value' },
        ...Array.from({ length: 50 }, (_, index) => ({
          id: `v${index}`,
          scenarioId: 's',
          kind: 'value' as const
        }))
      ],
      constraints: [],
      unknownFrontiers: [frontier, frontier],
      queries: [{
        id: 'forbid-selected-frontier',
        scenarioId: 's',
        kind: 'forbid-triggered-frontier',
        frontierIds: [frontier.id],
        code: frontier.code,
        message: frontier.message
      }]
    });
    expect(ordinary.findings).toEqual([]);
    expect(ordinary.triggeredUnknownFrontiers).toEqual([]);
    expect(ordinary.processedUnknownFrontiers).toEqual(['unknown:property']);
    expect(ordinary.counters.processedUnknownFrontierCount).toBe(1);
    expect(ordinary.counters.emittedFactCount).toBe(0);

    const protectedProof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        {
          id: 'base',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.SensitiveAggregate
        },
        { id: 'read', scenarioId: 's', kind: 'value' }
      ],
      constraints: [],
      unknownFrontiers: [frontier, frontier],
      queries: [{
        id: 'forbid-selected-frontier',
        scenarioId: 's',
        kind: 'forbid-triggered-frontier',
        frontierIds: [frontier.id],
        code: frontier.code,
        message: frontier.message
      }]
    });
    expect(protectedProof.findings.map(({ code }) => code)).toEqual([
      'UNKNOWN_PROPERTY_FRONTIER'
    ]);
    expect(protectedProof.triggeredUnknownFrontiers).toHaveLength(1);
    expect(protectedProof.counters.processedUnknownFrontierCount).toBe(1);
  });

  test('one Program lowers lexical owners, data resources, exact keys, and sparse call targets', () => {
    const live = mechanismScenario('live', '', [
      {
        logicalPath: 'scripts/release.ts',
        source: [
          "import pkg from '../package.json' with { type: 'json' };",
          'export const packageName = pkg.name;'
        ].join('\n')
      },
      {
        logicalPath: 'platform/dev-runner/sparse.ts',
        source: [
          "import { runDevCommand } from './command-runner.ts';",
          'type Runner = typeof runDevCommand;',
          'export async function dynamicImport(): Promise<unknown> {',
          "  const { runDevCommand: loaded } = await import('./command-runner.ts');",
          "  return loaded('bun');",
          '}',
          'export function finiteJoin(injected: Runner | undefined): unknown {',
          '  const selected = injected ?? runDevCommand;',
          "  return selected('bun');",
          '}',
          'export function withDefault(runner: Runner = runDevCommand): unknown {',
          "  return runner('bun');",
          '}',
          'function forward(runner: Runner): unknown {',
          "  return runner('bun');",
          '}',
          'export function throughParameter(): unknown {',
          '  return forward(runDevCommand);',
          '}'
        ].join('\n')
      }
    ]);
    const protectedUnknown = mechanismScenario(
      'protected-unknown',
      [
        '  const authorityBox = { bounded: runBoundedFastTestInvocations };',
        "  const opaqueKey: string = Math.random() > 0.5 ? 'bounded' : 'other';",
        '  void authorityBox[opaqueKey];'
      ].join('\n')
    );
    const suite = analyzeDevRunnerAuthorityProofWithInventoryForTests(
      EMPTY_TRACKED_INVENTORY,
      [live, protectedUnknown]
    );

    expect(suite.counters.programBuildCount).toBe(1);
    expect(suite.counters.typeCheckerBuildCount).toBe(1);
    expect(suite.counters.moduleResolutionCacheBuildCount).toBe(1);
    expect(suite.counters.programSymbolIndexBuildCount).toBe(1);
    expect(suite.scenarioProofsById.get('live')?.violations).toEqual([]);
    expect(suite.scenarioProofsById.get('protected-unknown')?.violationCodes)
      .toContain('UNKNOWN_PROPERTY_FRONTIER');
    expect(suite.moduleEdges.some((edge) =>
      edge.sourceModuleId === 'scripts/release.ts' &&
      edge.targetModuleId === 'package.json')).toBe(false);
    expect(suite.finiteProof.findings.some(({ code, message }) =>
      code === 'UNBOUNDED_MODULE' && message.includes('package.json'))).toBe(false);
    expect(suite.finiteProof.processedUnknownFrontiers.filter((id) =>
      id.includes('platform/dev-runner/test-runner.ts'))).toHaveLength(3);
    const sparsePairs = suite.finiteProof.knownCallablePairs.filter(({ callSiteId, callableId }) =>
      String(callSiteId).includes('platform/dev-runner/sparse.ts') &&
      String(callableId).includes('platform/dev-runner/command-runner.ts'));
    expect(sparsePairs.length).toBeGreaterThanOrEqual(4);
    expect(suite.counters.arbitraryCallableFactCount).toBe(0);
    expect(suite.counters.arbitraryNamespaceFactCount).toBe(0);
    expect(suite.counters.ambientCrossProductSeedCount).toBe(0);
  });

  test('cross-scenario edges find and never transfer protected facts', () => {
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['a', 'b'],
      nodes: [
        {
          id: 'a-source',
          scenarioId: 'a',
          kind: 'value',
          roles: ProtectedRoleBit.BoundedExecutor
        },
        { id: 'b-target', scenarioId: 'b', kind: 'value' }
      ],
      constraints: [{
        id: 'cross',
        scenarioId: 'a',
        kind: 'alias',
        source: value('a-source'),
        target: value('b-target')
      }]
    });
    expect(proof.findings.map(({ code }) => code)).toEqual(['CROSS_SCENARIO_EDGE']);
    expect(factMap(proof).get('value:b-target')).toBeUndefined();
    expect(proof.counters.ambientCrossProductSeedCount).toBe(0);
  });

  test('cross-scenario calls find and never transfer callable effects', () => {
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['a', 'b'],
      nodes: [{
        id: 'b-callee',
        scenarioId: 'b',
        kind: 'value',
        roles: ProtectedRoleBit.ReviewedDevCommand
      }],
      constraints: [],
      callables: [
        { id: 'a-caller', scenarioId: 'a' },
        { id: 'b-callee-callable', scenarioId: 'b' }
      ],
      directCalls: [{
        id: 'cross-call',
        scenarioId: 'a',
        callerCallableId: 'a-caller',
        calleeCallableId: 'b-callee-callable'
      }],
      callSites: [{
        id: 'b-call-site',
        scenarioId: 'b',
        callee: value('b-callee'),
        ownerCallableId: 'b-callee-callable',
        directCallableId: 'b-callee-callable',
        location: 'b.ts:1:1'
      }]
    });

    expect(proof.findings.map(({ code }) => code)).toEqual(['CROSS_SCENARIO_CALL']);
    expect(proof.effects.map(({ scenarioId, callableId }) => [
      String(scenarioId),
      String(callableId)
    ])).toEqual([['b', 'b-callee-callable']]);
  });

  test('module and call SCCs converge while effects remain non-flowing value summaries', () => {
    const moduleProjection = computeFiniteSccProjection(
      ['m1', 'm2', 'm3'],
      [
        { source: 'm1', target: 'm2' },
        { source: 'm2', target: 'm1' },
        { source: 'm2', target: 'm3' }
      ]
    );
    expect(moduleProjection.components).toEqual([['m1', 'm2'], ['m3']]);

    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [{
        id: 'callee',
        scenarioId: 's',
        kind: 'value',
        roles: ProtectedRoleBit.ReviewedDevCommand
      }],
      constraints: [],
      callables: [
        { id: 'a', scenarioId: 's' },
        { id: 'b', scenarioId: 's' }
      ],
      directCalls: [
        { id: 'a-b', scenarioId: 's', callerCallableId: 'a', calleeCallableId: 'b' },
        { id: 'b-a', scenarioId: 's', callerCallableId: 'b', calleeCallableId: 'a' }
      ],
      callSites: [{
        id: 'invoke',
        scenarioId: 's',
        callee: value('callee'),
        ownerCallableId: 'b',
        directCallableId: 'a',
        location: 'm.ts:1:1'
      }]
    });
    expect(proof.effects.map(({ scenarioId, callableId, effects }) => ({
      scenarioId: String(scenarioId),
      callableId: String(callableId),
      effects
    }))).toEqual([
      { scenarioId: 's', callableId: 'a', effects: EffectBit.InvokesReviewedDevCommand },
      { scenarioId: 's', callableId: 'b', effects: EffectBit.InvokesReviewedDevCommand }
    ]);
    expect(proof.counters.arbitraryCallableFactCount).toBe(0);
    expect(proof.counters.arbitraryNamespaceFactCount).toBe(0);
    expect(proof.processedCallPairs).toHaveLength(1);
  });

  test('a reviewed terminal callable exposes only its reviewed effect to callers', () => {
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        {
          id: 'reviewed',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.ReviewedDevCommand
        },
        {
          id: 'spawn',
          scenarioId: 's',
          kind: 'value',
          handles: HandleBit.ExactNodeChildSpawn
        }
      ],
      constraints: [],
      callables: [
        { id: 'caller', scenarioId: 's' },
        {
          id: 'command',
          scenarioId: 's',
          terminalEffectMask: EffectBit.InvokesReviewedDevCommand
        }
      ],
      directCalls: [{
        id: 'caller-command',
        scenarioId: 's',
        callerCallableId: 'caller',
        calleeCallableId: 'command'
      }],
      callSites: [
        {
          id: 'invoke-command',
          scenarioId: 's',
          callee: value('reviewed'),
          ownerCallableId: 'caller',
          directCallableId: 'command',
          targetCallableIds: ['command'],
          hasUnknownTarget: false,
          location: 'bounded.ts:1:1'
        },
        {
          id: 'invoke-spawn',
          scenarioId: 's',
          callee: value('spawn'),
          ownerCallableId: 'command',
          targetCallableIds: [],
          hasUnknownTarget: true,
          location: 'command.ts:1:1'
        }
      ]
    });
    const effects = new Map(proof.effects.map((effect) => [
      String(effect.callableId),
      effect.effects
    ]));
    expect(effects.get('command')).toBe(
      EffectBit.InvokesReviewedDevCommand | EffectBit.InvokesChildAuthority
    );
    expect(effects.get('caller')).toBe(EffectBit.InvokesReviewedDevCommand);
    expect(proof.knownCallablePairs.map(({ callSiteId, callableId }) => [
      String(callSiteId),
      String(callableId)
    ])).toEqual([['invoke-command', 'command']]);
    expect(proof.counters.arbitraryCallableFactCount).toBe(0);
    expect(proof.counters.ambientCrossProductSeedCount).toBe(0);
  });

  test('unknown protected execution is an effect only inside the required closure', () => {
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        {
          id: 'inside-callee',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.ReviewedDevCommand
        },
        {
          id: 'outside-callee',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.ReviewedDevCommand
        }
      ],
      constraints: [],
      callables: [
        { id: 'root', scenarioId: 's' },
        { id: 'inside', scenarioId: 's' },
        { id: 'outside', scenarioId: 's' }
      ],
      directCalls: [{
        id: 'root-inside',
        scenarioId: 's',
        callerCallableId: 'root',
        calleeCallableId: 'inside'
      }],
      callSites: [
        {
          id: 'inside-unknown',
          scenarioId: 's',
          callee: value('inside-callee'),
          ownerCallableId: 'inside',
          targetCallableIds: [],
          hasUnknownTarget: true,
          policyRequiredClosure: true,
          location: 'inside.ts:1:1'
        },
        {
          id: 'outside-unknown',
          scenarioId: 's',
          callee: value('outside-callee'),
          ownerCallableId: 'outside',
          targetCallableIds: [],
          hasUnknownTarget: true,
          policyRequiredClosure: false,
          location: 'outside.ts:1:1'
        }
      ],
      queries: [{
        id: 'bounded-unknown',
        scenarioId: 's',
        kind: 'forbid-effect',
        callableId: 'root',
        mask: EffectBit.UnknownProtectedExecution,
        code: 'UNRESOLVED_PROTECTED_CALL',
        message: 'bounded closure contains unresolved protected execution'
      }]
    });
    expect(proof.findings.map(({ code }) => code)).toEqual([
      'UNRESOLVED_PROTECTED_CALL'
    ]);
    const effects = new Map(proof.effects.map(({ callableId, effects }) => [
      String(callableId),
      effects
    ]));
    expect((effects.get('root') ?? 0) & EffectBit.UnknownProtectedExecution).not.toBe(0);
    expect((effects.get('inside') ?? 0) & EffectBit.UnknownProtectedExecution).not.toBe(0);
    expect((effects.get('outside') ?? 0) & EffectBit.UnknownProtectedExecution).toBe(0);
  });

  test('export-slot protected pairs are processed once across duplicate and cyclic flows', () => {
    const proof = solveFiniteAuthorityModel({
      scenarioIds: ['s'],
      nodes: [
        {
          id: 'source',
          scenarioId: 's',
          kind: 'value',
          roles: ProtectedRoleBit.BoundedExecutor
        },
        { id: 'm#a', scenarioId: 's', kind: 'export-slot' },
        { id: 'm#b', scenarioId: 's', kind: 'export-slot' }
      ],
      constraints: [
        {
          id: 'write',
          scenarioId: 's',
          kind: 'export-write',
          exportName: 'a',
          source: value('source'),
          target: slot('m#a')
        },
        {
          id: 'a-b',
          scenarioId: 's',
          kind: 'export-read',
          exportName: 'b',
          source: slot('m#a'),
          target: slot('m#b')
        },
        {
          id: 'b-a',
          scenarioId: 's',
          kind: 'export-read',
          exportName: 'a',
          source: slot('m#b'),
          target: slot('m#a')
        }
      ]
    });
    expect(proof.processedExportPairs).toEqual([
      `m#a\0${ProtectedRoleBit.BoundedExecutor}`,
      `m#b\0${ProtectedRoleBit.BoundedExecutor}`
    ]);
    expect(proof.counters.processedExportProtectedPairCount).toBe(2);
  });

  test('unrelated values, callables, modules, properties, and scenarios do not amplify a closure', () => {
    const base: FiniteAuthorityModelInput = {
      scenarioIds: ['a'],
      nodes: [
        {
          id: 'a-source',
          scenarioId: 'a',
          kind: 'value',
          handles: HandleBit.ChildAuthority
        },
        { id: 'a-target', scenarioId: 'a', kind: 'value' }
      ],
      constraints: [{
        id: 'a-edge',
        scenarioId: 'a',
        kind: 'alias',
        source: value('a-source'),
        target: value('a-target')
      }]
    };
    const expanded: FiniteAuthorityModelInput = {
      scenarioIds: ['a', 'unrelated'],
      nodes: [
        ...base.nodes,
        ...Array.from({ length: 100 }, (_, index) => ({
          id: `u${index}`,
          scenarioId: 'unrelated',
          kind: 'value' as const
        })),
        { id: 'unrelated-module#ordinary', scenarioId: 'unrelated', kind: 'export-slot' }
      ],
      constraints: base.constraints,
      callables: Array.from({ length: 25 }, (_, index) => ({
        id: `ordinary-callable-${index}`,
        scenarioId: 'unrelated'
      }))
    };
    const baseProof = solveFiniteAuthorityModel(base);
    const expandedProof = solveFiniteAuthorityModel(expanded);
    const projectA = (proof: typeof baseProof) => ({
      facts: proof.facts.filter(({ scenarioId }) => scenarioId === 'a'),
      effects: proof.effects.filter(({ scenarioId }) => scenarioId === 'a'),
      findings: proof.findings.filter(({ scenarioId }) => scenarioId === 'a')
    });
    expect(projectA(expandedProof)).toEqual(projectA(baseProof));
  });

  test('canonical proof bytes are invariant under catalog, edge, rule, and seed permutation', () => {
    const input: FiniteAuthorityModelInput = {
      scenarioIds: ['a', 'b'],
      nodes: [
        {
          id: 'a', scenarioId: 'a', kind: 'value', handles: HandleBit.ChildAuthority
        },
        { id: 'b', scenarioId: 'a', kind: 'value' },
        {
          id: 'c', scenarioId: 'b', kind: 'value', roles: ProtectedRoleBit.BoundedExecutor
        }
      ],
      constraints: [
        { id: 'ab', scenarioId: 'a', kind: 'alias', source: value('a'), target: value('b') },
        {
          id: 'derive',
          scenarioId: 'a',
          kind: 'capability-derivation',
          source: value('a'),
          sourceDomain: 'handle',
          sourceBit: HandleBit.ChildAuthority,
          target: value('b'),
          targetDomain: 'role',
          targetBit: ProtectedRoleBit.SensitiveAggregate
        }
      ],
      unknownFrontiers: [{
        id: 'unknown-b',
        scenarioId: 'b',
        operation: 'property-read',
        policyRequiredClosure: true,
        base: value('c'),
        code: 'UNKNOWN_PROPERTY_FRONTIER',
        message: 'opaque'
      }]
    };
    const canonical = solveFiniteAuthorityModel(input).canonicalBytes;
    for (let seed = 1; seed <= 12; seed += 1) {
      const permuted = solveFiniteAuthorityModel({
        ...input,
        scenarioIds: shuffled(input.scenarioIds, seed),
        nodes: shuffled(input.nodes, seed * 3),
        constraints: shuffled(input.constraints, seed * 7),
        unknownFrontiers: shuffled(input.unknownFrontiers ?? [], seed * 11)
      });
      expect(permuted.canonicalBytes).toBe(canonical);
    }
  });
});
