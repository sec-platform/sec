import { expect, test } from 'bun:test';

import { compilerRoot } from "../../workspace-context.ts";
import { compileRepositoryModuleGraph } from '../source-program-model/typescript.ts';
import {
  assertRepositoryModuleArchitectureBoundaries,
  assertRepositoryModuleImportBoundaries,
  assertRepositoryModuleSourceProgramBoundaries,
  collectRepositoryModuleBoundaryViolations,
  collectRepositoryModuleSourceProgramViolations,
  compileRepositoryModuleArchitectureProjection,
  compileRepositoryModuleMembership,
  compileRepositoryModuleTopologyProjection,
  parseModuleDescriptor,
  parseModuleDescriptorJson,
  type ModuleOperationRoleBinding
} from './contract.ts';

function repositoryModuleTestDescriptor(
  root: string
): ReturnType<typeof parseModuleDescriptor> {
  return parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: []
  }, `${root}/module.json`);
}

test('repository module descriptors resolve unique physical roots and external entrypoints', () => {
  const membership = compileRepositoryModuleMembership(compilerRoot);

  expect(new Set(membership.descriptors.map(({ moduleId }) => moduleId)).size)
    .toBe(membership.descriptors.length);
  for (const descriptor of membership.descriptors) {
    expect(membership.moduleForPath(descriptor.root)?.moduleId, descriptor.root)
      .toBe(descriptor.moduleId);
    for (const entrypoint of descriptor.externalEntrypoints) {
      expect(membership.moduleForPath(entrypoint)?.moduleId, entrypoint)
        .toBe(descriptor.moduleId);
    }
  }
});

test('repository module descriptor parser rejects unknown fields and invalid paths', () => {
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: []
  } as const;
  const descriptorPath = 'src/example/module.json';

  expect(parseModuleDescriptor(descriptor, descriptorPath).root).toBe('src/example');
  expect(() => parseModuleDescriptor({ ...descriptor, architectureRole: 'query' }, descriptorPath))
    .toThrow('architectureRole');
  expect(() => parseModuleDescriptor({ ...descriptor, architectureRole: 'service' }, descriptorPath))
    .toThrow('architectureRole');
  expect(() => parseModuleDescriptor({ ...descriptor, covered: true }, descriptorPath))
    .toThrow('unknown field');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    authorityRefs: ['system-architecture']
  }, descriptorPath)).toThrow('unknown field');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    externalEntrypoints: ['src/adapters/self-hosting/development/runner/cli.ts', 'src/adapters/self-hosting/development/runner/cli.ts']
  }, descriptorPath))
    .toThrow('entries must be unique');
  expect(() => parseModuleDescriptor(descriptor, '../module.json'))
    .toThrow('descriptorPath');
  expect(() => parseModuleDescriptorJson(
    '{"importGraph":"runtime","importGraph":"content","externalEntrypoints":[]}',
    descriptorPath
  )).toThrow('duplicate key');
});

test('repository module operation obligations are strict and bind declared public identities', () => {
  const obligation = {
    operation: {
      kind: 'capability',
      capability: 'example-operation',
      operation: 'execute'
    },
    consumerSupport: { consumers: ['consumer'] },
    effect: {
      kinds: ['process'],
      failureKinds: ['process-unavailable'],
      recovery: 'idempotent-retry'
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
  } as const;
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{ capability: 'example-operation', operations: ['execute'] }],
    operationObligations: [obligation]
  } as const;

  expect(parseModuleDescriptor(descriptor, 'src/provider/module.json')
    .operationObligations).toEqual([obligation]);
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{ ...obligation, resources: undefined }]
  }, 'src/provider/module.json')).toThrow('resources: expected an object');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      evolution: { retirement: 'replacement-obligations-satisfied' }
    }]
  }, 'src/provider/module.json')).toThrow('expected exact keys');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      resources: { aggregateBudgets: [] }
    }]
  }, 'src/provider/module.json')).toThrow('expected between 1 and 16 entries');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      resources: {
        aggregateBudgets: obligation.resources.aggregateBudgets.filter(
          ({ resource }) => resource !== 'input-bytes'
        )
      }
    }]
  }, 'src/provider/module.json')).toThrow(
    'process Effect obligation must declare exactly one input-bytes ceiling'
  );
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      resources: {
        aggregateBudgets: obligation.resources.aggregateBudgets.map((budget) => (
          budget.resource === 'output-bytes' ? { ...budget, maximum: 0 } : budget
        ))
      }
    }]
  }, 'src/provider/module.json')).toThrow('expected a canonical static aggregate ceiling');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      operation: { ...obligation.operation, operation: 'undeclared' }
    }]
  }, 'src/provider/module.json')).toThrow('must bind one declared capability provider operation');
});

