import fs from 'node:fs/promises';

const filePath = 'platform/shared/test-impact-contract.ts';
let source = await fs.readFile(filePath, 'utf8');

if (source.includes("import { pipelineTestImpactRules } from './test-impact-rules/pipeline.ts';")) {
  console.log('Pipeline test impact rules already connected.');
  process.exit(0);
}

function replaceOnce(before: string, after: string, label: string): void {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Missing codemod target: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Codemod target is ambiguous: ${label}`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
"import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';",
"import { getTestFilesSync, isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';\nimport { pipelineTestImpactRules } from './test-impact-rules/pipeline.ts';",
'pipeline test impact import'
);

replaceOnce(
'export const testImpactRules: TestImpactRule[] = [',
'export const testImpactRules: TestImpactRule[] = [\n  ...pipelineTestImpactRules,',
'test impact rule array'
);

await fs.writeFile(filePath, source, 'utf8');
console.log('Pipeline test impact rules connected.');
