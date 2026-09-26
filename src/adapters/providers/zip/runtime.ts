import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { settleResources, withAcquiredResource } from '../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  resolveExecutableLocator,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandBoundary } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const STDERR_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = MAX_INVENTORY_BYTES + MAX_TEXT_BYTES + 2 * STDERR_BYTES;
const ZIP_PROCESS_OPERATION = 'external-capabilities.zip-text-read.process';
const ZIP_PROCESS_REQUIREMENT = 'zip-text-read.host-process';
const ZIP_PROCESS_CONTRACT = sha256(Object.freeze({
  operation: ZIP_PROCESS_OPERATION,
  durationMs: COMMAND_TIMEOUT_MS,
  outputBytes: MAX_OUTPUT_BYTES,
  processes: 2
})) as OperationDigest;

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

function explicitPath(): string {
  const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === 'path');
  const value = key === undefined ? undefined : process.env[key];
  if (typeof value !== 'string' || value.length === 0) fail('requires one explicit PATH.');
  return value;
}

function compileZipProcessOperation(input: Readonly<{
  archiveDigest: `sha256:${string}`;
  member: string;
  providerIdentityDigest: OperationDigest;
}>) {
  const aggregateBudgets = Object.freeze([
    { resource: 'duration-ms' as const, maximum: COMMAND_TIMEOUT_MS },
    { resource: 'input-bytes' as const, maximum: MAX_ARCHIVE_BYTES },
    { resource: 'output-bytes' as const, maximum: MAX_OUTPUT_BYTES },
    { resource: 'processes' as const, maximum: 2 }
  ]);
  const plan = compileSemanticOperationPlan({
    operation: ZIP_PROCESS_OPERATION,
    intentDigest: sha256(Object.freeze({
      archiveDigest: input.archiveDigest,
      member: input.member
    })) as OperationDigest,
    decisionDigest: ZIP_PROCESS_CONTRACT,
    deadlineAtUnixMs: Date.now() + COMMAND_TIMEOUT_MS,
    aggregateBudgets,
    requirements: [{
      id: ZIP_PROCESS_REQUIREMENT,
      contractDigest: ZIP_PROCESS_CONTRACT,
      effectKinds: ['process'],
      failureKinds: [
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: sha256(Object.freeze({
        domain: 'external-capabilities.zip-text-read.local-admission',
        archiveDigest: input.archiveDigest,
        member: input.member
      })) as OperationDigest
    })
  });
  return Object.freeze({
    aggregateBudgets,
    operation: bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: ZIP_PROCESS_REQUIREMENT,
      contractDigest: ZIP_PROCESS_CONTRACT,
      providerIdentityDigest: input.providerIdentityDigest
    })])
  });
}

async function unzip(
  session: ProcessResourceSession,
  boundary: RetainedCommandBoundary,
  args: string[],
  maxStdoutBytes: number
) {
  const executed = await session.run(boundary, args, {
    envMode: 'inherit',
    maxStdoutBytes,
    maxStderrBytes: STDERR_BYTES
  });
  const result = executed.result;
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
      const executablePath = resolveExecutableLocator('unzip', { cwd: root, pathValue: explicitPath() });
      if (executablePath === null) fail('unzip executable is unavailable.');
      const executableParent = inspectNoFollowDirectoryChain(
        path.dirname(executablePath), 'ZIP provider executable parent'
      );
      const rootChain = inspectNoFollowDirectoryChain(root, 'ZIP provider temporary root');
      const executable = retainNoFollowOrdinaryFile(
        executableParent,
        path.basename(executablePath),
        undefined,
        'ZIP provider executable',
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'executable'
      );
      const workingDirectory = retainNoFollowDirectoryForChildProcess(
        rootChain,
        RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
        'ZIP provider temporary root'
      );
      const providerIdentityDigest = sha256(Object.freeze({
        domain: 'external-capabilities.zip-text-read.process-provider',
        executable: {
          path: executable.path,
          physical: executable.physical,
          digest: executable.digest()
        },
        workingDirectory: rootChain.target
      })) as OperationDigest;
      const compiled = compileZipProcessOperation({
        archiveDigest: rawSha256(input.archiveBytes),
        member,
        providerIdentityDigest
      });
      const session = openProcessResourceSession({
        operation: compiled.operation,
        requirementBindingContext: issueOperationRequirementBindingContext({
          operation: compiled.operation,
          requirementId: ZIP_PROCESS_REQUIREMENT,
          resourceCeilings: compiled.aggregateBudgets
        })
      });
      const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
      let source: string | undefined;
      let primary: Readonly<{ error: unknown }> | undefined;
      try {
        const inventorySource = strictText(
          await unzip(session, boundary, ['-Z1', archivePath], MAX_INVENTORY_BYTES),
          'archive inventory'
        );
        const names = inventorySource.split(/\r?\n/u).filter((entry) => entry.length > 0);
        if (names.length !== 1 || names[0] !== member
            || names[0]!.endsWith('/') || names[0]!.includes('\\') || names[0]!.startsWith('/')
            || names[0]!.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
          fail('archive inventory is not the exact single expected member.');
        }
        source = strictText(
          await unzip(session, boundary, ['-p', archivePath, member], MAX_TEXT_BYTES),
          'archive member'
        );
        if (source.length === 0 || Buffer.byteLength(source, 'utf8') > MAX_TEXT_BYTES) {
          fail('archive member is empty or oversized.');
        }
      } catch (error) {
        primary = Object.freeze({ error });
      }
      settleResources({
        ...(primary === undefined ? {} : {
          primary: { label: 'ZIP text read process', error: primary.error }
        }),
        cleanup: [
          {
            label: 'ZIP text read process session',
            settle: () => assertProcessResourceSessionReceipt(session.close(), {
              operationIdentityDigest: compiled.operation.plan.identity.identityDigest,
              boundAttemptDigest: compiled.operation.boundAttemptDigest,
              requirementId: ZIP_PROCESS_REQUIREMENT
            })
          },
          { label: 'ZIP text read working directory', settle: () => workingDirectory.dispose() },
          { label: 'ZIP text read executable', settle: () => executable.dispose() }
        ]
      });
      if (source === undefined) fail('settled without one exact member result.');
      return source;
    },
    release: (root) => rmSync(root, { recursive: true, force: true })
  });
}
