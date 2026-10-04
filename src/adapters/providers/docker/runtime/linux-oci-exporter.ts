import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import {
  assertSemanticOperationProjection, bindSemanticOperation,
  type BoundSemanticOperation, type ProviderSettlementReceipt
} from '../../../../execution/operation/semantic.ts';
import { ResourceCompositeSettlementError, settleResources } from '../../../../execution/resource-settlement.ts';
import {
  createExclusiveNoFollowRandomDirectory,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  readNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { ContainerEngineSession } from '../contract/container-engine-session.ts';
import { assertContainerEngineSessionTransferable, assertQualifiedLinuxDockerScopeBudget, assertRetainedQualifiedLinuxEngineSession, observeRetainedContainerEngineSessionClose, qualifiedLinuxEngineOriginIdentity, retainedContainerEngineSessionSignal } from './container-engine-session.ts';

export class LinuxDockerOciExporterUnavailableError extends Error {
  readonly code = 'SEC-LINUX-DOCKER-OCI-EXPORTER-UNAVAILABLE' as const;
  readonly retainedOutputIdentity: PhysicalDirectoryIdentity | undefined;
  constructor(readonly disposition: 'unsupported' | 'unavailable' | 'unknown', message: string,
    readonly retainedOutputRoot?: string, options?: { cause?: unknown; rootIdentity?: PhysicalDirectoryIdentity }) {
    super(message, options);
    this.retainedOutputIdentity = options?.rootIdentity === undefined ? undefined : Object.freeze({ ...options.rootIdentity });
  }
}

export interface QualifiedContainerEngineOciExporter {
  readonly identityDigest: `sha256:${string}`;
  readonly providerIdentityDigest: `sha256:${string}`;
  readonly originIdentityDigest: `sha256:${string}`;
  readonly observation: Readonly<{
    builder: 'default';
    driver: 'docker';
    outputCleanup: 'retired-and-absent';
    nativeCacheOwner: 'authenticated-fresh-job-daemon';
    vmTerminationOwner: 'authenticated-job-platform';
    hostCleanup: 'not-certified';
    layoutDigest: `sha256:${string}`;
    providerSettlementReceipt: ProviderSettlementReceipt;
  }>;
}

const issued = new WeakMap<object, { session: ContainerEngineSession; state: 'available' | 'claimed' | 'disposed' }>();

function unavailable(message: string): never {
  throw new LinuxDockerOciExporterUnavailableError('unsupported', message);
}

/** Failure algebra only; it cannot issue a functional or physical capability. */
export function throwLinuxDockerOciProbeFailures(input: Readonly<{
  failure?: Readonly<{ error: unknown }>;
  cleanupFailure?: Readonly<{ error: unknown }>;
  retainedOutputRoot?: string;
  retainedOutputIdentity?: PhysicalDirectoryIdentity;
}>): void {
  if (input.cleanupFailure !== undefined) {
    throw new LinuxDockerOciExporterUnavailableError('unknown', 'OCI probe output retirement is unconfirmed.', input.retainedOutputRoot,
      { ...(input.retainedOutputIdentity === undefined ? {} : { rootIdentity: input.retainedOutputIdentity }),
        cause: input.failure === undefined ? input.cleanupFailure.error : new ResourceCompositeSettlementError([
        { label: 'oci-probe', error: input.failure.error },
        { label: 'oci-probe-output-retirement', error: input.cleanupFailure.error }
      ]) });
  }
  if (input.failure !== undefined) throw input.failure.error;
}

/** v0.23 inspect has no JSON/format option. Only this exact default/docker
 * framing is admitted, before any command that could bootstrap a driver. */
export function assertDefaultDockerBuildxInspection(bytes: Uint8Array): void {
  if (bytes.byteLength > 64 * 1024) unavailable('Default builder inspection exceeded its output bound.');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { unavailable('Default builder inspection is not UTF-8.'); }
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(source)) unavailable('Default builder inspection contains control characters.');
  const lines = source.split('\n');
  const values = (key: string) => lines.filter(line => line.startsWith(`${key}:`)).map(line => line.slice(key.length + 1).trim());
  if (JSON.stringify(values('Name')) !== JSON.stringify(['default', 'default'])
      || JSON.stringify(values('Driver')) !== JSON.stringify(['docker'])
      || JSON.stringify(values('Endpoint')) !== JSON.stringify(['default'])
      || JSON.stringify(values('Status')) !== JSON.stringify(['running'])
      || lines.filter(line => line === 'Nodes:').length !== 1
      || values('Error').length !== 0 || values('Driver Options').length !== 0
      || values('BuildKit daemon flags').length !== 0 || lines.some(line => line.startsWith('File#'))) {
    unavailable('Buildx must observe exactly the already-running default Docker driver.');
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unavailable(`${label} is not an object.`);
  return value as Record<string, unknown>;
}

/** Independent physical OCI readback for the fixed scratch/one-label probe. */
export function readScratchOciExportLayout(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  expectedLabel: string;
  deadlineAtUnixMs: number;
}>): `sha256:${string}` {
  if (!/^[a-f0-9]{32}$/u.test(input.expectedLabel)) unavailable('OCI probe label is invalid.');
  const inventory = scanNoFollowDirectoryTreeInventory(input.directory, {
    deadlineAtMs: performance.now() + Math.max(0, input.deadlineAtUnixMs - Date.now()),
    maximumEntries: 16, maximumBytes: 1024 * 1024
  });
  if (inventory.some(entry => entry.kind === 'link')) unavailable('OCI probe output contains a link.');
  const json = (directory: PhysicalDirectoryIdentity, name: string) => {
    const bytes = readNoFollowOrdinaryFile(directory, name);
    if (bytes === null || bytes.byteLength > 64 * 1024) unavailable('OCI probe JSON is missing or oversized.');
    return { bytes, value: record(parseExactJsonBytes(bytes, 'OCI exporter probe', {
      maximumInputBytes: 64 * 1024, maximumDepth: 12
    }), 'OCI probe JSON') };
  };
  const layout = json(input.directory, 'oci-layout').value;
  if (JSON.stringify(layout) !== '{"imageLayoutVersion":"1.0.0"}') unavailable('OCI layout version is invalid.');
  const index = json(input.directory, 'index.json').value;
  const blobs = inspectNoFollowDirectoryChain(path.join(input.directory.path, 'blobs', 'sha256')).target;
  const expected = new Set(['oci-layout', 'index.json', 'blobs', 'blobs/sha256']);
  const blob = (descriptor: unknown) => {
    const value = record(descriptor, 'OCI descriptor');
    if (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)
        || !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > 64 * 1024) {
      unavailable('OCI probe descriptor is invalid.');
    }
    const name = value.digest.slice(7);
    const result = json(blobs, name);
    if (result.bytes.byteLength !== value.size || rawSha256(result.bytes) !== value.digest) unavailable('OCI probe blob digest or length differs.');
    expected.add(`blobs/sha256/${name}`);
    return { descriptor: value, value: result.value };
  };
  const onlyManifest = (value: Record<string, unknown>) => {
    if (value.schemaVersion !== 2 || value.mediaType !== 'application/vnd.oci.image.index.v1+json'
        || !Array.isArray(value.manifests) || value.manifests.length !== 1) unavailable('OCI probe index must contain one image.');
    return blob(value.manifests[0]);
  };
  let manifest = onlyManifest(index);
  if (manifest.descriptor.mediaType === 'application/vnd.oci.image.index.v1+json') manifest = onlyManifest(manifest.value);
  if (manifest.descriptor.mediaType !== 'application/vnd.oci.image.manifest.v1+json'
      || manifest.value.schemaVersion !== 2 || manifest.value.mediaType !== 'application/vnd.oci.image.manifest.v1+json'
      || !Array.isArray(manifest.value.layers) || manifest.value.layers.length !== 0) {
    unavailable('OCI probe must export a layer-free scratch image.');
  }
  const config = blob(manifest.value.config);
  const rootfs = record(config.value.rootfs, 'OCI rootfs');
  const imageConfig = record(config.value.config, 'OCI image config');
  const labels = record(imageConfig.Labels, 'OCI probe labels');
  if (config.descriptor.mediaType !== 'application/vnd.oci.image.config.v1+json'
      || config.value.architecture !== 'amd64' || config.value.os !== 'linux'
      || rootfs.type !== 'layers' || !Array.isArray(rootfs.diff_ids) || rootfs.diff_ids.length !== 0
      || labels['org.sec.oci-export-probe'] !== input.expectedLabel || Object.keys(labels).length !== 1
      || inventory.length !== expected.size || inventory.some(entry => !expected.has(entry.relativePath))) {
    unavailable('OCI probe image, label or complete output inventory differs.');
  }
  if (Date.now() >= input.deadlineAtUnixMs) unavailable('OCI probe readback exceeded its original deadline.');
  return sha256({ domain: 'sec.docker.scratch-oci-export', inventory, label: input.expectedLabel }) as `sha256:${string}`;
}

