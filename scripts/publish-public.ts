import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Public repo destination
const PUBLIC_REPO_URL = 'https://github.com/QzCrane/compliter.git';

// Allowed top-level entries for the public release (Strict Whitelist)
const ALLOWED_ROOT_ENTRIES = [
  'platform',
  'tests',
  'scripts',
  'package.json',
  'tsconfig.json',
  'bun.lock',
  '.gitignore',
  'README.md'
];

function copyRecursive(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function publish() {
  const currentDir = process.cwd();
  console.log(`Current directory: ${currentDir}`);

  // Create a secure temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-public-release-'));
  console.log(`Created temporary release workspace: ${tempDir}`);

  try {
    // 1. Copy only whitelisted files/folders from source to tempDir
    console.log('Copying whitelisted files (excluding private workspace and docs)...');
    for (const entry of ALLOWED_ROOT_ENTRIES) {
      const srcPath = path.join(currentDir, entry);
      const tgtPath = path.join(tempDir, entry);
      if (fs.existsSync(srcPath)) {
        copyRecursive(srcPath, tgtPath);
      }
    }

    // 1.5 Sanitize package.json for the public release (exclude private scripts and dependencies)
    const pkgPath = path.join(tempDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      console.log('Sanitizing package.json for public release...');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      
      // A. Keep only minimal public scripts
      pkg.scripts = {
        "sec": "bun ./platform/cli/index.ts",
        "dev": "bun ./platform/dev-runner.ts",
        "build": "bun ./scripts/build-release.ts",
        "test": "bun ./platform/dev-runner.ts test:fast",
        "check": "bun ./platform/dev-runner.ts check:fast",
        "typecheck": "bun ./platform/dev-runner.ts typecheck"
      };

      // B. Refine dependencies: retain core CLI libs, move compiler libs (ts-morph, typescript) here, remove Next/React
      const privateDeps = ['next', 'react', 'react-dom'];
      const refinedDependencies: Record<string, string> = {};
      for (const [depName, version] of Object.entries(pkg.dependencies || {})) {
        if (!privateDeps.includes(depName)) {
          refinedDependencies[depName] = version as string;
        }
      }
      
      // Move ts-morph and typescript from devDependencies to dependencies (required by standalone compiler at runtime)
      if (pkg.devDependencies?.['ts-morph']) {
        refinedDependencies['ts-morph'] = pkg.devDependencies['ts-morph'];
      }
      if (pkg.devDependencies?.['typescript']) {
        refinedDependencies['typescript'] = pkg.devDependencies['typescript'];
      }
      pkg.dependencies = refinedDependencies;

      // C. Refine devDependencies: strip private tooling and moved libs
      const refinedDevDependencies: Record<string, string> = {};
      for (const [depName, version] of Object.entries(pkg.devDependencies || {})) {
        if (depName !== 'gitnexus' && depName !== 'ts-morph' && depName !== 'typescript') {
          refinedDevDependencies[depName] = version as string;
        }
      }
      pkg.devDependencies = refinedDevDependencies;

      // D. Clean trustedDependencies: strip gitnexus
      if (Array.isArray(pkg.trustedDependencies)) {
        pkg.trustedDependencies = pkg.trustedDependencies.filter((dep: string) => dep !== 'gitnexus');
      }

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
      console.log('Successfully sanitized package.json scripts and dependencies.');
    }

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
    execSync('git commit -m "feat: release Spec Engineering Compiler codebase (sanitized)"', { cwd: tempDir, stdio: 'inherit' });

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
