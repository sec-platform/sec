import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readPipelineJournal } from '../../../src/adapters/compilation/pipeline/journal.ts';
import { PhysicalNoFollowError } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";
import { withTempWorkspace } from '../../testkit/workspace.ts';

function journalPath(workspaceRoot: string): string {
  return path.join(getWorkspacePaths(workspaceRoot).secRoot, 'pipeline-journal.json');
}

async function writeJournal(workspaceRoot: string, value: unknown): Promise<void> {
  const target = journalPath(workspaceRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value)}\n`, 'utf8');
}

test('existing stale or inconsistent Pipeline journal is not projected as an empty journal', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const cases = [
      { formatVersion: 'stale-version', transactions: [] },
      { formatVersion: '1', transactions: [] },
      {
        formatVersion: '2',
        activeTransactionId: 'tx:missing',
        transactions: []
      },
      {
        formatVersion: '2',
        activeTransactionId: 'tx:running',
        lastCommittedTransactionId: 'tx:running',
        transactions: [{
          id: 'tx:running',
          source: 'cli',
          requestedStages: ['resolve'],
          status: 'running',
          startedAt: '2026-08-18T00:00:00.000Z',
          passRecords: []
        }]
      },
      {
        formatVersion: '2',
        transactions: [{
          id: 'tx:duplicate',
          source: 'cli',
          requestedStages: ['resolve'],
          status: 'failed',
          completedAt: '2026-08-18T00:00:02.000Z',
          startedAt: '2026-08-18T00:00:00.000Z',
          passRecords: []
        }, {
          id: 'tx:duplicate',
          source: 'cli',
          requestedStages: ['resolve'],
          status: 'failed',
          completedAt: '2026-08-18T00:00:02.000Z',
          startedAt: '2026-08-18T00:00:01.000Z',
          passRecords: []
        }]
      }
    ];
    const failures = [
      /stale or malformed/,
      /requires owner-issued Adapt retirement migration/,
      /active transaction is inconsistent/,
      /last committed transaction is inconsistent/,
      /repeats transaction id/
    ];
    for (const [index, value] of cases.entries()) {
      await writeJournal(workspaceRoot, value);
      expect(() => readPipelineJournal(workspaceRoot)).toThrow(failures[index]!);
    }
  });
});

test('Pipeline journal reader rejects a linked local-state ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const target = journalPath(workspaceRoot);
    const localStateRoot = getWorkspacePaths(workspaceRoot).secRoot;
    const externalState = path.join(workspaceRoot, 'external-state');
    await fs.rm(localStateRoot, { recursive: true, force: true });
    await fs.mkdir(path.dirname(localStateRoot), { recursive: true });
    await fs.mkdir(externalState, { recursive: true });
    await fs.writeFile(
      path.join(externalState, path.basename(target)),
      `${JSON.stringify({ formatVersion: '2', transactions: [] })}\n`,
      'utf8'
    );
    await fs.symlink(
      externalState,
      localStateRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    let failure: unknown;
    try {
      readPipelineJournal(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PhysicalNoFollowError);
    expect((failure as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
  });
});
