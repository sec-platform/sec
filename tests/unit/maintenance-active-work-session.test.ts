import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeGitHubApiOperation, observeGitHubApiMainRef, withGitHubApiReadSession } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { observeActiveWorkPackage } from '../../src/adapters/self-hosting/control/documentation/document-control-plane.ts';
import { requireActiveWorkPackageOwnerObservation } from '../../src/adapters/self-hosting/control/task/contract/active-work-observation.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { compileSecWorkRollingProposalProjection, renderSecWorkRollingProposalPlan } from '../../src/adapters/self-hosting/control/work-selection/live-contract.ts';

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function fixture(active: boolean, operation: (root: string, mainSha: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-active-work-session-'));
  const manifest = 'config/repository/work-packages/session-fixture-v1.md';
  const bytes = Buffer.from(`---
schema: codex-development-work-package-v1
id: session-fixture-v1
tracking: none
base: '${'0'.repeat(40)}'
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: session-fixture
    owner: development-governance-maintainer
    ownedPaths:
      - ${manifest}
forbiddenPaths:
  - src/compiler/
acceptance:
  - "Keep the native observation boundary."
tests:
  - tests/unit/maintenance-active-work-session.test.ts
---
# Fixture
`);
  const put = (name: string, text: string | Uint8Array) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text);
  };
  try {
    git(root, ['init', '--quiet', '--initial-branch=main']);
    git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']);
    put('README.md', '# fixture\n'); git(root, ['add', '.']); git(root, ['commit', '--quiet', '-m', 'seed']);
    const seedSha = git(root, ['rev-parse', 'HEAD']);
    const seedTree = git(root, ['rev-parse', 'HEAD^{tree}']);
    if (active) git(root, ['switch', '--quiet', '-c', 'transport/old']);
    put('config/repository/current-state.yaml', `schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts:
  workSelection:
    catalog: config/repository/work-selection.md#sec-work-selection-roadmap-catalog-v1
    projection: sec-work-selection-live-v1-required
`);
    put('config/repository/active-work-package.md', `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-10-05
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${manifest}
manifestDigest: ${CodexDevelopmentWorkPackageManifestDigest(bytes)}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`);
    put('config/repository/rolling-plan.md', renderSecWorkRollingProposalPlan({
      projection: compileSecWorkRollingProposalProjection({ exactMain: seedSha, exactMainTree: seedTree,
        active: { packageId: 'session-fixture-v1', tracking: 'none', manifestPath: manifest,
          manifestDigest: CodexDevelopmentWorkPackageManifestDigest(bytes) as `sha256:${string}` },
        candidates: ['next-fixture-v1', 'last-fixture-v1'] }), reviewedOn: '2026-10-05'
    }));
    put(manifest, bytes); git(root, ['add', '.']); git(root, ['commit', '--quiet', '-m', 'fixture control docs']);
    const mainSha = active ? seedSha : git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-ref', 'refs/remotes/origin/main', mainSha]);
    git(root, ['remote', 'add', 'origin', 'https://github.com/sec-platform/sec.git']);
    if (!active) git(root, ['switch', '--quiet', '-c', 'transport/old']);
    await operation(root, mainSha);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function capability(mainSha: string, requests: string[], afterEffect: () => void = () => {}) {
  return issueGitHubApiTestCapability({ repository: 'sec-platform/sec', token: 'test-session-token-0123456789',
    principal: { transport: 'github-rest-token', login: 'fixture-maintainer', nodeId: 'fixture', userId: 1, permission: 'maintain' },
    effect: 'branch-closeout-write', transport: async (target, init) => {
      const url = String(target); requests.push(url);
      if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: mainSha } });
      if (url.endsWith('/repos/sec-platform/sec')) return Response.json({ full_name: 'sec-platform/sec', node_id: 'fixture-repo' });
      if (url.endsWith('/graphql') && init?.method === 'POST') { afterEffect(); return Response.json({ data: { updateRefs: { clientMutationId: null } } }); }
      throw new Error('unexpected fixture request');
    } });
}

test('real Active Work observer borrows the same closeout session before and after its exact effect', async () => {
  await fixture(false, async (root, mainSha) => {
    const requests: string[] = []; let effects = 0;
    const cap = capability(mainSha, requests, () => { effects += 1; });
    await withGitHubApiTestSession({ capability: cap, repositoryRoot: root, operation: async () => {
      const before = requireActiveWorkPackageOwnerObservation(await observeActiveWorkPackage(root));
      expect(before).toMatchObject({ state: 'none', defaultSha: mainSha });
      await executeGitHubApiOperation(cap, { kind: 'delete-ref-cas', branch: 'transport/old', expectedOldSha: mainSha });
      const after = requireActiveWorkPackageOwnerObservation(await observeActiveWorkPackage(root));
      expect(after).toMatchObject({ state: 'none', defaultSha: mainSha });
      expect(requests.filter(url => url.endsWith('/git/ref/heads/main'))).toHaveLength(4);
      expect(effects).toBe(1);
    } });
  });
});

test('real Active Work target remains active inside closeout observation', async () => {
  await fixture(true, async (root, mainSha) => {
    const requests: string[] = [];
    await withGitHubApiTestSession({ capability: capability(mainSha, requests), repositoryRoot: root, operation: async () => {
      const active = requireActiveWorkPackageOwnerObservation(await observeActiveWorkPackage(root));
      expect(active).toMatchObject({ state: 'active', branch: 'transport/old', defaultSha: mainSha });
      expect(requests.every(url => url.endsWith('/git/ref/heads/main'))).toBe(true);
    } });
  });
});

test('borrow rejects another root and generic nested reads stay rejected with their original reason', async () => {
  await fixture(false, async (root, mainSha) => {
    const requests: string[] = [];
    await withGitHubApiTestSession({ capability: capability(mainSha, requests), repositoryRoot: root, operation: async () => {
      await expect(observeGitHubApiMainRef({ repositoryRoot: path.dirname(root), repository: 'sec-platform/sec' })).rejects.toThrow('repository/root/effect');
      await expect(withGitHubApiReadSession({ repositoryRoot: root, repository: 'sec-platform/sec', operation: async () => null })).rejects.toThrow('repository/effect/origin');
    } });
    await withGitHubApiTestSession({ capability: capability(mainSha, requests), operation: async () => {
      const unresolved = await observeActiveWorkPackage(root);
      expect(unresolved.state).toBe('unresolved');
      expect(unresolved.reason).toContain('Main ref observation cannot borrow this repository/root/effect session');
    } });
    expect(requests).toHaveLength(0);
  });
});
