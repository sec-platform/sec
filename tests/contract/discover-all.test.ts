import { expect, test } from 'bun:test';
import { Project, SyntaxKind } from 'ts-morph';

import { extractCallRelations } from '../../scripts/discover-all.ts';

test('discover-all emits one typed relation for every CallExpression form', () => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true
  });
  const sourceFile = project.createSourceFile('fixture.ts', `
declare const handler: (() => void) | undefined;
declare const service: { run(): void };
declare class Base {}

service.run();
import('./module.ts');
(() => undefined)();
handler!();

class Child extends Base {
  constructor() {
    super();
  }
}
`);

  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  const relations = extractCallRelations(sourceFile, 'fixture.ts');

  expect(callExpressions).toHaveLength(5);
  expect(relations).toHaveLength(callExpressions.length);
  expect(relations.map(({ calleeExpression }) => calleeExpression)).toEqual(expect.arrayContaining([
    'service.run',
    'import',
    '(() => undefined)',
    'handler!',
    'super'
  ]));
  expect(relations.every(({ calleeKind, callerFile, callerLine }) =>
    calleeKind.length > 0 && callerFile === 'fixture.ts' && callerLine > 0)).toBe(true);
});
