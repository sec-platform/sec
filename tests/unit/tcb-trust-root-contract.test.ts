import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  matchSecTrustedBootstrapPathV2,
  parseSecTrustedBootstrapRegistryV2,
  SEC_TRUST_ROOT_PATHS_V2,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V2,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2,
  type SecTrustedBootstrapRegistryV2
} from '../../platform/shared/tcb-trust-root-contract.ts';

function canonicalSource(value: SecTrustedBootstrapRegistryV2 | Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function registrySource(): string {
  return readFileSync(path.join(compilerRoot, ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V2.split('/')), 'utf8');
}

function mutate(patch: Partial<Record<keyof SecTrustedBootstrapRegistryV2, unknown>>): string {
  return canonicalSource({ ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2, ...patch });
}

test('canonical trust-root registry is structurally strict and separates static privilege from causal runtime', () => {
  const parsed = parseSecTrustedBootstrapRegistryV2(registrySource());
  expect(parsed).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2);
  expect(parsed.causalRuntimePaths).toContain('platform/shared/verification-action-ci-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/verification-action-provider-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/verification-session-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/review-stability-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/main-health-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/integration-authorization-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/semantic-mutation-staging-boundary.ts');
  expect(parsed.causalRuntimePaths).toContain('platform/shared/workspace-write-lease.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/verification-session-github.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/branch-closeout-contract.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/branch-closeout-receipt.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/branch-closeout.ts');
  expect(parsed.staticExactPaths).toContain('scripts/codex/branch-lifecycle.ts');
  expect(parsed.causalRuntimePaths).not.toContain('scripts/codex/branch-lifecycle.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/branch-recovery.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/integration-authorization-publication.ts');
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/verification-action-github-provider.ts');
  expect(parsed.runtimeEntrypoints).toContain('scripts/codex/verification-session.ts');
  expect(parsed.runtimeEntrypoints).not.toContain('scripts/codex/sec-merge-bootstrap.ts');
  expect(parsed.causalRuntimePaths.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(parsed.reviewedSutEdges).toEqual(['scripts/ci-workspace-fast.ts -> platform/orchestrator.ts']);
  expect(parsed.reviewedBoundaryEdges).toEqual([
    'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts',
    'scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts'
  ]);

  expect(matchSecTrustedBootstrapPathV2('scripts/codex/repository-audit.ts')).toBeNull();
  expect(matchSecTrustedBootstrapPathV2('scripts/codex/sec-merge-bootstrap.ts')).toBeNull();
  expect(matchSecTrustedBootstrapPathV2('scripts/codex/merge-gate.ts')).toEqual({
    kind: 'causal-runtime',
    rule: 'scripts/codex/merge-gate.ts'
  });
  expect(matchSecTrustedBootstrapPathV2('platform/shared/tcb-closure-lock.ts')).toEqual({
    kind: 'static-exact',
    rule: 'platform/shared/tcb-closure-lock.ts'
  });
  expect(matchSecTrustedBootstrapPathV2('platform/shared/tcb-trust-root-contract.ts')).toEqual({
    kind: 'causal-runtime',
    rule: 'platform/shared/tcb-trust-root-contract.ts'
  });
  expect(matchSecTrustedBootstrapPathV2('scripts/codex/branch-lifecycle.ts')).toEqual({
    kind: 'static-exact',
    rule: 'scripts/codex/branch-lifecycle.ts'
  });
  expect(matchSecTrustedBootstrapPathV2(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V2)).toEqual({
    kind: 'static-exact',
    rule: SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V2
  });
  expect(matchSecTrustedBootstrapPathV2('.github/workflows/compiler-pr-validation.yml')).toEqual({
    kind: 'static-directory',
    rule: '.github/workflows/'
  });
  expect(matchSecTrustedBootstrapPathV2('.env.production')).toEqual({
    kind: 'static-prefix',
    rule: '.env'
  });
  expect(SEC_TRUST_ROOT_PATHS_V2).not.toContain('scripts/codex/');
  expect(SEC_TRUST_ROOT_PATHS_V2).toContain('scripts/codex/branch-lifecycle.ts');
  expect(SEC_TRUST_ROOT_PATHS_V2).toContain('scripts/codex/merge-gate.ts');
});

test('trust-root registry rejects structural ambiguity, path aliases and self-demotion', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2;
  const failures = [
    registrySource().trimEnd(),
    `${registrySource()}\n`,
    canonicalSource({ ...base, unknown: true }),
    registrySource().replace(
      '  "schema": "sec-trusted-bootstrap-registry-v2",\n',
      '  "schema": "sec-trusted-bootstrap-registry-v2",\n  "schema": "sec-trusted-bootstrap-registry-v2",\n'
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
      causalRuntimePaths: base.causalRuntimePaths.filter((entry) => entry !== 'platform/shared/tcb-trust-root-contract.ts')
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter(
        (entry) => entry !== 'platform/shared/semantic-mutation-staging-boundary.ts'
      )
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter(
        (entry) => entry !== 'platform/shared/workspace-write-lease.ts'
      )
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V2)
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter((entry) => entry !== 'scripts/codex/merge-gate.ts')
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter((entry) => entry !== 'scripts/codex/verification-session-runtime.ts')
    }),
    mutate({
      causalRuntimePaths: [...base.causalRuntimePaths, 'scripts/codex/repository-audit.ts'].sort()
    }),
    mutate({
      causalRuntimePaths: [...base.causalRuntimePaths, 'scripts/codex/branch-lifecycle.ts'].sort()
    }),
    mutate({
      runtimeEntrypoints: [...base.runtimeEntrypoints, 'scripts/codex/repository-audit.ts'].sort()
    }),
    mutate({
      reviewedSutEdges: ['scripts/codex/repository-audit.ts -> platform/orchestrator.ts']
    }),
    mutate({ reviewedBoundaryEdges: [] }),
    mutate({
      reviewedBoundaryEdges: base.reviewedBoundaryEdges.filter(
        (entry) => entry !== 'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts'
      )
    }),
    mutate({
      reviewedBoundaryEdges: ['scripts/codex/repository-audit.ts -> platform/shared/tcb-closure-lock.ts']
    }),
    mutate({
      reviewedBoundaryEdges: ['scripts/codex/verification-session.ts -> platform/shared/ci-contract.ts']
    }),
    mutate({
      reviewedBoundaryEdges: ['scripts/codex/verification-session.ts -> platform/shared/main-health-contract.ts']
    }),
    mutate({
      causalRuntimePaths: [...base.causalRuntimePaths.slice(0, -1), 'virtual/e\u0301.ts'].sort()
    })
  ];

  for (const source of failures) {
    expect(() => parseSecTrustedBootstrapRegistryV2(source)).toThrow();
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
    expect(() => matchSecTrustedBootstrapPathV2(repositoryPath)).toThrow();
  }
});