test('effectful provider exposure separates owner internals from operation-bound public capabilities', () => {
  const obligation = {
    operation: {
      kind: 'capability',
      capability: 'example-process',
      operation: 'openSession'
    },
    consumerSupport: { consumers: ['consumer'] },
    effect: {
      kinds: ['process'],
      failureKinds: ['process-unavailable'],
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
  } as const;
  const provider = {
    capability: 'example-process',
    operations: ['nativePrimitive', 'openSession'],
    effectKinds: ['process'],
    ownerInternalOperations: ['nativePrimitive']
  } as const;
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [provider],
    operationObligations: [obligation]
  } as const;

  expect(parseModuleDescriptor(descriptor, 'src/provider/module.json')
    .capabilityProviders).toEqual([{ ...provider, operationRoles: [] }]);
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: []
  }, 'src/provider/module.json')).toThrow('requires an operation obligation');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      effect: { kinds: ['filesystem'], failureKinds: ['io-failed'], recovery: 'owner-intervention' }
    }]
  }, 'src/provider/module.json')).toThrow('omits an intrinsic provider effect');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      operation: { ...obligation.operation, operation: 'nativePrimitive' }
    }]
  }, 'src/provider/module.json')).toThrow('owner-internal operation');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...provider,
      ownerInternalOperations: ['undeclaredPrimitive']
    }]
  }, 'src/provider/module.json')).toThrow('must be declared provider operations');
});

test('repository module capability roles bind exact operations and recovery addresses', () => {
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{
      capability: 'runtime.store',
      operations: ['append', 'recover'],
      operationRoles: [{
        operation: 'append',
        role: 'durable-worker',
        semanticOperation: 'runtime.store-append',
        requirementId: null,
        recovery: {
          capability: 'runtime.recovery',
          operation: 'recover',
          semanticOperation: 'runtime.store-append'
        }
      }]
    }],
    operationObligations: []
  } as const;
  expect(parseModuleDescriptor(descriptor, 'src/runtime-store/module.json')
    .capabilityProviders[0]?.operationRoles).toEqual([{
      operation: 'append',
      role: 'durable-worker',
      semanticOperation: 'runtime.store-append',
      requirementId: null,
      recovery: {
        capability: 'runtime.recovery',
        operation: 'recover',
        semanticOperation: 'runtime.store-append'
      }
    }]);
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [{
        operation: 'undeclared',
        role: 'durable-worker',
        semanticOperation: 'runtime.store-append',
        requirementId: null,
        recovery: null
      }]
    }]
  }, 'src/runtime-store/module.json')).toThrow('must be one declared provider operation');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [{
        operation: 'append',
        role: 'readback-issuer',
        semanticOperation: 'runtime.store-append',
        requirementId: 'runtime.store-provider',
        recovery: {
          capability: 'runtime.recovery',
          operation: 'recover',
          semanticOperation: 'runtime.store-append'
        }
      }]
    }]
  }, 'src/runtime-store/module.json')).toThrow('only valid for a durable-worker');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [{
        operation: 'append',
        role: 'provider-settlement-issuer',
        semanticOperation: 'runtime.store-append',
        requirementId: null,
        recovery: null
      }]
    }]
  }, 'src/runtime-store/module.json')).toThrow('is required for provider-settlement-issuer');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [{
        operation: 'append',
        role: 'durable-worker',
        semanticOperation: 'runtime.store-append',
        requirementId: null,
        recovery: {
          capability: 'runtime.recovery',
          operation: 'recover',
          semanticOperation: 'runtime.other-operation'
        }
      }]
    }]
  }, 'src/runtime-store/module.json')).toThrow('must bind the durable worker semantic operation');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [{
        operation: 'append',
        role: 'durable-worker',
        semanticOperation: 'invalid',
        requirementId: null,
        recovery: null
      }]
    }]
  }, 'src/runtime-store/module.json')).toThrow('has an invalid format');

  expect(parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{
      capability: 'verification.test-registration',
      operations: ['register'],
      operationRoles: [{
        operation: 'register',
        role: 'registration-issuer',
        semanticOperation: 'verification.effectful-test',
        requirementId: null,
        recovery: null
      }]
    }],
    operationObligations: []
  }, 'tests/module.json').capabilityProviders[0]?.operationRoles[0]?.role)
    .toBe('registration-issuer');
});

test('repository module conflicts only exact provider settlement and readback relations', () => {
  const role = (
    operation: string,
    issuerRole: 'provider-settlement-issuer' | 'readback-issuer',
    semanticOperation: string,
    requirementId: string
  ) => ({ operation, role: issuerRole, semanticOperation, requirementId, recovery: null });
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{
      capability: 'runtime.provider',
      operations: ['settle', 'readback'],
      operationRoles: [
        role('settle', 'provider-settlement-issuer', 'runtime.operation-a', 'runtime.provider-a'),
        role('readback', 'readback-issuer', 'runtime.operation-b', 'runtime.provider-b')
      ]
    }],
    operationObligations: []
  } as const;
  expect(parseModuleDescriptor(descriptor, 'src/runtime-provider/module.json')
    .capabilityProviders[0]?.operationRoles).toHaveLength(2);
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      ...descriptor.capabilityProviders[0],
      operationRoles: [
        role('settle', 'provider-settlement-issuer', 'runtime.operation-a', 'runtime.provider-a'),
        role('readback', 'readback-issuer', 'runtime.operation-a', 'runtime.provider-a')
      ]
    }]
  }, 'src/runtime-provider/module.json')).not.toThrow();
  expect(() => parseModuleDescriptor({
    ...descriptor,
    capabilityProviders: [{
      capability: 'runtime.provider-a',
      operations: ['settle'],
      operationRoles: [
        role('settle', 'provider-settlement-issuer', 'runtime.operation-a', 'runtime.provider-a')
      ]
    }, {
      capability: 'runtime.provider-b',
      operations: ['settle'],
      operationRoles: [
        role('settle', 'provider-settlement-issuer', 'runtime.operation-a', 'runtime.provider-a')
      ]
    }]
  }, 'src/runtime-provider/module.json')).toThrow(
    'semantic operation requirement issuer relations must be unique across the module'
  );
});

