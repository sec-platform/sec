import { SecError } from '../contracts/failure.ts';
import type { RuntimeDependencyInstallMode } from '../execution/dependency-install-request.ts';
export async function ensureProjectDependencyEnvironment<Binding extends { readonly manifestHash: string },
  Source extends { readonly ownerRoot: string; readonly sourcePath: string }>(input: Readonly<{
  installMode?: RuntimeDependencyInstallMode;
  readPreboundTarget(): Promise<void>;
  readCanonicalPaths(): Readonly<{ compilerDependencyRoot: string; compilerNodeModulesPath: string }>;
  readRuntimeSpec(): Promise<Readonly<{ manifestHash: string }>>;
  observeCompilerReady(): Promise<Readonly<{ kind: string; binding: { runtimeMaterialization: Binding | null }; sourceGeneration?: Source | null }> | null>;
  ensureCompilerReady(): Promise<Readonly<{ runtimeMaterialization?: Binding | null; nodeModulesPath: string; sourceGeneration?: Source | null }>>;
  readSourceGeneration(binding: Binding, ownerRoot: string, sourcePath: string): Promise<Source>;
  verifyIsolatedSource(binding: Binding, sourcePath: string): Promise<boolean>;
  publishTarget(source: Readonly<{ binding: Binding; sourceGeneration: Source; sourceNodeModulesPath: string; compilerDependencyRoot: string }>): Promise<void>;
}>) {
  if (input.installMode === 'prebound-only') return input.readPreboundTarget();
  const paths = input.readCanonicalPaths();
  const spec = await input.readRuntimeSpec();
  const source = await prepareProjectDependencySource({ ...paths, manifestHash: spec.manifestHash,
    isolated: input.installMode === 'offline-copy-only',
    observeCompilerReady: input.observeCompilerReady,
    ensureCompilerReady: input.ensureCompilerReady,
    readSourceGeneration: input.readSourceGeneration,
    verifyIsolatedSource: input.verifyIsolatedSource
  });
  await input.publishTarget(source);
}
/** Select the canonical source before entering the native target transaction. */
export async function prepareProjectDependencySource<Binding extends { readonly manifestHash: string },
  Source extends { readonly ownerRoot: string; readonly sourcePath: string }>(input: Readonly<{
  isolated: boolean;
  manifestHash: string;
  compilerDependencyRoot: string;
  compilerNodeModulesPath: string;
  observeCompilerReady(): Promise<Readonly<{ kind: string; binding: { runtimeMaterialization: Binding | null }; sourceGeneration?: Source | null }> | null>;
  ensureCompilerReady(): Promise<Readonly<{ runtimeMaterialization?: Binding | null; nodeModulesPath: string; sourceGeneration?: Source | null }>>;
  readSourceGeneration(binding: Binding, ownerRoot: string, sourcePath: string): Promise<Source>;
  verifyIsolatedSource(binding: Binding, sourcePath: string): Promise<boolean>;
}>) {
  let binding: Binding;
  let compilerSource: Source;
  if (input.isolated) {
    const ready = await input.observeCompilerReady();
    if (ready === null || ready.kind === 'incompatible-bridge' || ready.binding.runtimeMaterialization === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Canonical compiler dependency readiness is unavailable');
    }
    binding = ready.binding.runtimeMaterialization;
    compilerSource = ready.sourceGeneration ?? await input.readSourceGeneration(binding,
      input.compilerDependencyRoot, input.compilerNodeModulesPath);
  } else {
    const ready = await input.ensureCompilerReady();
    const material = ready.runtimeMaterialization;
    if (material === null || material === undefined || material.manifestHash !== input.manifestHash) {
      throw new SecError('RUNTIME-DEPS-004', 'Canonical compiler runtime materialization is unavailable');
    }
    binding = material;
    compilerSource = ready.sourceGeneration ?? await input.readSourceGeneration(binding, input.compilerDependencyRoot, ready.nodeModulesPath);
  }
  const sourceGeneration = await input.readSourceGeneration(binding, compilerSource.ownerRoot, compilerSource.sourcePath);
  if (input.isolated && !await input.verifyIsolatedSource(binding, sourceGeneration.sourcePath)) {
    throw new SecError('RUNTIME-DEPS-004', 'Canonical compiler runtime materialization is unavailable for isolated verification');
  }
  return Object.freeze({ binding, sourceGeneration, sourceNodeModulesPath: sourceGeneration.sourcePath,
    compilerDependencyRoot: input.compilerDependencyRoot });
}
