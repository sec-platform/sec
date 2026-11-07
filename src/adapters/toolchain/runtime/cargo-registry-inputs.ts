import path from 'node:path';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { CodedFailure } from '../../../contracts/failure.ts';
import { isCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { settleResources } from '../../../execution/resource-settlement.ts';
import {
  assertRetainedNoFollowCapability, assertSameNoFollowDirectoryIdentity, copyNoFollowDirectoryTreesBulk,
  createExclusiveNoFollowRandomDirectory, inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile, scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity, type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8 } from '../../runtime-state/physical/runtime/retained-file-read.ts';

const MAXIMUM_ENTRIES = 100_000;
const MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;
// Reserve both phases before either starts. The bulk owner does not expose
// consumed counters, so its reservation cannot be reclaimed by validation.
const COPY_ENTRIES = MAXIMUM_ENTRIES / 2;
const COPY_BYTES = MAXIMUM_BYTES / 2;
const registryBrand: unique symbol = Symbol('retained-cargo-registry-inputs');

export interface RetainedCargoRegistryInputs {
  readonly [registryBrand]: never;
  readonly cargoHome: PhysicalDirectoryIdentity;
  readonly identityDigest: `sha256:${string}`;
  assertCurrent(): void;
  retire(): void;
}

const issued = new WeakMap<object, { retired: boolean; failure: unknown }>();

export function assertRetainedCargoRegistryInputs(value: unknown): asserts value is RetainedCargoRegistryInputs {
  const state = value !== null && typeof value === 'object' ? issued.get(value) : undefined;
  if (state === undefined || state.retired || state.failure !== undefined) {
    throw new CodedFailure('CARGO-REGISTRY-INPUTS-INVALID', 'Live original-issued Cargo registry inputs are required.');
  }
}

type RegistryPackage = Readonly<{ name: string; version: string; source: string; checksum: string; archive: string }>;

function registryPackages(bytes: Uint8Array, maximumEntries: number): Readonly<{ packages: readonly RegistryPackage[]; recordCount: number }> {
  const lock = Bun.TOML.parse(decodeExactUtf8(bytes, 'Cargo.lock')) as Record<string, unknown>;
  if (!Array.isArray(lock.package)) throw new CodedFailure('CARGO-REGISTRY-LOCK', 'Cargo.lock package records are required.');
  if (lock.package.length > maximumEntries) throw new CodedFailure('CARGO-REGISTRY-LIMIT', 'Cargo.lock package record budget exhausted.');
  const packages: RegistryPackage[] = [];
  const checksums = new Map<string, string>();
  for (const entry of lock.package) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CodedFailure('CARGO-REGISTRY-LOCK', 'Cargo.lock package record is malformed.');
    }
    const { name, version, source, checksum } = entry as Record<string, unknown>;
    if (source === undefined) continue;
    if (typeof source !== 'string' || !source.startsWith('registry+') || source.length === 'registry+'.length) {
      throw new CodedFailure('CARGO-REGISTRY-SOURCE-UNAVAILABLE', 'This preparation requires registry archives; another package source needs its own preparation capability.');
    }
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(name)
        || typeof version !== 'string' || !/^[A-Za-z0-9.+_-]+$/u.test(version)
        || typeof checksum !== 'string' || !/^[a-f0-9]{64}$/u.test(checksum)) {
      throw new CodedFailure('CARGO-REGISTRY-LOCK', 'Registry package name, version or SHA256 checksum is unsafe or absent.');
    }
    const archive = `${name}-${version}.crate`;
    if (!isCanonicalPortableLogicalPath(archive)) throw new CodedFailure('CARGO-REGISTRY-LOCK', 'Registry archive name is unsafe.');
    const previous = checksums.get(archive);
    if (previous !== undefined && previous !== checksum) {
      throw new CodedFailure('CARGO-REGISTRY-AMBIGUOUS', 'Different locked sources require conflicting checksums for the same archive filename.');
    }
    checksums.set(archive, checksum);
    packages.push(Object.freeze({ name, version, source, checksum, archive }));
  }
  return Object.freeze({ packages: Object.freeze(packages), recordCount: lock.package.length });
}

