import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { withTempWorkspace } from '../../testkit/workspace.ts';

import { readWorkspaceSemanticQueryInput } from '../../../src/adapters/workspace/semantic-query-input.ts';

const validInput = JSON.stringify({ engineeringIRInput: { entities: [], facts: [] } });

test('semantic query input is confined to one workspace-relative member', async () => {
  await withTempWorkspace(async parent => {
    const workspace = path.join(parent, 'workspace');
    const outside = path.join(parent, 'outside.json');
    await fs.mkdir(path.join(workspace, 'inputs'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'inputs', 'query.json'), validInput);
    await fs.writeFile(outside, validInput);

    expect(readWorkspaceSemanticQueryInput(workspace, 'inputs/query.json'))
      .toMatchObject({ engineeringIRInput: { entities: [], facts: [] } });
    expect(() => readWorkspaceSemanticQueryInput(workspace, '../outside.json'))
      .toThrow('workspace-relative path');
    expect(() => readWorkspaceSemanticQueryInput(workspace, outside))
      .toThrow('workspace-relative path');
  }, 'sec-semantic-query-input-');
});

test('semantic query JSON rejects unsupported top-level fields rather than ignoring them', async () => {
  await withTempWorkspace(async workspace => {
    await fs.writeFile(path.join(workspace, 'query.json'), JSON.stringify({
      engineeringIRInput: { entities: [], facts: [] }, generatorDeclarations: []
    }));
    expect(() => readWorkspaceSemanticQueryInput(workspace, 'query.json'))
      .toThrow('only its own engineeringIRInput field');
  }, 'sec-semantic-query-input-');
});
