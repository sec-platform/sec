import { sha256 } from '../../../contracts/canonical.ts';
import { generatedStateDigest } from '../../../execution/generated-state/contract.ts';
import { WORKSPACE_GIT_STATUS_DURATION_MS, WORKSPACE_GIT_STATUS_RECORD_MAXIMUM, WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES, WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES, type WorkspaceGitStatusBackend } from '../../../execution/generated-state/environment-port.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';

function parseGitStatusRecords(bytes: Uint8Array): readonly string[] {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0) return Object.freeze([]);
  if (buffer[buffer.byteLength - 1] !== 0) {
    throw new Error('Git status returned a non-terminated record inventory.');
  }
  const payload = buffer.subarray(0, -1);
  const text = payload.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(payload)) {
    throw new Error('Git status returned non-UTF-8 path bytes.');
  }
  return Object.freeze(text.split('\0').sort());
}
export const workspaceGitStatusBackend: WorkspaceGitStatusBackend = Object.freeze<WorkspaceGitStatusBackend>({ observe: async input => {
  const operation = input.operation;
  try {
    return await withAuthorityGitReadSession({
      cwd: input.workspaceRoot,
      environment: { LANG: 'C', LC_ALL: 'C' },
      operation,
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      budget: {
        deadlineMs: WORKSPACE_GIT_STATUS_DURATION_MS,
        maxProcesses: 1,
        maxStdoutBytes: WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES,
        maxStderrBytes: WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES,
        maxRecords: WORKSPACE_GIT_STATUS_RECORD_MAXIMUM,
        maxCommandStdoutBytes: WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES,
        maxCommandStderrBytes: WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES
      },
      ...(input.signal === undefined ? {} : { signal: input.signal })
    }, async (session) => {
      const command = await session.run([
        'status', '--porcelain=v1', '-z', '--untracked-files=all'
      ]);
      if (command.kind !== 'completed') {
        throw new GitReadAuthorityError('Workspace Git status did not complete.', command);
      }
      if (command.result.code !== 0) {
        return Object.freeze({
          status: 'unresolved' as const,
          reason: 'command-failed' as const,
          detailDigest: sha256({
            code: command.result.code,
            stderr: command.result.stderr
          })
        });
      }
      let records: readonly string[];
      try {
        records = parseGitStatusRecords(command.result.stdout);
      } catch (error) {
        return Object.freeze({
          status: 'unresolved' as const,
          reason: 'malformed-output' as const,
          detailDigest: sha256(error instanceof Error ? error.message : String(error))
        });
      }
      const recordFailure = session.consumeRecords(records.length);
      if (recordFailure !== null) {
        throw new GitReadAuthorityError('Workspace Git status exceeded its record budget.', recordFailure);
      }
      return Object.freeze({
        status: 'resolved' as const,
        records,
        recordsDigest: generatedStateDigest(records)
      });
    });
  } catch (error) {
    if (!(error instanceof GitReadAuthorityError)) throw error;
    return Object.freeze({
      status: 'unresolved',
      reason: error.failure.reason,
      detailDigest: sha256({
        kind: error.failure.kind,
        reason: error.failure.reason,
        ...('detailDigest' in error.failure ? { providerDetailDigest: error.failure.detailDigest } : {})
      })
    });
  }

} });
