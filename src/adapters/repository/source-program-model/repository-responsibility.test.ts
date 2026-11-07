import { expect, test } from 'bun:test';
import { type BuildEngineeringIRInput } from '../../../compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../../compiler/ir/validate-engineering-ir.ts';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  assertRepositoryModuleArchitectureBoundaries,
  assertRepositoryModuleImportBoundaries,
  compileRepositoryModuleArchitectureProjection,
  compileRepositoryModuleMembershipSnapshot
} from '../architecture/contract.ts';
import { compileRepositorySourceProgramModel, compileSourceProgramResponsibilityEvidence } from './repository.ts';
import { compileSourceProgramRepositoryModuleGraph } from './source-program-module-graph.ts';

test('unbound Source Program facts remain unknown responsibility evidence', () => {
  const sources = new Map([
    [
      'src/public-contract/types.ts',
      "import type { Runtime } from '../runtime-owner/internal/private.ts';\n"
      + 'export interface Contract { readonly runtime: Runtime; }\n'
    ],
    ['src/public-contract/facade.ts', "export type { Contract } from './types.ts';\n"],
    [
      'src/runtime-owner/internal/private.ts',
      'export interface Runtime { readonly ready: boolean; }\n'
      + 'export function run(): Runtime { return { ready: true }; }\n'
    ],
    [
      'src/command-owner/cli.ts',
      "import type { Contract } from '../public-contract/facade.ts';\n"
      + 'export function main(_contract?: Contract): void {}\n'
    ],
    ['src/looks-like-query/value.ts', 'export function read(): string { return \'value\'; }\n']
  ]);
  const descriptors = [
    {
      root: 'src/public-contract',
      descriptor: { importGraph: 'runtime', externalEntrypoints: [] }
    },
    {
      root: 'src/runtime-owner',
      descriptor: {
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [{ capability: 'runtime.service', operations: ['run'] }]
      }
    },
    {
      root: 'src/command-owner',
      descriptor: {
        importGraph: 'runtime',
        externalEntrypoints: ['src/command-owner/cli.ts']
      }
    },
    {
      root: 'src/looks-like-query',
      descriptor: { importGraph: 'runtime', externalEntrypoints: [] }
    }
  ];
  const descriptorSources = descriptors.map(({ root, descriptor }) => ({
    descriptorPath: `${root}/module.json`,
    source: JSON.stringify(descriptor)
  }));
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...sources.keys(), ...descriptorSources.map(({ descriptorPath }) => descriptorPath)],
    descriptorSources
  });
  const files = [...sources].map(([path, source]) => ({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership: membership
  });
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: files.map(({ path }) => path),
    readSource: (path) => sources.get(path) ?? null
  });
  const projection = compileRepositoryModuleArchitectureProjection(graph, membership, model);
  expect(() => assertRepositoryModuleImportBoundaries(graph, membership)).not.toThrow();

  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/public-contract/facade.ts',
    semanticKind: 'pure-reexport',
    semanticObservationClass: 'derived'
  }));
  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/public-contract/types.ts',
    semanticKind: 'declaration-owner',
    semanticObservationClass: 'derived'
  }));
  expect(model.files).toContainEqual(expect.objectContaining({
    path: 'src/runtime-owner/internal/private.ts',
    semanticKind: 'executable',
    semanticObservationClass: 'derived'
  }));
  expect(projection.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toContainEqual(['src/runtime-owner/internal/private.ts', 'unknown']);
  expect(projection.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toContainEqual(['src/command-owner/cli.ts', 'unknown']);
  expect(projection.aggregateFacadePaths).toEqual(['src/public-contract/facade.ts']);
  // The same real source model includes a direct cross-owner import from the
  // contract to executable internal/private.ts: only the aggregate facade is forbidden.
  expect(projection.violations.filter(({ code }) => code === 'cross-package-aggregate-surface'))
    .toEqual([expect.objectContaining({
      code: 'cross-package-aggregate-surface',
      from: 'src/command-owner/cli.ts',
      to: 'src/public-contract/facade.ts'
    })]);
  expect(() => assertRepositoryModuleArchitectureBoundaries(graph, membership, model))
    .toThrow('[cross-package-aggregate-surface]');
  expect(projection.nodeResponsibilities).toContainEqual(expect.objectContaining({
    path: 'src/looks-like-query/value.ts',
    responsibility: 'unknown',
    reason: 'responsibility-evidence-unresolved'
  }));
  expect(projection.violations).not.toContainEqual(expect.objectContaining({
    code: 'repository-node-responsibility-reverse-dependency'
  }));
});