/** No daemon installation, restart, driver creation, image load or global prune. */
export async function qualifyLinuxDockerOciExporter(input: Readonly<{
  session: ContainerEngineSession;
  operation: BoundSemanticOperation;
  requirementId: string;
  scratchParent: string;
}>): Promise<QualifiedContainerEngineOciExporter> {
  assertSemanticOperationProjection(input.operation);
  input = Object.freeze({ ...input, operation: bindSemanticOperation(
    input.operation.plan, input.operation.bindings
  ) });
  // Buildx --output is a CSV option, not a shell argument. A comma/quote in
  // an otherwise valid filesystem path must not introduce another exporter.
  if (typeof input.scratchParent !== 'string' || /[,"\u0000-\u001f]/u.test(input.scratchParent)) {
    unavailable('OCI probe parent cannot be represented by the closed exporter option.');
  }
  // Authenticate the object without consulting any caller-supplied getter.
  const signal = retainedContainerEngineSessionSignal(input.session);
  const deadline = input.operation.plan.attempt.deadlineAtUnixMs;
  // The existing endpoint read owner and process session own one immutable
  // deadline. Do not run a shorter advertised probe on their longer budget.
  assertQualifiedLinuxDockerScopeBudget({ operation: input.operation, sessionDeadlineAtUnixMs: input.session.deadlineAtUnixMs });
  await assertRetainedQualifiedLinuxEngineSession(input.session);
  const assertBudget = (): void => {
    throwIfNativeAborted(signal);
    if (Date.now() >= deadline) unavailable('OCI probe original deadline expired.');
  };
  assertBudget();
  await input.session.observeEndpoint();
  assertBudget();
  const scope = input.session.openOperationScope({ operation: input.operation, requirementId: input.requirementId });
  let root: PhysicalDirectoryIdentity | undefined;
  let parent: PhysicalDirectoryIdentity | undefined;
  let receipt: ProviderSettlementReceipt | undefined;
  let layoutDigest: `sha256:${string}` | undefined;
  let failure: Readonly<{ error: unknown }> | undefined;
  try {
    const inspection = await input.session.execute({ kind: 'buildx-inspect-default', arguments: [] }, {
      maxStdoutBytes: 64 * 1024, maxStderrBytes: 64 * 1024
    });
    assertDefaultDockerBuildxInspection(inspection.stdout);
    parent = inspectNoFollowDirectoryChain(input.scratchParent, 'OCI probe private parent').target;
    root = createExclusiveNoFollowRandomDirectory(parent, 'sec-oci-probe-');
    const label = randomUUID().replaceAll('-', '');
    const output = path.join(root.path, 'layout');
    const dockerfile = Buffer.from(`FROM scratch\nLABEL org.sec.oci-export-probe=${label}\n`);
    const result = await input.session.execute({ kind: 'buildx-build', arguments: [
      '--progress=rawjson', '--provenance=false', '--sbom=false', '--no-cache',
      '--output', `type=oci,dest=${output},tar=false`, '-'
    ] }, {
      input: dockerfile, maxStdinBytes: dockerfile.byteLength,
      maxStdoutBytes: 64 * 1024, maxStderrBytes: 1024 * 1024, acceptAnyExitCode: true
    });
    if (result.code !== 0) unavailable('The retained default Docker driver did not export the scratch OCI image.');
    layoutDigest = readScratchOciExportLayout({ directory: inspectNoFollowDirectoryChain(output).target,
      expectedLabel: label, deadlineAtUnixMs: deadline });
  } catch (error) { failure = Object.freeze({ error }); }
  try { receipt = scope.settle(); }
  catch (error) {
    throw new LinuxDockerOciExporterUnavailableError('unknown', 'OCI probe scope settlement is unconfirmed; retain its output.', root?.path,
      { ...(root === undefined ? {} : { rootIdentity: root }),
        cause: failure === undefined ? error : new ResourceCompositeSettlementError([
        { label: 'oci-probe', error: failure.error }, { label: 'oci-probe-scope-settlement', error }
      ]) });
  }
  if (receipt.physicalDisposition === 'unknown') {
    throw new LinuxDockerOciExporterUnavailableError('unknown', 'OCI probe transport is unsettled; retain its exact output for recovery.', root?.path,
      { ...(root === undefined ? {} : { rootIdentity: root }), ...(failure === undefined ? {} : { cause: failure.error }) });
  }
  let cleanupFailure: Readonly<{ error: unknown }> | undefined;
  try { settleResources({
    cleanup: root === undefined ? [] : [{ label: 'oci-probe-output-retirement', settle: () => {
      const deadlineAtMonotonicMs = performance.now() + Math.max(0, deadline - Date.now());
      const inventory = scanNoFollowDirectoryTreeInventory(root!, { deadlineAtMs: deadlineAtMonotonicMs,
        maximumEntries: 32, maximumBytes: 2 * 1024 * 1024 });
      retireNoFollowDirectoryTree({ parent: parent!, root: root!, inventory, deadlineAtMonotonicMs });
      if (inspectExactNoFollowDirectoryPresence(root!.path).state !== 'absent') unavailable('OCI probe output retirement is unconfirmed.');
    } }]
  }); } catch (error) { cleanupFailure = Object.freeze({ error }); }
  throwLinuxDockerOciProbeFailures({ ...(failure === undefined ? {} : { failure }),
    ...(cleanupFailure === undefined ? {} : { cleanupFailure }),
    ...(root === undefined ? {} : { retainedOutputRoot: root.path, retainedOutputIdentity: root }) });
  assertBudget();
  await input.session.observeEndpoint();
  await assertRetainedQualifiedLinuxEngineSession(input.session);
  if (layoutDigest === undefined || receipt.physicalDisposition !== 'settled') unavailable('OCI probe has no settled export observation.');
  // Functional capability only: independently checked bytes plus settled
  // transport and this output's retirement. No domain Effect receipt, hosted
  // terminal verdict or whole-daemon cleanup is issued by this owner.
  const observation = Object.freeze({ builder: 'default' as const, driver: 'docker' as const,
    outputCleanup: 'retired-and-absent' as const, nativeCacheOwner: 'authenticated-fresh-job-daemon' as const,
    vmTerminationOwner: 'authenticated-job-platform' as const, hostCleanup: 'not-certified' as const,
    layoutDigest, providerSettlementReceipt: receipt });
  const value = Object.freeze({ identityDigest: sha256({ domain: 'sec.docker.qualified-oci-exporter',
    provider: input.session.providerIdentityDigest, endpoint: input.session.endpoint, observation }) as `sha256:${string}`,
    providerIdentityDigest: input.session.providerIdentityDigest,
    originIdentityDigest: qualifiedLinuxEngineOriginIdentity(input.session), observation });
  assertBudget();
  issued.set(value, { session: input.session, state: 'available' });
  return value;
}

/** Borrow only. The creating owner retains close responsibility and must wait
 * for all borrows to finish before transfer/close. No caller-shaped session. */
export async function consumeQualifiedContainerEngineOciExporter(
  value: QualifiedContainerEngineOciExporter
): Promise<ContainerEngineSession> {
  const record = issued.get(value);
  if (record === undefined) unavailable('OCI exporter is not owner-issued.');
  if (record.state !== 'available') unavailable('OCI exporter ownership has already transferred or closed.');
  await assertRetainedQualifiedLinuxEngineSession(record.session);
  if (record.state !== 'available') unavailable('OCI exporter ownership changed during readback.');
  return record.session;
}

/** One-shot transfer of the same qualified, idle session. The recipient owns
 * its original close/settlement obligation; the former owner must not use or
 * close previously borrowed references. This does not reopen/reset a budget. */
export async function claimQualifiedContainerEngineOciExporter(value: QualifiedContainerEngineOciExporter): Promise<ContainerEngineSession> {
  const session = await consumeQualifiedContainerEngineOciExporter(value);
  const record = issued.get(value)!;
  assertContainerEngineSessionTransferable(session);
  if (record.state !== 'available') unavailable('OCI exporter ownership changed before transfer.');
  record.state = 'claimed';
  return session;
}

export function closeUnclaimedQualifiedContainerEngineOciExporter(value: QualifiedContainerEngineOciExporter): void {
  const record = issued.get(value);
  if (record === undefined) unavailable('OCI exporter is not owner-issued.');
  if (record.state !== 'available') unavailable('OCI exporter close no longer belongs to the creating owner.');
  assertContainerEngineSessionTransferable(record.session);
  record.state = 'disposed';
  record.session.close();
}

/** Read-only ownership/physical closeout. A claimed-but-open or unknown session
 * must not authorize retirement of its borrowed static generation. */
export function observeQualifiedContainerEngineOciExporterOwnership(value: QualifiedContainerEngineOciExporter): Readonly<{
  ownership: 'available' | 'claimed' | 'disposed';
  sessionClose: 'open' | 'settled' | 'unknown';
}> {
  const record = issued.get(value);
  if (record === undefined) unavailable('OCI exporter is not owner-issued.');
  return Object.freeze({ ownership: record.state, sessionClose: observeRetainedContainerEngineSessionClose(record.session) });
}
