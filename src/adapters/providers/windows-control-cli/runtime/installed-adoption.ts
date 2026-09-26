import { dlopen, FFIType } from 'bun:ffi';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  resolveExecutableLocator
} from '../../../runtime-state/physical/runtime/process.ts';
import {
  getWindowsControlCliExecutableBinding,
  type WindowsControlCliEnvironmentSpec,
  type WindowsControlCliExecutableBindingProjection
} from '../contract/environment.ts';

export type WindowsControlCliInstalledAdoptionFailureReason =
  | 'installed-executable-capability-unproven'
  | 'installed-executable-ambiguous'
  | 'installed-executable-manifest-mismatch'
  | 'installed-loader-closure-unproven'
  | 'working-directory-binding-drift'
  | 'retained-capability-unavailable'
  | 'provider-epoch-drift'
  | 'session-deadline-exhausted'
  | 'session-aborted';

export class WindowsControlCliInstalledAdoptionError extends Error {
  constructor(readonly reason: WindowsControlCliInstalledAdoptionFailureReason) {
    super(`Windows control CLI installed adoption failed (${reason})`);
    this.name = 'WindowsControlCliInstalledAdoptionError';
  }
}

export type WindowsControlCliInstalledAdoption = Readonly<{
  readonly providerRevision: `sha256:${string}`;
  readonly rootObservedBytes: number;
  readonly executableObservedBytes: number;
  readonly records: number;
  assertCurrent(): void;
  dispose(): void;
}>;

type AdoptionDeadline = Readonly<{
  remainingMs(): number;
  assertLive(): void;
}>;

type AdoptionLedger = Readonly<{
  observe(bytes: number, executable: boolean): void;
  record(): void;
  snapshot(): Readonly<{
    rootObservedBytes: number;
    executableObservedBytes: number;
    records: number;
  }>;
}>;

type RetainedExecutableClosure = Readonly<{
  readonly binding: WindowsControlCliExecutableBindingProjection;
  readonly root: PhysicalDirectoryChain;
  readonly retained: readonly RetainedNoFollowOrdinaryFile[];
  readonly fileReceipts: readonly RetainedFileReceipt[];
  readonly executable: RetainedNoFollowOrdinaryFile;
  readonly observedBytes: number;
  readonly executableObservedBytes: number;
  readonly records: number;
  assertCurrent(): void;
  dispose(): void;
}>;

type RetainedFileReceipt = Readonly<{
  readonly capability: RetainedNoFollowOrdinaryFile;
  readonly byteDigest: `sha256:${string}`;
}>;

const WINDOWS_PATH_LIMIT = 32_768;
const PE_IMPORT_NAME_LIMIT = 256;
const PE_SECTION_LIMIT = 96;

function fail(reason: WindowsControlCliInstalledAdoptionFailureReason): never {
  throw new WindowsControlCliInstalledAdoptionError(reason);
}

function adoptionLedger(input: Readonly<{
  maxRootObservedBytes: number;
  maxExecutableObservedBytes: number;
  maxRecords: number;
}>): AdoptionLedger {
  let rootObservedBytes = 0;
  let executableObservedBytes = 0;
  let records = 0;
  const observe = (bytes: number, executable: boolean): void => {
    if (!Number.isSafeInteger(bytes) || bytes < 0
        || rootObservedBytes + bytes > input.maxRootObservedBytes
        || (executable && executableObservedBytes + bytes > input.maxExecutableObservedBytes)) {
      fail('retained-capability-unavailable');
    }
    rootObservedBytes += bytes;
    if (executable) executableObservedBytes += bytes;
  };
  const record = (): void => {
    if (records + 1 > input.maxRecords) fail('retained-capability-unavailable');
    records += 1;
  };
  return Object.freeze({
    observe,
    record,
    snapshot: () => Object.freeze({ rootObservedBytes, executableObservedBytes, records })
  });
}

function environmentValue(source: Readonly<NodeJS.ProcessEnv>, key: string): string | undefined {
  const actual = Object.keys(source).find((candidate) => candidate.toUpperCase() === key);
  return actual === undefined ? undefined : source[actual];
}

function pathKey(value: string): string {
  return path.win32.normalize(value).replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US');
}

function relativePathKey(value: string): string {
  return value.replaceAll('/', '\\').toLocaleLowerCase('en-US');
}

