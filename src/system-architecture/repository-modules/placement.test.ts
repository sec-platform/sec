import { expect, test } from 'bun:test';

import { compileSecRepositoryModuleGraph } from '../../brownfield/source-program-model/typescript.ts';
import {
  type SecModuleDescriptor,
  type SecModuleOperationObligation,
  type SecRepositoryModuleMembership,
  type SecRepositoryModuleSourceProgramFacts
} from './contract.ts';
import {
  compileSecRepositoryModulePlacementAdmission
} from './placement.ts';

const operationObligation: SecModuleOperationObligation = Object.freeze({
  operation: Object.freeze({ kind: 'capability', capability: 'example.execution', operation: 'run' }),
  consumerSupport: Object.freeze({ consumers: Object.freeze(['example.consumer']) }),
  effect: Object.freeze({
    kinds: Object.freeze(['process'] as const),
    failureKinds: Object.freeze(['example.failed']),
    recovery: 'owner-intervention'
  }),
  evolution: Object.freeze({ migration: 'not-required', retirement: 'replacement-obligations-satisfied' }),
  resources: Object.freeze({
    aggregateBudgets: Object.freeze([
      Object.freeze({ resource: 'duration-ms', maximum: 1_000 }),
      Object.freeze({ resource: 'input-bytes', maximum: 1_000 }),
      Object.freeze({ resource: 'output-bytes', maximum: 1_000 }),
      Object.freeze({ resource: 'processes', maximum: 1 })
    ])
  }),
  futureSupport: Object.freeze({ condition: 'semantic-superset-required' })
});

function descriptor(moduleId: string, root: string): SecModuleDescriptor {
  return Object.freeze({
    moduleId,
    root,
    importGraph: 'runtime',
    externalEntrypoints: Object.freeze([]),
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'example.execution',
      operations: Object.freeze(['run']),
      effectKinds: Object.freeze(['process'] as const),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([Object.freeze({
        operation: 'run',
        role: 'domain-owner',
        semanticOperation: 'example.operation',
        requirementId: null,
        recovery: null
      })])
    })]),
    operationObligations: Object.freeze([operationObligation]),
    causalRelations: Object.freeze([]),
    preDependencyBootstrap: false
  });
}