test('repository architecture rejects omitted authority roles and same-owner issuer composition', () => {
  const attemptRole = {
    operation: 'issueAttempt',
    role: 'attempt-issuer',
    semanticOperation: 'example.operation',
    requirementId: null,
    recovery: null
  } as const;
  const grantRole = {
    operation: 'issueGrant',
    role: 'grant-issuer',
    semanticOperation: 'example.operation',
    requirementId: null,
    recovery: null
  } as const;
  const bindingRole = {
    operation: 'issueBinding',
    role: 'binding-issuer',
    semanticOperation: 'example.operation',
    requirementId: 'example.provider',
    recovery: null
  } as const;
  const compile = (
    operationRoles: readonly ModuleOperationRoleBinding[],
    operations: readonly string[] = ['issueAttempt', 'issueBinding', 'issueGrant']
  ) => {
    const descriptor = parseModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [{
        capability: 'example.authority',
        operations,
        operationRoles
      }]
    }, 'src/authority/module.json');
    const files = ['src/authority/issuer.ts'];
    const graph = compileRepositoryModuleGraph({
      files: files,
      readSource: () => operations.map((name) => `export function ${name}(): void {}`).join('\n')
    });
    return compileRepositoryModuleArchitectureProjection(graph, {
      descriptors: [descriptor],
      graphRoots: ['src/authority'],
      moduleRoots: ['src/authority'],
      moduleForPath: () => descriptor
    }, {
      files: [{
        path: files[0]!,
        moduleId: descriptor.moduleId,
        surface: 'production',
        semanticKind: 'executable',
        semanticObservationClass: 'observed'
      }],
      declarations: operations.map((name) => ({
        path: files[0]!,
        moduleId: descriptor.moduleId,
        name,
        exported: true
      })),
      entrypoints: [],
      entrypointClosures: []
    });
  };

  const omitted = compile([attemptRole, grantRole]);
  expect(omitted.violations).toContainEqual(expect.objectContaining({
    code: 'authority-mint-export-unclassified',
    from: 'src/authority/issuer.ts',
    to: 'example.authority:issueBinding'
  }));

  const exact = compile([attemptRole, bindingRole, grantRole]);
  expect(exact.violations.some(({ code }) => code === 'authority-mint-export-unclassified'))
    .toBe(false);
  expect(exact.violations).toContainEqual(expect.objectContaining({
    code: 'repository-module-role-unresolved',
    detail: 'authority co-owns independent semantic operation roles for example.operation: attempt-issuer, binding-issuer, grant-issuer'
  }));

  const role = (name: string, issuerRole: ModuleOperationRoleBinding['role'], requirementId: string | null) => ({
    operation: name, role: issuerRole, semanticOperation: 'example.operation', requirementId, recovery: null
  });
  const requirementIdForRole = (
    issuerRole: ModuleOperationRoleBinding['role']
  ): string | null => issuerRole === 'binding-issuer'
    || issuerRole === 'provider-settlement-issuer'
    || issuerRole === 'readback-issuer'
    ? 'example.provider'
    : null;
  const incompatible = [
    ['domain-owner', 'grant-issuer'],
    ['grant-issuer', 'attempt-issuer'],
    ['grant-issuer', 'binding-issuer'],
    ['grant-issuer', 'provider-settlement-issuer'],
    ['provider-settlement-issuer', 'readback-issuer'],
    ['readback-issuer', 'recovery-issuer']
  ] as const;
  for (const [left, right] of incompatible) {
    const roles = [
      role('left', left, requirementIdForRole(left)),
      role('right', right, requirementIdForRole(right))
    ];
    expect(compile(roles, ['left', 'right']).violations).toContainEqual(expect.objectContaining({ code: 'repository-module-role-unresolved' }));
  }
  for (const roles of [
    [role('attempt', 'attempt-issuer', null), role('recover', 'recovery-issuer', null)],
    [role('bind', 'binding-issuer', 'example.provider'), role('settle', 'provider-settlement-issuer', 'example.provider')],
    [role('domain', 'domain-owner', null), role('readback', 'readback-issuer', 'example.provider')]
  ]) {
    expect(compile(roles, roles.map(({ operation }) => operation)).violations.some(({ code }) => code === 'repository-module-role-unresolved')).toBe(false);
  }
});