test('Source Program binds validated semantic intent to one exact exported declaration', () => {
  const sourcePath = 'src/example/run.ts';
  const source = [
    'export function run(): string { return \'ok\'; }',
    'function hidden(): string { return \'private\'; }',
    'export function ambiguous(value: string): string;',
    'export function ambiguous(value: number): number;',
    'export function ambiguous(value: string | number): string | number { return value; }',
    ''
  ].join('\n');
  const descriptorPath = 'src/example/module.json';
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [sourcePath, descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
    }]
  });
  const files = [{ path: sourcePath, source, contentDigest: rawSha256(source) }];
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  const model = compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership: membership });
  const semanticContract = {
    blockId: 'example/basic',
    contractPath: 'catalog/registry/official/example.basic/contracts/example.yaml',
    contract: {
      formatVersion: '1' as const,
      id: 'example-core',
      namespace: 'example',
      entities: [],
      states: [],
      responsibilities: [{
        id: 'ExampleOperation',
        role: 'legacy prose cannot classify a node',
        bindings: [{
          target: { kind: 'operation' as const, id: 'run' },
          declaration: { path: sourcePath, exportName: 'run' }
        }],
        owns: [],
        implements: ['run'],
        dependsOn: []
      }],
      operations: [{
        id: 'run',
        responsibility: 'ExampleOperation',
        inputs: [], reads: [], writes: [], mutates: [], requiresPolicies: [],
        requiresPermissions: [], performsEffects: [], emits: [], invokes: [], awaits: []
      }],
      events: [], policies: [], permissions: [], effects: [], scenarios: []
    }
  };
  const engineeringInput = (contractInput: typeof semanticContract): BuildEngineeringIRInput => ({
    app: { id: 'responsibility-binding', name: 'Responsibility Binding' },
    resolvedBlocks: [{
      id: 'example/basic', version: '0.1.0', kind: 'capability', installOrder: 1,
      manifestPath: 'catalog/registry/official/example.basic/block.manifest.yaml',
      registrySourceId: 'official', registryKind: 'official', registryLocation: 'compiler',
      registryPath: 'catalog/registry/official'
    }],
    manifests: [{
      blockId: 'example/basic',
      manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
    }],
    acceptanceIds: [],
    policyDeclarations: [],
    semanticContracts: [contractInput]
  });
  const snapshot = buildValidatedEngineeringIR(engineeringInput(semanticContract));
  const responsibilityEvidence = compileSourceProgramResponsibilityEvidence(model, snapshot);
  expect(responsibilityEvidence).toEqual([
    expect.objectContaining({
      responsibilityId: 'responsibility:example:ExampleOperation',
      target: { kind: 'operation', id: 'operation:example:run' },
      declaration: expect.objectContaining({
        path: sourcePath,
        exportName: 'run',
        moduleId: 'example'
      }),
      sourceRevision,
      semanticRevision: snapshot.ir.semanticRevision,
      observationClass: 'observed',
      reason: 'validated'
    })
  ]);
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [sourcePath],
    readSource: () => source
  });
  const projection = compileRepositoryModuleArchitectureProjection(graph, membership, {
    ...model,
    semanticRevision: snapshot.ir.semanticRevision,
    responsibilityEvidence
  });
  expect(projection.nodeResponsibilities).toEqual([
    expect.objectContaining({ path: sourcePath, responsibility: 'operation' })
  ]);

  for (const [declarationPath, exportName, reason] of [
    [sourcePath, 'hidden', 'exported-declaration-missing'],
    [sourcePath, 'ambiguous', 'exported-declaration-ambiguous'],
    ['src/example/other.ts', 'run', 'exported-declaration-missing']
  ] as const) {
    const unmatchedContract = structuredClone(semanticContract);
    unmatchedContract.contract.responsibilities[0]!.bindings![0]!.declaration.path = declarationPath;
    unmatchedContract.contract.responsibilities[0]!.bindings![0]!.declaration.exportName = exportName;
    const unmatchedSnapshot = buildValidatedEngineeringIR(engineeringInput(unmatchedContract));
    expect(compileSourceProgramResponsibilityEvidence(model, unmatchedSnapshot)).toEqual([
      expect.objectContaining({
        declaration: expect.objectContaining({ path: declarationPath, exportName }),
        observationClass: 'unknown',
        reason
      })
    ]);
  }

  const conflictingContract = structuredClone(semanticContract);
  conflictingContract.contract.responsibilities.push({
    id: 'DuplicateDeclarationClaim',
    role: 'another prose claim is still not authority',
    bindings: [{
      target: { kind: 'operation', id: 'run' },
      declaration: { path: sourcePath, exportName: 'run' }
    }],
    owns: [],
    implements: [],
    dependsOn: []
  });
  const conflictingSnapshot = buildValidatedEngineeringIR(engineeringInput(conflictingContract));
  expect(compileSourceProgramResponsibilityEvidence(model, conflictingSnapshot)).toEqual([
    expect.objectContaining({
      observationClass: 'unknown',
      reason: 'declaration-binding-conflict'
    }),
    expect.objectContaining({
      observationClass: 'unknown',
      reason: 'declaration-binding-conflict'
    })
  ]);
});

