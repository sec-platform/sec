import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test.each(['ts', 'tsx', 'mts', 'cts', 'TS', 'TSX', 'MTS', 'CTS'])(
  'ordinary fixtures reject dynamic TypeScript paths before filesystem lookup: %s', async (extension) => {
    const dynamicPath: string = `src/never-read-fixture.${extension}`;
    await expect(readCompilerFile(dynamicPath)).rejects.toThrow('Production TypeScript is not a text fixture');
  }
);

test('ordinary JSON fixtures remain available without granting source-analysis access', async () => {
  const source = await readCompilerFile('package.json');
  expect(JSON.parse(source)).toHaveProperty('scripts');
});