export async function prepareCargoRegistryInputs(input: Readonly<{
  sourceCargoHome: PhysicalDirectoryIdentity;
  lockFile: RetainedNoFollowOrdinaryFile;
  outputRoot: PhysicalDirectoryIdentity;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
  assertCurrent: () => void;
}>): Promise<RetainedCargoRegistryInputs> {
  if (process.platform !== 'win32') throw new CodedFailure('CARGO-REGISTRY-UNAVAILABLE', 'Cargo registry continuous input protection requires the qualified Windows retained-file provider.');
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()) {
    throw new CodedFailure('CARGO-REGISTRY-DEADLINE', 'Cargo registry preparation requires a live absolute deadline.');
  }
  const deadlineAtMs = performance.now() + input.deadlineAtUnixMs - Date.now();
  const checkpoint = (): void => {
    throwIfNativeAborted(input.signal);
    if (performance.now() >= deadlineAtMs || Date.now() >= input.deadlineAtUnixMs) {
      throw new CodedFailure('CARGO-REGISTRY-DEADLINE', 'Cargo registry preparation deadline exhausted.');
    }
  };
  const assertBoundary = (): void => {
    checkpoint();
    input.assertCurrent();
    assertSameNoFollowDirectoryIdentity(input.sourceCargoHome, 'Cargo preparation source home');
    assertSameNoFollowDirectoryIdentity(input.outputRoot, 'Cargo preparation output root');
  };
  let entriesRemaining = MAXIMUM_ENTRIES - COPY_ENTRIES;
  let bytesRemaining = MAXIMUM_BYTES - COPY_BYTES;
  const consumeBytes = (size: number): void => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytesRemaining) {
      throw new CodedFailure('CARGO-REGISTRY-LIMIT', 'Cargo registry validation byte budget exhausted.');
    }
    bytesRemaining -= size;
  };
  const scan = (directory: PhysicalDirectoryIdentity, direct: boolean) => {
    checkpoint();
    if (entriesRemaining < 1) throw new CodedFailure('CARGO-REGISTRY-LIMIT', 'Cargo registry validation entry budget exhausted.');
    const options = { maximumEntries: entriesRemaining, deadlineAtMs, signal: input.signal };
    const result = direct ? scanNoFollowDirectoryDirectMetadata(directory, options) : scanNoFollowDirectoryTreeMetadata(directory, options);
    entriesRemaining -= result.length;
    return result;
  };
  const pins: RetainedNoFollowOrdinaryFile[] = [];
  let cargoHome: PhysicalDirectoryIdentity;
  let identityDigest: `sha256:${string}`;
  try {
    assertBoundary();
    assertRetainedNoFollowCapability(input.lockFile, 'ordinary-file', 'Cargo preparation lock');
    input.lockFile.assertCurrent();
    consumeBytes(input.lockFile.size);
    const lockBytes = input.lockFile.readBytes();
    const { packages, recordCount } = registryPackages(lockBytes, entriesRemaining);
    entriesRemaining -= recordCount;
    const required = new Map(packages.map(record => [record.archive, record.checksum]));
    const sourceRoot = assertSameNoFollowDirectoryIdentity(input.sourceCargoHome, 'Cargo preparation source home');
    assertSameNoFollowDirectoryIdentity(input.outputRoot, 'Cargo preparation output root');
    const registry = inspectNoFollowDirectoryChain(path.join(sourceRoot.target.path, 'registry')).target;
    for (const entry of scan(registry, true)) {
      if (entry.relativePath === '') continue;
      if (entry.kind === 'directory' && ['cache', 'index', 'src'].includes(entry.relativePath)) continue;
      if (entry.kind === 'file' && entry.relativePath === 'CACHEDIR.TAG') continue;
      throw new CodedFailure('CARGO-REGISTRY-UNSAFE', 'Cargo registry has an unknown or unsafe direct member.');
    }
    cargoHome = createExclusiveNoFollowRandomDirectory(input.outputRoot, 'cargo-home-');
    await copyNoFollowDirectoryTreesBulk([{ source: registry, target: path.join(cargoHome.path, 'registry') }], {
      excludeRelativePaths: ['src'], maximumEntries: COPY_ENTRIES, maximumBytes: COPY_BYTES,
      deadlineAtMs, signal: input.signal, assertCurrent: assertBoundary
    });
    const copiedRegistry = inspectNoFollowDirectoryChain(path.join(cargoHome.path, 'registry')).target;
    const observations: unknown[] = [];
    const matched = new Set<string>();
    for (const entry of scan(copiedRegistry, false)) {
      checkpoint();
      if (entry.kind === 'link') throw new CodedFailure('CARGO-REGISTRY-UNSAFE', 'Private registry links are unavailable.');
      if (entry.relativePath !== '' && !entry.relativePath.includes('/')
          && !(entry.kind === 'directory' && ['cache', 'index'].includes(entry.relativePath))
          && !(entry.kind === 'file' && entry.relativePath === 'CACHEDIR.TAG')) {
        throw new CodedFailure('CARGO-REGISTRY-UNSAFE', 'Copied registry has an unknown or unsafe direct member.');
      }
      const components = entry.relativePath.split('/');
      if (components[0] !== 'cache' || entry.kind !== 'file') continue;
      const checksum = required.get(components.at(-1)!);
      if (checksum === undefined) continue;
      if (components.length !== 3) throw new CodedFailure('CARGO-REGISTRY-UNSAFE', 'Matching archive is outside the registry cache source layout.');
      const archive = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(path.join(copiedRegistry.path, entry.relativePath))),
        components[2]!, { device: entry.device, inode: entry.inode }, 'Verified Cargo registry archive');
      pins.push(archive);
      consumeBytes(archive.size);
      const digest = archive.digest();
      if (digest.byteDigest !== `sha256:${checksum}`) throw new CodedFailure('CARGO-REGISTRY-CHECKSUM', 'Private registry archive differs from its locked SHA256 checksum.');
      matched.add(components[2]!);
      observations.push({ path: entry.relativePath, physical: archive.physical, size: digest.size, byteDigest: digest.byteDigest });
    }
    for (const archive of required.keys()) {
      if (!matched.has(archive)) throw new CodedFailure('CARGO-REGISTRY-MISSING', `Locked registry archive is absent: ${archive}`);
    }
    assertBoundary();
    input.lockFile.assertCurrent();
    identityDigest = sha256({ domain: 'cargo-registry-inputs', lock: rawSha256(lockBytes), packages,
      cargoHome, archives: observations }) as `sha256:${string}`;
    checkpoint();
  } catch (error) {
    settleResources({ primary: { label: 'Cargo registry preparation', error }, cleanup: pins.reverse().map(pin => ({
      label: 'partial Cargo registry archive', settle: () => pin.dispose()
    })) });
    throw error;
  }
  const state = { retired: false, failure: undefined as unknown };
  const generation: RetainedCargoRegistryInputs = Object.freeze({ [registryBrand]: undefined as never,
    cargoHome, identityDigest,
    assertCurrent: () => {
      assertRetainedCargoRegistryInputs(generation);
      input.assertCurrent();
      input.lockFile.assertCurrent();
      assertSameNoFollowDirectoryIdentity(cargoHome, 'Prepared Cargo home');
      for (const pin of pins) pin.assertCurrent();
    },
    retire: () => {
      if (state.retired) return;
      if (state.failure !== undefined) throw state.failure;
      try {
        settleResources({ cleanup: [...pins].reverse().map(pin => ({ label: 'Cargo registry archive', settle: () => pin.dispose() })) });
        state.retired = true;
      } catch (error) { state.failure = error; throw error; }
    }
  });
  issued.set(generation, state);
  return generation;
}
