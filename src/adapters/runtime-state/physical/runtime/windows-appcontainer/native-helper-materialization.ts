import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rawSha256 } from '../../../../../contracts/canonical.ts';

export type WindowsAppContainerNativeHelperMaterializationFailure =
  | 'native-helper-build'
  | 'native-helper-bundle-contract'
  | 'native-helper-capability'
  | 'native-helper-entry';

export class WindowsAppContainerNativeHelperMaterializationError extends Error {
  readonly failure: WindowsAppContainerNativeHelperMaterializationFailure;

  constructor(
    failure: WindowsAppContainerNativeHelperMaterializationFailure,
    cause?: unknown
  ) {
    super(failure, cause === undefined ? undefined : { cause });
    this.name = 'WindowsAppContainerNativeHelperMaterializationError';
    this.failure = failure;
  }
}

export interface WindowsAppContainerNativeHelperCapability {
  readonly byteLength: number;
  readonly contentDigest: `sha256:${string}`;
}

type NativeHelperBundleSource = () => Promise<Uint8Array>;

interface NativeHelperEntryMetadata {
  readonly identity: string;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
  readonly linkCount: number;
}

export interface NativeHelperEntryProbe {
  readonly lstat: (value: string) => Promise<NativeHelperEntryMetadata>;
  readonly realpath: (value: string) => Promise<string>;
}

