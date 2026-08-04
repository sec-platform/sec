import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentGitBlobSha256,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1,
  CodexDevelopmentResolveActiveWorkPackageV1,
  type CodexDevelopmentActivePointerV2
} from '../../scripts/codex/document-control-plane-contract.ts';

const CURRENT_STATE_PATH = 'docs/work/current-state.yaml';
const POINTER_PATH = 'docs/work/active-work-package.md';
const FIXTURE_MANIFEST_PATH = 'docs/work-packages/control-plane-lifecycle-fixture-v1.md';

function readGitBlob(cwd: string, spec: string): Buffer | undefined {
  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'buffer',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout : undefined;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function pointerFor(blob: Uint8Array): CodexDevelopmentActivePointerV2 {
  return {
    schema: 'sec-active-work-package-pointer-v2',
    selectionMode: 'exact-manifest-not-on-default-branch-v1',
    defaultBranchRef: 'refs/remotes/origin/main',
    defaultRefFreshness: 'live-platform-match-required',
    manifest: FIXTURE_MANIFEST_PATH,
    manifestDigest: CodexDevelopmentGitBlobSha256(blob),
    digestBytes: 'git-blob',
    unavailableDefaultRef: 'unresolved',
    matchingDefaultBlob: 'none'
  };
}

test('shared resolver fails closed for stale, unavailable, malformed, and checkout-byte drift', () => {
  const gitBlob = Buffer.from('schema: frozen\n', 'utf8');
  const oldDefaultBlob = Buffer.from('schema: old\n', 'utf8');
  const checkoutCrlfBytes = Buffer.from('schema: frozen\r\n', 'utf8');
  const pointer = pointerFor(gitBlob);

  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: gitBlob,
    defaultManifestBlob: null,
    defaultRefState: 'stale'
  })).toEqual({ state: 'unresolved', reason: 'default-ref-stale' });
  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: gitBlob,
    defaultManifestBlob: null,
    defaultRefState: 'unavailable'
  })).toEqual({ state: 'unresolved', reason: 'default-ref-unavailable' });
  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: checkoutCrlfBytes,
    defaultManifestBlob: oldDefaultBlob,
    defaultRefState: 'fresh'
  })).toEqual({ state: 'invalid', reason: 'candidate-digest-mismatch' });

  const malformedPointer = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
manifest: ${FIXTURE_MANIFEST_PATH}
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  expect(() => CodexDevelopmentParseActivePointerV2(malformedPointer))
    .toThrow('must contain exactly');

  const competingPointer = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${FIXTURE_MANIFEST_PATH}
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/competing-control-plane-fixture-v1.md
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  expect(() => CodexDevelopmentParseActivePointerV2(competingPointer))
    .toThrow('exactly one YAML selector block');

  expect(() => CodexDevelopmentParseCurrentStateSpecV1(`
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: false
stableFacts: {}
`)).toThrow('requireRemoteMatch must be true');

  const validSpec = CodexDevelopmentParseCurrentStateSpecV1(`
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
  for (const invalidSource of [
    'remote: --upload-pack=malicious',
    'defaultBranch: -unsafe',
    'defaultRef: refs/remotes/upstream/main'
  ]) {
    const field = invalidSource.split(':', 1)[0]!;
    const original = field === 'remote'
      ? 'remote: origin'
      : field === 'defaultBranch'
        ? 'defaultBranch: main'
        : 'defaultRef: refs/remotes/origin/main';
    expect(() => CodexDevelopmentParseCurrentStateSpecV1(
      `
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`.replace(original, invalidSource)
    )).toThrow();
  }
  expect(() => CodexDevelopmentParseActivePointerV2(`---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-23
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ../../unsafe.md
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`)).toThrow('canonical Work Package manifest path');
  expect(() => CodexDevelopmentAssertControlPlaneBindingV1({
    spec: validSpec,
    pointer: { ...pointer, defaultBranchRef: 'refs/remotes/upstream/main' }
  })).toThrow('must match');
});

test('real Git lifecycle resolves missing path to active and published blob to none', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-control-plane-lifecycle-'));
  try {
    runGit(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    runGit(repositoryRoot, ['config', 'user.email', 'sec-control-plane@example.invalid']);
    runGit(repositoryRoot, ['config', 'user.name', 'SEC Control Plane Test']);
    await writeFile(path.join(repositoryRoot, 'README.md'), '# fixture\n', 'utf8');
    runGit(repositoryRoot, ['add', 'README.md']);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base']);

    runGit(repositoryRoot, ['switch', '--quiet', '-c', 'candidate']);
    const manifestPath = path.join(repositoryRoot, FIXTURE_MANIFEST_PATH);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, 'schema: frozen\n', 'utf8');
    runGit(repositoryRoot, ['add', FIXTURE_MANIFEST_PATH]);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateBlob = readGitBlob(repositoryRoot, `HEAD:${FIXTURE_MANIFEST_PATH}`);
    expect(candidateBlob).toBeDefined();
    const pointer = pointerFor(candidateBlob!);

    runGit(repositoryRoot, ['switch', '--quiet', 'main']);
    expect(readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`)).toBeUndefined();
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: null,
      defaultRefState: 'fresh'
    })).toMatchObject({ state: 'active', manifest: FIXTURE_MANIFEST_PATH });

    runGit(repositoryRoot, ['merge', '--quiet', '--ff-only', 'candidate']);
    const publishedBlob = readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`);
    expect(publishedBlob).toEqual(candidateBlob!);
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: publishedBlob!,
      defaultRefState: 'fresh'
    })).toEqual({ state: 'none', reason: 'matching-default-blob' });

    await writeFile(path.join(repositoryRoot, 'external-change.txt'), 'next main\n', 'utf8');
    runGit(repositoryRoot, ['add', 'external-change.txt']);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'subsequent external change']);
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`)!,
      defaultRefState: 'fresh'
    })).toEqual({ state: 'none', reason: 'matching-default-blob' });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}, 30_000);

