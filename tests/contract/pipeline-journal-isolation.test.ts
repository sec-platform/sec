import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { PhysicalNoFollowError } from '../../platform/shared/physical-no-follow.ts';
import { readPipelineJournal } from '../../platform/shared/pipeline-journal.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function journalPath(workspaceRoot: string): string {
  return path.join(getWorkspacePaths(workspaceRoot).localStateRoot, 'pipeline-journal.json');
}

async function writeJournal(workspaceRoot: string, value: unknown): Promise<void> {
  const target = journalPath(workspaceRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value)}\n`, 'utf8');
}

test('existing stale or inconsistent Pipeline journal is not projected as an empty journal', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    for (const value of [
      { formatVersion: 'stale-version', transactions: [] },
      {
        formatVersion: '1',
        activeTransactionId: 'tx:missing',
        transactions: []
      },
      {
        formatVersion: '1',
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
        formatVersion: '1',
        transactions: [{
          id: 'tx:duplicate',
          source: 'cli',
          requestedStages: ['resolve'],
          status: 'failed',
          startedAt: '2026-08-18T00:00:00.000Z',
          passRecords: []
        }, {
          id: 'tx:duplicate',
          source: 'cli',
          requestedStages: ['resolve'],
          status: 'failed',
          startedAt: '2026-08-18T00:00:01.000Z',
          passRecords: []
        }]
      }
    ]) {
      await writeJournal(workspaceRoot, value);
      expect(() => readPipelineJournal(workspaceRoot)).toThrow();
    }
  });
});

test('Pipeline journal reader rejects a linked local-state ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const target = journalPath(workspaceRoot);
    const localStateRoot = getWorkspacePaths(workspaceRoot).localStateRoot;
    const externalState = path.join(workspaceRoot, 'external-state');
    await fs.rm(localStateRoot, { recursive: true, force: true });
    await fs.mkdir(path.dirname(localStateRoot), { recursive: true });
    await fs.mkdir(externalState, { recursive: true });
    await fs.writeFile(
      path.join(externalState, path.basename(target)),
      `${JSON.stringify({ formatVersion: '1', transactions: [] })}\n`,
      'utf8'
    );
    await fs.symlink(
      externalState,
      localStateRoot,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() => readPipelineJournal(workspaceRoot))
      .toThrow('retained JSON');
  });
});