test('repository module causal relations bind semantic subjects to exact module symbols', () => {
  const relation = {
    subject: 'semantic.repair-plan',
    relation: 'parses',
    symbol: {
      path: 'src/semantics/repair/types.ts',
      name: 'parseRepairPlanJson'
    },
    operation: null
  } as const;
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    causalRelations: [relation]
  } as const;
  expect(parseModuleDescriptor(descriptor, 'src/semantics/repair/module.json')
    .causalRelations).toEqual([relation]);
  expect(() => parseModuleDescriptor({
    ...descriptor,
    causalRelations: [{
      ...relation,
      symbol: { ...relation.symbol, path: 'src/bootstrap/cli/register-commands.ts' }
    }]
  }, 'src/semantics/repair/module.json')).toThrow('must remain inside the declaring module root');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    causalRelations: [relation, relation]
  }, 'src/semantics/repair/module.json')).toThrow('relations must be unique');
  expect(() => parseModuleDescriptor({
    ...descriptor,
    causalRelations: [{
      ...relation,
      operation: { semanticOperation: 'invalid', requirementId: null }
    }]
  }, 'src/semantics/repair/module.json')).toThrow('has an invalid format');
});

test('repository module compiler prevents production from importing test authority', () => {
  const files = [
    'src/example/index.ts',
    'tests/unit/example-provider.ts'
  ];
  const sources = new Map([
    ['src/example/index.ts', "export { provider } from '../../tests/unit/example-provider.ts';"],
    ['tests/unit/example-provider.ts', 'export const provider = true;']
  ]);

  expect(() => compileRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  })).toThrow('production repository module imports test-only module');
});