test('repository controls use the shared live resolver and preserve one bounded rolling window', async () => {
  const [currentStateSource, pointerSource, lifecycleAuthority, rollingPlan] = await Promise.all([
    readFile(CURRENT_STATE_PATH, 'utf8'),
    readFile(POINTER_PATH, 'utf8'),
    readFile('docs/development-governance.md', 'utf8'),
    readFile('docs/work/rolling-plan.md', 'utf8')
  ]);
  const currentState = CodexDevelopmentParseCurrentStateSpecV1(currentStateSource);
  const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
  const manifestBlob = readGitBlob(process.cwd(), `:${pointer.manifest}`);
  const activePackageId = path.basename(pointer.manifest, '.md');

  expect(currentState.schema).toBe('sec-current-state-live-v1');
  expect(currentState.resolver).toEqual({
    command: 'bun scripts/codex/document-control-plane.ts status --json',
    repository: 'sec-platform/sec',
    remote: 'origin',
    defaultBranch: 'main',
    defaultRef: 'refs/remotes/origin/main',
    requireRemoteMatch: true
  });
  expect(currentStateSource).not.toContain('basisMainSha');
  expect(currentStateSource).not.toContain('openPullRequests');
  expect(currentStateSource).not.toContain('nextReconciliationPoint');
  expect(manifestBlob).toBeDefined();
  expect(pointer.manifestDigest).toBe(CodexDevelopmentGitBlobSha256(manifestBlob!));

  const defaultManifestBlob = readGitBlob(
    process.cwd(),
    `${pointer.defaultBranchRef}:${pointer.manifest}`
  ) ?? null;
  const repositoryResolution = CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: manifestBlob!,
    defaultManifestBlob,
    defaultRefState: 'fresh'
  });
  if (
    defaultManifestBlob
    && CodexDevelopmentGitBlobSha256(defaultManifestBlob) === pointer.manifestDigest
  ) {
    expect(repositoryResolution).toEqual({ state: 'none', reason: 'matching-default-blob' });
  } else {
    expect(repositoryResolution).toEqual({
      state: 'active',
      manifest: pointer.manifest,
      manifestDigest: pointer.manifestDigest
    });
  }

  expect(lifecycleAuthority).toContain('selected frozen Work Package');
  expect(lifecycleAuthority).toContain('Resolver 无法确定');
  expect(lifecycleAuthority).toContain('fail closed');
  expect(lifecycleAuthority).toContain('Development Run State（目标 owner）');
  const parsedRollingPlan = CodexDevelopmentParseRollingPlanV1(rollingPlan);
  expect(parsedRollingPlan.activePackageId).toBe(activePackageId);
  expect(parsedRollingPlan.candidatePackageIds.length).toBeGreaterThanOrEqual(2);
  expect(parsedRollingPlan.candidatePackageIds.length).toBeLessThanOrEqual(5);
});
