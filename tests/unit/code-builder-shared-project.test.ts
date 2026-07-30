import { expect, test } from 'bun:test';
import { Project } from 'ts-morph';
import { CodeBuilder, getDefaultProject } from '../../platform/compiler/codegen/code-builder.ts';

test('getDefaultProject returns the same Project instance across multiple calls', () => {
  const first = getDefaultProject();
  const second = getDefaultProject();
  expect(first).toBe(second);
  expect(first).toBeInstanceOf(Project);
});

test('multiple CodeBuilder instances share the same underlying Project', () => {
  const project = getDefaultProject();
  const builderA = new CodeBuilder('shared-project/a.ts');
  const builderB = new CodeBuilder('shared-project/b.ts');

  builderA.addVariable({ name: 'aValue', initializer: '1' });
  builderB.addVariable({ name: 'bValue', initializer: '2' });

  // Both source files should exist in the shared project
  expect(project.getSourceFile('shared-project/a.ts')).toBeDefined();
  expect(project.getSourceFile('shared-project/b.ts')).toBeDefined();

  // Each builder's output is independent despite sharing the project
  expect(builderA.getText()).toContain('aValue');
  expect(builderB.getText()).toContain('bValue');
  expect(builderA.getText()).not.toContain('bValue');
  expect(builderB.getText()).not.toContain('aValue');
});

test('CodeBuilder accepts an external project parameter for testing/override', () => {
  const externalProject = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  });
  const builder = new CodeBuilder('external-project/c.ts', '', externalProject);

  builder.addVariable({ name: 'cValue', initializer: '3' });

  expect(externalProject.getSourceFile('external-project/c.ts')).toBeDefined();
  expect(builder.getText()).toContain('cValue');
  // The external project must not be the default shared project
  expect(externalProject).not.toBe(getDefaultProject());
});

test('source files from different CodeBuilders coexist in the shared Project', () => {
  const project = getDefaultProject();
  const beforeCount = project.getSourceFiles().length;

  const builderOne = new CodeBuilder(`coexist-${beforeCount}/one.ts`);
  const builderTwo = new CodeBuilder(`coexist-${beforeCount}/two.ts`);

  builderOne.addFunction({ name: 'first', body: 'return 1;' });
  builderTwo.addFunction({ name: 'second', body: 'return 2;' });

  expect(project.getSourceFiles().length).toBe(beforeCount + 2);
  expect(project.getSourceFile(`coexist-${beforeCount}/one.ts`)).toBeDefined();
  expect(project.getSourceFile(`coexist-${beforeCount}/two.ts`)).toBeDefined();
});