test('repository module compiler does not infer visibility from directory names', () => {
  const files = [
    'src/consumer/index.ts',
    'src/provider/runtime/effect.ts'
  ];
  const sources = new Map([
    ['src/consumer/index.ts', "export { effect } from '../provider/runtime/effect.ts';"],
    ['src/provider/runtime/effect.ts', 'export const effect = true;']
  ]);
  const graph = compileRepositoryModuleGraph({
    files: files,
    readSource: (file) => sources.get(file) ?? null
  });
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');

  expect(() => assertRepositoryModuleImportBoundaries(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src/consumer', 'src/provider'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  })).not.toThrow();
});

test('edit-loop topology and full semantic architecture share one exact owner graph', () => {
  const files = ['src/alpha/runtime.ts', 'src/beta/runtime.ts'];
  const sources = new Map([
    ['src/alpha/runtime.ts', "import { beta } from '../beta/runtime.ts'; export const alpha = beta;"],
    ['src/beta/runtime.ts', "import { alpha } from '../alpha/runtime.ts'; export const beta = alpha;"]
  ]);
  const alpha = repositoryModuleTestDescriptor('src/alpha');
  const beta = repositoryModuleTestDescriptor('src/beta');
  const membership = {
    descriptors: [alpha, beta],
    graphRoots: ['src'],
    moduleRoots: ['src/alpha', 'src/beta'],
    moduleForPath: (file: string) => file.startsWith('src/alpha/') ? alpha : beta
  };
  const graph = compileRepositoryModuleGraph({
    files: files,
    readSource: (file) => sources.get(file) ?? null
  });
  const topology = compileRepositoryModuleTopologyProjection(graph, membership);
  const architecture = compileRepositoryModuleArchitectureProjection(graph, membership, {
    files: files.map((path) => ({
      path,
      moduleId: membership.moduleForPath(path).moduleId,
      surface: 'production' as const,
      semanticKind: 'executable' as const,
      semanticObservationClass: 'observed' as const
    })),
    entrypoints: [],
    entrypointClosures: [],
    capabilities: []
  });

  expect(topology.ownerEdges).toEqual(architecture.ownerEdges);
  expect(topology.strongComponents).toEqual(architecture.strongComponents);
  expect(topology.feedbackCuts).toEqual(architecture.feedbackCuts);
  expect(topology.strongComponents).toHaveLength(1);
  expect(topology.feedbackCuts).toHaveLength(1);
});

test('repository topology projects same-owner file cycles from the canonical graph', () => {
  const descriptor = repositoryModuleTestDescriptor('src/owner');
  const files = [
    'src/owner/a.ts',
    'src/owner/b.ts',
    'src/owner/consumer.ts',
    'src/owner/observation.spec.ts',
    'src/owner/self.ts'
  ];
  const sources = new Map([
    ['src/owner/a.ts', "import { b } from './b.ts'; export const a = b;"],
    ['src/owner/b.ts', "import { a } from './a.ts'; export const b = a;"],
    ['src/owner/consumer.ts', "import { a } from './a.ts'; export const consumer = a;"],
    ['src/owner/observation.spec.ts', "import { consumer } from './consumer.ts'; void consumer;"],
    ['src/owner/self.ts', "import './self.ts'; export const self = true;"]
  ]);
  const membership = {
    descriptors: [descriptor],
    graphRoots: [descriptor.root],
    moduleRoots: [descriptor.root],
    moduleForPath: () => descriptor
  };
  const compile = (orderedFiles: readonly string[]) => compileRepositoryModuleTopologyProjection(
    compileRepositoryModuleGraph({ files: orderedFiles, readSource: (file) => sources.get(file) ?? null }),
    membership
  );
  const topology = compile(files);

  expect(topology.ownerEdges).toEqual([]);
  expect(topology.strongComponents).toEqual([]);
  expect(topology.fileStrongComponents).toEqual([
    {
      ownerId: descriptor.moduleId,
      paths: ['src/owner/a.ts', 'src/owner/b.ts'],
      edges: [
        expect.objectContaining({ fromPath: 'src/owner/a.ts', toPath: 'src/owner/b.ts' }),
        expect.objectContaining({ fromPath: 'src/owner/b.ts', toPath: 'src/owner/a.ts' })
      ]
    },
    {
      ownerId: descriptor.moduleId,
      paths: ['src/owner/self.ts'],
      edges: [expect.objectContaining({
        fromPath: 'src/owner/self.ts',
        toPath: 'src/owner/self.ts'
      })]
    }
  ]);
  expect(topology.violations).toContainEqual(expect.objectContaining({
    code: 'repository-module-internal-cycle',
    from: 'src/owner/a.ts',
    to: 'src/owner/b.ts'
  }));
  expect(compile([...files].reverse())).toEqual(topology);
});

test('cross-owner aggregate facades are TypeScript facts rather than index filename policy', () => {
  const files = [
    'src/consumer/use.ts',
    'src/provider/public.ts',
    'src/provider/contract.ts',
    'src/provider/runtime/effect.ts'
  ];
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const membership = {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file: string) => file.startsWith('src/consumer/') ? consumer : provider
  };

  const publicGraph = compileRepositoryModuleGraph({
    files: files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export type { Contract } from '../provider/contract.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  expect(() => assertRepositoryModuleImportBoundaries(publicGraph, membership)).not.toThrow();

  const aggregateGraph = compileRepositoryModuleGraph({
    files: files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export type { Contract } from '../provider/public.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : file === 'src/provider/public.ts'
          ? 'export type { Contract } from \'./contract.ts\';'
          : 'export const effect = true;'
  });
  const sourceProgramFacts = {
    files: files.map((path) => ({
      path,
      moduleId: path.startsWith('src/consumer/') ? consumer.moduleId : provider.moduleId,
      surface: 'production' as const,
      semanticKind: path === 'src/provider/public.ts'
        ? 'pure-reexport' as const
        : path === 'src/provider/runtime/effect.ts' || path === 'src/consumer/use.ts'
          ? 'executable' as const
          : 'declaration-owner' as const,
      semanticObservationClass: 'derived' as const
    })),
    entrypoints: [],
    entrypointClosures: [],
    capabilities: []
  };
  const aggregateProjection = compileRepositoryModuleArchitectureProjection(
    aggregateGraph,
    membership,
    sourceProgramFacts
  );
  expect(aggregateProjection.aggregateFacadePaths).toEqual(['src/provider/public.ts']);
  expect(() => assertRepositoryModuleArchitectureBoundaries(
    aggregateGraph,
    membership,
    sourceProgramFacts
  ))
    .toThrow('[cross-package-aggregate-surface]');

  const implementationGraph = compileRepositoryModuleGraph({
    files: files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export { effect } from '../provider/runtime/effect.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  const implementationProjection = compileRepositoryModuleArchitectureProjection(
    implementationGraph,
    membership,
    sourceProgramFacts
  );
  expect(implementationProjection.aggregateFacadePaths).toEqual([]);
  expect(implementationProjection.violations).toEqual([]);
});

test('pre-dependency entrypoints cannot import an unavailable package', () => {
  const descriptor = parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/bootstrap/cli.ts'],
    preDependencyBootstrap: true
  }, 'src/bootstrap/module.json');
  const graph = compileRepositoryModuleGraph({ files: ['src/bootstrap/cli.ts'], readSource: () => "import 'unmaterialized-package';" });
  expect(() => assertRepositoryModuleImportBoundaries(graph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).toThrow('[pre-dependency-bootstrap-unavailable-package]');

  const postBootstrapGraph = compileRepositoryModuleGraph({ files: ['src/bootstrap/cli.ts'], readSource: () => "void import('materialized-after-bootstrap');" });
  expect(() => assertRepositoryModuleImportBoundaries(postBootstrapGraph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).not.toThrow();
});

test('repository module admission rejects retired src/apps and src/modules roots', () => {
  for (const retiredRoot of ['src/apps', 'src/modules']) {
    expect(() => compileRepositoryModuleGraph({ files: [`${retiredRoot}/legacy.ts`], readSource: () => 'export {};' })).toThrow('retired repository root');

    expect(() => parseModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: []
    }, `${retiredRoot}/module.json`)).toThrow('retired repository root');
  }
});

test('repository module boundary compiler does not turn internal path spelling into policy', () => {
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const graph = compileRepositoryModuleGraph({ files: [
    'src/consumer/index.ts',
    'src/provider/index.ts',
    'src/provider/internal/private.ts',
    'src/provider/operation.ts'
  ], readSource: (file) => file === 'src/consumer/index.ts'
    ? [
      "import '../provider/internal/private.ts';",
      "import '../provider/operation.ts';"
    ].join('\n')
    : 'export {};' });
  const violations = collectRepositoryModuleBoundaryViolations(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: [consumer.root, provider.root],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  });

  expect(violations).toEqual([]);
});

test('repository module dependency cycles exclude test observation edges', () => {
  const first = repositoryModuleTestDescriptor('src/first');
  const second = repositoryModuleTestDescriptor('src/second');
  const tests = repositoryModuleTestDescriptor('tests');
  const membership = {
    descriptors: [first, second, tests],
    graphRoots: ['src', 'tests'],
    moduleRoots: [first.root, second.root, tests.root],
    moduleForPath: (file: string) => file.startsWith('src/first/')
      ? first
      : file.startsWith('src/second/') ? second : tests
  };
  const observationGraph = compileRepositoryModuleGraph({ files: [
    'src/first/index.ts',
    'src/second/index.ts',
    'src/second/reverse.spec.ts',
    'tests/observation.test.ts'
  ], readSource: (file) => file === 'src/first/index.ts'
    ? "import '../second/index.ts';"
    : file === 'tests/observation.test.ts'
      ? "import '../src/first/index.ts';"
      : file === 'src/second/reverse.spec.ts'
        ? "import '../first/index.ts';"
      : 'export {};' });
  expect(collectRepositoryModuleBoundaryViolations(observationGraph, membership)
    .some(({ code }) => code === 'module-dependency-cycle')).toBe(false);

  const productionCycleGraph = compileRepositoryModuleGraph({ files: ['src/first/index.ts', 'src/second/index.ts'], readSource: (file) => file === 'src/first/index.ts'
    ? "import '../second/index.ts';"
    : "import '../first/index.ts';" });
  expect(collectRepositoryModuleBoundaryViolations(productionCycleGraph, membership)
    .filter(({ code }) => code === 'module-dependency-cycle')).toHaveLength(1);
});

test('repository architecture projects stable SCC witnesses, reciprocal pairs, and an acyclic feedback cut', () => {
  const alpha = repositoryModuleTestDescriptor('src/alpha');
  const beta = repositoryModuleTestDescriptor('src/beta');
  const membership = {
    descriptors: [beta, alpha],
    graphRoots: ['src'],
    moduleRoots: [beta.root, alpha.root],
    moduleForPath: (file: string) => file.startsWith('src/alpha/') ? alpha : beta
  };
  const files = ['src/beta/b.ts', 'src/alpha/a.ts'];
  const sources = new Map([
    ['src/alpha/a.ts', "import '../beta/b.ts'; export const alpha = true;"],
    ['src/beta/b.ts', "import '../alpha/a.ts'; export const beta = true;"]
  ]);
  const facts = {
    files: files.map((path) => ({
      path,
      moduleId: path.startsWith('src/alpha/') ? alpha.moduleId : beta.moduleId,
      surface: 'production' as const,
      semanticKind: 'declaration-owner' as const,
      semanticObservationClass: 'derived' as const
    })),
    entrypoints: [],
    entrypointClosures: []
  };
  const compile = (orderedFiles: readonly string[]) => {
    const graph = compileRepositoryModuleGraph({ files: orderedFiles, readSource: (file) => sources.get(file) ?? null });
    return compileRepositoryModuleArchitectureProjection(graph, membership, facts);
  };
  const projection = compile(files);

  expect(projection.ownerEdges.map(({ fromOwner, toOwner }) => [fromOwner, toOwner]))
    .toEqual([
      [alpha.moduleId, beta.moduleId],
      [beta.moduleId, alpha.moduleId]
    ]);
  expect(projection.strongComponents).toEqual([expect.objectContaining({
    ownerIds: [alpha.moduleId, beta.moduleId]
  })]);
  expect(projection.reciprocalPairs).toHaveLength(1);
  expect(projection.feedbackCuts).toEqual([expect.objectContaining({
    fromOwner: beta.moduleId,
    toOwner: alpha.moduleId,
    witnesses: [expect.objectContaining({
      fromPath: 'src/beta/b.ts',
      toPath: 'src/alpha/a.ts'
    })]
  })]);
  expect(compile([...files].reverse())).toEqual(projection);
});

test('repository architecture derives one node responsibility and rejects reverse node dependencies', () => {
  const descriptors = [
    repositoryModuleTestDescriptor('src/contracts'),
    repositoryModuleTestDescriptor('src/computation'),
    parseModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [{ capability: 'clock', operations: ['readClock'] }]
    }, 'src/capability/module.json'),
    repositoryModuleTestDescriptor('src/operation'),
    repositoryModuleTestDescriptor('src/workflow'),
    parseModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: ['src/entry/cli.ts']
    }, 'src/entry/module.json')
  ];
  const files = [
    'src/contracts/types.ts',
    'src/computation/value.ts',
    'src/capability/clock.ts',
    'src/operation/execute.ts',
    'src/workflow/run.ts',
    'src/entry/cli.ts'
  ];
  const membership = {
    descriptors,
    graphRoots: ['src'],
    moduleRoots: descriptors.map(({ root }) => root),
    moduleForPath: (file: string) => descriptors.find(({ root }) => file.startsWith(`${root}/`)) ?? null
  };
  const sources = new Map([
    ['src/contracts/types.ts', 'export interface Value { readonly value: string; }'],
    ['src/computation/value.ts', "import type { Value } from '../contracts/types.ts'; export const value: Value = { value: 'x' };"],
    ['src/capability/clock.ts', 'export function readClock(): number { return 0; }'],
    ['src/operation/execute.ts', "import { readClock } from '../capability/clock.ts'; export const execute = () => readClock();"],
    ['src/workflow/run.ts', "import { execute } from '../operation/execute.ts'; export const run = () => execute();"],
    ['src/entry/cli.ts', "import { run } from '../workflow/run.ts'; run();"]
  ]);
  const sourceRevision = 'source-revision';
  const semanticRevision = 'semantic-revision';
  const bound = [
    ['src/contracts/types.ts', 'Value', 'entity', 'entity:test:Value'],
    ['src/capability/clock.ts', 'readClock', 'effect', 'effect:test:clock-read'],
    ['src/operation/execute.ts', 'execute', 'operation', 'operation:test:execute'],
    ['src/workflow/run.ts', 'run', 'scenario', 'scenario:test:run']
  ] as const;
  const declarations = bound.map(([path, name]) => ({
    observationId: `declaration:${path}:${name}`,
    declarationDigest: `digest:${path}:${name}`,
    path,
    moduleId: membership.moduleForPath(path)?.moduleId ?? null,
    name,
    exported: true
  }));
  const facts = {
    sourceRevision,
    semanticRevision,
    files: files.map((path) => ({
      path,
      moduleId: membership.moduleForPath(path)?.moduleId ?? null,
      surface: 'production' as const,
      semanticKind: path === 'src/contracts/types.ts'
        ? 'declaration-owner' as const : 'executable' as const,
      semanticObservationClass: 'derived' as const
    })),
    declarations,
    responsibilityEvidence: bound.map(([path, exportName, kind, targetId], index) => ({
      bindingId: `responsibility-binding:test:${index}`,
      responsibilityId: `responsibility:test:${index}`,
      target: { kind, id: targetId },
      declaration: {
        path,
        exportName,
        observationId: declarations[index]!.observationId,
        declarationDigest: declarations[index]!.declarationDigest,
        moduleId: declarations[index]!.moduleId
      },
      sourceRevision,
      semanticRevision,
      observationClass: 'observed' as const,
      reason: 'validated' as const,
      evidenceDigest: `evidence:${index}`
    })),
    entrypoints: [{
      observationId: 'interface-cli',
      kind: 'module-entrypoint' as const,
      path: 'package.json',
      name: 'cli',
      targetPaths: ['src/entry/cli.ts'],
      observationClass: 'derived' as const
    }],
    entrypointClosures: [{
      entrypointObservationId: 'interface-cli',
      targetPaths: ['src/entry/cli.ts'],
      handlerModuleIds: ['interface'],
      reachablePaths: files,
      capabilityPaths: ['src/capability/clock.ts'],
      transports: [],
      unknownPaths: [],
      observationClass: 'derived' as const
    }],
    capabilities: []
  };
  const compile = (sourceForContract: string) => compileRepositoryModuleArchitectureProjection(
    compileRepositoryModuleGraph({
      files: files,
      readSource: (file) => file === 'src/contracts/types.ts'
        ? sourceForContract : sources.get(file) ?? null
    }),
    membership,
    facts
  );
  const valid = compile(sources.get('src/contracts/types.ts')!);
  expect(valid.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toEqual([
      ['src/capability/clock.ts', 'capability'],
      ['src/computation/value.ts', 'unknown'],
      ['src/contracts/types.ts', 'contract'],
      ['src/entry/cli.ts', 'unknown'],
      ['src/operation/execute.ts', 'operation'],
      ['src/workflow/run.ts', 'workflow']
    ]);
  expect(valid.violations).toEqual([]);

  const reversed = compile("export { readClock } from '../capability/clock.ts';");
  expect(reversed.violations).toContainEqual(expect.objectContaining({
    code: 'repository-node-responsibility-reverse-dependency',
    from: 'src/contracts/types.ts',
    to: 'src/capability/clock.ts'
  }));
});

