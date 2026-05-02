import fs from 'node:fs/promises';
import path from 'node:path';
import { globby } from 'globby';

async function main() {
  const testFiles = await globby('tests/**/*.ts');
  let replacedCount = 0;
  for (const file of testFiles) {
    let content = await fs.readFile(file, 'utf8');
    if (content.includes("'vitest'")) {
      content = content.replace(/from\s+['"]vitest['"]/g, "from 'bun:test'");
      await fs.writeFile(file, content, 'utf8');
      replacedCount++;
    }
  }
  console.log(`Replaced vitest with bun:test in ${replacedCount} files.`);

  const testRunnerPath = 'platform/dev-runner/test-runner.ts';
  let runnerContent = await fs.readFile(testRunnerPath, 'utf8');
  runnerContent = runnerContent.replace(/commandPath\(binPath, 'vitest'\)/g, "'bun'");
  runnerContent = runnerContent.replace(/\[\'run\'/g, "['test'");
  await fs.writeFile(testRunnerPath, runnerContent, 'utf8');
  console.log('Updated platform/dev-runner/test-runner.ts');
  
  const testRunnerContent = await fs.readFile(testRunnerPath, 'utf8');
  console.log('Test runner uses bun:', testRunnerContent.includes('bun'));
}

main().catch(console.error);
