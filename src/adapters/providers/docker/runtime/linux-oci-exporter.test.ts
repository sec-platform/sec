import { expect, test } from 'bun:test';

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext, type SecOperationDigest
} from '../../../../execution/operation/semantic.ts';

import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { ContainerEngineSession } from '../contract/container-engine-session.ts';
import { createDockerEndpointIdentity } from '../contract/daemon.ts';
import {
  assertQualifiedLinuxDockerScopeBudget,
  assertRetainedQualifiedLinuxEngineSession,
  compileContainerEngineOperationArguments,
  compileQualifiedLinuxDockerOperationArguments
} from './container-engine-session.ts';
import {
  assertDefaultDockerBuildxInspection,
  claimQualifiedContainerEngineOciExporter,
  closeUnclaimedQualifiedContainerEngineOciExporter,
  consumeQualifiedContainerEngineOciExporter,
  qualifyLinuxDockerOciExporter,
  readScratchOciExportLayout,
  throwLinuxDockerOciProbeFailures,
  type QualifiedContainerEngineOciExporter
} from './linux-oci-exporter.ts';

const linuxTest = test.skipIf(process.platform !== 'linux');
const label = 'a'.repeat(32);
const endpoint = createDockerEndpointIdentity({ contextName: 'default', daemonId: 'fixture',
  endpointHost: 'unix:///run/docker.sock', osType: 'linux', architecture: 'x86_64' });
const inspection = Buffer.from('Name:          default\nDriver:        docker\n\nNodes:\nName:          default\nEndpoint:      default\nStatus:        running\nBuildKit version: v0.20.2\n');

test('default driver inspection excludes fallback, extra nodes and error output', () => {
  expect(() => assertDefaultDockerBuildxInspection(inspection)).not.toThrow();
  for (const source of [
    inspection.toString().replace('docker\n', 'docker-container\n'),
    `${inspection}Name: foreign\nEndpoint: default\nStatus: running\n`,
    `${inspection}Error: failed\n`,
    inspection.toString().replace('running', 'stopped'),
    inspection.toString().replace('Endpoint:      default', 'Endpoint:      other'),
    `${inspection}Driver Options: image="unqualified"\n`
  ]) expect(() => assertDefaultDockerBuildxInspection(Buffer.from(source))).toThrow();
});

test('qualification and materialization cannot choose different builders or bootstrap during inspection', () => {
  expect(compileQualifiedLinuxDockerOperationArguments(endpoint, { kind: 'buildx-build', arguments: ['-'] }))
    .toEqual(['--host', endpoint.endpointHost, 'buildx', 'build', '--builder=default', '-']);
  for (const arguments_ of [['--builder', 'other'], ['--builder=other']]) {
    expect(() => compileQualifiedLinuxDockerOperationArguments(endpoint, { kind: 'buildx-bake', arguments: arguments_ }))
      .toThrow('cannot replace');
  }
  expect(compileContainerEngineOperationArguments(endpoint, { kind: 'buildx-inspect-default', arguments: [] }))
    .toEqual(['--host', endpoint.endpointHost, 'buildx', 'inspect', 'default']);
  expect(() => compileContainerEngineOperationArguments(endpoint, { kind: 'buildx-inspect-default', arguments: ['--bootstrap'] }))
    .toThrow('cannot accept');
  expect(compileContainerEngineOperationArguments(endpoint, { kind: 'container-stop', arguments: ['--time', '10', 'exact-id'] }))
    .toEqual(['--host', endpoint.endpointHost, 'container', 'stop', '--time', '10', 'exact-id']);
});

test('policy-shaped sessions and exporter receipts cannot mint actual exporter admission', async () => {
  let calls = 0;
  await expect(assertRetainedQualifiedLinuxEngineSession({ execute() { calls += 1; } } as unknown as ContainerEngineSession))
    .rejects.toThrow('no qualified Linux CLI');
  await expect(consumeQualifiedContainerEngineOciExporter({ identityDigest: `sha256:${'a'.repeat(64)}` } as QualifiedContainerEngineOciExporter))
    .rejects.toThrow('not owner-issued');
  await expect(claimQualifiedContainerEngineOciExporter({} as QualifiedContainerEngineOciExporter)).rejects.toThrow('not owner-issued');
  expect(() => closeUnclaimedQualifiedContainerEngineOciExporter({} as QualifiedContainerEngineOciExporter)).toThrow('not owner-issued');
  expect(calls).toBe(0);
});

function operationFixture(deadlineAtUnixMs = Date.now() + 10_000, duration = 10_000) {
  const digest = sha256('exporter fixture') as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'external.container-engine.exporter-fixture', intentDigest: digest, decisionDigest: digest,
    deadlineAtUnixMs,
    aggregateBudgets: [{ resource: 'duration-ms', maximum: duration }, { resource: 'processes', maximum: 8 },
      { resource: 'input-bytes', maximum: 4096 }, { resource: 'output-bytes', maximum: 2 * 1024 * 1024 }],
    requirements: [{ id: 'engine', contractDigest: digest, effectKinds: ['filesystem', 'process', 'provider'], failureKinds: ['unavailable'] }],
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: digest })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({ requirementId: 'engine', contractDigest: digest, providerIdentityDigest: digest })]);
}