function rootForCandidate(candidate: string, relativeCandidate: string): string | null {
  const normalizedCandidate = path.win32.normalize(candidate);
  const normalizedRelative = relativeCandidate.replaceAll('/', '\\');
  const candidateKey = pathKey(normalizedCandidate);
  const relativeKey = relativePathKey(normalizedRelative);
  if (!candidateKey.endsWith(`\\${relativeKey}`) && candidateKey !== relativeKey) return null;
  const root = normalizedCandidate.slice(0, normalizedCandidate.length - normalizedRelative.length)
    .replace(/[\\/]+$/u, '');
  return path.win32.isAbsolute(root) && path.win32.normalize(root) === root ? root : null;
}

function candidateRoots(
  binding: WindowsControlCliExecutableBindingProjection,
  environment: Readonly<NodeJS.ProcessEnv>,
  workingDirectory: string,
  maximum: number
): readonly string[] {
  const candidates = new Map<string, string>();
  const addCandidate = (candidate: string, relativeCandidate: string): void => {
    if (candidates.size >= maximum || candidate.length > WINDOWS_PATH_LIMIT) return;
    const root = rootForCandidate(candidate, relativeCandidate);
    if (root !== null) candidates.set(pathKey(root), root);
  };
  const pathValue = environmentValue(environment, 'PATH') ?? '';
  const selectedHint = resolveExecutableLocator(binding.executableName, {
    pathValue,
    cwd: workingDirectory
  });
  if (selectedHint !== null) {
    for (const layout of binding.candidateLayouts) {
      addCandidate(selectedHint, layout.candidateRelativePath);
    }
  }
  const programFiles = [
    environmentValue(environment, 'PROGRAMFILES'),
    environmentValue(environment, 'PROGRAMW6432')
  ].filter((value): value is string => value !== undefined && path.win32.isAbsolute(value));
  const localAppData = environmentValue(environment, 'LOCALAPPDATA');
  const conventionalRoots = binding.id === 'git'
    ? [
        ...programFiles.map((root) => path.win32.join(root, 'Git')),
        ...(localAppData === undefined ? [] : [path.win32.join(localAppData, 'Programs', 'Git')])
      ]
    : [
        ...programFiles.map((root) => path.win32.join(root, 'GitHub CLI')),
        ...(localAppData === undefined ? [] : [path.win32.join(localAppData, 'Programs', 'GitHub CLI')])
      ];
  for (const root of conventionalRoots) {
    for (const layout of binding.candidateLayouts) {
      addCandidate(path.win32.join(root, layout.candidateRelativePath), layout.candidateRelativePath);
    }
  }
  for (const entry of pathValue.split(path.delimiter).slice(0, 128)) {
    if (entry.length === 0 || entry.includes('\0') || !path.win32.isAbsolute(entry)) continue;
    for (const layout of binding.candidateLayouts) {
      addCandidate(
        path.win32.join(entry, path.win32.basename(layout.candidateRelativePath)),
        layout.candidateRelativePath
      );
    }
  }
  return Object.freeze([...candidates.values()]);
}

function retainManifestFile(
  root: PhysicalDirectoryChain,
  relativePath: string,
  expectedSize: number,
  expectedDigest: string,
  role: 'ordinary-file' | 'executable',
  executableObservation: boolean,
  ledger: AdoptionLedger,
  label: string
): RetainedFileReceipt {
  const parentPath = path.win32.join(root.target.path, path.win32.dirname(relativePath));
  const parent = inspectNoFollowDirectoryChain(parentPath, `${label} parent`);
  const retained = retainNoFollowOrdinaryFile(
    parent,
    path.win32.basename(relativePath),
    undefined,
    label,
    role === 'executable' ? RETAINED_EXECUTABLE_CHILD_DESCRIPTOR : 5,
    role
  );
  ledger.record();
  ledger.observe(retained.size, executableObservation);
  const digest = retained.digest();
  if (retained.size !== expectedSize || digest.byteDigest !== `sha256:${expectedDigest}`) {
    retained.dispose();
    fail('installed-executable-manifest-mismatch');
  }
  return Object.freeze({ capability: retained, byteDigest: digest.byteDigest });
}