function fixture(input: Readonly<{
  runImportsHelper?: boolean;
  runImportsContract?: boolean;
  reverseContractImport?: boolean;
  includeUnclassified?: boolean;
}>) {
  const alpha = descriptor('example.alpha', 'src/example-alpha');
  const beta = descriptor('example.beta', 'src/example-beta');
  const runPath = 'src/example-alpha/run.ts';
  const helperPath = 'src/example-alpha/helper.ts';
  const contractPath = 'src/example-beta/contract.ts';
  const unknownPath = 'src/example-alpha/unknown.ts';
  const files = [runPath, helperPath, contractPath, ...(input.includeUnclassified ? [unknownPath] : [])];
  const source = new Map<string, string>([
    [runPath, `${input.runImportsHelper ? "import { helper } from './helper.ts';\n" : ''}${input.runImportsContract ? "import type { Contract } from '../example-beta/contract.ts';\n" : ''}export function run(): ${input.runImportsContract ? 'Contract' : 'number'} { return ${input.runImportsContract ? "{ value: 'ready' }" : input.runImportsHelper ? 'helper()' : '1'}; }`],
    [helperPath, 'export function helper() { return 1; }'],
    [contractPath, `${input.reverseContractImport ? "import { run } from '../example-alpha/run.ts';\n" : ''}export interface Contract { value: string; }`],
    [unknownPath, 'export function publicUnknown() {}\nfunction effectUnknown() {}']
  ]);
  const graph = compileSecRepositoryModuleGraph({
    files,
    readSource: (path) => source.get(path) ?? null
  });
  const membership: SecRepositoryModuleMembership = Object.freeze({
    descriptors: Object.freeze([alpha, beta]),
    graphRoots: Object.freeze(['src']),
    moduleRoots: Object.freeze([alpha.root, beta.root]),
    moduleForPath: (path) => path.startsWith(`${alpha.root}/`) ? alpha : path.startsWith(`${beta.root}/`) ? beta : null
  });
  const declarations = Object.freeze([
    Object.freeze({ observationId: 'node-run', declarationDigest: 'digest-run', path: runPath, moduleId: alpha.moduleId, name: 'run', kind: 'FunctionDeclaration', exported: true }),
    Object.freeze({ observationId: 'node-helper', declarationDigest: 'digest-helper', path: helperPath, moduleId: alpha.moduleId, name: 'helper', kind: 'FunctionDeclaration', exported: true }),
    Object.freeze({ observationId: 'node-contract', declarationDigest: 'digest-contract', path: contractPath, moduleId: beta.moduleId, name: 'Contract', kind: 'InterfaceDeclaration', exported: true }),
    ...(input.includeUnclassified ? [
      Object.freeze({ observationId: 'node-public-unknown', declarationDigest: 'digest-public', path: unknownPath, moduleId: alpha.moduleId, name: 'publicUnknown', kind: 'FunctionDeclaration', exported: true }),
      Object.freeze({ observationId: 'node-effect-unknown', declarationDigest: 'digest-effect', path: unknownPath, moduleId: alpha.moduleId, name: 'effectUnknown', kind: 'FunctionDeclaration', exported: false })
    ] : [])
  ]);
  const facts: SecRepositoryModuleSourceProgramFacts & { files: readonly ({
    path: string;
    moduleId: string | null;
    surface: 'production';
    semanticKind: 'declaration-owner';
    semanticObservationClass: 'observed';
    sourceLines: number;
  })[] } = {
    sourceRevision: 'source-revision',
    semanticRevision: 'semantic-revision',
    files: Object.freeze(files.map((path) => Object.freeze({
      path,
      moduleId: membership.moduleForPath(path)!.moduleId,
      surface: 'production' as const,
      semanticKind: 'declaration-owner' as const,
      semanticObservationClass: 'observed' as const,
      sourceLines: (source.get(path) ?? '').split(/\r\n|\r|\n/u).length
    }))),
    declarations,
    references: input.includeUnclassified ? Object.freeze([Object.freeze({
      path: contractPath,
      sourceObservationId: 'node-contract',
      targetObservationId: 'node-public-unknown',
      targetPath: unknownPath,
      observationClass: 'observed' as const
    })]) : Object.freeze([]),
    entrypoints: Object.freeze([]),
    entrypointClosures: Object.freeze([]),
    capabilities: input.includeUnclassified ? Object.freeze([Object.freeze({
      observationId: 'capability-effect',
      path: unknownPath,
      moduleId: alpha.moduleId,
      surface: 'production' as const,
      capability: 'process',
      operation: 'spawn',
      owningDeclarationObservationId: 'node-effect-unknown',
      providerCapability: null,
      providerModuleId: null,
      transport: 'native-runtime',
      observationClass: 'observed' as const
    })]) : Object.freeze([])
  };
  return { alpha, beta, facts, graph, membership };
}

test('responsibility admission resolves compiler and descriptor facts while blocking only critical unknowns', () => {
  const input = fixture({ includeUnclassified: true, reverseContractImport: true });
  const result = compileSecRepositoryModulePlacementAdmission({
    graph: input.graph,
    membership: input.membership,
    facts: input.facts
  });

  expect(result.responsibilityFrontier).toContainEqual(expect.objectContaining({
    nodeId: 'node-run', status: 'resolved', responsibility: 'operation'
  }));
  expect(result.responsibilityFrontier).toContainEqual(expect.objectContaining({
    nodeId: 'node-contract', status: 'resolved', responsibility: 'contract'
  }));
  expect(result.violations.map(({ code }) => code)).toContain(
    'repository-public-declaration-responsibility-unresolved'
  );
  expect(result.violations.map(({ code }) => code)).toContain(
    'repository-effectful-declaration-responsibility-unresolved'
  );
  expect(result.violations.map(({ code }) => code)).toContain(
    'repository-node-responsibility-reverse-dependency'
  );
});
