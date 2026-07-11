import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  calculateCanonicalProjectFileHash,
  calculateProjectFileHash
} from '../../platform/shared/project-file-hash.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('canonical provenance hashes normalize UTF-8 line endings without weakening raw baseline hashes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lfPath = path.join(workspaceRoot, 'lf.txt');
    const crlfPath = path.join(workspaceRoot, 'crlf.txt');
    const binaryAPath = path.join(workspaceRoot, 'binary-a.bin');
    const binaryBPath = path.join(workspaceRoot, 'binary-b.bin');

    await fs.writeFile(lfPath, 'first\nsecond\n');
    await fs.writeFile(crlfPath, 'first\r\nsecond\r\n');
    await fs.writeFile(binaryAPath, Buffer.from([0, 13, 10, 255]));
    await fs.writeFile(binaryBPath, Buffer.from([0, 10, 10, 255]));

    expect(await calculateProjectFileHash(lfPath)).not.toBe(await calculateProjectFileHash(crlfPath));
    expect(await calculateCanonicalProjectFileHash(lfPath)).toBe(
      await calculateCanonicalProjectFileHash(crlfPath)
    );
    expect(await calculateProjectFileHash(binaryAPath)).not.toBe(await calculateProjectFileHash(binaryBPath));
    expect(await calculateCanonicalProjectFileHash(binaryAPath)).not.toBe(
      await calculateCanonicalProjectFileHash(binaryBPath)
    );
  });
});
