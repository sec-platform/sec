import { createHash } from 'node:crypto';
import type { VerificationActionKeyDigest } from '../../src/execution/verification/action.ts';

import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CodexDevelopmentRunGateProcess, type CodexDevelopmentGateProcessSettlement } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';

export const HEAD = '1'.repeat(40);
export const TREE = '2'.repeat(40);
export const BASE = '3'.repeat(40);
export const BASE_TREE = '4'.repeat(40);
export const MANIFEST_PATH = 'config/repository/work-packages/exact-verification-v1.md';

function bytesDigest(value: string): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function manifestSource(): string {
  return `---
schema: codex-development-work-package-v1
id: exact-verification-v1
tracking: none
base: "${BASE}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: exact-verification
    owner: verification-writer
    ownedPaths:
      - src/adapters/verification/platform/ci/verification.ts
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact-verification
tests:
  - tests/unit/ci-verification-execution.test.ts
---

# Exact Verification
`;
}

export function exactManifest(testIdentity: string) {
  const source = `${manifestSource()}\n<!-- test-run:${bytesDigest(testIdentity)} -->\n`;
  return {
    blobSha: createHash('sha1').update(source).digest('hex'),
    bytes: new TextEncoder().encode(source),
    mode: '100644' as const, type: 'blob' as const
  };
}

export function clock(): () => Date {
  let time = Date.parse('2026-08-09T00:00:00.000Z');
  return () => new Date(time += 10);
}

export function revisions(ref: string): string | null {
  if (ref === 'HEAD') return HEAD;
  if (ref === 'HEAD^{tree}') return TREE;
  if (ref === BASE || ref === 'HEAD^1') return BASE;
  if (ref === `${BASE}^{tree}`) return BASE_TREE;
  return null;
}

export function baseOptions(root: string) {
  const changedFiles = ['docs/product.md'];
  const manifest = exactManifest(root);
  const docsGate = buildCiQuickGatePlan({
    includeImports: false,
    includeDocs: true,
    selectedSlowSuites: [],
    selectedSlowTests: []
  }).find(({ id }) => id === 'docs-doctor');
  if (docsGate === undefined) throw new Error('CI test plan requires its documentation gate.');
  return {
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: MANIFEST_PATH
    },
    now: clock(),
    repositoryRoot: root,
    gitRevision: revisions,
    trackedTreeIsClean: () => true,
    // Injected changed-path tests have no immutable source receipt. Use one
    // owner-resolved documentation path; source graph selection is exercised
    // only through the exact Git provider route.
    changedFiles: () => changedFiles,
    readExactGitBlob: () => manifest,
    readGitBlob: () => manifest,
    testVerificationPlan: {
      profile: 'quick' as const,
      changedFiles,
      selectionResolved: true,
      selectionReasons: [],
      affectedOwners: ['product'],
      affectedSlowTests: [],
      gates: [docsGate]
    },
    runGate: executeSentinelGate(root, 0)
  };
}

export function executeSentinelGate(repositoryRoot: string, code: number, output = '') {
  return async (
    gate: Readonly<{ id: string; argv: string[]; env: NodeJS.ProcessEnv }>,
    execution: Parameters<typeof CodexDevelopmentRunGateProcess>[2]
  ): Promise<CodexDevelopmentGateProcessSettlement> => CodexDevelopmentRunGateProcess(
    repositoryRoot,
    {
      ...gate,
      argv: [process.execPath, '-e', `${output.length > 0 ? `console.error(${JSON.stringify(output)});` : ''}process.exit(${code});`]
    },
    execution
  );
}
