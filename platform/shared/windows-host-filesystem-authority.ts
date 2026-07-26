import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCommand } from './process.ts';

type DirectoryIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
}>;

export type WindowsHostDirectoryAclProof = Readonly<{
  aclDigest: string;
  ownerSid: string;
}>;

export type WindowsHostDirectoryAclProbe = (
  directoryPath: string
) => Promise<WindowsHostDirectoryAclProof>;

export type WindowsHostDirectoryAuthority = Readonly<{
  assertCurrent: () => Promise<void>;
  release: () => Promise<void>;
  rootPath: string;
}>;

type WindowsHostDirectoryAuthorityProbe = (
  directoryPath: string,
  mode: 'harden' | 'prove'
) => Promise<WindowsHostDirectoryAclProof>;

type WindowsBrowserLaunchHostAuthorityOptions = Readonly<{
  aclProbe: WindowsHostDirectoryAuthorityProbe;
  allocationSurfacePath: string;
  removeDirectory: (directoryPath: string) => Promise<void>;
}>;

const WINDOWS_ACL_PROOF_TIMEOUT_MS = 10_000;
const WINDOWS_ACL_PROOF_OUTPUT_LIMIT = 16 * 1024;

const WINDOWS_DIRECTORY_AUTHORITY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$directory = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String($env:SEC_WINDOWS_HOST_DIRECTORY_PROOF_TARGET)
)
$item = Get-Item -LiteralPath $directory -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'not-physical-directory'
}
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:SEC_WINDOWS_HOST_DIRECTORY_PROOF_MODE -eq 'harden') {
  $hardened = Get-Acl -LiteralPath $item.FullName
  $hardened.SetAccessRuleProtection($true, $false)
  $hardened.SetOwner($currentSid)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$hardened.AddAccessRule($rule)
  Set-Acl -LiteralPath $item.FullName -AclObject $hardened
}
$acl = Get-Acl -LiteralPath $item.FullName
$ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier])
if ($null -eq $currentSid -or $ownerSid.Value -ne $currentSid.Value) {
  throw 'owner-mismatch'
}
$writeMask = [int64](
  [Security.AccessControl.FileSystemRights]::WriteData -bor
  [Security.AccessControl.FileSystemRights]::CreateFiles -bor
  [Security.AccessControl.FileSystemRights]::AppendData -bor
  [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
  [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
  [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
  [Security.AccessControl.FileSystemRights]::Delete -bor
  [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
  [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
  [Security.AccessControl.FileSystemRights]::TakeOwnership -bor
  0x10000000 -bor
  0x40000000
)
$trustedSids = [Collections.Generic.HashSet[string]]::new(
  [StringComparer]::OrdinalIgnoreCase
)
[void]$trustedSids.Add($currentSid.Value)
[void]$trustedSids.Add($ownerSid.Value)
[void]$trustedSids.Add('S-1-5-18')
[void]$trustedSids.Add('S-1-5-32-544')
foreach ($rule in $acl.GetAccessRules(
  $true,
  $true,
  [Security.Principal.SecurityIdentifier]
)) {
  if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
    continue
  }
  $rights = [int64]$rule.FileSystemRights
  if (($rights -band $writeMask) -eq 0) {
    continue
  }
  $sid = $rule.IdentityReference.Value
  if (-not $trustedSids.Contains($sid)) {
    throw "untrusted-writer:$sid"
  }
}
[Console]::Out.Write((ConvertTo-Json @{
  ownerSid = $ownerSid.Value
  sddl = $acl.Sddl
} -Compress))
`;

function directoryIdentity(metadata: {
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly mode: bigint | number;
}): DirectoryIdentity {
  return Object.freeze({
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function ordinaryWindowsPath(value: string): string {
  const normalized = path.win32.normalize(value);
  if (normalized.startsWith('\\\\?\\UNC\\')) return `\\\\${normalized.slice(8)}`;
  return normalized.startsWith('\\\\?\\') ? normalized.slice(4) : normalized;
}

function sameWindowsPath(left: string, right: string): boolean {
  return ordinaryWindowsPath(path.win32.resolve(left)).toLocaleLowerCase('en-US') ===
    ordinaryWindowsPath(path.win32.resolve(right)).toLocaleLowerCase('en-US');
}

async function physicalWindowsDirectory(directoryPath: string): Promise<Readonly<{
  identity: DirectoryIdentity;
  rootPath: string;
}>> {
  if (!path.win32.isAbsolute(directoryPath)) {
    throw new Error('Windows host directory authority must be absolute');
  }
  const rootPath = path.win32.resolve(directoryPath);
  const metadata = await lstat(rootPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Windows host directory authority must be a physical directory');
  }
  const canonical = await realpath(rootPath);
  if (!sameWindowsPath(canonical, rootPath)) {
    throw new Error('Windows host directory authority must not traverse an alias');
  }
  return Object.freeze({
    identity: directoryIdentity(metadata),
    rootPath
  });
}

async function removeExactEmptyWindowsDirectory(
  directoryPath: string,
  expectedIdentity: DirectoryIdentity,
  removeDirectory: (targetPath: string) => Promise<void>
): Promise<void> {
  const current = await physicalWindowsDirectory(directoryPath);
  if (!sameDirectoryIdentity(current.identity, expectedIdentity)) {
    throw new Error('Windows host directory authority changed before cleanup');
  }
  if ((await readdir(current.rootPath)).length !== 0) {
    throw new Error('Windows host directory authority contains unowned data');
  }
  await removeDirectory(current.rootPath);
  try {
    await lstat(current.rootPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw new Error('Windows host directory authority cleanup did not remove the private root');
}

async function windowsSystemDirectory(): Promise<string> {
  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    GetSystemDirectoryW: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.u32
    }
  } as const);
  try {
    const capacity = 32_768;
    const output = Buffer.alloc(capacity * 2);
    const length = kernel32.symbols.GetSystemDirectoryW(output, capacity);
    if (length === 0 || length >= capacity) {
      throw new Error('Windows system directory could not be resolved');
    }
    return output.subarray(0, length * 2).toString('utf16le');
  } finally {
    kernel32.close();
  }
}

async function probeWindowsDirectoryAcl(
  directoryPath: string,
  mode: 'harden' | 'prove' = 'prove'
): Promise<WindowsHostDirectoryAclProof> {
  const systemDirectory = await windowsSystemDirectory();
  const powershell = path.win32.join(
    systemDirectory,
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const encodedCommand = Buffer.from(
    WINDOWS_DIRECTORY_AUTHORITY_SCRIPT,
    'utf16le'
  ).toString('base64');
  const encodedPath = Buffer.from(directoryPath, 'utf8').toString('base64');
  const result = await runCommand(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand
  ], {
    cwd: systemDirectory,
    env: {
      PATH: '',
      SEC_WINDOWS_HOST_DIRECTORY_PROOF_TARGET: encodedPath,
      SEC_WINDOWS_HOST_DIRECTORY_PROOF_MODE: mode,
      SystemRoot: path.win32.dirname(systemDirectory),
      WINDIR: path.win32.dirname(systemDirectory)
    },
    envMode: 'replace',
    timeoutMs: WINDOWS_ACL_PROOF_TIMEOUT_MS
  });
  if (result.code !== 0 || result.stdout.length > WINDOWS_ACL_PROOF_OUTPUT_LIMIT) {
    const diagnostic = result.stderr.trim().slice(0, 1024);
    throw new Error(diagnostic.length === 0
      ? 'Windows host directory owner and ACL proof failed'
      : `Windows host directory owner and ACL proof failed: ${diagnostic}`);
  }
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(',') !== 'ownerSid,sddl') {
    throw new Error('Windows host directory ACL proof is invalid');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.ownerSid !== 'string' || !record.ownerSid.startsWith('S-1-') ||
    typeof record.sddl !== 'string' || record.sddl.length === 0) {
    throw new Error('Windows host directory ACL proof is invalid');
  }
  return Object.freeze({
    aclDigest: sha256(record.sddl),
    ownerSid: record.ownerSid
  });
}

async function proveWindowsHostDirectoryAuthority(
  directoryPath: string,
  aclProbe: WindowsHostDirectoryAclProbe,
  initialAcl?: WindowsHostDirectoryAclProof,
  release: () => Promise<void> = async () => undefined,
  expectedIdentity?: DirectoryIdentity
): Promise<WindowsHostDirectoryAuthority> {
  const physical = await physicalWindowsDirectory(directoryPath);
  if (expectedIdentity && !sameDirectoryIdentity(physical.identity, expectedIdentity)) {
    throw new Error('Windows host directory authority changed before issuance');
  }
  const acl = initialAcl ?? await aclProbe(physical.rootPath);
  if (!acl.ownerSid.startsWith('S-1-') || !acl.aclDigest.startsWith('sha256:')) {
    throw new Error('Windows host directory owner and ACL proof is invalid');
  }
  return Object.freeze({
    rootPath: physical.rootPath,
    release,
    assertCurrent: async () => {
      const currentPhysical = await physicalWindowsDirectory(physical.rootPath);
      const currentAcl = await aclProbe(physical.rootPath);
      if (!sameDirectoryIdentity(currentPhysical.identity, physical.identity) ||
        currentAcl.ownerSid !== acl.ownerSid ||
        currentAcl.aclDigest !== acl.aclDigest) {
        throw new Error('Windows host directory authority changed');
      }
    }
  });
}

export async function acquireWindowsBrowserLaunchHostAuthority(): Promise<
  WindowsHostDirectoryAuthority
> {
  if (process.platform !== 'win32') {
    throw new Error('Windows browser launch host authority is Windows-only');
  }
  return acquireWindowsBrowserLaunchHostAuthorityWithOptions({
    aclProbe: probeWindowsDirectoryAcl,
    allocationSurfacePath: tmpdir(),
    removeDirectory: rmdir
  });
}

async function acquireWindowsBrowserLaunchHostAuthorityWithOptions(
  options: WindowsBrowserLaunchHostAuthorityOptions
): Promise<WindowsHostDirectoryAuthority> {
  const allocationSurface = await physicalWindowsDirectory(options.allocationSurfacePath);
  const authorityPath = path.win32.join(
    allocationSurface.rootPath,
    `sec-h-${randomUUID().replaceAll('-', '')}`
  );
  await mkdir(authorityPath);
  const created = await physicalWindowsDirectory(authorityPath);
  let released = false;
  try {
    const currentAllocationSurface = await physicalWindowsDirectory(allocationSurface.rootPath);
    if (!sameDirectoryIdentity(currentAllocationSurface.identity, allocationSurface.identity)) {
      throw new Error('Windows host allocation surface changed during private-root creation');
    }
    const initialAcl = await options.aclProbe(authorityPath, 'harden');
    const hardened = await physicalWindowsDirectory(authorityPath);
    if (!sameDirectoryIdentity(hardened.identity, created.identity)) {
      throw new Error('Windows host directory authority changed during ACL hardening');
    }
    if ((await readdir(authorityPath)).length !== 0) {
      throw new Error('Windows host directory authority contains unowned data');
    }
    const authority = await proveWindowsHostDirectoryAuthority(
      authorityPath,
      async (directoryPath) => options.aclProbe(directoryPath, 'prove'),
      initialAcl,
      async () => {
        if (released) return;
        await authority.assertCurrent();
        await removeExactEmptyWindowsDirectory(
          authorityPath,
          created.identity,
          options.removeDirectory
        );
        released = true;
      },
      created.identity
    );
    return authority;
  } catch (error) {
    try {
      await removeExactEmptyWindowsDirectory(
        authorityPath,
        created.identity,
        options.removeDirectory
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Windows browser launch host authority acquisition and cleanup both failed'
      );
    }
    throw error;
  }
}

/** Test-only production-acquisition fault seam. */
export function acquireWindowsBrowserLaunchHostAuthorityForTests(
  allocationSurfacePath: string,
  aclProbe: WindowsHostDirectoryAuthorityProbe,
  removeDirectory: (directoryPath: string) => Promise<void> = rmdir
): Promise<WindowsHostDirectoryAuthority> {
  if (process.platform !== 'win32') {
    throw new Error('Windows browser launch host authority is Windows-only');
  }
  return acquireWindowsBrowserLaunchHostAuthorityWithOptions({
    aclProbe,
    allocationSurfacePath,
    removeDirectory
  });
}

/** Test-only deterministic owner/DACL proof seam. */
export function proveWindowsHostDirectoryAuthorityForTests(
  directoryPath: string,
  aclProbe: WindowsHostDirectoryAclProbe
): Promise<WindowsHostDirectoryAuthority> {
  return proveWindowsHostDirectoryAuthority(directoryPath, aclProbe);
}
