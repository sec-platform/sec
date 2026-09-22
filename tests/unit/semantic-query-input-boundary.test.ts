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
