import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  buildRuntimeDependencySpec,
  buildRuntimePackageManifest,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES
} from '../../platform/shared/runtime-dependency-spec.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

describe('Sandbox Architecture (SM-3 Exit Closure Constraints)', () => {
  test('shared dependency manifest builder consumes the canonical runtime dependency spec', async () => {
    const manifest = buildRuntimePackageManifest(
      'shared-runtime-deps',
      buildRuntimeDependencySpec(await readCompilerPackageJson())
    );
    const dependencies = manifest.dependencies;
    const devDependencies = manifest.devDependencies;
    const actualPackages = [...Object.keys(dependencies), ...Object.keys(devDependencies)]
      .sort((left, right) => left.localeCompare(right));
    const expectedPackages = [...RUNTIME_DEPENDENCY_PACKAGE_NAMES]
      .sort((left, right) => left.localeCompare(right));

    expect(actualPackages).toEqual(expectedPackages);
    for (const packageName of expectedPackages) {
      const version = dependencies[packageName] ?? devDependencies[packageName];
      expect(typeof version).toBe('string');
      expect(version!.trim().length).toBeGreaterThan(0);
    }
  });

  test('materialized shared dependency root does not own a competing lock or Bun config', () => {
    const sharedDepsDir = path.join(process.cwd(), '.shared-deps');
    for (const forbiddenFile of [
      'bun.lockb',
      'bun.lock',
      'bunfig.toml',
      'yarn.lock',
      'package-lock.json'
    ]) {
      expect(fs.existsSync(path.join(sharedDepsDir, forbiddenFile))).toBe(false);
    }
  });

  test('materialized dependency root remains distinct from the compiler node_modules root', () => {
    const sharedDepsDir = path.join(process.cwd(), '.shared-deps');
    expect(fs.existsSync(sharedDepsDir)).toBe(true);
    expect(path.basename(sharedDepsDir)).toBe('.shared-deps');
    expect(path.resolve(sharedDepsDir)).not.toBe(path.resolve(process.cwd(), 'node_modules'));
  });
});
