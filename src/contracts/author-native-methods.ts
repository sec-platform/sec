import {
  AUTHOR_KERNEL_GRAMMAR_MANIFEST,
  AUTHOR_KERNEL_LOCK_SCHEMA,
  AUTHOR_KERNEL_READER_CHECK,
  AUTHOR_KERNEL_ROOT,
  AUTHOR_KERNEL_TARGET_CHECK,
  AuthorKernelInputDeclarationError,
  authorKernelDeclaredInputPaths,
  isAuthorKernelVerificationRootInput
} from './author-kernel-verification.ts';
import { compareCodeUnits, deepFreeze, rawSha256, sha256, uniqueSorted } from './canonical.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from './repository-path.ts';
import { SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS } from './repository-test-path.ts';

/** Source-only method data. Issued projections, environment qualification and
 * the original execution owner remain necessary before any method can run. */
export const AUTHOR_NATIVE_METHOD_IDS = ['cargo-tests', 'reader-check', 'target-check'] as const;
export type AuthorNativeMethodId = (typeof AUTHOR_NATIVE_METHOD_IDS)[number];

export interface AuthorNativeMethodUnit {
  readonly id: AuthorNativeMethodId;
  readonly owner: 'adapters.compilation';
  readonly phase: 'quick' | 'risk';
  readonly inputs: readonly Readonly<{ path: string; contentDigest: string | null }>[];
  readonly selectionPaths: readonly string[];
  readonly absentLookupPaths: readonly string[];
  readonly unresolvedInputs: readonly string[];
  readonly inputClosureDigest: string;
}

interface SourceFile {
  readonly path: string;
  readonly source: string;
  readonly contentDigest: string;
}

interface ModuleReference {
  readonly from: string;
  readonly resolvedTarget: string | null;
  readonly candidateTargets: readonly string[];
  /** Narrow consumer view of the compiler-issued runtime relation. */
  readonly runtime: Readonly<{ kind: 'module' | 'asset'; target: string }>
    | Readonly<{ kind: 'external' | 'unresolved' | 'none' }>;
}

interface MethodInput {
  readonly files: readonly SourceFile[];
  readonly moduleGraph: Readonly<{
    references: readonly ModuleReference[];
    unresolvedFiles: readonly string[];
  }>;
}

const ESSENTIAL_BUILD_INPUTS = [
  `${AUTHOR_KERNEL_ROOT}/Cargo.toml`,
  `${AUTHOR_KERNEL_ROOT}/Cargo.lock`,
  `${AUTHOR_KERNEL_ROOT}/build.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/lib.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/main.rs`,
  AUTHOR_KERNEL_GRAMMAR_MANIFEST,
  AUTHOR_KERNEL_LOCK_SCHEMA
] as const;

// These are actual reads in the existing Reader oracle. The source acquisition
// classifier intentionally captures a wider examples directory independently.
const READER_RUNTIME_INPUTS = [
  'tools/documentation/codec_parameters.py',
  'tools/documentation/source_inventory.py',
  'examples/第一层作者/names-and-roots/codec-cases.json',
  'examples/第一层作者/names-and-roots/complete-base-cases.json',
  'examples/第一层作者/names-and-roots/schema-cases.json',
  'examples/第一层作者/names-and-roots/developer-surface-cases.json',
  'examples/第一层作者/names-and-roots/lexical-boundary-cases.json'
] as const;
const SHARED_TARGET_FIXTURE = `${AUTHOR_KERNEL_ROOT}/fixtures/shared-views.module.json`;
const CLI_INPUTS = [
  'src/bootstrap/cli/cli.ts',
  'src/adapters/toolchain/runtime/package-source-launcher.ts'
] as const;
const METHOD_RULE_INPUTS = [
  'src/contracts/author-native-methods.ts',
  'src/contracts/author-kernel-verification.ts',
  'src/adapters/self-hosting/development/runner/native-test-runner.ts'
] as const;
const HOST_CONSUMERS = new Set([
  'src/adapters/compilation/author-kernel.ts',
  'src/adapters/compilation/author-analysis-transport.ts'
]);
const LEGACY_NATIVE_INPUTS = new Set([
  `${AUTHOR_KERNEL_ROOT}/src/lib.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/model.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/source.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/typescript.rs`,
  `${AUTHOR_KERNEL_ROOT}/src/main.rs`
]);

function requirePath(path: string): void {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(path)) {
    throw new AuthorKernelInputDeclarationError('Native method input path is not canonical repository-relative.');
  }
}

function isCargoControl(path: string): boolean {
  return isAuthorKernelVerificationRootInput(path)
    && /(?:^|\/)(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?)$|(?:^|\/)\.cargo\/config(?:\.toml)?$/u.test(path);
}

function isCargoInput(path: string): boolean {
  return isCargoControl(path) || (isAuthorKernelVerificationRootInput(path)
    && path.startsWith(`${AUTHOR_KERNEL_ROOT}/`)
    && (path.endsWith('.rs') || path === `${AUTHOR_KERNEL_ROOT}/build.rs`
      || path.startsWith(`${AUTHOR_KERNEL_ROOT}/fixtures/`)));
}