test('package role claims cannot change node responsibility authority', () => {
  const descriptor = parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{ capability: 'example-provider', operations: ['run'] }]
  }, 'src/example/module.json');
  const graph = compileRepositoryModuleGraph({ files: ['src/example/value.ts'], readSource: () => 'export const value = 1;' });
  const facts = {
    files: [{
      path: 'src/example/value.ts',
      moduleId: descriptor.moduleId,
      surface: 'production' as const,
      semanticKind: 'executable' as const,
      semanticObservationClass: 'derived' as const
    }],
    entrypoints: [],
    entrypointClosures: [],
    capabilities: [],
    moduleRoles: [{
      moduleId: descriptor.moduleId,
      role: 'command' as const,
      observationClass: 'observed' as const
    }]
  };
  const projection = compileRepositoryModuleArchitectureProjection(graph, {
    descriptors: [descriptor],
    graphRoots: ['src/example'],
    moduleRoots: ['src/example'],
    moduleForPath: () => descriptor
  }, facts);
  expect(projection.nodeResponsibilities).toEqual([
    expect.objectContaining({
      path: 'src/example/value.ts',
      responsibility: 'unknown',
      reason: 'responsibility-evidence-unresolved'
    })
  ]);
  expect(projection.violations).toEqual([]);
});

