import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { withAcquiredResource } from '../../../execution/resource-settlement.ts';
import { runCommandBytes } from '../../runtime-state/physical/runtime/process.ts';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const STDERR_BYTES = 64 * 1024;

function fail(message: string): never {
  throw new Error(`ZIP text provider ${message}`);
}

function expectedFileName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(value)) fail('expected member name is invalid.');
  return value;
}

function strictText(value: Uint8Array, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { return fail(`${label} is not UTF-8.`); }
}

async function unzip(root: string, args: string[], maxStdoutBytes: number) {
  const result = await runCommandBytes('unzip', args, {
    cwd: root,
    maxStdoutBytes,
    maxStderrBytes: STDERR_BYTES,
    timeoutMs: COMMAND_TIMEOUT_MS
  });
  if (result.code !== 0) {
    fail(`unzip failed: ${result.stderr.trim() || `exit ${String(result.code)}`}`);
  }
  return result.stdout;
}

/**
 * Read one exact UTF-8 member from a GitHub-style ZIP artifact.  The provider
 * owns the archive process and temporary file; callers own neither raw process
 * execution nor extraction paths.
 */
export async function readZipTextFile(input: Readonly<{
  archiveBytes: Uint8Array;
  expectedFileName: string;
}>): Promise<string> {
  if (!(input.archiveBytes instanceof Uint8Array)
      || input.archiveBytes.byteLength === 0
      || input.archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail('archive bytes are empty or exceed the bounded input envelope.');
  }
  const member = expectedFileName(input.expectedFileName);
  return await withAcquiredResource({
    operationLabel: 'zip-text-read-operation',
    resourceLabel: 'zip-text-temporary-directory',
    acquire: () => mkdtempSync(path.join(tmpdir(), 'sec-zip-read-')),
    use: async (root) => {
      const archivePath = path.join(root, 'artifact.zip');
      writeFileSync(archivePath, input.archiveBytes, { flag: 'wx' });
      const inventorySource = strictText(
        await unzip(root, ['-Z1', archivePath], MAX_INVENTORY_BYTES),
        'archive inventory'
      );
      const names = inventorySource.split(/\r?\n/u).filter((entry) => entry.length > 0);
      if (names.length !== 1 || names[0] !== member
          || names[0]!.endsWith('/') || names[0]!.includes('\\') || names[0]!.startsWith('/')
          || names[0]!.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        fail('archive inventory is not the exact single expected member.');
      }
      const source = strictText(
        await unzip(root, ['-p', archivePath, member], MAX_TEXT_BYTES),
        'archive member'
      );
      if (source.length === 0 || Buffer.byteLength(source, 'utf8') > MAX_TEXT_BYTES) {
        fail('archive member is empty or oversized.');
      }
      return source;
    },
    release: (root) => rmSync(root, { recursive: true, force: true })
  });
}
