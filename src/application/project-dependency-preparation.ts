import { CodedFailure } from '../contracts/failure.ts';
import type { RuntimeDependencyInstallMode } from '../execution/dependency-install-request.ts';
export async function ensureProjectDependencyEnvironment<Binding extends { readonly manifestHash: string },
  Source extends { readonly ownerRoot: string; readonly sourcePath: string }>(input: Readonly<{
  installMode?: RuntimeDependencyInstallMode;
  readPreboundTarget(): Promise<void>;
  readCanonicalPaths(): Readonly<{ compilerDependencyRoot: string; compilerNodeModulesPath: string }>;
  readRuntimeSpec(): Promise<Readonly<{ manifestHash: string }>>;
  observeCompilerReady(): Promise<Readonly<{ kind: string; binding: { runtimeMaterialization: Binding | null }; sourceGeneration?: Source | null }> | null>;
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
    readSourceGeneration: input.readSourceGeneration,
    verifyIsolatedSource: input.verifyIsolatedSource
  });
  await input.publishTarget(source);
}
/** Observe an already prepared canonical source before entering the native target transaction. */
export async function prepareProjectDependencySource<Binding extends { readonly manifestHash: string },
  Source extends { readonly ownerRoot: string; readonly sourcePath: string }>(input: Readonly<{
  isolated: boolean;
  manifestHash: string;
  compilerDependencyRoot: string;
  compilerNodeModulesPath: string;
  observeCompilerReady(): Promise<Readonly<{ kind: string; binding: { runtimeMaterialization: Binding | null }; sourceGeneration?: Source | null }> | null>;
  readSourceGeneration(binding: Binding, ownerRoot: string, sourcePath: string): Promise<Source>;
  verifyIsolatedSource(binding: Binding, sourcePath: string): Promise<boolean>;
}>) {
  const ready = await input.observeCompilerReady();
  const binding = ready?.binding.runtimeMaterialization;
  if (ready === null || ready.kind === 'incompatible-bridge' || binding === null || binding === undefined ||
      binding.manifestHash !== input.manifestHash) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Canonical compiler dependency readiness is unavailable');
  }
  const compilerSource = ready.sourceGeneration ?? await input.readSourceGeneration(binding,
    input.compilerDependencyRoot, input.compilerNodeModulesPath);
  const sourceGeneration = await input.readSourceGeneration(binding, compilerSource.ownerRoot, compilerSource.sourcePath);
  if (input.isolated && !await input.verifyIsolatedSource(binding, sourceGeneration.sourcePath)) {
    throw new CodedFailure('RUNTIME-DEPS-004', 'Canonical compiler runtime materialization is unavailable for isolated verification');
  }
  return Object.freeze({ binding, sourceGeneration, sourceNodeModulesPath: sourceGeneration.sourcePath,
    compilerDependencyRoot: input.compilerDependencyRoot });
}