test('scope snapshots retain the real foundation plan and copy only the mutable binding container', () => {
  const original = operationFixture();
  const bindings = [...original.bindings];
  const successor = bindSecSemanticOperation(original.plan, bindings);
  bindings.length = 0;
  expect(successor.plan).toBe(original.plan);
  expect(successor.plan.attempt).toBe(original.plan.attempt);
  expect(successor.boundAttemptDigest).toBe(original.boundAttemptDigest);
  expect(successor.bindingSetIdentityDigest).toBe(original.bindingSetIdentityDigest);
  expect(successor.bindings).toHaveLength(1);
  expect(Object.isFrozen(successor)).toBe(true);
  expect(Object.isFrozen(successor.bindings)).toBe(true);
  expect(() => bindSecSemanticOperation(structuredClone(original.plan), original.bindings)).toThrow('foundation-compiled');
});

test('new Linux scope budget accepts the real foundation plan and refuses shorter, expired or undersized scopes', () => {
  const deadline = Date.now() + 10_000;
  expect(() => assertQualifiedLinuxDockerScopeBudget({ operation: operationFixture(deadline), sessionDeadlineAtUnixMs: deadline })).not.toThrow();
  for (const input of [
    { operation: operationFixture(deadline), sessionDeadlineAtUnixMs: deadline + 1 },
    { operation: operationFixture(deadline), sessionDeadlineAtUnixMs: deadline - 1 },
    { operation: operationFixture(deadline, 1), sessionDeadlineAtUnixMs: deadline },
    { operation: operationFixture(1), sessionDeadlineAtUnixMs: 1 }
  ]) {
    try { assertQualifiedLinuxDockerScopeBudget(input); throw new Error('Expected scope rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'SEC-LINUX-DOCKER-OPERATION-BUDGET-UNSUPPORTED', disposition: 'unsupported' }); }
  }
});

test('exporter rejects a forged session before invoking its deadline getter', async () => {
  const operation = operationFixture();
  let calls = 0;
  const session = Object.defineProperty({}, 'deadlineAtUnixMs', { get() { calls += 1; throw new Error('caller getter invoked'); } }) as ContainerEngineSession;
  await expect(qualifyLinuxDockerOciExporter({ session, operation, requirementId: 'engine', scratchParent: '/tmp' }))
    .rejects.toThrow('not owner-issued');
  expect(calls).toBe(0);
});

test('OCI failure closeout preserves throw undefined and both labeled errors', () => {
  let caught = false;
  try { throwLinuxDockerOciProbeFailures({ failure: { error: undefined } }); }
  catch (error) { caught = true; expect(error).toBeUndefined(); }
  expect(caught).toBe(true);
  try {
    throwLinuxDockerOciProbeFailures({ failure: { error: undefined }, cleanupFailure: { error: 'cleanup failed' }, retainedOutputRoot: '/private/owned-output' });
    throw new Error('Expected unconfirmed cleanup');
  } catch (error) {
    expect(error).toMatchObject({ disposition: 'unknown', retainedOutputRoot: '/private/owned-output',
      cause: { failures: [
        { label: 'oci-probe', error: undefined },
        { label: 'oci-probe-output-retirement', error: 'cleanup failed' }
      ] } });
  }
});

async function fixture(root: string) {
  const blobs = path.join(root, 'blobs', 'sha256');
  await mkdir(blobs, { recursive: true });
  const writeBlob = async (mediaType: string, value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(blobs, hash), bytes);
    return { mediaType, digest: `sha256:${hash}`, size: bytes.length };
  };
  const config = await writeBlob('application/vnd.oci.image.config.v1+json', {
    architecture: 'amd64', os: 'linux', config: { Labels: { 'org.sec.oci-export-probe': label } },
    rootfs: { type: 'layers', diff_ids: [] }
  });
  const manifest = await writeBlob('application/vnd.oci.image.manifest.v1+json', {
    schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers: []
  });
  await writeFile(path.join(root, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}\n');
  await writeFile(path.join(root, 'index.json'), JSON.stringify({ schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [manifest] }));
  return { config, manifest, blobs };
}

linuxTest('independent scratch OCI fixture checks real blob identities, label and complete inventory', async () => {
  const root = await mkdtemp('/tmp/sec-oci-export-readback-test-');
  try {
    const files = await fixture(root);
    const input = { directory: inspectNoFollowDirectoryChain(root).target, expectedLabel: label, deadlineAtUnixMs: Date.now() + 10_000 };
    expect(readScratchOciExportLayout(input)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => readScratchOciExportLayout({ ...input, expectedLabel: 'b'.repeat(32) })).toThrow('differs');
    await writeFile(path.join(root, 'unreferenced'), 'untrusted');
    expect(() => readScratchOciExportLayout(input)).toThrow('inventory differs');
    await rm(path.join(root, 'unreferenced'));
    await writeFile(path.join(files.blobs, files.config.digest.slice(7)), '{}');
    expect(() => readScratchOciExportLayout(input)).toThrow('digest or length');
  } finally { await rm(root, { recursive: true, force: true }); }
});
