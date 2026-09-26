import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import { resolveWorkspaceRuntimeRoots } from '../workspace-state/paths.ts';
import {
  createGeneratedStateRegistration,
  generatedStateDigest,
  generatedStateRuleForPath
} from './contract.ts';
import {
  generatedStateProducerHooks,
  inspectGeneratedState
} from './lifecycle.ts';

const roots: string[] = [];
const relativePath = '.tmp/dependency-installs/c.staging-registration-migration';

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function legacyFixture() {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-registration-migration-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  const generatedRoot = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'payload.bin'), 'current-generation');
  const environment = { ...process.env, SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const runtimeRoots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment });
  const registrationsRoot = path.join(
    runtimeRoots.workspaceStateRoot,
    'generated-state',
    'v1',
    'registrations'
  );
  const targetRegistrationsRoot = path.join(
    runtimeRoots.workspaceStateRoot,
    'generated-state',
    'v1',
    'registrations-v2'
  );
  await mkdir(registrationsRoot, { recursive: true });
  const workspace = inspectNoFollowDirectoryChain(repositoryRoot, 'fixture workspace').target;
  const generated = inspectNoFollowDirectoryChain(generatedRoot, 'fixture generation').target;
  const rule = generatedStateRuleForPath(relativePath);
  if (rule === null) throw new Error('Fixture generated-state rule is unavailable.');
  const identity = (value: typeof workspace) => Object.freeze({
    device: value.device,
    inode: value.inode,
    objectId: value.objectId
  });
  const current = createGeneratedStateRegistration({
    repositoryRoot,
    workspace: identity(workspace),
    rule,
    relativePath,
    root: identity(generated),
    operationId: 'registration-migration-current'
  }, { clock: () => new Date('2026-08-29T00:01:00.000Z') });
  const historical = createGeneratedStateRegistration({
    repositoryRoot,
    workspace: identity(workspace),
    rule,
    relativePath,
    root: identity(generated),
    operationId: 'registration-migration-historical'
  }, { clock: () => new Date('2026-08-29T00:00:00.000Z') });
  const currentBytes = canonicalBytes(current);
  const historicalBytes = canonicalBytes(historical);
  await writeFile(
    path.join(registrationsRoot, `registration-${current.registrationDigest.slice('sha256:'.length)}.json`),
    currentBytes
  );
  await writeFile(
    path.join(registrationsRoot, `registration-${historical.registrationDigest.slice('sha256:'.length)}.json`),
    historicalBytes
  );
  const pointerKey = generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-registration-key-v1',
    relativePath
  })).slice('sha256:'.length);
  await writeFile(path.join(registrationsRoot, `${pointerKey}.json`), currentBytes);
  return {
    environment,
    repositoryRoot,
    registrationsRoot,
    targetRegistrationsRoot,
    current,
    historical
  } as const;
}

test('legacy registrations migrate once without inventing a historical ledger chain', async () => {
  const fixture = await legacyFixture();
  const beforeNames = await readdir(fixture.registrationsRoot);
  const beforeBytes = await Promise.all(beforeNames.sort().map(async (name) => [
    name,
    await readFile(path.join(fixture.registrationsRoot, name), 'utf8')
  ] as const));

  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await hooks.bind(relativePath);

  const afterNames = await readdir(fixture.registrationsRoot);
  const afterBytes = await Promise.all(afterNames.sort().map(async (name) => [
    name,
    await readFile(path.join(fixture.registrationsRoot, name), 'utf8')
  ] as const));
  expect(afterBytes).toEqual(beforeBytes);
  const targetNames = await readdir(fixture.targetRegistrationsRoot);
  expect(targetNames.filter((name) => name.startsWith('registration-migration-')).length).toBe(2);
  expect(targetNames.filter((name) => name.startsWith('registration-ledger-')).length).toBe(1);
  expect(targetNames).toContain(
    `registration-${fixture.current.registrationDigest.slice('sha256:'.length)}.json`
  );
  expect(targetNames).not.toContain(
    `registration-${fixture.historical.registrationDigest.slice('sha256:'.length)}.json`
  );
  expect((await inspectGeneratedState({
    repositoryRoot: fixture.repositoryRoot,
    relativePaths: [relativePath]
  }, { environment: fixture.environment })).entries[0]).toMatchObject({
    registrationState: 'active',
    registrationDigest: fixture.current.registrationDigest
  });

  const resumed = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await resumed.bind(relativePath);
  const retired = await resumed.retired(relativePath, 'migration-test-retired');
  expect(retired?.phase).toBe('retired');
  expect((await readdir(fixture.targetRegistrationsRoot))
    .filter((name) => name.startsWith('registration-ledger-')).length).toBe(2);
});

test('unknown legacy residue blocks before publishing migration authority', async () => {
  const fixture = await legacyFixture();
  await writeFile(path.join(fixture.registrationsRoot, 'foreign.txt'), 'foreign');

  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await expect(hooks.bind(relativePath)).rejects.toThrow('unknown residue');

  // Runtime State admission materializes the namespace, but invalid legacy
  // input must not publish any durable migration or registration authority.
  expect(await readdir(fixture.targetRegistrationsRoot)).toEqual([]);
});

test('a completed migration re-censuses the target before allowing another mutation', async () => {
  const fixture = await legacyFixture();
  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await hooks.bind(relativePath);
  await writeFile(path.join(fixture.targetRegistrationsRoot, 'foreign-target-residue.txt'), 'foreign');

  const resumed = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await expect(resumed.bind(relativePath)).rejects.toThrow('unknown residue');
});

test('fresh generated-state runtime uses semantic layout names without numeric generations', async () => {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-runtime-current-layout-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  const generatedRoot = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'payload.bin'), 'current-generation');
  const environment = { ...process.env, SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const runtimeRoots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment });

  const hooks = generatedStateProducerHooks(
    { repositoryRoot },
    { environment }
  );
  await hooks.bind(relativePath);

  const currentRoot = path.join(
    runtimeRoots.workspaceStateRoot,
    'generated-state',
    'runtime',
    'registrations',
    'current'
  );
  expect(await readdir(currentRoot)).not.toHaveLength(0);
  await expect(readdir(path.join(runtimeRoots.workspaceStateRoot, 'generated-state', 'v1')))
    .rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readdir(path.join(runtimeRoots.workspaceStateRoot, 'generated-state', 'runtime', 'registrations-v2')))
    .rejects.toMatchObject({ code: 'ENOENT' });
});
