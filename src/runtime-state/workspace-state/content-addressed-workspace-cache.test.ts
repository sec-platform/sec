import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import {
  ContentAddressedWorkspaceCacheError,
  openContentAddressedWorkspaceCacheSession,
  type ContentAddressedWorkspaceCacheSession
} from './content-addressed-workspace-cache.ts';

const temporaryRoots: string[] = [];
const sessions: ContentAddressedWorkspaceCacheSession[] = [];
const originalCacheHome = process.env.SEC_CACHE_HOME;

afterEach(() => {
  while (sessions.length > 0) sessions.pop()!.close();
  if (originalCacheHome === undefined) delete process.env.SEC_CACHE_HOME;
  else process.env.SEC_CACHE_HOME = originalCacheHome;
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()!;
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      throw new Error('Refusing to remove a non-temporary cache fixture');
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-content-cache-'));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  mkdirSync(repositoryRoot);
  process.env.SEC_CACHE_HOME = path.join(root, 'cache');
  const requirementId = 'runtime-state.cache.fixture';
  const contractDigest = sha256({ requirementId }) as SecOperationDigest;
  const operation = bindSecSemanticOperation(compileSecSemanticOperationPlan({
    operation: 'runtime-state.content-addressed-cache.fixture',
    intentDigest: sha256({ repositoryRoot }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + 30_000,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: 1024 },
      { resource: 'output-bytes', maximum: 1024 },
      { resource: 'records', maximum: 32 }
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['cache.cancelled', 'cache.deadline-exhausted', 'cache.physical-replacement']
    }]
  }), [compileSecCapabilityBinding({
    requirementId,
    contractDigest,
    providerIdentityDigest: sha256('runtime-state-cache-fixture') as SecOperationDigest
  })]);
  const session = openContentAddressedWorkspaceCacheSession({
    operation,
    requirementId,
    repository: inspectNoFollowDirectoryChain(repositoryRoot, 'cache fixture repository').target
  });
  sessions.push(session);
  const namespace = session.openNamespace({
    namespace: 'fixture-cache',
    schemaDigest: sha256('fixture-schema') as `sha256:${string}`,
    maximumEntries: 2
  });
  return { namespace, root, session };
}

function entry(name: string, source: string) {
  const bytes = new TextEncoder().encode(source);
  return Object.freeze({ name, bytes, digest: rawSha256(bytes) });
}

function findGenerationDirectory(root: string, leafName: string): string {
  const matches: string[] = [];
  const visit = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, item.name);
      if (item.isDirectory()) visit(candidate);
      else if (item.isFile() && item.name === leafName) matches.push(directory);
    }
  };
  visit(root);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

test.serial('domain-neutral cache publishes immutable bytes and exposes only validated predecessor tokens', () => {
  const value = fixture();
  const firstKey = sha256('first') as `sha256:${string}`;
  const secondKey = sha256('second') as `sha256:${string}`;
  const first = value.namespace.open(firstKey);
  const firstToken = new TextEncoder().encode('first-token');
  expect(first.loadExact()).toEqual({ status: 'miss', keyDigest: firstKey });
  expect(first.publish({ entries: [entry('payload.bin', 'first')], predecessorToken: firstToken }).status).toBe('hit');

  const second = value.namespace.open(secondKey);
  const predecessor = second.loadPredecessor();
  expect(predecessor.status).toBe('hit');
  if (predecessor.status !== 'hit') throw new Error('Expected predecessor cache hit');
  expect(predecessor.keyDigest).toBe(firstKey);
  expect(new TextDecoder().decode(predecessor.predecessorToken)).toBe('first-token');
  expect(new TextDecoder().decode(predecessor.entries[0]!.bytes)).toBe('first');
});

test.serial('physical replacement and foreign residue remain typed cache failures', () => {
  const value = fixture();
  const key = sha256('replace') as `sha256:${string}`;
  const hint = value.namespace.open(key);
  hint.publish({
    entries: [entry('payload.bin', 'stable')],
    predecessorToken: new Uint8Array()
  });
  const generationRoot = findGenerationDirectory(value.root, 'payload.bin');
  renameSync(generationRoot, `${generationRoot}-displaced`);
  mkdirSync(generationRoot);
  try {
    hint.publish({
      entries: [entry('payload.bin', 'stable')],
      predecessorToken: new Uint8Array()
    });
    throw new Error('Expected physical replacement to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ContentAddressedWorkspaceCacheError);
    expect((error as ContentAddressedWorkspaceCacheError).kind).toBe('physical-replacement');
  }
});
