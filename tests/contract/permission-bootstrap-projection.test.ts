import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { normalizeGitHubRepositoryPermission } from '../../src/adapters/providers/github-api/repository-permission.ts';
import { compilePermissionBootstrapProjection, synchronizePermissionBootstrapProjection } from '../../src/adapters/repository/repository-audit/permission-bootstrap-projection.ts';
import { readCompilerFile, readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

const normalizerPath = 'src/adapters/providers/github-api/repository-permission.ts';
const workflows = ['merge-gate', 'compiler-pr-validation', 'trusted-bootstrap']
  .map((name) => `.github/workflows/${name}.yml`);

async function sources(): Promise<Map<string, string>> {
  return new Map([
    [normalizerPath, await readCompilerTypeScriptMutationFixture(normalizerPath, 'transpile-input')],
    ...await Promise.all(workflows.map(async (file) => [file, await readCompilerFile(file)] as const))
  ]);
}

test('pre-checkout decoder regions exactly derive from their canonical owners', async () => {
  const changes = compilePermissionBootstrapProjection(await sources());
  expect(changes.map(({ path: file }) => file)).toEqual(workflows);
  expect(changes.filter(({ before, after }) => before !== after)).toEqual([]);
  expect(changes.reduce((count, { after }) => count + after.split('// BEGIN GENERATED repository-permission.ts').length - 1, 0))
    .toBe(4);
});

test('projection rejects new runtime dependencies instead of silently dropping or executing them', async () => {
  const input = await sources();
  const original = input.get(normalizerPath)!;
  for (const changed of [
    `import { injected } from './elsewhere.ts';\n${original}`,
    `const injected = 'admin';\n${original}`,
    original.replace('const role = source.role_name;', 'const role = injected;'),
    original.replace('const role = source.role_name;', 'const role = { injected };'),
    original.replace('const role = source.role_name;', 'const role = require("elsewhere");')
  ]) {
    expect(() => compilePermissionBootstrapProjection(new Map(input).set(normalizerPath, changed)))
      .toThrow(/ordinary exported function|free runtime dependency/u);
  }
});

test('projected functions reject host lexical captures and malformed script syntax', async () => {
  const input = await sources();
  const file = workflows[0]!;
  for (const declaration of ['const Array = { isArray: () => false };', 'const undefined = null;', 'const broken = ;']) {
    const source = input.get(file)!.replace('            // BEGIN GENERATED', `            ${declaration}\n            // BEGIN GENERATED`);
    expect(() => compilePermissionBootstrapProjection(new Map(input).set(file, source)))
      .toThrow(/captures canonical intrinsic|malformed host script/u);
  }
});

test('check is read-only, explicit write is idempotent, and every target validates before any mutation', async () => {
  const input = await sources();
  const root = mkdtempSync(path.join(tmpdir(), 'permission-bootstrap-'));
  try {
    for (const [file, source] of input) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    const first = workflows[0]!;
    const expected = input.get(first)! + '\n# Unrelated user comment must remain byte-for-byte.\n';
    const stale = expected.replace('if (role === undefined)', 'if (role === null)');
    writeFileSync(path.join(root, first), stale);
    expect(await synchronizePermissionBootstrapProjection(root, 'check')).toEqual([first]);
    expect(readFileSync(path.join(root, first), 'utf8')).toBe(stale);
    expect(await synchronizePermissionBootstrapProjection(root, 'write')).toEqual([first]);
    expect(readFileSync(path.join(root, first), 'utf8')).toBe(expected);
    expect(await synchronizePermissionBootstrapProjection(root, 'write')).toEqual([]);
    writeFileSync(path.join(root, first), stale);
    const pendingWrite = synchronizePermissionBootstrapProjection(root, 'write');
    // The canonical lease acquisition suspends after capture, before publication.
    const concurrent = stale + '# Concurrent same-inode edit.\n';
    writeFileSync(path.join(root, first), concurrent);
    await expect(pendingWrite).rejects.toThrow(/preimage changed/u);
    expect(readFileSync(path.join(root, first), 'utf8')).toBe(concurrent);
    writeFileSync(path.join(root, first), stale);
    const last = workflows.at(-1)!;
    for (const malformed of [
      input.get(last)!.replace('// END GENERATED repository-permission.ts', ''),
      input.get(last)! + '\n# // BEGIN GENERATED repository-permission.ts\n'
    ]) {
      writeFileSync(path.join(root, last), malformed);
      await expect(synchronizePermissionBootstrapProjection(root, 'write')).rejects.toThrow(/missing or duplicate/u);
      expect(readFileSync(path.join(root, first), 'utf8')).toBe(stale);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function executeScript(file: string, job: string, github: unknown, env: Record<string, string>, diagnostics: unknown[] = []): Promise<Map<string, string>> {
  const source = await readCompilerFile(file);
  const { compileSourceProgramEmbeddedWorkflowPrograms } = await import('../../src/adapters/repository/source-program-model/embedded-programs.ts');
  const { rawSha256 } = await import('../../src/contracts/canonical.ts');
  const script = compileSourceProgramEmbeddedWorkflowPrograms({ path: file, source, contentDigest: rawSha256(source) })
    .find(({ address }) => address === `jobs/${job}/steps/0/github-script`)!.source;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) =>
    (...values: unknown[]) => Promise<void>;
  const outputs = new Map<string, string>();
  const crypto = await import('node:crypto');
  await new AsyncFunction('github', 'context', 'core', 'process', 'require', script)(github,
    { repo: { owner: 'sec-platform', repo: 'sec' }, actor: 'maintainer' },
    { setOutput: (name: string, value: string) => outputs.set(name, value),
      info: (message: string) => diagnostics.push(JSON.parse(message)) }, { env },
    (name: string) => { if (name !== 'crypto') throw new Error('Unexpected script dependency'); return crypto; });
  return outputs;
}

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const manifestPath = 'config/repository/work-packages/bootstrap-test.md';
const maintain = { permission: 'write', role_name: 'maintain' };
const contradictory = { permission: 'read', role_name: 'maintain' };

test('activation script emits normalized maintain and retains dispatch identity checks', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = Buffer.from('trusted test manifest');
  const material = {
    schema: 'sec-agent-operation-activation-request-v1', phase: 'prepare', pullRequestNumber: 42,
    expectedBaseSha: base, expectedHeadSha: head, manifestPath,
    manifestDigest: `sha256:${createHash('sha256').update(manifest).digest('hex')}`, preparationCommentId: null
  };
  const request = { ...material, requestOperationId: `sha256:${createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(material).sort(([a], [b]) => a < b ? -1 : 1)))).digest('hex')}` };
  const pull = { number: 42, state: 'open', draft: true, body: `Work-Package: ${manifestPath}`,
    base: { ref: 'main', sha: base, repo: { id: 123 } }, head: { ref: 'codex/bootstrap', sha: head, repo: { id: 123 } } };
  const run = (permission: unknown, triggeringActor = 'maintainer') => executeScript(workflows[1]!,
    'validate-agent-operation-activation-request', {
      rest: { repos: {
        get: async () => ({ data: { id: 123, default_branch: 'main' } }),
        getCollaboratorPermissionLevel: async () => ({ data: permission }),
        getBranch: async () => ({ data: { commit: { sha: base } } }),
        getCommit: async () => ({ data: { commit: { tree: { sha: 'c'.repeat(40) } } } }),
        compareCommitsWithBasehead: async () => ({ data: { behind_by: 0, ahead_by: 1, total_commits: 1, commits: [{ parents: [{}] }] } }),
        getContent: async () => ({ data: { type: 'file', encoding: 'base64', content: manifest.toString('base64'),
          sha: createHash('sha1').update(`blob ${manifest.length}\0`).update(manifest).digest('hex') } })
      }, pulls: { get: async () => ({ data: pull }), list: () => undefined } },
      paginate: async () => [pull]
    }, { PAYLOAD_JSON: JSON.stringify({ payload: request }), WORKFLOW_SHA: base,
      ACTOR_LOGIN: 'maintainer', TRIGGERING_ACTOR_LOGIN: triggeringActor,
      EVENT_SENDER_JSON: JSON.stringify({ login: 'maintainer', node_id: 'USER_maintainer' }) });
  const emittedPermission = (await run(maintain)).get('actor-permission');
  expect(emittedPermission).toBe('maintain');
  // This runtime join also makes the entire freshness-test file a real normalizer consumer.
  expect<unknown>(emittedPermission).toBe(normalizeGitHubRepositoryPermission(maintain));
  await expect(run(contradictory)).rejects.toThrow('requires maintain or admin');
  await expect(run(maintain, 'other')).rejects.toThrow('event sender differ');
});

test('Session and bootstrap admission consume paired responses before any trusted continuation', async () => {
  const allowed = new Error('Reached the independent live-base observation');
  const digest = `sha256:${'c'.repeat(64)}`;
  const sessionRequest = {
    schema: 'sec-verification-session-hosted-request-v1', prNumber: 42, expectedBaseSha: base,
    expectedBaseTreeSha: base, expectedHeadSha: head, expectedHeadTreeSha: head,
    manifestPath, manifestDigest: digest, profile: 'quick', expectedScopeProposalDigest: digest,
    expectedActionPlanDigest: digest, expectedSessionRevision: digest, reviewPolicyDigest: digest, requestOperationId: digest
  };
  const bootstrapRequest = { schema: 'sec-trusted-bootstrap-request-v1', pull_request: 42,
    expected_base: base, expected_head: head, manifest_path: manifestPath, manifest_digest: digest };
  for (const [file, job, payload, event] of [
    [workflows[1]!, 'validate-hosted-request', { payload: sessionRequest }, 'sec-verify-session-v2'],
    [workflows[2]!, 'resolve', bootstrapRequest, 'sec-trusted-bootstrap-v1']
  ] as const) {
    const run = (triggeringPermission: unknown) => executeScript(file, job, {
      rest: { repos: {
        get: async () => ({ data: { default_branch: 'main' } }),
        getCollaboratorPermissionLevel: async ({ username }: { username: string }) => ({ data: username === 'trigger' ? triggeringPermission : maintain }),
        getBranch: async () => { throw allowed; }, getCommit: async () => ({ data: {} })
      }, pulls: { get: async () => ({ data: {} }), list: () => undefined } }, paginate: async () => []
    }, { PAYLOAD_JSON: JSON.stringify(payload), EVENT_TYPE: event, ACTOR_LOGIN: 'actor', TRIGGERING_ACTOR_LOGIN: 'trigger',
      ACTOR: 'actor', TRIGGERING_ACTOR: 'trigger' });
    await expect(run(maintain)).rejects.toBe(allowed);
    await expect(run(contradictory)).rejects.toThrow(/requires maintain\/admin/u);
  }
});
