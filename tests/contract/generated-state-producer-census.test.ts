import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  GENERATED_STATE_RULES,
  KNOWN_GENERATED_STATE_PRODUCERS,
  classifyGeneratedStatePath
} from '../../platform/shared/generated-state-contract.ts';
import {
  GENERATED_STATE_WRITER_CENSUS,
  auditGeneratedStateWriterCensus,
  type GeneratedStateWriterSourceFile
} from '../../platform/shared/generated-state-writer-census.ts';

async function trackedSourceFiles(): Promise<GeneratedStateWriterSourceFile[]> {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const listed = spawnSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    windowsHide: true
  });
  if (listed.status !== 0 || !Buffer.isBuffer(listed.stdout)) {
    throw new Error('git ls-files failed while building the writer census input');
  }
  const files: GeneratedStateWriterSourceFile[] = [];
  for (const repositoryPath of listed.stdout.toString('utf8').split('\0')) {
    if (!repositoryPath) continue;
    const absolute = path.join(repositoryRoot, ...repositoryPath.split('/'));
    files.push({
      path: repositoryPath,
      text: await readFile(absolute, 'utf8')
    });
  }
  return files;
}

describe('generated-state producer census', () => {
  test('every known producer and census family resolves inside the registry', () => {
    const ruleIds = new Set(GENERATED_STATE_RULES.map((rule) => rule.id));
    for (const producer of KNOWN_GENERATED_STATE_PRODUCERS) {
      expect(classifyGeneratedStatePath(producer.relativePath).ruleId).toBe(producer.ruleId);
    }
    for (const entry of GENERATED_STATE_WRITER_CENSUS) {
      if (entry.family === 'root') continue;
      expect(ruleIds.has(entry.ruleId)).toBe(true);
    }
  });

  test('the tracked repository has no unregistered or stale generated-state writer', async () => {
    const files = await trackedSourceFiles();
    const findings = auditGeneratedStateWriterCensus(files);
    expect(findings).toEqual([]);
  });

  test('an explicit unregistered .tmp writer fails the closure', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([{
      path: 'fixtures/unregistered-writer.ts',
      text: `fs.writeFile('${TMP}/new-unregistered-output', 'x');`
    }]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generated-state-writer-unregistered',
        family: 'new-unregistered-output'
      })
    ]));
  });

  test('an explicit unregistered .tmp writer in workflow or shell form fails the closure', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([
      {
        path: '.github/workflows/new.yml',
        text: `path: ${TMP}/new-unregistered-output`
      },
      {
        path: 'scripts/new.sh',
        text: `echo hello > ${TMP}/new-unregistered-output`
      }
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generated-state-writer-unregistered',
        family: 'new-unregistered-output'
      })
    ]));
  });
});
