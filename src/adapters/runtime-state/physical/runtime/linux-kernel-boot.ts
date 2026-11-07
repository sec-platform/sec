import { closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import path from 'node:path';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import { linuxOpenLeafAt, linuxOpenReadableLeafAt, linuxOpenRetainedAbsoluteDirectory, linuxReadRetainedLinkTarget, linuxRetainedFilesystemObservation } from './physical-no-follow-native.ts';

export class LinuxKernelBootError extends Error {
  constructor(readonly reason: 'unsupported-platform' | 'unavailable' | 'invalid-result', detail: string) {
    super(`Linux kernel boot boundary is unavailable: ${detail}`);
    this.name = 'LinuxKernelBootError';
  }
}

export interface LinuxKernelBootBoundary {
  readonly platform: 'linux';
  readonly bootId: string;
  readonly initStartTime: string;
  readonly pidNamespace: string;
}

/** Reuses the native unit owner's bounded boot_id/PID1 observations, not its
 * same-manager stop/recovery rules. A procfs descriptor excludes an ordinary
 * caller-owned file, FUSE/remote projection or non-procfs bind-mounted value. */
function readKernelProcFile(filePath: string, maximum: number, readOnly: boolean, namespaceLink = false): string {
  const directory = linuxOpenRetainedAbsoluteDirectory(path.dirname(filePath), 'Linux kernel observation parent');
  let fd: number | undefined;
  let result: string | undefined;
  let primary: { label: string; error: unknown } | undefined;
  try {
    fd = (namespaceLink ? linuxOpenLeafAt : linuxOpenReadableLeafAt)(directory.directoryFd,
      path.basename(filePath), 'Linux kernel observation leaf');
    const before = fstatSync(fd, { bigint: true });
    if (linuxRetainedFilesystemObservation(fd).type !== 0x9fa0n ||
        (namespaceLink ? !before.isSymbolicLink() : !before.isFile() || before.uid !== 0n ||
          (before.mode & 0o022n) !== 0n || (readOnly && (before.mode & 0o222n) !== 0n))) {
      throw new LinuxKernelBootError('unavailable', 'the selected observation is not a native root-owned procfs file');
    }
    if (namespaceLink) {
      result = linuxReadRetainedLinkTarget(fd, 'Linux kernel namespace link');
      if (Buffer.byteLength(result, 'utf8') > maximum) throw new LinuxKernelBootError('invalid-result', 'native namespace link exceeds its bound');
    } else {
      const bytes = Buffer.alloc(maximum + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null);
        if (count === 0) break;
        length += count;
      }
      if (length > maximum) throw new LinuxKernelBootError('invalid-result', 'native procfs observation exceeds its bound');
      result = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    }
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(filePath, { bigint: true });
    if ((namespaceLink ? !named.isSymbolicLink() : !named.isFile() || named.isSymbolicLink()) || before.dev !== after.dev || before.ino !== after.ino ||
        before.mode !== after.mode || before.uid !== after.uid || named.dev !== before.dev || named.ino !== before.ino ||
        named.mode !== before.mode || named.uid !== before.uid) {
      throw new LinuxKernelBootError('unavailable', 'native procfs identity changed during observation');
    }
  } catch (error) { primary = { label: 'Linux kernel boot observation', error }; }
  settleResources({ ...(primary === undefined ? {} : { primary }),
    cleanup: [
      { label: 'Linux kernel boot procfs descriptor', settle: () => { if (fd !== undefined) closeSync(fd); } },
      { label: 'Linux kernel boot procfs parent', settle: () => closeSync(directory.directoryFd) },
      { label: 'Linux kernel boot filesystem root', settle: () => closeSync(directory.filesystemRootFd) }
    ] });
  return result!;
}

function selectedPidNamespace(): string {
  const current = readKernelProcFile(`/proc/${process.pid}/ns/pid`, 64, false, true);
  const init = readKernelProcFile('/proc/1/ns/pid', 64, false, true);
  if (!/^pid:\[[1-9][0-9]{0,19}\]$/u.test(current) || current !== init) {
    throw new LinuxKernelBootError('unavailable', 'the reader and selected PID1 are not in one native PID namespace');
  }
  return current;
}

function systemManagerStartTime(): string {
  if (readKernelProcFile('/proc/1/comm', 64, false) !== 'systemd\n') {
    throw new LinuxKernelBootError('unavailable', 'the selected native systemd system manager is required');
  }
  const text = readKernelProcFile('/proc/1/stat', 65536, true);
  const separator = text.lastIndexOf(') ');
  const start = text.slice(separator + 2).trim().split(/\s+/u)[19];
  if (!text.startsWith('1 (') || separator < 3 || start === undefined || !/^(?:0|[1-9][0-9]{0,19})$/u.test(start)) {
    throw new LinuxKernelBootError('invalid-result', 'PID1 start-time observation is malformed');
  }
  return start;
}

/** Kernel boot_id is generated once and remains invariant for that kernel:
 * https://www.kernel.org/doc/html/latest/admin-guide/sysctl/kernel.html#random
 * A different UUID can qualify only with the externally retained original
 * checkpoint and trusted same-host/no-VM-or-namespace-migration/no-rollback
 * maintenance premises. It is not a machine identity or an ordered counter.
 * PID1 restart alone and hibernation of the same kernel never qualify. */
export function observeLinuxKernelBootBoundary(): LinuxKernelBootBoundary {
  if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64')) {
    throw new LinuxKernelBootError('unsupported-platform', `${process.platform}/${process.arch}`);
  }
  const pidNamespace = selectedPidNamespace();
  const bootText = readKernelProcFile('/proc/sys/kernel/random/boot_id', 128, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/u.test(bootText)) {
    throw new LinuxKernelBootError('invalid-result', 'kernel boot UUID is malformed');
  }
  const initStartTime = systemManagerStartTime();
  if (bootText !== readKernelProcFile('/proc/sys/kernel/random/boot_id', 128, true) ||
      initStartTime !== systemManagerStartTime() || pidNamespace !== selectedPidNamespace()) {
    throw new LinuxKernelBootError('unavailable', 'kernel or system-manager view changed during observation');
  }
  return Object.freeze({ platform: 'linux', bootId: bootText.slice(0, -1), initStartTime, pidNamespace });
}
