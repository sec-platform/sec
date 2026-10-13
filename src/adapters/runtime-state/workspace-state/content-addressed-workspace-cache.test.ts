import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
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

function fixture(input: Readonly<{
  deadlineMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  root?: string;
}> = {}) {
  const root = input.root ?? mkdtempSync(path.join(os.tmpdir(), 'sec-content-cache-'));
  if (input.root === undefined) temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  if (input.root === undefined) mkdirSync(repositoryRoot);
  process.env.SEC_CACHE_HOME = path.join(root, 'cache');
  const requirementId = 'runtime-state.cache.fixture';
  const contractDigest = sha256({ requirementId }) as OperationDigest;
  const deadlineMs = input.deadlineMs ?? 30_000;
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'runtime-state.content-addressed-cache.fixture',
    intentDigest: sha256({ repositoryRoot }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + deadlineMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: deadlineMs },
      { resource: 'input-bytes', maximum: input.inputBytes ?? 1024 },
      { resource: 'output-bytes', maximum: input.outputBytes ?? 1024 },
      { resource: 'records', maximum: 32 }
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['cache.cancelled', 'cache.deadline-exhausted', 'cache.physical-replacement']
    }]
  }), [compileCapabilityBinding({
    requirementId,
    contractDigest,
    providerIdentityDigest: sha256('runtime-state-cache-fixture') as OperationDigest
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

test.serial('cache reads consume their admitted byte budget beyond the physical default leaf ceiling', () => {
  const byteLength = 64 * 1024 * 1024 + 4096;
  const value = fixture({
    deadlineMs: 120_000,
    inputBytes: byteLength + 1024,
    outputBytes: byteLength * 2 + 2048
  });
  const bytes = Buffer.alloc(byteLength);
  bytes[0] = 0x51;
  bytes[bytes.length - 1] = 0x7a;
  const key = sha256('large-cache-generation') as `sha256:${string}`;
  const hint = value.namespace.open(key);
  const publication = Object.freeze({
    entries: [Object.freeze({ name: 'large.bin', bytes, digest: rawSha256(bytes) })],
    predecessorToken: new Uint8Array()
  });
  expect(hint.publish(publication).status).toBe('hit');
  const loaded = hint.loadExact();
  expect(loaded.status).toBe('hit');
  if (loaded.status !== 'hit') throw new Error('Expected exact large cache hit');
  expect(loaded.entries[0]!.bytes.byteLength).toBe(byteLength);
  expect(loaded.entries[0]!.digest).toBe(publication.entries[0]!.digest);
});

test.serial('cache rejects an exact generation larger than its read budget as corrupt cache', () => {
  const value = fixture({ inputBytes: 4096, outputBytes: 4096 });
  const key = sha256('over-budget-cache-generation') as `sha256:${string}`;
  const hint = value.namespace.open(key);
  hint.publish({ entries: [entry('payload.bin', 'x'.repeat(2048))], predecessorToken: new Uint8Array() });
  value.session.close();
  sessions.splice(sessions.indexOf(value.session), 1);
  const constrained = fixture({ root: value.root }).namespace.open(key);
  try {
    constrained.loadExact();
    throw new Error('Expected exact cache read budget rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(ContentAddressedWorkspaceCacheError);
    expect((error as ContentAddressedWorkspaceCacheError).kind).toBe('corrupt-cache');
  }
});

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
