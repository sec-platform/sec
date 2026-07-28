import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerRuntimeLayout,
  RELEASE_ENTRYPOINT_RELATIVE_PATH,
  resolveCompilerRuntimeLayout
} from '../platform/shared/runtime-layout.ts';

function requireRepositorySourceRoot(): string {
  const sourceRoot = compilerRuntimeLayout.repositorySourceRoot;
  if (!sourceRoot) {
    throw new Error('Release build requires the SEC repository source layout');
  }
  return sourceRoot;
}
const repositorySourceRoot = requireRepositorySourceRoot();
const releaseRuntimeLayout = resolveCompilerRuntimeLayout(pathToFileURL(path.join(
  compilerRuntimeLayout.packageRoot,
  RELEASE_ENTRYPOINT_RELATIVE_PATH
)).href);
const DIST_DIR = releaseRuntimeLayout.runtimeAssetRoot;

async function build() {
  console.log('Starting release build...');

  // 1. Clean existing dist folder
  if (fs.existsSync(DIST_DIR)) {
    console.log(`Cleaning existing build folder: ${DIST_DIR}`);
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 2. Run Bun build to bundle code and resolve .ts imports into a single entrypoint
  console.log('Bundling platform CLI using Bun...');
  
  // Mark all dependencies from package.json as external
  const externalDependencies = Object.keys(pkg.dependencies || {});
  
  const result = await Bun.build({
    entrypoints: [path.join(repositorySourceRoot, 'platform', 'cli', 'index.ts')],
    outdir: DIST_DIR,
    target: 'node',
    external: [...externalDependencies, 'bun', 'typescript', 'node:path', 'node:fs', 'node:child_process', 'node:url', 'node:os'],
    minify: false,
  });

  if (!result.success) {
    console.error('Bundle build failed:');
    for (const message of result.logs) {
      console.error(message);
    }
    process.exit(1);
  }

  // Rename compiled file from dist/index.js to dist/se.js or keep it.
  // The entrypoint is dist/index.js (matching package.json bin configuration)
  console.log('CLI compiled successfully to ./dist/index.js.');

  // 3. Copy every canonical runtime resource into the bundle asset root.
  console.log('Copying canonical runtime assets to dist...');
  for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
    const destination = path.join(releaseRuntimeLayout.runtimeAssetRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(repositorySourceRoot, relativePath), destination, { recursive: true });
  }

  // 4. Set executable permission for the entrypoint (chmod +x)
  const cliEntrypoint = releaseRuntimeLayout.executableModulePath;
  if (fs.existsSync(cliEntrypoint)) {
    // Add Node shebang at the top of the bundle if not present,
    // though the entrypoint platform/cli/index.ts has it, Bun's bundler keeps it if it's there.
    // Let's prepend it just to be safe.
    let content = fs.readFileSync(cliEntrypoint, 'utf8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      content = '#!/usr/bin/env node\n' + content;
      fs.writeFileSync(cliEntrypoint, content, 'utf8');
    }
    
    fs.chmodSync(cliEntrypoint, 0o755);
    console.log('Executable permissions set for CLI entrypoint.');
  }

  console.log('Release build completed successfully!');
}

build().catch((err) => {
  console.error('Build process failed:', err);
  process.exit(1);
});