test('source-program ownership excludes colocated tests and binds public entrypoints to descriptors', () => {
  const undeclared = repositoryModuleTestDescriptor('src/feature');
  const declared = parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/feature/cli.ts']
  }, 'src/feature/module.json');
  const membershipFor = (descriptor: typeof declared) => ({
    descriptors: [descriptor],
    graphRoots: [descriptor.root],
    moduleRoots: [descriptor.root],
    moduleForPath: (file: string) => file.startsWith('src/feature/') ? descriptor : null
  });
  const entrypointKinds = ['package-script', 'package-bin', 'module-entrypoint'] as const;
  const facts = {
    files: [
      { path: 'src/feature/cli.ts', moduleId: 'feature', surface: 'production' as const },
      { path: 'src/unowned/service.ts', moduleId: null, surface: 'production' as const },
      { path: 'src/unowned/service.test.ts', moduleId: null, surface: 'test' as const }
    ],
    entrypoints: entrypointKinds.map((kind) => ({
      observationId: kind,
      kind,
      path: 'package.json',
      name: kind,
      observationClass: 'observed' as const
    })),
    entrypointClosures: entrypointKinds.map((kind) => ({
      entrypointObservationId: kind,
      targetPaths: ['src/feature/cli.ts'],
      handlerModuleIds: ['feature'],
      reachablePaths: ['src/feature/cli.ts'],
      capabilityPaths: [],
      observationClass: 'observed' as const
    }))
  };

  const violations = collectRepositoryModuleSourceProgramViolations(
    facts,
    membershipFor(undeclared)
  );
  expect(violations.filter(({ code }) => code === 'unowned-production-source'))
    .toEqual([expect.objectContaining({ from: 'src/unowned/service.ts' })]);
  expect(violations.filter(({ code }) => code === 'repository-entrypoint-not-declared'))
    .toHaveLength(entrypointKinds.length);
  expect(violations.some(({ from }) => from === 'src/unowned/service.test.ts')).toBe(false);

  expect(() => assertRepositoryModuleSourceProgramBoundaries(facts, membershipFor(declared)))
    .toThrow('[unowned-production-source]');
  expect(() => assertRepositoryModuleSourceProgramBoundaries({
    ...facts,
    files: facts.files.filter(({ path }) => path !== 'src/unowned/service.ts')
  }, membershipFor(declared))).not.toThrow();
});


