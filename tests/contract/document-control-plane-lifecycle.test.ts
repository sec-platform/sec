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
  CodexDevelopmentResolveActiveWorkPackageV1,
  type CodexDevelopmentActivePointerV2
} from '../../scripts/codex/document-control-plane.ts';

const CURRENT_STATE_PATH = 'docs/work/current-state.yaml';
const POINTER_PATH = 'docs/work/active-work-package.md';
const MANIFEST_PATH = 'docs/work-packages/docs-control-plane-publication-lifecycle-v1.md';

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
    manifest: MANIFEST_PATH,
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
manifest: ${MANIFEST_PATH}
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  expect(() => CodexDevelopmentParseActivePointerV2(malformedPointer))
    .toThrow('must contain exactly');

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
    const manifestPath = path.join(repositoryRoot, MANIFEST_PATH);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, 'schema: frozen\n', 'utf8');
    runGit(repositoryRoot, ['add', MANIFEST_PATH]);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateBlob = readGitBlob(repositoryRoot, `HEAD:${MANIFEST_PATH}`);
    expect(candidateBlob).toBeDefined();
    const pointer = pointerFor(candidateBlob!);

    runGit(repositoryRoot, ['switch', '--quiet', 'main']);
    expect(readGitBlob(repositoryRoot, `main:${MANIFEST_PATH}`)).toBeUndefined();
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: null,
      defaultRefState: 'fresh'
    })).toMatchObject({ state: 'active', manifest: MANIFEST_PATH });

    runGit(repositoryRoot, ['merge', '--quiet', '--ff-only', 'candidate']);
    const publishedBlob = readGitBlob(repositoryRoot, `main:${MANIFEST_PATH}`);
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
      defaultManifestBlob: readGitBlob(repositoryRoot, `main:${MANIFEST_PATH}`)!,
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
    readFile('docs/04-AI自主实现执行蓝图.md', 'utf8'),
    readFile('docs/work/rolling-plan.md', 'utf8')
  ]);
  const currentState = CodexDevelopmentParseCurrentStateSpecV1(currentStateSource);
  const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
  const manifestBlob = readGitBlob(process.cwd(), `:${MANIFEST_PATH}`);

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
  expect(pointer.manifest).toBe(MANIFEST_PATH);
  expect(manifestBlob).toBeDefined();
  expect(pointer.manifestDigest).toBe(CodexDevelopmentGitBlobSha256(manifestBlob!));

  const defaultManifestBlob = readGitBlob(process.cwd(), `${pointer.defaultBranchRef}:${MANIFEST_PATH}`) ?? null;
  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: manifestBlob!,
    defaultManifestBlob,
    defaultRefState: 'fresh'
  })).toMatchObject({ state: 'active', manifest: MANIFEST_PATH });

  expect(lifecycleAuthority).toContain('bun scripts/codex/document-control-plane.ts status --json');
  expect(lifecycleAuthority).toContain('测试必须导入共享 resolver，禁止复制 selector算法');
  expect((rollingPlan.match(/^### [1-5]\. /gmu) ?? [])).toHaveLength(5);
  expect((rollingPlan.match(/^### docs-control-plane-publication-lifecycle-v1$/gmu) ?? []))
    .toHaveLength(1);
  const candidateHeadings = [
    '### 1. docs-authority-content-normalization-v1',
    '### 2. docs-doctor-v5-semantic-superset-bootstrap-v1',
    '### 3. runtime-canonical-line-and-pr137-reconciliation-v1',
    '### 4. dirty-root-and-branch-reconciliation-v1',
    '### 5. nexus-exact-tree-census-refresh'
  ];
  for (let index = 1; index < candidateHeadings.length; index += 1) {
    expect(rollingPlan.indexOf(candidateHeadings[index])).toBeGreaterThan(
      rollingPlan.indexOf(candidateHeadings[index - 1])
    );
  }
});
