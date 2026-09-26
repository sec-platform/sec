import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileTcbClosureIdentity,
  TCB_TRUST_ROOT
} from '../../src/adapters/verification/platform/trust/compiler.ts';
import { createSecTrustedBootstrapTrustRoot, matchSecTrustedBootstrapPath, parseSecTrustedBootstrapRegistry, SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, SEC_TRUSTED_BOOTSTRAP_REGISTRY, SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, type SecTrustedBootstrapRegistry } from '../../src/adapters/verification/platform/trust/contract/root.ts';

const TCB_CLOSURE_LOCK = compileTcbClosureIdentity();

function canonicalSource(value: SecTrustedBootstrapRegistry | Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function registrySource(): string {
  return readFileSync(path.resolve(import.meta.dir, '../../src/adapters/verification/platform/trust/contract/ci-trust-root-registry.json'), 'utf8');
}

function mutate(patch: Partial<Record<keyof SecTrustedBootstrapRegistry, unknown>>): string {
  return canonicalSource({ ...SEC_TRUSTED_BOOTSTRAP_REGISTRY, ...patch });
}

test('canonical trust-root registry is structurally strict and separates static privilege from causal runtime', () => {
  const parsed = parseSecTrustedBootstrapRegistry(registrySource());
  expect(parsed).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY);
  expect(registrySource()).not.toContain('causalRuntimePaths');
  expect(TCB_TRUST_ROOT.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_TRUST_ROOT.causalRuntimePaths.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(parsed.reviewedSutEdges).toEqual([]);
  expect(parsed.reviewedBoundaryEdges).toEqual([]);
  expect(parsed.reviewedExternalImports).toContain(
    'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod'
  );

  const causalRuntimePath = TCB_TRUST_ROOT.causalRuntimePaths[0]!;
  expect(matchSecTrustedBootstrapPath('scripts/codex/untrusted.ts', TCB_TRUST_ROOT)).toBeNull();
  expect(matchSecTrustedBootstrapPath(causalRuntimePath, TCB_TRUST_ROOT)).toEqual({
    kind: 'causal-runtime',
    rule: causalRuntimePath
  });
  expect(matchSecTrustedBootstrapPath(SEC_TCB_CLOSURE_RUNTIME_PATH, TCB_TRUST_ROOT)).toEqual({
    kind: 'static-exact',
    rule: SEC_TCB_CLOSURE_RUNTIME_PATH
  });
  expect(matchSecTrustedBootstrapPath(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, TCB_TRUST_ROOT)).toEqual({
    kind: 'causal-runtime',
    rule: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER
  });
  expect(matchSecTrustedBootstrapPath(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, TCB_TRUST_ROOT)).toEqual({
    kind: 'static-exact',
    rule: SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
  });
  expect(matchSecTrustedBootstrapPath('.github/workflows/compiler-pr-validation.yml', TCB_TRUST_ROOT)).toEqual({
    kind: 'static-directory',
    rule: '.github/workflows/'
  });
  expect(matchSecTrustedBootstrapPath('.env.production', TCB_TRUST_ROOT)).toEqual({
    kind: 'static-prefix',
    rule: '.env'
  });
  expect(TCB_TRUST_ROOT.paths).not.toContain('scripts/codex/');
});

test('trust-root registry rejects structural ambiguity, path aliases and self-demotion', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY;
  const failures = [
    registrySource().trimEnd(),
    `${registrySource()}\n`,
    canonicalSource({ ...base, unknown: true }),
    registrySource().replace(
      '  "schema": "sec-trusted-bootstrap-registry-v3",\n',
      '  "schema": "sec-trusted-bootstrap-registry-v3",\n  "schema": "sec-trusted-bootstrap-registry-v3",\n'
    ),
    mutate({ staticExactPaths: [...base.staticExactPaths, base.staticExactPaths[0]!].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths].reverse() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'C:/escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), '../escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'platform\\escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'docs/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths.slice(0, -1), 'tests/testkit'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'scripts/codex/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'src/adapters/verification/platform/'].sort() }),
    mutate({ staticPrefixes: ['.env', '.env.'] }),
    mutate({ staticPrefixes: ['../'] }),
    mutate({ staticExactPaths: base.staticExactPaths.filter((entry) => entry !== '.bun-version') }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TCB_CLOSURE_RUNTIME_PATH)
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH)
    }),
    mutate({
      reviewedBoundaryEdges: ['src/adapters/verification/platform/ci/runtime/verification-session.ts -> platform/shared/ci-contract.ts']
    }),
    mutate({
      reviewedBoundaryEdges: ['src/adapters/verification/platform/ci/runtime/verification-session.ts -> src/adapters/self-hosting/control/main-health/contract.ts']
    }),
    mutate({
      reviewedExternalImports: [
        ...base.reviewedExternalImports,
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod'
      ].sort()
    }),
    mutate({ reviewedExternalImports: ['* -> zod'] }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod/*'
      ]
    }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> ../zod'
      ]
    }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod as parser'
      ]
    })
  ];

  for (const source of failures) {
    expect(() => parseSecTrustedBootstrapRegistry(source)).toThrow();
  }
});

test('policy and derived causal closure are both validated when composing the trust root', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY;
  const modules = TCB_CLOSURE_LOCK.modules;
  const syntheticModule = 'scripts/codex/untrusted.ts';
  const causalFailures = [
    modules.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER),
    [...modules].reverse(),
    [...modules, modules[0]!].sort(),
    [...modules.slice(0, -1), 'virtual/e\u0301.ts'].sort()
  ];
  for (const causalRuntimePaths of causalFailures) {
    expect(() => createSecTrustedBootstrapTrustRoot({ registry: base, causalRuntimePaths })).toThrow();
  }
  for (const registry of [
    { ...base, staticExactPaths: [...base.staticExactPaths].reverse() },
    { ...base, runtimeEntrypoints: [...base.runtimeEntrypoints, syntheticModule].sort() },
    { ...base, reviewedSutEdges: [`${syntheticModule} -> platform/untrusted.ts`] },
    { ...base, reviewedBoundaryEdges: [`${syntheticModule} -> ${SEC_TCB_CLOSURE_RUNTIME_PATH}`] }
  ]) {
    expect(() => createSecTrustedBootstrapTrustRoot({ registry, causalRuntimePaths: modules })).toThrow();
  }
});

test('trust-root matcher rejects non-canonical caller paths instead of laundering aliases', () => {
  for (const repositoryPath of [
    '../src/adapters/self-hosting/control/integration/merge-gate.ts',
    '/src/adapters/self-hosting/control/integration/merge-gate.ts',
    'scripts\\codex\\merge-gate.ts',
    'scripts//codex/merge-gate.ts',
    'C:/src/adapters/self-hosting/control/integration/merge-gate.ts'
  ]) {
    expect(() => matchSecTrustedBootstrapPath(repositoryPath, TCB_TRUST_ROOT)).toThrow();
  }
});
