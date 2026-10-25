import { settleWorkspaceCallback } from '../../../../../tests/testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError, settleResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { inspectNoFollowDirectoryChain } from './physical-no-follow.ts';
import {
  openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot,
  retainedRuntimeStateDirectoryRequiresHostNamespace
} from './retained-runtime-state-directory.ts';
import {
  censusRetainedRuntimeGenerations,
  observeRuntimeEndpointResidueCandidatesForTests,
  runtimeEndpointAccessFailureObservationForTests,
  settleRuntimeGenerationCensusAdmissionForTests
} from './runtime-endpoint-residue.ts';

const providerIdentityDigest = `sha256:${'a'.repeat(64)}` as const;

test('partial generation census preserves primary and reports its physical close failure', () => {
  const primary = new Error('second generation admission failed');
  const closeFailure = new Error('first generation close failed');
  let closeCalls = 0;
  try {
    settleRuntimeGenerationCensusAdmissionForTests({
      primary,
      close: () => {
        closeCalls += 1;
        throw closeFailure;
      }
    });
    throw new Error('expected composite settlement failure');
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalResourceCompositeSettlementError);
    expect((error as PhysicalResourceCompositeSettlementError).failures).toEqual([
      { label: 'runtime-generation-census-admission', error: primary },
      { label: 'runtime-generation-census-close', error: closeFailure }
    ]);
  }
  expect(closeCalls).toBe(1);
});

test('bounded generation census reports physical presence without inferring provider lifecycle from links', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'runtime-generation-census-'));
  let owner: ReturnType<typeof openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot> | null = null;
  let census: ReturnType<typeof censusRetainedRuntimeGenerations> | null = null;
  await settleWorkspaceCallback(async () => {
    const activePath = path.join(rootPath, 'active-generation');
    const stalePath = path.join(rootPath, 'stale-generation');
    const unknownPath = path.join(rootPath, 'unknown-generation');
    await mkdir(activePath);
    await mkdir(stalePath);
    await mkdir(unknownPath);
    await writeFile(path.join(activePath, 'ordinary.state'), 'active');
    await symlink(
      activePath,
      path.join(stalePath, 'arbitrary.endpoint'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await writeFile(path.join(unknownPath, 'one.state'), '1');
    await writeFile(path.join(unknownPath, 'two.state'), '2');
    await writeFile(path.join(unknownPath, 'three.state'), '3');
    owner = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 48,
      mode: 'open-existing',
      root: inspectNoFollowDirectoryChain(rootPath, 'generation census owner')
    });
    census = censusRetainedRuntimeGenerations({
      providerIdentityDigest,
      maximumBytesPerRoot: 1024,
      maximumDurationMs: 2_000,
      maximumEntriesPerRoot: 2,
      profiles: [
        { id: 'active', owner, segments: ['active-generation'], childDescriptor: 49 },
        { id: 'absent', owner, segments: ['absent-generation'], childDescriptor: 50 },
        { id: 'stale', owner, segments: ['stale-generation'], childDescriptor: 51 },
        { id: 'unknown', owner, segments: ['unknown-generation'], childDescriptor: 52 }
      ]
    });
    expect(Object.fromEntries(census.receipt.entries.map(({ id, state }) => [id, state])))
      .toEqual({
        active: 'present',
        absent: 'absent',
        stale: 'present',
        unknown: 'unknown'
      });
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'generation census', settle: () => { census?.close(); } },
      { label: 'census owner', settle: () => { owner?.close(); } },
      { label: 'census fixture root', settle: () => rm(rootPath, { recursive: true, force: true }) }
    ] });
  });
});

test.skipIf(process.platform !== 'win32')('generation census preserves the owner host-namespace requirement', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'runtime-host-census-'));
  let owner: ReturnType<typeof openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot> | null = null;
  let census: ReturnType<typeof censusRetainedRuntimeGenerations> | null = null;
  await settleWorkspaceCallback(async () => {
    await mkdir(path.join(rootPath, 'generation'));
    owner = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 48,
      mode: 'open-existing',
      root: inspectNoFollowDirectoryChain(rootPath, 'host census owner'),
      requireHostNamespace: true
    });
    census = censusRetainedRuntimeGenerations({
      providerIdentityDigest,
      maximumBytesPerRoot: 1024,
      maximumDurationMs: 2_000,
      maximumEntriesPerRoot: 2,
      profiles: [{ id: 'host', owner, segments: ['generation'], childDescriptor: 49 }]
    });
    expect(census.receipt.entries[0]?.state).toBe('present');
    expect(retainedRuntimeStateDirectoryRequiresHostNamespace(census.generations[0]!)).toBe(true);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'generation census', settle: () => { census?.close(); } },
      { label: 'census owner', settle: () => { owner?.close(); } },
      { label: 'census fixture root', settle: () => rm(rootPath, { recursive: true, force: true }) }
    ] });
  });
});

test('presentation text alone cannot issue a runtime endpoint residue receipt', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'runtime-false-presentation-'));
  let retained: ReturnType<typeof openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot> | null = null;
  await settleWorkspaceCallback(async () => {
    const generationRoot = path.join(rootPath, 'unverified-generation');
    await mkdir(generationRoot);
    const endpointPath = path.join(generationRoot, 'looks-real.endpoint');
    await writeFile(endpointPath, 'ordinary-accessible-entry');
    retained = openRetainedRuntimeStateDirectoryAtOwnerIssuedRoot({
      childDescriptor: 57,
      mode: 'open-existing',
      root: inspectNoFollowDirectoryChain(rootPath, 'endpoint false-presentation root')
    });
    let probes = 0;
    const receipt = observeRuntimeEndpointResidueCandidatesForTests({
      admittedGenerationRoots: [
        inspectNoFollowDirectoryChain(generationRoot, 'false presentation generation').target
      ],
      providerIdentityDigest,
      providerEvidence: `${endpointPath}: Win32 1920; restart Windows is required`,
      roots: [retained],
      probe: () => {
        probes += 1;
        return null;
      }
    });
    expect(probes).toBe(1);
    expect(receipt).toBeNull();
    const outsideGeneration = path.join(rootPath, 'not-admitted-generation');
    await mkdir(outsideGeneration);
    const outsideEndpoint = path.join(outsideGeneration, 'physical-but-unowned.endpoint');
    await writeFile(outsideEndpoint, 'preimage');
    probes = 0;
    const outsideReceipt = observeRuntimeEndpointResidueCandidatesForTests({
      admittedGenerationRoots: [
        inspectNoFollowDirectoryChain(generationRoot, 'admitted generation fence').target
      ],
      providerIdentityDigest,
      providerEvidence: `${outsideEndpoint}: native access unavailable`,
      roots: [retained],
      probe: ({ candidatePath }) => {
        probes += 1;
        return runtimeEndpointAccessFailureObservationForTests({ candidatePath });
      }
    });
    expect(probes).toBe(0);
    expect(outsideReceipt).toBeNull();
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'retained root', settle: () => { retained?.close(); } },
      { label: 'residue fixture root', settle: () => rm(rootPath, { recursive: true, force: true }) }
    ] });
  });
});