function compileIssuerRoleFixture(input: Readonly<{
  sources: Readonly<Record<string, string>>;
  operationObligations?: Readonly<Record<string, readonly unknown[]>>;
  descriptors: Readonly<Record<string, readonly Readonly<{
    capability: string;
    operations: readonly string[];
    effectKinds?: readonly string[];
    operationRoles: readonly Readonly<{
      operation: string;
      role: string;
      semanticOperation: string;
      requirementId: string | null;
      recovery: Readonly<{
        capability: string;
        operation: string;
        semanticOperation: string;
      }> | null;
    }>[];
  }>[]>>;
}>) {
  const files = Object.entries(input.sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const descriptorSources = Object.entries(input.descriptors).map(([root, capabilityProviders]) => ({
    descriptorPath: `${root}/module.json`,
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders,
      operationObligations: input.operationObligations?.[root] ?? [],
      preDependencyBootstrap: false
    })
  }));
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...files.map(({ path }) => path),
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources
  });
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  return compileRepositorySourceProgramModel({ sourceRevision, files, moduleMembership });
}

test('source program distinguishes valid issuer recovery from cross-owner and durable-worker violations', () => {
  const validInput = {
    sources: {
      'src/grant/issuer.ts': 'export function issueTrustedGrant(): void {}\n',
      'src/binding/issuer.ts': 'export function issueBinding(): void {}\n',
      'src/provider/issuer.ts': 'export function settleProvider(): void {}\n',
      'src/readback/issuer.ts': 'export function readback(): void {}\n',
      'src/terminal/issuer.ts': 'export function joinTerminal(): void {}\n',
      'src/recovery/issuer.ts': 'export function recover(): void {}\n',
      'src/store-positive/worker.ts': [
        'export function appendAttempt(): void {}',
        'export interface DurableInput { readonly claim: string; }',
        'export function append(input: DurableInput): string { return input.claim; }',
        ''
      ].join('\n')
    },
    descriptors: {
      'src/grant': [{ capability: 'semantic.grant', operations: ['issueTrustedGrant'], operationRoles: [
        { operation: 'issueTrustedGrant', role: 'grant-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/binding': [{ capability: 'semantic.binding', operations: ['issueBinding'], operationRoles: [
        { operation: 'issueBinding', role: 'binding-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/provider': [{ capability: 'semantic.provider', operations: ['settleProvider'], operationRoles: [
        { operation: 'settleProvider', role: 'provider-settlement-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/readback': [{ capability: 'semantic.readback', operations: ['readback'], operationRoles: [
        { operation: 'readback', role: 'readback-issuer', semanticOperation: 'example.operation', requirementId: 'example.provider', recovery: null }
      ] }],
      'src/terminal': [{ capability: 'semantic.terminal', operations: ['joinTerminal'], operationRoles: [
        { operation: 'joinTerminal', role: 'terminal-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/recovery': [{ capability: 'runtime.recovery', operations: ['recover'], operationRoles: [
        { operation: 'recover', role: 'recovery-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/store-positive': [{ capability: 'runtime.store', operations: ['appendAttempt', 'append'], operationRoles: [
        {
          operation: 'appendAttempt',
          role: 'durable-worker',
          semanticOperation: 'example.operation',
          requirementId: null,
          recovery: {
            capability: 'runtime.recovery',
            operation: 'recover',
            semanticOperation: 'example.operation'
          }
        },
        {
          operation: 'append',
          role: 'durable-worker',
          semanticOperation: 'example.operation',
          requirementId: null,
          recovery: {
            capability: 'runtime.recovery',
            operation: 'recover',
            semanticOperation: 'example.operation'
          }
        }
      ] }]
    }
  };
  const invalidInput = {
    sources: {
      'src/effect/operation.ts': 'export function execute(): void {}\n',
      'src/grant-owner/empty.ts': 'export const marker = true;\n',
      'src/foreign/issuer.ts': 'export function issueGrant(): void {}\n',
      'src/conflict/issuer.ts': 'export function settle(): void {}\nexport function readback(): void {}\n',
      'src/domain/operation.ts': 'export const domainOperation = 1;\n',
      'src/store/worker.ts': "import { domainOperation } from '../domain/operation.ts';\nexport function append(argv: string[], callback: () => void): number { callback(); return argv.length + domainOperation; }\n"
    },
    operationObligations: {
      'src/effect': [operationObligation('example.effect', 'execute')]
    },
    descriptors: {
      'src/effect': [{
        capability: 'example.effect',
        operations: ['execute'],
        effectKinds: ['process'],
        operationRoles: []
      }],
      'src/grant-owner': [{ capability: 'semantic.grant', operations: ['issueGrant'], operationRoles: [
        { operation: 'issueGrant', role: 'grant-issuer', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/foreign': [],
      'src/conflict': [{ capability: 'semantic.conflict', operations: ['settle', 'readback'], operationRoles: [
        { operation: 'settle', role: 'provider-settlement-issuer', semanticOperation: 'example.settle-operation', requirementId: 'example.settle-provider', recovery: null },
        { operation: 'readback', role: 'readback-issuer', semanticOperation: 'example.readback-operation', requirementId: 'example.readback-provider', recovery: null }
      ] }],
      'src/domain': [{ capability: 'domain.operation', operations: ['domainOperation'], operationRoles: [
        { operation: 'domainOperation', role: 'domain-owner', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }],
      'src/store': [{ capability: 'runtime.store', operations: ['append'], operationRoles: [
        { operation: 'append', role: 'durable-worker', semanticOperation: 'example.operation', requirementId: null, recovery: null }
      ] }]
    }
  };
  const model = compileIssuerRoleFixture({
    sources: { ...validInput.sources, ...invalidInput.sources },
    operationObligations: invalidInput.operationObligations,
    descriptors: { ...validInput.descriptors, ...invalidInput.descriptors }
  });
  const validPaths = new Set([
    'src/grant/module.json',
    'src/binding/module.json',
    'src/provider/module.json',
    'src/readback/module.json',
    'src/terminal/module.json',
    'src/recovery/module.json',
    'src/store-positive/module.json',
    'src/store-positive/worker.ts'
  ]);
  expect(model.candidates.filter(({ code, paths }) => (
    (code.startsWith('operation-issuer')
      || code.startsWith('operation-recovery')
      || code.startsWith('durable-worker'))
    && paths.some((path) => validPaths.has(path))
  ))).toEqual([
    expect.objectContaining({
      code: 'durable-worker-generic-input-exposed',
      subject: 'runtime.store:append',
      paths: ['src/store-positive/worker.ts'],
      observationClass: 'unknown'
    })
  ]);

  const codes = model.candidates.map(({ code }) => code);
  expect(codes).toContain('operation-issuer-role-outside-owner');
  expect(codes).not.toContain('operation-issuer-role-conflict');
  expect(codes).toContain('durable-worker-generic-input-exposed');
  expect(codes).toContain('durable-worker-domain-import');
  expect(codes).toContain('operation-recovery-binding-unresolved');
  expect(model.candidates.filter(({ code, paths }) => (
    code === 'operation-issuer-role-outside-owner'
    && paths.includes('src/grant-owner/module.json')
  ))).toEqual([expect.objectContaining({
    observationClass: 'derived',
    paths: expect.arrayContaining(['src/foreign/issuer.ts'])
  })]);
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'durable-worker-generic-input-exposed',
    subject: 'runtime.store:append',
    reason: 'durable worker exposes a caller-supplied callback',
    observationClass: 'derived',
    paths: ['src/store/worker.ts']
  }));
  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'operation-critical-role-unresolved',
    subject: 'example.effect:execute',
    observationClass: 'unknown'
  }));
});


const operationObligation = (capability: string, operation: string) => ({
  operation: { kind: 'capability', capability, operation },
  consumerSupport: { consumers: [] },
  effect: {
    kinds: ['process'],
    failureKinds: ['example.failed'],
    recovery: 'owner-intervention'
  },
  evolution: {
    migration: 'not-required',
    retirement: 'replacement-obligations-satisfied'
  },
  resources: {
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 1_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 1 },
      { resource: 'processes', maximum: 1 }
    ]
  },
  futureSupport: { condition: 'semantic-superset-required' }
});

test('source program accepts terminal issuers only with one matching semantic domain owner', () => {
  type OperationRoleFixture = Readonly<{
    operation: string;
    role: string;
    semanticOperation: string;
    requirementId: string | null;
    recovery: null;
  }>;
  const terminalRole = {
    operation: 'close',
    role: 'terminal-issuer',
    semanticOperation: 'example.lifecycle.run',
    requirementId: null,
    recovery: null
  } as const;
  const domainRole = {
    operation: 'create',
    role: 'domain-owner',
    semanticOperation: 'example.lifecycle.run',
    requirementId: null,
    recovery: null
  } as const;
  const provider = (capability: string, operationRoles: readonly OperationRoleFixture[]) => ({
    capability,
    operations: ['create', 'createOther', 'close'],
    effectKinds: [] as string[],
    operationRoles
  });
  const cases = [
    {
      id: 'accepted',
      capability: 'example.lifecycle.accepted',
      providers: [provider('example.lifecycle.accepted', [
        { ...domainRole, semanticOperation: 'example.lifecycle.accepted.run' },
        { ...terminalRole, semanticOperation: 'example.lifecycle.accepted.run' }
      ])],
      unresolved: false
    },
    {
      id: 'isolated',
      capability: 'example.lifecycle.isolated',
      providers: [provider('example.lifecycle.isolated', [
        { ...terminalRole, semanticOperation: 'example.lifecycle.isolated.run' }
      ])],
      unresolved: true
    },
    {
      id: 'cross-capability',
      capability: 'example.lifecycle.cross-capability',
      providers: [
        provider('example.lifecycle.cross-capability', [
          { ...terminalRole, semanticOperation: 'example.lifecycle.cross-capability.run' }
        ]),
        {
          capability: 'example.other-lifecycle',
          operations: ['create'],
          effectKinds: [] as string[],
          operationRoles: [{ ...domainRole, semanticOperation: 'example.lifecycle.cross-capability.run' }]
        }
      ],
      unresolved: true
    },
    {
      id: 'cross-semantic',
      capability: 'example.lifecycle.cross-semantic',
      providers: [provider('example.lifecycle.cross-semantic', [
        { ...domainRole, semanticOperation: 'example.lifecycle.other-run' },
        { ...terminalRole, semanticOperation: 'example.lifecycle.cross-semantic.run' }
      ])],
      unresolved: true
    },
    {
      id: 'requirement-bound',
      capability: 'example.lifecycle.requirement-bound',
      providers: [provider('example.lifecycle.requirement-bound', [
        { ...domainRole, semanticOperation: 'example.lifecycle.requirement-bound.run' },
        {
          ...terminalRole,
          semanticOperation: 'example.lifecycle.requirement-bound.run',
          role: 'provider-settlement-issuer',
          requirementId: 'example.lifecycle.provider'
        }
      ])],
      unresolved: true
    }
  ];
  const source = [
    'export function create(): void {}',
    'export function createOther(): void {}',
    'export function close(): void {}'
  ].join('\n');
  const model = compileIssuerRoleFixture({
    sources: Object.fromEntries(cases.map(({ id }) => [
      `src/lifecycle-${id}/operation.ts`, source
    ])),
    operationObligations: Object.fromEntries(cases.map(({ id, capability }) => [
      `src/lifecycle-${id}`, [operationObligation(capability, 'close')]
    ])),
    descriptors: Object.fromEntries(cases.map(({ id, providers }) => [
      `src/lifecycle-${id}`, providers
    ]))
  });
  for (const { capability, unresolved } of cases) {
    expect(model.candidates.filter(({ code, subject }) => (
      code === 'operation-critical-role-unresolved'
      && subject === `${capability}:close`
    ))).toEqual(unresolved ? [
      expect.objectContaining({
        code: 'operation-critical-role-unresolved',
        subject: `${capability}:close`,
        observationClass: 'unknown'
      })
    ] : []);
  }

  expect(() => compileIssuerRoleFixture({
    sources: { 'src/lifecycle-invalid/operation.ts': source },
    operationObligations: {
      'src/lifecycle-invalid': [operationObligation('example.lifecycle.invalid', 'close')]
    },
    descriptors: {
      'src/lifecycle-invalid': [provider('example.lifecycle.invalid', [
        domainRole,
        { ...domainRole, operation: 'createOther' },
        terminalRole
      ])]
    }
  })).toThrow('repository snapshot descriptor is invalid');
});


function compileCausalReaderFixture(
  readerSources: Readonly<Record<string, string>>,
  additionalSources: Readonly<Record<string, string>> = Object.freeze({})
) {
  const sources = {
    'src/semantics/repair/types.ts': [
      'export interface RepairPlan { readonly status: string; }',
      'export function parseRepairPlanJson(source: string): RepairPlan { return JSON.parse(source) as RepairPlan; }'
    ].join('\n'),
    'src/adapters/filesystem/files.ts': 'export async function readJson<T>(_path: string): Promise<T> { throw new Error(); }\n',
    ...readerSources,
    ...additionalSources
  };
  const descriptorSources = [{
    descriptorPath: 'src/semantics/repair/module.json',
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      causalRelations: [{
        subject: 'semantic.repair-plan',
        relation: 'declares',
        symbol: { path: 'src/semantics/repair/types.ts', name: 'RepairPlan' },
        operation: null
      }, {
        subject: 'semantic.repair-plan',
        relation: 'parses',
        symbol: { path: 'src/semantics/repair/types.ts', name: 'parseRepairPlanJson' },
        operation: null
      }]
    })
  }, {
    descriptorPath: 'src/adapters/filesystem/module.json',
    source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
  }, {
    descriptorPath: 'src/adapters/workspace/module.json',
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      causalRelations: Object.keys(readerSources).map((path) => ({
        subject: 'semantic.repair-plan',
        relation: 'reads-back',
        symbol: { path, name: 'readRequiredRepairPlan' },
        operation: null
      }))
    })
  }];
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...Object.keys(sources),
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources
  });
  return compileRepositorySourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
}

test('causal readback provenance accepts canonical parser, fail-only guard and owner relays by exact reader path', () => {
  const readerSources = {
    'src/adapters/workspace/canonical.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan { return parseRepairPlanJson(source); }'
      ].join('\n'),
    'src/adapters/workspace/guarded.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function bytesOrNull(): string | null { return null; }',
        'function readRequiredRepairPlan(_path: string): RepairPlan {',
        '  const bytes = bytesOrNull();',
        "  if (bytes === null) throw new Error('missing');",
        '  return parseRepairPlanJson(bytes);',
        '}'
      ].join('\n'),
    'src/adapters/workspace/stable-relay.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'async function readRequiredRepairPlan(source: string): Promise<RepairPlan> {',
        "  const parsed = source.length > 0 ? await (parseRepairPlanJson(source)) : await parseRepairPlanJson('{}');",
        '  return (parsed as RepairPlan)!;',
        '}'
      ].join('\n'),
    'src/adapters/workspace/owner-helper.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readThroughOwner(source: string): RepairPlan { return parseRepairPlanJson(source); }',
        'function readRequiredRepairPlan(source: string): RepairPlan { return readThroughOwner(source); }'
      ].join('\n'),
    'src/adapters/workspace/cross-file-reexport.ts': [
        "import { readThroughOwner } from '../../semantics/repair/runtime/index.ts';",
        "import type { RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan { return readThroughOwner(source); }'
      ].join('\n')
  };
  const model = compileCausalReaderFixture(readerSources, {
    'src/semantics/repair/runtime/read.ts': [
      "import { parseRepairPlanJson, type RepairPlan } from '../types.ts';",
      'export function readThroughOwner(source: string): RepairPlan { return parseRepairPlanJson(source); }'
    ].join('\n'),
    'src/semantics/repair/runtime/index.ts': "export { readThroughOwner } from './read.ts';\n"
  });
  for (const path of Object.keys(readerSources)) {
    expect(model.declarations).toContainEqual(expect.objectContaining({
      path,
      name: 'readRequiredRepairPlan'
    }));
    expect(model.candidates.filter(({ code, paths }) => (
      paths.includes(path)
      && (code === 'causal-relation-owner-bypass' || code === 'causal-identity-unresolved')
    ))).toEqual([]);
  }
});

test('causal readback provenance rejects each generic read, mutation, bypass and unresolved return independently', () => {
  const readerSources = {
    'src/adapters/workspace/generic.ts': [
        "import type { RepairPlan } from '../../semantics/repair/types.ts';",
        "import { readJson } from '../../adapters/filesystem/files.ts';",
        'async function readRequiredRepairPlan(path: string): Promise<RepairPlan> { return readJson<RepairPlan>(path); }'
      ].join('\n'),
    'src/adapters/workspace/mutating-branch.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        "  if (source.length === 0) source = '{}';",
        '  return parseRepairPlanJson(source);',
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-01.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        "import { readJson } from '../../adapters/filesystem/files.ts';",
        'async function readRequiredRepairPlan(path: string): Promise<RepairPlan> {',
        '  const generic = await readJson<RepairPlan>(path);',
        "  parseRepairPlanJson('{}');",
        '  return generic;',
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-02.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        '  let parsed: RepairPlan;',
        '  parsed = parseRepairPlanJson(source);',
        '  return parsed;',
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-03.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        '  if (source.length > 0) return parseRepairPlanJson(source);',
        "  return { status: 'branch-bypass' };",
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-04.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        '  try { return parseRepairPlanJson(source); }',
        "  catch { return { status: 'catch-bypass' }; }",
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-05.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        '  let parsed = parseRepairPlanJson(source);',
        "  parsed = { status: 'reassigned' };",
        '  return parsed;',
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-06.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        "  const parsers: Record<string, (value: string) => RepairPlan> = { canonical: parseRepairPlanJson };",
        "  return parsers[source]?.(source) ?? { status: 'dynamic' };",
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-07.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan {',
        "  if (source.length === 0) throw new Error('empty');",
        '  parseRepairPlanJson(source);',
        '  return readRequiredRepairPlan(source.slice(1));',
        '}'
      ].join('\n'),
    'src/adapters/workspace/bypass-08.ts': [
        "import { parseRepairPlanJson, type RepairPlan } from '../../semantics/repair/types.ts';",
        'function readRequiredRepairPlan(source: string): RepairPlan | undefined {',
        '  if (source.length > 0) return parseRepairPlanJson(source);',
        '}'
      ].join('\n')
  };
  const model = compileCausalReaderFixture(readerSources);
  for (const path of Object.keys(readerSources)) {
    expect(model.declarations).toContainEqual(expect.objectContaining({
      path,
      name: 'readRequiredRepairPlan'
    }));
    expect(model.candidates.filter(({ code, paths }) => (
      code === 'causal-relation-owner-bypass' && paths.includes(path)
    ))).toEqual([expect.objectContaining({
      code: 'causal-relation-owner-bypass',
      subject: 'semantic.repair-plan:parser/readback',
      observationClass: 'derived',
      paths: expect.arrayContaining([path])
    })]);
  }
});
