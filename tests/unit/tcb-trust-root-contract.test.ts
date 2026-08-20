import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { TCB_CLOSURE_LOCK, TCB_TRUST_ROOT_V3 } from '../../platform/shared/tcb-closure-lock.ts';
import {
  createSecTrustedBootstrapTrustRootV3,
  matchSecTrustedBootstrapPathV3,
  parseSecTrustedBootstrapRegistryV3,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3,
  type SecTrustedBootstrapRegistryV3
} from '../../platform/shared/tcb-trust-root-contract.ts';

function canonicalSource(value: SecTrustedBootstrapRegistryV3 | Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function registrySource(): string {
  return readFileSync(path.join(compilerRoot, ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3.split('/')), 'utf8');
}

function mutate(patch: Partial<Record<keyof SecTrustedBootstrapRegistryV3, unknown>>): string {
  return canonicalSource({ ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3, ...patch });
}

test('canonical trust-root registry is structurally strict and separates static privilege from causal runtime', () => {
  const parsed = parseSecTrustedBootstrapRegistryV3(registrySource());
  expect(parsed).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3);
  expect(registrySource()).not.toContain('causalRuntimePaths');
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths)
    .toContain('platform/shared/verification-action-provider-contract.ts');
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths).toContain('scripts/codex/branch-closeout.ts');
  expect(parsed.staticExactPaths).toContain('scripts/codex/branch-lifecycle.ts');
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths).not.toContain('scripts/codex/branch-lifecycle.ts');
  expect(parsed.runtimeEntrypoints).toContain('scripts/codex/verification-session.ts');
  expect(parsed.runtimeEntrypoints).not.toContain('scripts/codex/sec-merge-bootstrap.ts');
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(parsed.reviewedSutEdges).toEqual([
    'scripts/ci-workspace-fast.ts -> platform/orchestrator/block-orchestrator.ts',
    'scripts/ci-workspace-fast.ts -> platform/orchestrator/compose-orchestrator.ts',
    'scripts/ci-workspace-fast.ts -> platform/orchestrator/verify-orchestrator.ts',
    'scripts/ci-workspace-fast.ts -> platform/orchestrator/workspace-orchestrator.ts'
  ]);
  expect(parsed.reviewedBoundaryEdges).toEqual([
    'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts',
    'scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts'
  ]);

  expect(matchSecTrustedBootstrapPathV3('scripts/codex/repository-audit.ts', TCB_TRUST_ROOT_V3)).toBeNull();
  expect(matchSecTrustedBootstrapPathV3('scripts/codex/sec-merge-bootstrap.ts', TCB_TRUST_ROOT_V3)).toBeNull();
  expect(matchSecTrustedBootstrapPathV3('scripts/codex/merge-gate.ts', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'causal-runtime',
    rule: 'scripts/codex/merge-gate.ts'
  });
  expect(matchSecTrustedBootstrapPathV3('platform/shared/tcb-closure-lock.ts', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'static-exact',
    rule: 'platform/shared/tcb-closure-lock.ts'
  });
  expect(matchSecTrustedBootstrapPathV3('platform/shared/tcb-trust-root-contract.ts', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'causal-runtime',
    rule: 'platform/shared/tcb-trust-root-contract.ts'
  });
  expect(matchSecTrustedBootstrapPathV3('scripts/codex/branch-lifecycle.ts', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'static-exact',
    rule: 'scripts/codex/branch-lifecycle.ts'
  });
  expect(matchSecTrustedBootstrapPathV3(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3, TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'static-exact',
    rule: SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3
  });
  expect(matchSecTrustedBootstrapPathV3('.github/workflows/compiler-pr-validation.yml', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'static-directory',
    rule: '.github/workflows/'
  });
  expect(matchSecTrustedBootstrapPathV3('.env.production', TCB_TRUST_ROOT_V3)).toEqual({
    kind: 'static-prefix',
    rule: '.env'
  });
  expect(TCB_TRUST_ROOT_V3.paths).not.toContain('scripts/codex/');
  expect(TCB_TRUST_ROOT_V3.paths).toContain('scripts/codex/branch-lifecycle.ts');
  expect(TCB_TRUST_ROOT_V3.paths).toContain('scripts/codex/merge-gate.ts');
});

test('trust-root registry rejects structural ambiguity, path aliases and self-demotion', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3;
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
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'platform/shared/'].sort() }),
    mutate({ staticPrefixes: ['.env', '.env.'] }),
    mutate({ staticPrefixes: ['../'] }),
    mutate({ staticExactPaths: base.staticExactPaths.filter((entry) => entry !== '.bun-version') }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter(
        (entry) => entry !== 'scripts/codex/branch-lifecycle.ts'
      )
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== 'platform/shared/tcb-closure-lock.ts')
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3)
    }),
    mutate({ reviewedBoundaryEdges: [] }),
    mutate({
      reviewedBoundaryEdges: base.reviewedBoundaryEdges.filter(
        (entry) => entry !== 'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts'
      )
    }),
    mutate({
      reviewedBoundaryEdges: ['scripts/codex/verification-session.ts -> platform/shared/ci-contract.ts']
    }),
    mutate({
      reviewedBoundaryEdges: ['scripts/codex/verification-session.ts -> platform/shared/main-health-contract.ts']
    })
  ];

  for (const source of failures) {
    expect(() => parseSecTrustedBootstrapRegistryV3(source)).toThrow();
  }
});

test('policy and derived causal closure are both validated when composing the trust root', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3;
  const modules = TCB_CLOSURE_LOCK.modules;
  const causalFailures = [
    modules.filter((entry) => entry !== 'platform/shared/tcb-trust-root-contract.ts'),
    modules.filter((entry) => entry !== 'platform/shared/semantic-mutation-staging-boundary.ts'),
    modules.filter((entry) => entry !== 'platform/shared/workspace-write-lease.ts'),
    [...modules, 'scripts/codex/repository-audit.ts'].sort(),
    [...modules, 'scripts/codex/branch-lifecycle.ts'].sort(),
    [...modules.slice(0, -1), 'virtual/e\u0301.ts'].sort()
  ];
  for (const causalRuntimePaths of causalFailures) {
    expect(() => createSecTrustedBootstrapTrustRootV3({ registry: base, causalRuntimePaths })).toThrow();
  }
  for (const registry of [
    { ...base, staticExactPaths: [...base.staticExactPaths].reverse() },
    { ...base, runtimeEntrypoints: [...base.runtimeEntrypoints, 'scripts/codex/repository-audit.ts'].sort() },
    { ...base, reviewedSutEdges: ['scripts/codex/repository-audit.ts -> platform/orchestrator.ts'] },
    { ...base, reviewedBoundaryEdges: ['scripts/codex/repository-audit.ts -> platform/shared/tcb-closure-lock.ts'] }
  ]) {
    expect(() => createSecTrustedBootstrapTrustRootV3({ registry, causalRuntimePaths: modules })).toThrow();
  }
});

test('trust-root matcher rejects non-canonical caller paths instead of laundering aliases', () => {
  for (const repositoryPath of [
    '../scripts/codex/merge-gate.ts',
    '/scripts/codex/merge-gate.ts',
    'scripts\\codex\\merge-gate.ts',
    'scripts//codex/merge-gate.ts',
    'C:/scripts/codex/merge-gate.ts'
  ]) {
    expect(() => matchSecTrustedBootstrapPathV3(repositoryPath, TCB_TRUST_ROOT_V3)).toThrow();
  }
});
