import path from 'node:path';

import { borrowByteView, snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { isPlainObject } from '../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';

interface NativeCargoBinaryExpectation {
  readonly manifestPath: string;
  readonly targetName: string;
  readonly targetDirectory: string;
}

function reject(kind: string, message: string, cause?: unknown): never {
  throw new CodedFailure('DEVELOPMENT-NATIVE-CARGO-ARTIFACT-001', message, { kind },
    cause === undefined ? undefined : { cause });
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f]/u.test(value);
}

function absolutePath(value: unknown): string {
  if (!nonemptyString(value) || !path.isAbsolute(value) || path.normalize(value) !== value) {
    reject('invalid-path', 'Cargo artifact paths must be canonical absolute native paths.');
  }
  return value;
}

function targetIdentity(value: unknown): Readonly<{ name: string; kind: readonly string[] }> {
  if (!isPlainObject(value) || !nonemptyString(value.name)
      || !Array.isArray(value.kind) || value.kind.length === 0
      || !value.kind.every(nonemptyString) || new Set(value.kind).size !== value.kind.length) {
    reject('malformed-message', 'Cargo target identity is malformed.');
  }
  return { name: value.name, kind: value.kind };
}

function artifactExecutable(message: Record<string, unknown>, expected: NativeCargoBinaryExpectation): string | null {
  const manifestPath = absolutePath(message.manifest_path);
  const target = targetIdentity(message.target);
  if (!nonemptyString(message.package_id) || !isPlainObject(message.profile)
      || typeof message.profile.test !== 'boolean' || typeof message.fresh !== 'boolean'
      || !Array.isArray(message.filenames) || !message.filenames.every(nonemptyString)
      || (message.executable !== null && !nonemptyString(message.executable))) {
    reject('malformed-message', 'Cargo compiler artifact is malformed.');
  }
  const filenames = message.filenames.map(absolutePath);
  const executable = message.executable === null ? null : absolutePath(message.executable);
  if (manifestPath !== expected.manifestPath || target.name !== expected.targetName
      || target.kind.length !== 1 || target.kind[0] !== 'bin' || message.profile.test) return null;
  if (executable === null || !filenames.includes(executable)) {
    reject('missing-executable', 'Cargo binary artifact has no matching executable output.');
  }
  const relative = path.relative(expected.targetDirectory, executable);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    reject('outside-target-directory', 'Cargo binary artifact is outside its owned target directory.');
  }
  return executable;
}

/** Decode only this invocation's bounded Cargo build output. The caller owns
 * the process result, input identity and physical ordinary-file verification.
 * Cargo permits other tools to print arbitrary stdout. This consumer rejects
 * every nonblank non-JSON line and any message after build-finished. */
export function parseNativeCargoBinaryArtifact(
  stdout: Uint8Array,
  expected: NativeCargoBinaryExpectation
): string {
  return parseNativeCargoOutput(stdout, expected, false).executable;
}

/** Cargo's successful build-finished line ends its build protocol. Subsequent
 * test-program bytes are opaque and owned by the returned result. The caller
 * still verifies the whole Cargo test process exit and tree settlement. */
export function parseNativeCargoTestBinaryArtifact(
  stdout: Uint8Array,
  expected: NativeCargoBinaryExpectation
): Readonly<{ executable: string; testOutput: Uint8Array }> {
  return parseNativeCargoOutput(stdout, expected, true);
}

function parseNativeCargoOutput(
  stdout: Uint8Array,
  expected: NativeCargoBinaryExpectation,
  allowTestOutput: boolean
): Readonly<{ executable: string; testOutput: Uint8Array }> {
  const expectation = {
    manifestPath: absolutePath(expected.manifestPath),
    targetDirectory: absolutePath(expected.targetDirectory),
    targetName: expected.targetName
  };
  if (!nonemptyString(expectation.targetName)) reject('invalid-target-name', 'Cargo binary target name is empty or invalid.');
  let source: Uint8Array;
  try {
    source = borrowByteView(stdout, 'Cargo build stdout');
  } catch (cause) {
    reject('invalid-utf8', 'Cargo build stdout is not exact UTF-8 byte data.', cause);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let finished = false;
  let selected: string | null = null;
  let offset = 0;
  while (offset < source.byteLength) {
    const newline = source.indexOf(0x0a, offset);
    const end = newline === -1 ? source.byteLength : newline;
    let line: string;
    try {
      line = decoder.decode(source.subarray(offset, end));
    } catch (cause) {
      reject('invalid-utf8', 'Cargo build stdout is not exact UTF-8 byte data.', cause);
    }
    offset = newline === -1 ? end : end + 1;
    if (/^[\t\r ]*$/u.test(line)) continue;
    if (finished) reject('message-after-completion', 'Cargo build output continues after build-finished.');
    let message: unknown;
    try {
      message = parseExactJson(line, 'Cargo build message', undefined, 64);
    } catch (cause) {
      reject('malformed-message', 'Cargo build stdout contains a malformed JSON message.', cause);
    }
    if (!isPlainObject(message)) reject('malformed-message', 'Cargo build message must be one JSON object.');
    switch (message.reason) {
      case 'compiler-artifact': {
        const executable = artifactExecutable(message, expectation);
        if (executable !== null) {
          if (selected !== null) reject('ambiguous-artifact', 'Cargo build emitted multiple matching binary artifacts.');
          selected = executable;
        }
        break;
      }
      case 'build-finished':
        if (message.success !== true) reject('failed-build', 'Cargo build did not finish successfully.');
        finished = true;
        break;
      case 'compiler-message':
        absolutePath(message.manifest_path);
        targetIdentity(message.target);
        if (!nonemptyString(message.package_id) || !isPlainObject(message.message)) {
          reject('malformed-message', 'Cargo compiler diagnostic is malformed.');
        }
        break;
      case 'build-script-executed':
        if (!nonemptyString(message.package_id)) reject('malformed-message', 'Cargo build script message is malformed.');
        break;
      default:
        reject('unsupported-message', 'Cargo build stdout contains an unsupported message reason.');
    }
    if (finished && allowTestOutput) break;
  }
  if (!finished) reject('missing-completion', 'Cargo build output has no successful build-finished message.');
  if (selected === null) reject('missing-artifact', 'Cargo build output has no matching binary artifact.');
  return { executable: selected, testOutput: snapshotByteView(source.subarray(offset), 'Cargo test output') };
}
