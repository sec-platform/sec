import crypto from 'node:crypto';
import path from 'node:path';
import { CompilerError } from './errors.ts';
import { readJson } from './fs.ts';
import { compilerRoot } from './paths.ts';

interface RootPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface RuntimeDependencySpec {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  manifestHash: string;
}

export interface RuntimePackageManifest {
  name: string;
  private: true;
  type: 'module';
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const runtimeDependencyKeys = ['next', 'react', 'react-dom', 'yaml'] as const;
const runtimeDevDependencyKeys = [
  '@playwright/test',
  '@types/bun',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  'typescript',
  'vitest'
] as const;

function resolveVersion(rootPackage: RootPackageJson, dependencyName: string): string {
  const version = rootPackage.dependencies?.[dependencyName] ?? rootPackage.devDependencies?.[dependencyName];
  if (!version) {
    throw new CompilerError(
      'RUNTIME-DEPS-000',
      `Root package.json is missing required runtime dependency "${dependencyName}"`
    );
  }
  return version;
}

function stableHash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function loadRuntimeDependencySpec(
  packageJsonPath = path.join(compilerRoot, 'package.json')
): Promise<RuntimeDependencySpec> {
  const rootPackage = await readJson<RootPackageJson>(packageJsonPath);
  const dependencies = Object.fromEntries(
    runtimeDependencyKeys.map((dependencyName) => [dependencyName, resolveVersion(rootPackage, dependencyName)])
  );
  const devDependencies = Object.fromEntries(
    runtimeDevDependencyKeys.map((dependencyName) => [dependencyName, resolveVersion(rootPackage, dependencyName)])
  );

  return {
    dependencies,
    devDependencies,
    manifestHash: stableHash({ dependencies, devDependencies })
  };
}

export function buildRuntimePackageManifest(
  name: string,
  spec: RuntimeDependencySpec
): RuntimePackageManifest {
  return {
    name,
    private: true,
    type: 'module',
    dependencies: { ...spec.dependencies },
    devDependencies: { ...spec.devDependencies }
  };
}
