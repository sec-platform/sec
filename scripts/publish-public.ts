import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Public repo destination
const PUBLIC_REPO_URL = 'https://github.com/QzCrane/compliter.git';

// Excluded folders/files from the public release
const EXCLUDED_PATHS = [
  '.git',
  'docs',
  'node_modules',
  'project',
  '.shared-deps',
  '.pjc',
  '.claude',
  '.trae',
  '.gitnexus',
  '.chatgpt-handoff',
  '_handoff',
  'report',
  'playwright-report',
  'test-results',
  '.vscode',
  '.idea'
];

function copyFolderRecursive(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  for (const file of files) {
    const srcPath = path.join(source, file);
    const tgtPath = path.join(target, file);

    // Skip excluded paths
    if (EXCLUDED_PATHS.includes(file)) {
      continue;
    }

    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyFolderRecursive(srcPath, tgtPath);
    } else {
      fs.copyFileSync(srcPath, tgtPath);
    }
  }
}

async function publish() {
  const currentDir = process.cwd();
  console.log(`Current directory: ${currentDir}`);

  // Create a secure temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-public-release-'));
  console.log(`Created temporary release workspace: ${tempDir}`);

  try {
    // 1. Copy sanitized files
    console.log('Copying and sanitizing files (excluding docs/ and private rules)...');
    copyFolderRecursive(currentDir, tempDir);

    // 2. Initialize temporary git repository
    console.log('Initializing git repository...');
    execSync('git init', { cwd: tempDir, stdio: 'inherit' });
    execSync('git checkout -b main', { cwd: tempDir, stdio: 'inherit' });

    // 3. Add remote
    console.log(`Adding remote public URL: ${PUBLIC_REPO_URL}`);
    execSync(`git remote add origin ${PUBLIC_REPO_URL}`, { cwd: tempDir, stdio: 'inherit' });

    // 4. Commit files
    console.log('Staging files...');
    execSync('git add .', { cwd: tempDir, stdio: 'inherit' });
    
    console.log('Committing release snapshot...');
    execSync('git commit -m "feat: release SpecEngineer compiler codebase (sanitized)"', { cwd: tempDir, stdio: 'inherit' });

    // 5. Push to public repo
    console.log('Pushing to public remote repository...');
    execSync('git push -f origin main', { cwd: tempDir, stdio: 'inherit' });

    console.log('Successfully published clean version to public repository!');
  } catch (error) {
    console.error('Failed to publish to public repository:', error);
  } finally {
    // 6. Clean up temporary workspace
    console.log('Cleaning up temporary directory...');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

publish().catch(console.error);