function peImportedModuleNames(bytes: Uint8Array, maximumSections: number): readonly string[] {
  try {
    if (bytes.byteLength < 256) fail('installed-loader-closure-unproven');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== 0x5a4d) fail('installed-loader-closure-unproven');
    const pe = view.getUint32(0x3c, true);
    if (pe + 24 > bytes.byteLength || view.getUint32(pe, true) !== 0x0000_4550) {
      fail('installed-loader-closure-unproven');
    }
    const sectionCount = view.getUint16(pe + 6, true);
    const optionalSize = view.getUint16(pe + 20, true);
    if (sectionCount < 1 || sectionCount > Math.min(maximumSections, PE_SECTION_LIMIT)) {
      fail('installed-loader-closure-unproven');
    }
    const optional = pe + 24;
    const magic = view.getUint16(optional, true);
    const directoryTable = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
    if (directoryTable < optional || directoryTable + 16 > optional + optionalSize) {
      fail('installed-loader-closure-unproven');
    }
    const importRva = view.getUint32(directoryTable + 8, true);
    const importSize = view.getUint32(directoryTable + 12, true);
    if (importRva === 0 || importSize < 20) fail('installed-loader-closure-unproven');
    const sections = [] as Array<Readonly<{
      virtualAddress: number;
      virtualSize: number;
      rawSize: number;
      rawOffset: number;
    }>>;
    const sectionTable = optional + optionalSize;
    if (sectionTable + sectionCount * 40 > bytes.byteLength) fail('installed-loader-closure-unproven');
    for (let index = 0; index < sectionCount; index += 1) {
      const offset = sectionTable + index * 40;
      sections.push(Object.freeze({
        virtualAddress: view.getUint32(offset + 12, true),
        virtualSize: view.getUint32(offset + 8, true),
        rawSize: view.getUint32(offset + 16, true),
        rawOffset: view.getUint32(offset + 20, true)
      }));
    }
    const headerSize = view.getUint32(optional + 60, true);
    const fileOffset = (rva: number, length = 1): number => {
      if (!Number.isSafeInteger(rva) || rva < 0 || !Number.isSafeInteger(length) || length < 1) {
        fail('installed-loader-closure-unproven');
      }
      if (rva < headerSize && rva + length <= headerSize && rva + length <= bytes.byteLength) {
        return rva;
      }
      for (const section of sections) {
        const delta = rva - section.virtualAddress;
        if (delta >= 0 && delta + length <= section.rawSize) {
          const offset = section.rawOffset + delta;
          if (offset + length <= bytes.byteLength) return offset;
        }
      }
      fail('installed-loader-closure-unproven');
    };
    const modules: string[] = [];
    let terminated = false;
    for (let descriptorRva = importRva;
      descriptorRva + 20 <= importRva + importSize;
      descriptorRva += 20) {
      const descriptor = fileOffset(descriptorRva, 20);
      const nameRva = view.getUint32(descriptor + 12, true);
      if (nameRva === 0) {
        if ([0, 4, 8, 16].some((offset) => view.getUint32(descriptor + offset, true) !== 0)) {
          fail('installed-loader-closure-unproven');
        }
        terminated = true;
        break;
      }
      if (modules.length >= PE_IMPORT_NAME_LIMIT) fail('installed-loader-closure-unproven');
      let name = '';
      for (let nameOffset = 0; nameOffset <= 255; nameOffset += 1) {
        const byte = bytes[fileOffset(nameRva + nameOffset, 1)]!;
        if (byte === 0) break;
        if (byte < 0x20 || byte > 0x7e) fail('installed-loader-closure-unproven');
        name += String.fromCharCode(byte);
      }
      const terminator = bytes[fileOffset(nameRva + name.length, 1)];
      if (name.length === 0 || name.length > 255 || terminator !== 0
          || !/^[A-Za-z0-9._-]+\.dll$/iu.test(name)) {
        fail('installed-loader-closure-unproven');
      }
      modules.push(name.toLocaleLowerCase('en-US'));
    }
    if (!terminated || modules.length === 0 || new Set(modules).size !== modules.length) {
      fail('installed-loader-closure-unproven');
    }
    return Object.freeze(modules);
  } catch (error) {
    if (error instanceof WindowsControlCliInstalledAdoptionError) throw error;
    fail('installed-loader-closure-unproven');
  }
}

