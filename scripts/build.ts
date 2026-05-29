import fs from 'node:fs';
import path from 'node:path';

async function build() {
  console.log('Building SpecEngineer release package...');

  // Clean dist directory
  const distDir = path.resolve('dist');
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Read package.json to get list of dependencies to keep external
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const externals = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    'typescript',
    'ts-morph'
  ];

  // Use Bun.build to bundle local TS sources into a single JS file
  const result = await Bun.build({
    entrypoints: ['./platform/cli/index.ts'],
    outdir: './dist',
    target: 'bun',
    minify: false,
    external: externals,
  });

  if (!result.success) {
    console.error('Build failed:', result.logs);
    process.exit(1);
  }

  // Find the generated file (Bun.build might output to dist/index.js)
  const outputPath = path.join(distDir, 'index.js');
  const targetPath = path.join(distDir, 'se.js');

  if (fs.existsSync(outputPath)) {
    fs.renameSync(outputPath, targetPath);
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`Build output file not found at: ${targetPath}`);
    process.exit(1);
  }

  console.log('Bundle built successfully in dist/se.js');

  // Copy registries and policies so they are bundled with the release
  console.log('Copying static resources (registry and policies)...');
  fs.mkdirSync(path.join(distDir, 'platform/registry/official'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'platform/policies/official'), { recursive: true });

  fs.cpSync('platform/registry/official', path.join(distDir, 'platform/registry/official'), { recursive: true });
  fs.cpSync('platform/policies', path.join(distDir, 'platform/policies'), { recursive: true });

  // Write pre-shebang header to make it globally executable
  const bundleContent = fs.readFileSync(targetPath, 'utf8');
  fs.writeFileSync(targetPath, `#!/usr/bin/env bun\n${bundleContent}`);
  fs.chmodSync(targetPath, 0o755);

  // Copy package.json to dist/ so it is publishable as an independent package
  const releasePkg = {
    ...pkg,
    private: false, // Make it publishable
    name: '@spec-engineer/cli',
    main: './se.js',
    bin: {
      se: './se.js',
      pjc: './se.js'
    },
    // We only need to publish the dist folder contents
    files: [
      'se.js',
      'platform/'
    ]
  };
  // Remove scripts we don't need for runtime distribution
  delete releasePkg.scripts;
  delete releasePkg.devDependencies;
  
  fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(releasePkg, null, 2));

  console.log('SpecEngineer release package successfully prepared in dist/ directory!');
}

build().catch(console.error);