function isBinaryInput(path: string): boolean {
  return isCargoControl(path) || path === `${AUTHOR_KERNEL_ROOT}/build.rs`
    || (isAuthorKernelVerificationRootInput(path)
      && path.startsWith(`${AUTHOR_KERNEL_ROOT}/src/`) && path.endsWith('.rs'));
}

interface Closure {
  readonly required: Set<string>;
  readonly selection: Set<string>;
  readonly absent: Set<string>;
  readonly unresolved: Set<string>;
}

function emptyClosure(): Closure {
  return { required: new Set(), selection: new Set(), absent: new Set(), unresolved: new Set() };
}

function requireInputs(closure: Closure, paths: Iterable<string>): void {
  for (const path of paths) {
    closure.required.add(path);
    closure.selection.add(path);
  }
}

/** Traverse only the compiler's existing observations. Candidate absence is a
 * negative lookup dependency, while a missing resolved target is unresolved. */
function includeTypeScriptClosure(
  closure: Closure,
  roots: readonly string[],
  files: ReadonlySet<string>,
  references: ReadonlyMap<string, readonly ModuleReference[]>,
  unresolvedFiles: ReadonlySet<string>
): void {
  const pending = [...roots];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    requireInputs(closure, [path]);
    if (unresolvedFiles.has(path)) closure.unresolved.add(path);
    for (const reference of references.get(path) ?? []) {
      const targets = new Set<string>();
      if (reference.resolvedTarget !== null) targets.add(reference.resolvedTarget);
      if (reference.runtime.kind === 'module' || reference.runtime.kind === 'asset') {
        targets.add(reference.runtime.target);
      }
      requireInputs(closure, targets);
      if (reference.runtime.kind === 'module') pending.push(reference.runtime.target);
      else if (reference.runtime.kind === 'unresolved') closure.unresolved.add(path);
      for (const candidate of reference.candidateTargets) {
        closure.selection.add(candidate);
        if (files.has(candidate)) requireInputs(closure, [candidate]);
        else if (!targets.has(candidate)) closure.absent.add(candidate);
      }
    }
  }
}

/** One source-only traversal for the producer and strict projection codec.
 * Byte inputs do not become module evaluation roots merely by being retained. */
export function authorNativeMethodTypeScriptClosure(
  id: AuthorNativeMethodId,
  input: Readonly<{ filePaths: readonly string[]; moduleGraph: MethodInput['moduleGraph'] }>
): Readonly<{
  requiredPaths: readonly string[];
  selectionPaths: readonly string[];
  absentLookupPaths: readonly string[];
  unresolvedPaths: readonly string[];
}> {
  if (!AUTHOR_NATIVE_METHOD_IDS.includes(id)) {
    throw new AuthorKernelInputDeclarationError('Native method identity is unsupported.');
  }
  const references = new Map<string, ModuleReference[]>();
  for (const reference of input.moduleGraph.references) {
    requirePath(reference.from);
    if (reference.resolvedTarget !== null) requirePath(reference.resolvedTarget);
    if (reference.runtime.kind === 'module' || reference.runtime.kind === 'asset') requirePath(reference.runtime.target);
    for (const candidate of reference.candidateTargets) requirePath(candidate);
    const group = references.get(reference.from) ?? [];
    group.push(reference);
    references.set(reference.from, group);
  }
  const unresolvedFiles = new Set(input.moduleGraph.unresolvedFiles);
  for (const path of unresolvedFiles) requirePath(path);
  for (const path of input.filePaths) requirePath(path);
  const roots = id === 'cargo-tests' ? METHOD_RULE_INPUTS
    : [id === 'reader-check' ? AUTHOR_KERNEL_READER_CHECK : AUTHOR_KERNEL_TARGET_CHECK,
      ...CLI_INPUTS, ...METHOD_RULE_INPUTS];
  const closure = emptyClosure();
  includeTypeScriptClosure(closure, roots, new Set(input.filePaths), references, unresolvedFiles);
  return deepFreeze({
    requiredPaths: uniqueSorted([...closure.required]),
    selectionPaths: uniqueSorted([...closure.selection]),
    absentLookupPaths: uniqueSorted([...closure.absent]),
    unresolvedPaths: uniqueSorted([...closure.unresolved])
  });
}

function makeUnit(
  id: AuthorNativeMethodId,
  closure: Closure,
  files: ReadonlyMap<string, SourceFile>
): AuthorNativeMethodUnit {
  const inputs = uniqueSorted([...closure.required]).map(path => {
    const file = files.get(path);
    if (file === undefined) closure.unresolved.add(path);
    return { path, contentDigest: file?.contentDigest ?? null };
  });
  const fields = {
    id,
    owner: 'adapters.compilation' as const,
    phase: id === 'target-check' ? 'risk' as const : 'quick' as const,
    inputs,
    selectionPaths: uniqueSorted([...closure.selection]),
    absentLookupPaths: uniqueSorted([...closure.absent]),
    unresolvedInputs: uniqueSorted([...closure.unresolved])
  };
  return deepFreeze({ ...fields, inputClosureDigest: sha256(fields) });
}