interface NativeHelperBuildOutput {
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

interface NativeHelperBuildResult {
  readonly success: boolean;
  readonly outputs: readonly NativeHelperBuildOutput[];
}

type NativeHelperBuilder = (
  entryPath: string
) => Promise<NativeHelperBuildResult>;

export interface NativeHelperBundleLoaderForTests {
  readonly build: () => Promise<Uint8Array>;
  readonly prepare: () => Promise<void>;
}

const NATIVE_HELPER_ENTRY_PATH = fileURLToPath(new URL('./native-helper.ts', import.meta.url));
const capabilityBytes = new WeakMap<object, Uint8Array>();

const NATIVE_HELPER_ENTRY_PROBE: NativeHelperEntryProbe = Object.freeze({
  async lstat(value: string): Promise<NativeHelperEntryMetadata> {
    const metadata = await lstat(value);
    return Object.freeze({
      identity: [
        metadata.dev,
        metadata.ino,
        metadata.mode,
        metadata.nlink,
        metadata.size,
        metadata.ctimeMs,
        metadata.mtimeMs
      ].map(String).join(':'),
      isFile: metadata.isFile(),
      isSymbolicLink: metadata.isSymbolicLink(),
      linkCount: Number(metadata.nlink)
    });
  },
  realpath
});

const NATIVE_HELPER_BUILDER: NativeHelperBuilder =
  async (entryPath) => Bun.build({
    entrypoints: [entryPath],
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    splitting: false,
    target: 'bun'
  });

function sameNativePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

async function proveNativeHelperEntry(
  entryPath: string,
  probe: NativeHelperEntryProbe
): Promise<Readonly<{ identity: string; path: string }>> {
  try {
    const before = await probe.lstat(entryPath);
    const physicalPath = await probe.realpath(entryPath);
    const after = await probe.lstat(entryPath);
    if (!before.isFile || before.isSymbolicLink || before.linkCount !== 1 ||
      before.identity !== after.identity || before.isFile !== after.isFile ||
      before.isSymbolicLink !== after.isSymbolicLink || before.linkCount !== after.linkCount ||
      !sameNativePath(physicalPath, entryPath)) {
      throw new Error('invalid native helper entry');
    }
    return Object.freeze({ identity: before.identity, path: path.resolve(physicalPath) });
  } catch (error) {
    if (error instanceof WindowsAppContainerNativeHelperMaterializationError) throw error;
    throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-entry', error);
  }
}

function validateNativeHelperBundle(bytes: Uint8Array): Uint8Array {
  const stable = bytes.slice();
  const text = new TextDecoder().decode(stable);
  if (stable.byteLength === 0 || /(?:from|import\s*\()\s*["'][^"']+\.ts["']/u.test(text)) {
    throw new WindowsAppContainerNativeHelperMaterializationError(
      'native-helper-bundle-contract'
    );
  }
  return stable;
}

async function buildNativeHelperBundleSource(
  entryPath = NATIVE_HELPER_ENTRY_PATH,
  probe = NATIVE_HELPER_ENTRY_PROBE,
  builder = NATIVE_HELPER_BUILDER
): Promise<Uint8Array> {
  const before = await proveNativeHelperEntry(entryPath, probe);
  let result: NativeHelperBuildResult;
  try {
    result = await builder(before.path);
    if (!result.success || result.outputs.length !== 1) {
      throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-build');
    }
  } catch (error) {
    if (error instanceof WindowsAppContainerNativeHelperMaterializationError) throw error;
    throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-build', error);
  }
  let outputBytes: Uint8Array;
  try {
    outputBytes = new Uint8Array(await result.outputs[0]!.arrayBuffer());
  } catch (error) {
    throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-build', error);
  }
  const bytes = validateNativeHelperBundle(outputBytes);
  const after = await proveNativeHelperEntry(entryPath, probe);
  if (after.path !== before.path || after.identity !== before.identity) {
    throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-entry');
  }
  return bytes;
}

function issueNativeHelperCapability(bytes: Uint8Array): WindowsAppContainerNativeHelperCapability {
  const stable = validateNativeHelperBundle(bytes);
  const capability = Object.freeze({
    byteLength: stable.byteLength,
    contentDigest: rawSha256(stable)
  });
  capabilityBytes.set(capability, stable);
  return capability;
}

function createCapabilityLoader(source: NativeHelperBundleSource): Readonly<{
  acquire: () => Promise<WindowsAppContainerNativeHelperCapability>;
  prepare: () => Promise<void>;
}> {
  let cachedPromise: Promise<WindowsAppContainerNativeHelperCapability> | undefined;
  const acquire = (): Promise<WindowsAppContainerNativeHelperCapability> => {
    if (cachedPromise) return cachedPromise;
    const pending = source().then(issueNativeHelperCapability);
    let cached: Promise<WindowsAppContainerNativeHelperCapability>;
    cached = pending.catch((error: unknown) => {
      if (cachedPromise === cached) cachedPromise = undefined;
      throw error;
    });
    cachedPromise = cached;
    return cached;
  };
  return Object.freeze({
    acquire,
    async prepare(): Promise<void> {
      await acquire();
    }
  });
}

const productionCapabilityLoader = createCapabilityLoader(buildNativeHelperBundleSource);

export function acquireWindowsAppContainerNativeHelperCapability(
): Promise<WindowsAppContainerNativeHelperCapability> {
  return productionCapabilityLoader.acquire();
}

export function readWindowsAppContainerNativeHelperCapability(
  capability: WindowsAppContainerNativeHelperCapability
): Uint8Array {
  const bytes = capabilityBytes.get(capability);
  if (bytes === undefined || capability.byteLength !== bytes.byteLength ||
    capability.contentDigest !== rawSha256(bytes)) {
    throw new WindowsAppContainerNativeHelperMaterializationError('native-helper-capability');
  }
  return bytes.slice();
}

export function createNativeHelperBundleLoaderForTests(
  source: NativeHelperBundleSource
): NativeHelperBundleLoaderForTests {
  const loader = createCapabilityLoader(source);
  return Object.freeze({
    async build(): Promise<Uint8Array> {
      return readWindowsAppContainerNativeHelperCapability(await loader.acquire());
    },
    prepare: loader.prepare
  });
}

export async function proveNativeHelperEntryForTests(
  entryPath: string,
  probe: NativeHelperEntryProbe
): Promise<string> {
  return (await proveNativeHelperEntry(entryPath, probe)).path;
}

export function buildNativeHelperBundleForTests(
  entryPath = NATIVE_HELPER_ENTRY_PATH,
  probe = NATIVE_HELPER_ENTRY_PROBE,
  builder = NATIVE_HELPER_BUILDER
): Promise<Uint8Array> {
  return buildNativeHelperBundleSource(entryPath, probe, builder);
}