function openSystemDirectoryKernel32() {
  return dlopen('kernel32.dll', {
    GetSystemDirectoryW: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.u32
    }
  } as const);
}

function windowsSystemDirectory(): string {
  let kernel32: ReturnType<typeof openSystemDirectoryKernel32> | null = null;
  try {
    kernel32 = openSystemDirectoryKernel32();
    const capacity = 32_768;
    const output = Buffer.alloc(capacity * 2);
    const length = kernel32.symbols.GetSystemDirectoryW(output, capacity);
    if (length === 0 || length >= capacity) fail('installed-loader-closure-unproven');
    const directory = output.subarray(0, length * 2).toString('utf16le');
    if (!path.win32.isAbsolute(directory) || path.win32.normalize(directory) !== directory) {
      fail('installed-loader-closure-unproven');
    }
    return directory;
  } catch (error) {
    if (error instanceof WindowsControlCliInstalledAdoptionError) throw error;
    throw new WindowsControlCliInstalledAdoptionError(
      'installed-loader-closure-unproven'
    );
  } finally {
    kernel32?.close();
  }
}

function retainSystemModule(
  systemDirectory: PhysicalDirectoryChain,
  name: string,
  ledger: AdoptionLedger
): RetainedFileReceipt {
  const retained = retainNoFollowOrdinaryFile(
    systemDirectory,
    name,
    undefined,
    `Windows loader system module ${name}`,
    5,
    'ordinary-file'
  );
  ledger.record();
  ledger.observe(retained.size, false);
  return Object.freeze({ capability: retained, byteDigest: retained.digest().byteDigest });
}

