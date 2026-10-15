import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readWorkspaceSemanticQueryInput } from '../../src/adapters/workspace/semantic-query-input.ts';

const validInput = JSON.stringify({ engineeringIRInput: { entities: [], facts: [] } });

test('semantic query input is confined to one workspace-relative member', async () => {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'sec-semantic-query-input-'));
  const workspace = path.join(parent, 'workspace');
  const outside = path.join(parent, 'outside.json');
  try {
    await fs.mkdir(path.join(workspace, 'inputs'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'inputs', 'query.json'), validInput);
    await fs.writeFile(outside, validInput);

    expect(readWorkspaceSemanticQueryInput(workspace, 'inputs/query.json'))
      .toMatchObject({ engineeringIRInput: { entities: [], facts: [] } });
    expect(() => readWorkspaceSemanticQueryInput(workspace, '../outside.json'))
      .toThrow('workspace-relative path');
    expect(() => readWorkspaceSemanticQueryInput(workspace, outside))
      .toThrow('workspace-relative path');
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('semantic query JSON rejects unsupported top-level fields rather than ignoring them', async () => {
  const workspace = await fs.mkdtemp(path.join(tmpdir(), 'sec-semantic-query-input-'));
  try {
    for (const extra of [{ generatorDeclarations: [] }, { unsupported: true }]) {
      await fs.writeFile(path.join(workspace, 'query.json'), JSON.stringify({
        engineeringIRInput: { entities: [], facts: [] }, ...extra
      }));
      expect(() => readWorkspaceSemanticQueryInput(workspace, 'query.json'))
        .toThrow('only its own engineeringIRInput field');
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