test('pre-dependency evaluation excludes erased type imports without exempting runtime imports', () => {
  const descriptor = parseModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/bootstrap/cli.ts'],
    preDependencyBootstrap: true
  }, 'src/bootstrap/module.json');
  const membership = {
    descriptors: [descriptor], graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'], moduleForPath: () => descriptor
  };
  for (const source of [
    "import type { Shape } from 'unmaterialized-package'; export type View = Shape;",
    "import { type Shape } from 'unmaterialized-package'; export type View = Shape;",
    "import type { Shape } from './lazy.ts'; export type View = Shape;"
  ]) {
    const graph = compileRepositoryModuleGraph({
      files: ['src/bootstrap/cli.ts', 'src/bootstrap/lazy.ts'],
      readSource: file => file.endsWith('/cli.ts') ? source
        : "import 'unmaterialized-package'; export interface Shape { readonly id: string; }"
    });
    expect(collectRepositoryModuleBoundaryViolations(graph, membership)
      .filter(({ code }) => code === 'pre-dependency-bootstrap-unavailable-package')).toEqual([]);
  }
  for (const source of [
    "import { value, type Shape } from 'unmaterialized-package'; console.log(value);",
    "import { value } from './lazy.ts'; console.log(value);"
  ]) {
    const graph = compileRepositoryModuleGraph({
      files: ['src/bootstrap/cli.ts', 'src/bootstrap/lazy.ts'],
      readSource: file => file.endsWith('/cli.ts') ? source
        : "import 'unmaterialized-package'; export const value = 1;"
    });
    expect(collectRepositoryModuleBoundaryViolations(graph, membership))
      .toContainEqual(expect.objectContaining({ code: 'pre-dependency-bootstrap-unavailable-package' }));
  }
});