function authenticateCandidate(
  rootPath: string,
  binding: WindowsControlCliExecutableBindingProjection,
  systemDirectory: PhysicalDirectoryChain,
  deadline: AdoptionDeadline,
  ledger: AdoptionLedger,
  maximumPeSections: number
): RetainedExecutableClosure {
  const retained: RetainedNoFollowOrdinaryFile[] = [];
  const fileReceipts: RetainedFileReceipt[] = [];
  try {
    deadline.assertLive();
    const root = inspectNoFollowDirectoryChain(rootPath, `${binding.id} installed root`);
    ledger.record();
    let executable: RetainedNoFollowOrdinaryFile | null = null;
    let observedBytes = 0;
    let executableObservedBytes = 0;
    const executableEntries = new Map<string, (typeof binding.launcherEntries)[number]>();
    for (const entry of [...binding.launcherEntries, binding.effectiveEntry]) {
      executableEntries.set(relativePathKey(entry.relativePath), entry);
    }
    for (const entry of executableEntries.values()) {
      deadline.assertLive();
      const receipt = retainManifestFile(
        root,
        entry.relativePath,
        entry.observedSizeBytes,
        entry.observedSha256,
        entry === binding.effectiveEntry ? 'executable' : 'ordinary-file',
        true,
        ledger,
        `${binding.id} ${entry.roles.join('+')} image`
      );
      const capability = receipt.capability;
      retained.push(capability);
      fileReceipts.push(receipt);
      observedBytes += capability.size;
      executableObservedBytes += capability.size;
      if (entry === binding.effectiveEntry) executable = capability;
    }
    if (executable === null) fail('installed-executable-manifest-mismatch');
    const declaredModules = new Map(binding.appLocalModules.map((entry) => [
      path.win32.basename(entry.relativePath).toLocaleLowerCase('en-US'),
      entry
    ] as const));
    ledger.observe(executable.size, true);
    const imports = peImportedModuleNames(executable.readBytes(), maximumPeSections);
    observedBytes += executable.size;
    executableObservedBytes += executable.size;
    const imported = new Set(imports);
    if ([...declaredModules.keys()].some((name) => !imported.has(name))) {
      fail('installed-loader-closure-unproven');
    }
    const effectiveParent = inspectNoFollowDirectoryChain(
      path.win32.dirname(executable.path),
      `${binding.id} effective executable parent`
    );
    for (const importedName of imports) {
      deadline.assertLive();
      const declared = declaredModules.get(importedName);
      if (declared !== undefined) {
        const receipt = retainManifestFile(
          root,
          declared.relativePath,
          declared.observedSizeBytes,
          declared.observedSha256,
          'ordinary-file',
          false,
          ledger,
          `${binding.id} app-local module ${importedName}`
        );
        const capability = receipt.capability;
        retained.push(capability);
        fileReceipts.push(receipt);
        observedBytes += capability.size;
        continue;
      }
      if (inspectNoFollowOrdinaryFileEntry(effectiveParent.target, importedName) !== null) {
        fail('installed-loader-closure-unproven');
      }
      const receipt = retainSystemModule(systemDirectory, importedName, ledger);
      const capability = receipt.capability;
      retained.push(capability);
      fileReceipts.push(receipt);
      observedBytes += capability.size;
    }
    const assertCurrent = (): void => {
      deadline.assertLive();
      for (const capability of retained) capability.assertCurrent();
    };
    let disposeFailure: Readonly<{ error: unknown }> | undefined;
    const dispose = (): void => {
      if (disposeFailure !== undefined) throw disposeFailure.error;
      const failures: unknown[] = [];
      for (const capability of [...retained].reverse()) {
        try { capability.dispose(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 0) return;
      const error = failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'Windows control CLI loader closure disposal had multiple failures.');
      disposeFailure = Object.freeze({ error });
      throw error;
    };
    assertCurrent();
    return Object.freeze({
      binding,
      root,
      retained: Object.freeze([...retained]),
      fileReceipts: Object.freeze([...fileReceipts]),
      executable,
      observedBytes,
      executableObservedBytes,
      records: 1 + retained.length,
      assertCurrent,
      dispose
    });
  } catch (error) {
    for (const capability of [...retained].reverse()) {
      try { capability.dispose(); } catch { /* retain primary adoption failure */ }
    }
    throw error;
  }
}

function physicalRootKey(root: PhysicalDirectoryChain): string {
  return `${root.target.device}:${root.target.inode}:${root.target.objectId}`;
}

function selectExecutableClosure(
  binding: WindowsControlCliExecutableBindingProjection,
  environment: Readonly<NodeJS.ProcessEnv>,
  workingDirectory: string,
  systemDirectory: PhysicalDirectoryChain,
  deadline: AdoptionDeadline,
  ledger: AdoptionLedger,
  maximumCandidates: number,
  maximumPeSections: number
): RetainedExecutableClosure {
  const authenticated = new Map<string, RetainedExecutableClosure>();
  let manifestMismatch = false;
  let loaderMismatch = false;
  for (const root of candidateRoots(binding, environment, workingDirectory, maximumCandidates)) {
    deadline.assertLive();
    try {
      const closure = authenticateCandidate(
        root,
        binding,
        systemDirectory,
        deadline,
        ledger,
        maximumPeSections
      );
      const key = physicalRootKey(closure.root);
      const previous = authenticated.get(key);
      if (previous === undefined) authenticated.set(key, closure);
      else closure.dispose();
    } catch (error) {
      if (error instanceof WindowsControlCliInstalledAdoptionError) {
        if (error.reason === 'retained-capability-unavailable'
            || error.reason === 'session-deadline-exhausted'
            || error.reason === 'session-aborted'
            || error.reason === 'provider-epoch-drift') {
          for (const closure of authenticated.values()) closure.dispose();
          throw error;
        }
        manifestMismatch ||= error.reason === 'installed-executable-manifest-mismatch';
        loaderMismatch ||= error.reason === 'installed-loader-closure-unproven';
        continue;
      }
      if (error instanceof PhysicalNoFollowError) continue;
      continue;
    }
  }
  if (authenticated.size !== 1) {
    for (const closure of authenticated.values()) closure.dispose();
    if (authenticated.size > 1) fail('installed-executable-ambiguous');
    if (loaderMismatch) fail('installed-loader-closure-unproven');
    if (manifestMismatch) fail('installed-executable-manifest-mismatch');
    fail('installed-executable-capability-unproven');
  }
  return authenticated.values().next().value!;
}

function providerRevision(
  spec: WindowsControlCliEnvironmentSpec,
  closures: readonly RetainedExecutableClosure[],
  systemDirectory: PhysicalDirectoryChain,
  workingDirectory: PhysicalDirectoryChain
): `sha256:${string}` {
  return sha256({
    schema: 'sec-windows-control-cli-installed-adoption-receipt-v1',
    profileId: spec.profileId,
    specDigest: spec.specDigest,
    systemDirectory: systemDirectory.target,
    workingDirectory: workingDirectory.target,
    executables: closures.map((closure) => ({
      id: closure.binding.id,
      root: closure.root.target,
      files: closure.fileReceipts.map(({ capability, byteDigest }) => ({
        pathDigest: sha256(pathKey(capability.path)),
        physical: capability.physical,
        size: capability.size,
        digest: byteDigest
      }))
    }))
  }) as `sha256:${string}`;
}

export function adoptInstalledWindowsControlCli(
  input: Readonly<{
    spec: WindowsControlCliEnvironmentSpec;
    workingDirectory: string;
    deadline: AdoptionDeadline;
    budget: Readonly<{
      maxRootObservedBytes: number;
      maxExecutableObservedBytes: number;
      maxRecords: number;
    }>;
    environment?: Readonly<NodeJS.ProcessEnv>;
  }>
): WindowsControlCliInstalledAdoption {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail('retained-capability-unavailable');
  }
  const environment = input.environment ?? process.env;
  const closures: RetainedExecutableClosure[] = [];
  const ledger = adoptionLedger(input.budget);
  let retainedWorkingDirectory: RetainedNoFollowChildProcessDirectory | null = null;
  try {
    input.deadline.assertLive();
    const workingDirectory = inspectNoFollowDirectoryChain(
      input.workingDirectory,
      'Windows control CLI working directory'
    );
    ledger.record();
    const systemDirectory = inspectNoFollowDirectoryChain(
      windowsSystemDirectory(),
      'Windows loader System32 directory'
    );
    ledger.record();
    for (const id of ['git', 'gh'] as const) {
      const binding = getWindowsControlCliExecutableBinding(input.spec, id);
      if (binding === null) fail('installed-executable-capability-unproven');
      closures.push(selectExecutableClosure(
        binding,
        environment,
        input.workingDirectory,
        systemDirectory,
        input.deadline,
        ledger,
        input.spec.adoptionContract.discovery.maxCandidatesPerExecutable,
        input.spec.adoptionContract.physicalClosure.maxPeSections
      ));
    }
    const { rootObservedBytes, executableObservedBytes, records } = ledger.snapshot();
    if (rootObservedBytes > input.spec.adoptionContract.physicalClosure.maxObservedBytes
        || closures.reduce((sum, closure) => sum + closure.retained.length, 0)
          > input.spec.adoptionContract.physicalClosure.maxRetainedFiles) {
      fail('retained-capability-unavailable');
    }
    retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectory,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Windows control CLI retained working directory'
    );
    const revision = providerRevision(input.spec, closures, systemDirectory, workingDirectory);
    let disposed = false;
    let disposeFailure: Readonly<{ error: unknown }> | undefined;
    const assertCurrent = (): void => {
      if (disposed) fail('provider-epoch-drift');
      input.deadline.assertLive();
      retainedWorkingDirectory!.assertCurrent();
      for (const closure of closures) closure.assertCurrent();
    };
    const dispose = (): void => {
      if (disposed) {
        if (disposeFailure !== undefined) throw disposeFailure.error;
        return;
      }
      disposed = true;
      const failures: unknown[] = [];
      try { retainedWorkingDirectory?.dispose(); } catch (error) { failures.push(error); }
      for (const closure of [...closures].reverse()) {
        try { closure.dispose(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 0) return;
      const error = failures.length === 1
        ? failures[0]
        : new AggregateError(failures, 'Windows control CLI provider disposal had multiple failures.');
      disposeFailure = Object.freeze({ error });
      throw error;
    };
    assertCurrent();
    return Object.freeze({
      providerRevision: revision,
      rootObservedBytes,
      executableObservedBytes,
      records,
      assertCurrent,
      dispose
    });
  } catch (error) {
    try { retainedWorkingDirectory?.dispose(); } catch { /* retain primary adoption failure */ }
    for (const closure of [...closures].reverse()) {
      try { closure.dispose(); } catch { /* retain primary adoption failure */ }
    }
    if (error instanceof WindowsControlCliInstalledAdoptionError) throw error;
    if (error instanceof PhysicalNoFollowError) {
      fail(error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        ? 'provider-epoch-drift'
        : 'retained-capability-unavailable');
    }
    fail('retained-capability-unavailable');
  }
}
