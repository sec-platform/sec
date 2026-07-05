import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import { addBlock, composeWorkspace, initWorkspace, resolveWorkspace } from '../../platform/orchestrator.ts';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-provenance-probe-'));
await initWorkspace(root, { reset: true });
await addBlock(root, 'ticket/basic');
await resolveWorkspace(root);
const { lock } = await composeWorkspace(root);
const provenance = await buildProvenance(root, lock);
const artifact = provenance.artifacts.find((entry) => entry.path === 'src/installed/ticket/ticket-semantic-contract.ts');
if (!artifact) throw new Error('semantic artifact missing');
console.log(JSON.stringify(artifact));