export function isAuthorNativeMethodCatalogPresent(paths: readonly string[]): boolean {
  return paths.some(path => HOST_CONSUMERS.has(path)
    || path === AUTHOR_KERNEL_READER_CHECK || path === AUTHOR_KERNEL_TARGET_CHECK
    || (path.startsWith(`${AUTHOR_KERNEL_ROOT}/`) && isAuthorKernelVerificationRootInput(path)));
}

export function compileAuthorNativeMethodUnits(input: MethodInput): readonly AuthorNativeMethodUnit[] {
  const files = new Map<string, SourceFile>();
  for (const file of input.files) {
    requirePath(file.path);
    if (files.has(file.path)) throw new AuthorKernelInputDeclarationError('Native method input paths repeat.');
    if (rawSha256(file.source) !== file.contentDigest) {
      throw new AuthorKernelInputDeclarationError('Native method source bytes do not match their content digest.');
    }
    files.set(file.path, file);
  }
  if (!isAuthorNativeMethodCatalogPresent([...files.keys()])) return Object.freeze([]);

  const typeScriptClosure = (id: AuthorNativeMethodId): Closure => {
    const result = authorNativeMethodTypeScriptClosure(id, { filePaths: [...files.keys()], moduleGraph: input.moduleGraph });
    return { required: new Set(result.requiredPaths), selection: new Set(result.selectionPaths),
      absent: new Set(result.absentLookupPaths), unresolved: new Set(result.unresolvedPaths) };
  };
  const manifest = files.get(AUTHOR_KERNEL_GRAMMAR_MANIFEST);
  const grammarInputs = manifest === undefined ? [AUTHOR_KERNEL_GRAMMAR_MANIFEST]
    : authorKernelDeclaredInputPaths(manifest.source);
  const buildInputs = uniqueSorted([
    ...ESSENTIAL_BUILD_INPUTS,
    ...grammarInputs,
    ...[...files.keys()].filter(isBinaryInput)
  ]);

  const cargo = typeScriptClosure('cargo-tests');
  requireInputs(cargo, [...buildInputs, ...[...files.keys()].filter(isCargoInput),
    ...READER_RUNTIME_INPUTS, SHARED_TARGET_FIXTURE, ...SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS]);

  const reader = typeScriptClosure('reader-check');
  requireInputs(reader, [...buildInputs, SHARED_TARGET_FIXTURE, ...SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS]);

  const target = typeScriptClosure('target-check');
  requireInputs(target, [SHARED_TARGET_FIXTURE, ...SEC_REPOSITORY_TEST_EXECUTION_INPUT_PATHS]);
  const targetLoadSelection = new Set(target.selection);
  requireInputs(target, buildInputs);
  // Evidence retains all binary bytes. Risk selection follows the reviewed
  // legacy native responsibility and conservatively complete TS module loads.
  for (const path of buildInputs) {
    if (!targetLoadSelection.has(path) && !LEGACY_NATIVE_INPUTS.has(path) && !isCargoControl(path)) target.selection.delete(path);
  }
  return deepFreeze([
    makeUnit('cargo-tests', cargo, files),
    makeUnit('reader-check', reader, files),
    makeUnit('target-check', target, files)
  ]);
}

export function selectAuthorNativeMethods(
  units: readonly AuthorNativeMethodUnit[],
  changedPaths: readonly string[],
  scope: 'affected' | 'risk' | 'full'
): readonly AuthorNativeMethodUnit[] {
  if (!['affected', 'risk', 'full'].includes(scope)) throw new AuthorKernelInputDeclarationError('Native method selection scope is unsupported.');
  for (const path of changedPaths) requirePath(path);
  const changed = new Set(changedPaths);
  const selected = new Map<AuthorNativeMethodId, AuthorNativeMethodUnit>();
  const seen = new Set<AuthorNativeMethodId>();
  for (const unit of units) {
    if (!AUTHOR_NATIVE_METHOD_IDS.includes(unit.id) || unit.owner !== 'adapters.compilation'
        || unit.phase !== (unit.id === 'target-check' ? 'risk' : 'quick')) {
      throw new AuthorKernelInputDeclarationError('Native method identity, owner or phase is unsupported.');
    }
    if (seen.has(unit.id)) throw new AuthorKernelInputDeclarationError('Native method units repeat an identity.');
    seen.add(unit.id);
    if (scope !== 'full' && unit.phase !== (scope === 'affected' ? 'quick' : 'risk')) continue;
    const matches = scope === 'full' || unit.selectionPaths.some(path => changed.has(path))
      || changedPaths.some(path => unit.id === 'cargo-tests' ? isCargoInput(path)
        : unit.id === 'reader-check' ? isBinaryInput(path) : isCargoControl(path) || LEGACY_NATIVE_INPUTS.has(path));
    if (matches) selected.set(unit.id, unit);
  }
  return Object.freeze([...selected.values()].sort((left, right) => compareCodeUnits(left.id, right.id)));
}
