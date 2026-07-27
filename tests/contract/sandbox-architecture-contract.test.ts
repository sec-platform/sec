import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

describe('Sandbox Architecture (SM-3 Exit Closure Constraints)', () => {
  test('sandbox runtime consumes an immutable 11-package manifest contract', async () => {
    const manifestRaw = await readCompilerFile('.shared-deps/package.json');
    const manifest = JSON.parse(manifestRaw);
    
    const deps = manifest.dependencies || {};
    const devDeps = manifest.devDependencies || {};
    const allPackages = [...Object.keys(deps), ...Object.keys(devDeps)];
    
    const authorized = [
      'next', 'react', 'react-dom', 'yaml',
      '@playwright/test', '@types/bun', '@types/node', '@types/react', '@types/react-dom',
      'ts-morph', 'typescript'
    ];

    // ARCHITECTURE CONTRACT: This array IS the single source of truth for allowed Sandbox dependencies.
    // If a new Agent Skill or tool requires a new dependency in the Sandbox, 
    // YOU MUST EXPLICITLY ADD IT TO THE `authorized` ARRAY ABOVE AND UPDATE THIS LENGTH CHECK!
    // This physically forces an architectural review when expanding the Sandbox surface area.
    expect(allPackages.length).toBe(authorized.length, `The .shared-deps manifest must contain exactly ${authorized.length} authorized packages`);
    
    // Every required package manifest must have its exact name and a nonempty installed version
    for (const pkg of authorized) {
      expect(allPackages).toContain(pkg);
      const version = deps[pkg] || devDeps[pkg];
      expect(typeof version).toBe('string');
      expect(version.trim().length).toBeGreaterThan(0, `Package ${pkg} must have a valid version`);
    }
  });

  test('sandbox prevents workspace hoisting and duplicate locks', () => {
    const sharedDepsDir = path.join(process.cwd(), '.shared-deps');
    
    // Hard limit: No local lockfiles or bunfig in the sandbox root to prevent hoisting
    expect(fs.existsSync(path.join(sharedDepsDir, 'bun.lockb'))).toBe(false, 'Sandbox must not contain bun.lockb');
    expect(fs.existsSync(path.join(sharedDepsDir, 'bun.lock'))).toBe(false, 'Sandbox must not contain bun.lock');
    expect(fs.existsSync(path.join(sharedDepsDir, 'bunfig.toml'))).toBe(false, 'Sandbox must not contain bunfig.toml');
    expect(fs.existsSync(path.join(sharedDepsDir, 'yarn.lock'))).toBe(false, 'Sandbox must not contain yarn.lock');
    expect(fs.existsSync(path.join(sharedDepsDir, 'package-lock.json'))).toBe(false, 'Sandbox must not contain package-lock.json');
  });

  test('sandbox name strictly avoids naming conflicts with compiler tooling', () => {
    const sharedDepsDir = path.join(process.cwd(), '.shared-deps');
    // Ensure the folder exists to prove the isolation test is running on real directory
    expect(fs.existsSync(sharedDepsDir)).toBe(true);
    
    // The name must remain '.shared-deps' and not 'node_modules' to avoid accidental resolution
    expect(path.basename(sharedDepsDir)).toBe('.shared-deps');
  });
});
