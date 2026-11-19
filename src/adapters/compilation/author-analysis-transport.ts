import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { snapshotByteView } from '../../contracts/byte-snapshot.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import { assertNativeAbortSignal, throwIfNativeAborted } from '../../contracts/native-abort.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryLeaf,
  PhysicalNoFollowError,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommandBytes } from '../runtime-state/physical/runtime/process.ts';
import {
  readOptionalRetainedOrdinaryLeaf,
  retainOptionalDirectory
} from '../runtime-state/physical/runtime/retained-file-read.ts';

const MAXIMUM_ROOT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_TRANSPORT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const RUN_MILLISECONDS = 30_000;
const natural = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const need = z.object({ locator: z.string(), path: z.string(), code: z.string(), message: z.string() }).strict();
const captureRequest = z.object({
  kind: z.enum(['directory', 'file']), path: z.string(), scope_root: z.string()
}).strict();
const moduleUse = z.object({
  project_instance: z.string().min(1), module_id: z.string().min(1),
  resolution_domain: z.string().min(1), interpretation: digest
}).strict();
const sourceInfo = z.object({
  locator: z.string(), revision: digest, byte_length: natural, layer: z.string()
}).strict();
const origin = z.object({ pointer: z.string(), start: natural, end: natural }).strict().nullable();
const exportHop = z.object({
  module: natural, export: z.string(), via_import: z.string().nullable(),
  qualification: z.enum(['capture-local', 'pending-lock-and-module-use', 'module-use'])
}).strict();
function nameResolutionSchema<Hop extends z.ZodTypeAny>(hop: Hop) {
  return z.discriminatedUnion('state', [
    z.object({ state: z.literal('resolved'), declaration: natural, route: z.array(hop) }).strict(),
    z.object({ state: z.literal('needs'), code: z.string(), selector: z.string(), route: z.array(hop) }).strict(),
    z.object({ state: z.literal('rejected'), code: z.string(), selector: z.string(), route: z.array(hop) }).strict()
  ]);
}
const authorNameResolutionSchema = nameResolutionSchema(exportHop);
export const captureLocalNameResolutionSchema = nameResolutionSchema(exportHop.extend({
  qualification: z.enum(['capture-local', 'pending-lock-and-module-use'])
}));
const lexicalDomain = z.enum(['semantic', 'value']);
const lexicalPhase = z.enum(['static', 'runtime', 'unknown']);
const localResolution = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), binding: natural }).strict(),
  z.object({ state: z.literal('needs'), code: z.string() }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string() }).strict()
]);
const controlResolution = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), scope: natural }).strict(),
  z.object({ state: z.literal('needs'), code: z.string() }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string() }).strict()
]);
const lexicalProblem = z.object({ occurrence: natural, code: z.string() }).strict();
const lexicalOutput = z.object({
  occurrences: z.array(z.object({ id: natural, module: natural, owner: natural.nullable(),
    expanded_path: z.string(), origin, schema_slot: z.string() }).strict()),
  scopes: z.array(z.object({ id: natural, parent: natural.nullable(), occurrence: natural,
    kind: z.enum(['definition', 'function', 'lambda', 'block', 'let', 'branch', 'match_arm', 'handler', 'try_body', 'loop', 'semantic']) }).strict()),
  bindings: z.array(z.object({ id: natural, scope: natural, occurrence: natural, source_key: z.string().nullable(),
    name: z.string(), kind: z.enum(['runtime_parameter', 'let', 'var', 'pattern', 'handler', 'Type', 'Value', 'Region', 'Scope', 'EffectRow', 'constructor', 'pack']),
    domains: z.array(lexicalDomain).min(1).max(2), phase: lexicalPhase, mutable: z.boolean() }).strict()),
  uses: z.array(z.object({ occurrence: natural, scope: natural, domain: lexicalDomain, selector: z.string(),
    phase: lexicalPhase, expected_kind: z.string().nullable(), resolution: localResolution }).strict()),
  exits: z.array(z.object({ occurrence: natural, kind: z.enum(['return', 'break', 'continue']), target: controlResolution }).strict()),
  captures: z.array(z.object({ scope: natural, binding: natural, occurrence: natural }).strict()),
  problems: z.array(lexicalProblem), pending_regions: z.array(lexicalProblem)
}).strict();
function nameAnalysisSchema<Identity extends z.ZodTypeAny, Resolution extends z.ZodTypeAny>(identity: Identity, resolution: Resolution) {
  return z.object({
    schema: z.literal('gift.author-names/2'), stage: z.literal('names'), identity_scope: identity,
    input_revision: z.string(), source_revision: z.string(), root: natural,
    modules: z.array(z.object({ id: natural, module_id: z.string(), source_revision: z.string(), grammar_revision: z.string() }).strict()),
    declarations: z.array(z.object({ id: natural, module: natural, name: z.string(), kind: z.string(), origin }).strict()),
    references: z.array(z.object({ module: natural, owner: natural.nullable(), expanded_path: z.string(), origin,
      schema_slot: z.string(), domain: z.enum(['source-reference', 'declaration-selector', 'profile-selector', 'dialect-consumer']), resolution }).strict()),
    exports: z.array(z.object({ module: natural, name: z.string(), resolution }).strict()),
    reads: z.array(z.object({ module: natural, domain: z.string(), name: z.string() }).strict()),
    problems: z.array(z.object({ module: natural, path: z.string(), code: z.string() }).strict()),
    pending_regions: z.array(z.object({ module: natural, path: z.string(), code: z.string() }).strict()),
    lexical: lexicalOutput, unchecked: z.array(z.string())
  }).strict();
}
export const captureLocalNameAnalysisSchema = nameAnalysisSchema(z.literal('capture-local'), captureLocalNameResolutionSchema);
const moduleUseNameAnalysisSchema = nameAnalysisSchema(z.literal('module-use'), authorNameResolutionSchema);
const diagnostic = z.object({ code: z.string(), path: z.string(), message: z.string() }).strict();
const sourceNeed = z.object({ source: natural, code: z.string() }).strict();
const effectState = z.enum(['body_derived', 'conservative_bound', 'unknown', 'rejected']);
const analysis = z.object({
  input_basis: digest,
  names: moduleUseNameAnalysisSchema,
  type_count: natural,
  sources: z.array(z.object({ id: natural, module: natural, owner: natural.nullable(), path: z.string(), origin }).strict()),
  signatures: z.array(z.object({ declaration: natural, ty: natural.nullable(),
    state: z.enum(['type_ready', 'needs_annotation', 'needs_input', 'rejected']), body_type_checked: z.boolean() }).strict()),
  bodies: z.array(z.object({ source: natural, state: z.enum(['type_checked', 'pending', 'rejected']),
    normal: z.enum(['value', 'no_normal', 'pending']), ty: natural.nullable() }).strict()),
  effects: z.object({
    declarations: z.array(z.object({ declaration: natural, state: effectState,
      may: z.array(z.object({ class: z.string(), port: natural.nullable(), resource: natural.nullable(), scope: z.string().nullable() }).strict()),
      internal: z.array(z.object({ binding: natural, instance: natural, write: z.boolean() }).strict()),
      needs: z.array(sourceNeed) }).strict()),
    needs: z.array(sourceNeed), problems: z.array(z.object({ source: natural, diagnostic }).strict())
  }).strict(),
  needs: z.array(sourceNeed), problems: z.array(z.object({ declaration: natural, diagnostic }).strict()),
  body_problems: z.array(z.object({ source: natural, diagnostic }).strict())
}).strict();
const nativeBudget = z.object({ work: natural, allocation_bytes: natural }).strict();
const analysisResult = z.object({
  schema: z.literal('gift.author-analysis/1'), purpose: z.literal('analyze'),
  state: z.enum(['prepared', 'waiting', 'conflict', 'stopped']), basis: digest, interpretation: digest,
  requests: z.array(captureRequest), needs: z.array(need), sources: z.array(sourceInfo), module_uses: z.array(moduleUse),
  modules: z.array(z.object({ id: natural, locator: z.string(), module_use: moduleUse, source_revision: digest }).strict()),
  analysis: analysis.nullable(),
  budget: z.object({ requested: nativeBudget, remaining: nativeBudget, consumed: nativeBudget }).strict()
}).strict();
export type AuthorAnalysisResult = z.infer<typeof analysisResult>;

const targetBindingLocation = z.object({
  project_scope: z.string().min(1), resolution_domain: z.string().min(1), interpretation: digest,
  slot: z.object({ role: z.literal('target_profile'), target: z.string() }).strict()
}).strict();
const rustGeneration = z.object({
  state: z.enum(['complete', 'needs', 'rejected']), input_basis: digest,
  method: z.object({ module_id: z.literal('gift:rust-source-library'), export: z.literal('emit'),
    implementation_revision: digest }).strict(),
  provenance: z.object({ target: z.string(), binding: targetBindingLocation,
    profile_id: z.string().min(1), profile_revision: z.string().min(1), profile_source_revision: digest,
    profile_locator: z.string(), lock_locator: z.string(), lock_revision: digest, node_id: z.string().min(1) }).strict().nullable(),
  context: z.object({ crate_name: z.string().min(1), edition: z.enum(['2021', '2024']), std_profile: z.literal('std'),
    crate_shape: z.literal('library'), emit: z.literal('source'),
    toolchain_requirements: z.array(z.object({ id: z.string(), revision: z.string() }).strict()),
    runtime_requirements: z.array(z.string()), evidence_obligations: z.array(z.string()) }).strict().nullable(),
  members_complete: z.boolean(),
  artifacts: z.array(z.object({ path: z.string(), content: z.string() }).strict()),
  source_map: z.array(z.object({ source_module: natural, declaration: natural, definition: z.string(),
    source_pointer: z.string(), source_revision: digest, artifact: z.string(),
    start_line: natural.min(1), end_line: natural.min(1) }).strict()),
  exports: z.array(z.object({ root_id: z.string(), export: z.string(), rust_name: z.string(),
    root_module: natural, declaration: natural, route: z.array(exportHop) }).strict()),
  dependencies: z.array(z.object({ source_module: natural, declaration: natural, source_revision: digest,
    callees: z.array(natural) }).strict()),
  needs: z.array(need), problems: z.array(need), unrequested_checks: z.array(z.string())
}).strict();
const generationResult = analysisResult.omit({ schema: true, purpose: true }).extend({
  schema: z.literal('gift.author-generation/1'), purpose: z.literal('generate'),
  grammar_revision: digest,
  resolver_binding: z.object({ id: z.literal('gift:captured-author-resolver/1'), revision: digest }).strict(),
  generation: rustGeneration.nullable()
}).strict();
export type AuthorGenerationResult = z.infer<typeof generationResult>;

type CaptureRequest = z.infer<typeof captureRequest>;
type CaptureOutcome = 'complete' | 'found' | 'partial' | 'absent' | 'denied' | 'unavailable' | 'failed';
type DirectoryEntry = Readonly<{ name: string; kind: 'file' | 'directory' | 'link' | 'other'; byte_length: number }>;
type CaptureObservation =
  | Readonly<{ kind: 'directory'; path: string; outcome: CaptureOutcome; entries: readonly DirectoryEntry[] }>
  | Readonly<{ kind: 'file'; path: string; outcome: CaptureOutcome; bytes: readonly number[] }>;

function protocol(message: string): never {
  throw new CodedFailure('AUTHOR-ANALYSIS-PROTOCOL', message);
}

function revision(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function locator(value: string): string {
  if (value === '.' || (value.length > 0 && !value.includes('\\') && !value.includes(':')
      && !value.includes('\0') && !value.startsWith('/')
      && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..'))) {
    return value;
  }
  return protocol('Native capture locator is not a canonical relative path');
}

function inside(root: string, candidate: string): boolean {
  return root === '.' || candidate === root || candidate.startsWith(`${root}/`);
}

function validateCaptureRequest(request: CaptureRequest, scopeRoot: string, rootLocator: string): void {
  locator(request.path);
  if (request.scope_root !== scopeRoot || !inside(scopeRoot, request.path) || request.path === rootLocator
      || request.kind === 'file' && request.path === scopeRoot) {
    protocol('Native capture request escapes or replaces the fixed root source');
  }
}

/** The retained directory limits this invocation's reads. Its physical identity
 * is capture context, not the Project's persistent semantic or lock identity. */
class LocalCapture {
  readonly sources = new Map<string, Uint8Array>();
  readonly observations = new Map<string, CaptureObservation>();
  readonly context: Readonly<{ project_instance: string; resolution_domain: string }>;
  readonly rootLocator: string;
  readonly scopeRoot: string;
  readonly rootBytes: Uint8Array;
  private readonly directories = new Map<string, PhysicalDirectoryIdentity>();
  private remainingEntries = 20_000;
  private remainingBytes = 32 * 1024 * 1024;

  constructor(workspaceRoot: string, inputPath: string, readonly deadline: number, readonly signal?: AbortSignal) {
    if (signal !== undefined) assertNativeAbortSignal(signal);
    this.current();
    this.rootLocator = locator(path.relative(workspaceRoot, inputPath).split(path.sep).join('/'));
    this.scopeRoot = path.posix.dirname(this.rootLocator);
    const parent = retainOptionalDirectory(path.dirname(inputPath), 'Author analysis project root');
    if (parent === null) throw new CodedFailure('AUTHOR-ANALYSIS-INPUT', 'Author analysis project directory is absent');
    this.directories.set(this.scopeRoot, parent);
    const bytes = readOptionalRetainedOrdinaryLeaf(parent, path.basename(inputPath), { maximumBytes: MAXIMUM_ROOT_BYTES });
    if (bytes === null) throw new CodedFailure('AUTHOR-ANALYSIS-INPUT', 'Author analysis root source is absent');
    this.rootBytes = snapshotByteView(bytes, 'Author analysis root', MAXIMUM_ROOT_BYTES);
    this.remainingBytes -= this.rootBytes.length;
    this.sources.set(this.rootLocator, this.rootBytes);
    const identity = revision(Buffer.from(JSON.stringify([parent.path, parent.device, parent.inode, parent.objectId])));
    this.context = Object.freeze({ project_instance: `capture:${identity}`, resolution_domain: 'gift:captured-author-resolver/1' });
    this.current();
  }

  current(): void {
    throwIfNativeAborted(this.signal);
    if (performance.now() >= this.deadline) {
      throw new CodedFailure('AUTHOR-ANALYSIS-RESOURCE', 'Author analysis logical-run deadline exhausted');
    }
  }

  validateRequest(request: CaptureRequest): void {
    validateCaptureRequest(request, this.scopeRoot, this.rootLocator);
  }

  private directory(directoryLocator: string): PhysicalDirectoryIdentity | null {
    this.current();
    const root = this.directories.get(this.scopeRoot)!;
    assertSameNoFollowDirectoryIdentity(root, 'Author analysis project root');
    if (directoryLocator === this.scopeRoot) return root;
    const relative = this.scopeRoot === '.' ? directoryLocator : directoryLocator.slice(this.scopeRoot.length + 1);
    let current = root;
    let currentLocator = this.scopeRoot;
    for (const segment of relative.split('/')) {
      this.current();
      currentLocator = currentLocator === '.' ? segment : `${currentLocator}/${segment}`;
      const retained = this.directories.get(currentLocator);
      if (retained !== undefined) {
        assertSameNoFollowDirectoryIdentity(retained, 'Author analysis captured directory');
        current = retained;
      } else {
        const child = inspectNoFollowDirectoryLeaf(current, segment, 'Author analysis directory');
        if (child === null) return null;
        this.directories.set(currentLocator, child);
        current = child;
      }
    }
    return current;
  }

  acquire(request: CaptureRequest): boolean {
    this.validateRequest(request);
    this.current();
    const key = `${request.kind}:${request.path}`;
    if (this.observations.has(key)) return false;
    let observation: CaptureObservation;
    try {
      if (request.kind === 'directory') {
        const directory = this.directory(request.path);
        if (directory === null) {
          observation = { kind: 'directory', path: request.path, outcome: 'absent', entries: [] };
        } else {
          if (this.remainingEntries === 0) throw new CodedFailure('AUTHOR-ANALYSIS-RESOURCE', 'Author capture entry budget exhausted');
          const entries = scanNoFollowDirectoryDirectMetadata(directory, {
            deadlineAtMs: this.deadline, maximumEntries: this.remainingEntries, signal: this.signal
          }).map(entry => ({
            name: entry.relativePath, kind: entry.kind, byte_length: entry.size
          }));
          this.remainingEntries -= entries.length;
          observation = { kind: 'directory', path: request.path, outcome: 'complete', entries };
        }
      } else {
        const parent = this.directory(path.posix.dirname(request.path));
        const bytes = parent === null ? null : readOptionalRetainedOrdinaryLeaf(parent, path.posix.basename(request.path), {
          maximumBytes: this.remainingBytes
        });
        if (bytes === null) {
          observation = { kind: 'file', path: request.path, outcome: 'absent', bytes: [] };
        } else {
          this.remainingBytes -= bytes.length;
          const captured = snapshotByteView(bytes, 'Author captured source');
          this.sources.set(request.path, captured);
          observation = { kind: 'file', path: request.path, outcome: 'found', bytes: Array.from(captured) };
        }
      }
    } catch (error) {
      this.current();
      if (!(error instanceof PhysicalNoFollowError)) throw error;
      if (error.code === 'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED' || /(?:entry bound|byte bound|deadline)/u.test(error.message)) {
        throw new CodedFailure('AUTHOR-ANALYSIS-RESOURCE', 'Author capture exceeded its logical-run budget', {}, { cause: error });
      }
      const outcome = error.code === 'PHYSICAL_NO_FOLLOW_ABSENT' ? 'absent'
        : error.nativeFailure?.failureClass === 'access-denied' ? 'denied'
          : error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
            || error.nativeFailure?.failureClass === 'access-unavailable' ? 'unavailable' : 'failed';
      observation = request.kind === 'directory'
        ? { kind: 'directory', path: request.path, outcome, entries: [] }
        : { kind: 'file', path: request.path, outcome, bytes: [] };
    }
    this.current();
    this.observations.set(key, observation);
    return true;
  }
}

export interface AuthorAnalysisExpectation {
  readonly budget: Readonly<{ work: number; allocation_bytes: number }>;
  readonly basis?: string;
  readonly interpretation?: string;
  readonly rootLocator?: string;
}

/** Validate the real native result against the original captured source set.
 * This boundary checks transport integrity, not semantic qualification. */
export function parseAuthorAnalysis(
  value: unknown,
  capturedSources: ReadonlyMap<string, Uint8Array>,
  expected: AuthorAnalysisExpectation
): AuthorAnalysisResult {
  const parsed = analysisResult.safeParse(value);
  if (!parsed.success) return protocol(`Native analysis returned an invalid result at ${parsed.error.issues[0]?.path.join('.') ?? ''}`);
  return validateCapturedResult(parsed.data, capturedSources, expected);
}

function validateCapturedResult<Result extends AuthorAnalysisResult | AuthorGenerationResult>(
  data: Result, capturedSources: ReadonlyMap<string, Uint8Array>, expected: AuthorAnalysisExpectation
): Result {
  const rootLocator = locator(expected.rootLocator ?? capturedSources.keys().next().value ?? '');
  if (!capturedSources.has(rootLocator)) return protocol('Analysis root is not in the captured source set');
  const scopeRoot = path.posix.dirname(rootLocator);
  if ((expected.basis !== undefined && data.basis !== expected.basis)
      || (expected.interpretation !== undefined && data.interpretation !== expected.interpretation)) {
    return protocol('Native analysis changed its fixed preparation or interpretation');
  }
  for (const dimension of ['work', 'allocation_bytes'] as const) {
    const requested = data.budget.requested[dimension];
    const remaining = data.budget.remaining[dimension];
    if (requested !== expected.budget[dimension] || remaining > requested
        || data.budget.consumed[dimension] !== requested - remaining) {
      return protocol('Native analysis refunded or overdrawn the logical-run budget');
    }
  }
  const selectedSources = new Set<string>();
  for (const source of data.sources) {
    locator(source.locator);
    const bytes = capturedSources.get(source.locator);
    if (bytes === undefined || selectedSources.has(source.locator) || source.layer !== 'captured'
        || source.byte_length !== bytes.length || source.revision !== revision(bytes)) {
      return protocol('Native analysis source catalog does not bind the exact captured bytes');
    }
    selectedSources.add(source.locator);
  }
  if (selectedSources.size !== capturedSources.size) return protocol('Native analysis omitted a captured source');
  const requested = new Set<string>();
  for (const request of data.requests) {
    validateCaptureRequest(request, scopeRoot, rootLocator);
    const key = `${request.kind}:${request.path}`;
    if (requested.has(key)) return protocol('Native analysis requested a duplicate capture');
    requested.add(key);
  }
  if (data.modules.length !== data.module_uses.length) return protocol('Module-use and module catalogs differ');
  const uses = new Set<string>();
  for (const [index, module] of data.modules.entries()) {
    const source = data.sources.find(item => item.locator === module.locator);
    const key = JSON.stringify(module.module_use);
    if (module.id !== index || source === undefined || module.source_revision !== source.revision
        || key !== JSON.stringify(data.module_uses[index]) || uses.has(key)
        || module.module_use.interpretation !== data.interpretation) {
      return protocol('Native module does not bind its actual source and unique module use');
    }
    uses.add(key);
  }
  if (data.state === 'prepared' && (data.analysis === null || data.requests.length !== 0)
      || (data.state === 'conflict' || data.state === 'stopped') && (data.analysis !== null || data.requests.length !== 0)) {
    return protocol('Native preparation state conflicts with its analysis or capture requests');
  }
  if (data.analysis === null) return data;
  const result = data.analysis;
  const names = result.names;
  const validModule = (module: number): boolean => module < data.modules.length;
  const validDeclaration = (declaration: number | null): boolean => declaration === null || declaration < names.declarations.length;
  const validOwner = (owner: number | null, module: number): boolean => owner === null || names.declarations[owner]?.module === module;
  const validType = (ty: number | null): boolean => ty === null || ty < result.type_count;
  const validSource = (source: number): boolean => source < result.sources.length;
  const validOrigin = (module: number, position: z.infer<typeof origin>): boolean => {
    const association = data.modules[module];
    const bytes = association === undefined ? undefined : capturedSources.get(association.locator);
    return bytes !== undefined && (position === null || position.start <= position.end && position.end <= bytes.length);
  };
  const validResolution = (resolution: z.infer<typeof authorNameResolutionSchema>): boolean =>
    (resolution.state !== 'resolved' || validDeclaration(resolution.declaration))
      && resolution.route.every(hop => validModule(hop.module));
  if (names.input_revision !== result.input_basis || !validModule(names.root)
      || names.modules.length !== data.modules.length || names.source_revision !== data.modules[names.root]?.source_revision
      || names.modules.some((module, index) => module.id !== index || !digest.safeParse(module.grammar_revision).success
        || module.module_id !== data.modules[index]?.module_use.module_id
        || module.source_revision !== data.modules[index]?.source_revision)
      || names.declarations.some((item, index) => item.id !== index || !validModule(item.module) || !validOrigin(item.module, item.origin))
      || names.references.some(item => !validModule(item.module) || !validOwner(item.owner, item.module)
        || !validOrigin(item.module, item.origin) || !validResolution(item.resolution))
      || names.exports.some(item => !validModule(item.module) || !validResolution(item.resolution))
      || [...names.reads, ...names.problems, ...names.pending_regions].some(item => !validModule(item.module))) {
    return protocol('Native name analysis contains invalid module, declaration or source associations');
  }
  const lexical = names.lexical;
  const validOccurrence = (id: number): boolean => id < lexical.occurrences.length;
  const validScope = (id: number): boolean => id < lexical.scopes.length;
  const validBinding = (id: number): boolean => id < lexical.bindings.length;
  const occurrenceModule = (id: number): number | undefined => lexical.occurrences[id]?.module;
  const scopeModule = (id: number): number | undefined => occurrenceModule(lexical.scopes[id]?.occurrence ?? -1);
  const bindingModule = (id: number): number | undefined => occurrenceModule(lexical.bindings[id]?.occurrence ?? -1);
  if (lexical.occurrences.some((item, index) => item.id !== index || !validModule(item.module)
      || !validOwner(item.owner, item.module) || !validOrigin(item.module, item.origin))
      || lexical.scopes.some((item, index) => item.id !== index || !validOccurrence(item.occurrence)
        || item.parent !== null && (item.parent >= index || scopeModule(item.parent) !== occurrenceModule(item.occurrence)))
      || lexical.bindings.some((item, index) => item.id !== index || !validScope(item.scope) || !validOccurrence(item.occurrence)
        || scopeModule(item.scope) !== occurrenceModule(item.occurrence) || new Set(item.domains).size !== item.domains.length)
      || lexical.uses.some(item => !validScope(item.scope) || !validOccurrence(item.occurrence)
        || scopeModule(item.scope) !== occurrenceModule(item.occurrence)
        || item.resolution.state === 'resolved' && (!validBinding(item.resolution.binding)
          || bindingModule(item.resolution.binding) !== occurrenceModule(item.occurrence)))
      || lexical.exits.some(item => !validOccurrence(item.occurrence) || item.target.state === 'resolved'
        && (!validScope(item.target.scope) || scopeModule(item.target.scope) !== occurrenceModule(item.occurrence) || (item.kind === 'return'
          ? !['function', 'lambda'].includes(lexical.scopes[item.target.scope]!.kind)
          : lexical.scopes[item.target.scope]!.kind !== 'loop')))
      || lexical.captures.some(item => !validScope(item.scope) || lexical.scopes[item.scope]?.kind !== 'lambda'
        || !validBinding(item.binding) || !validOccurrence(item.occurrence)
        || scopeModule(item.scope) !== occurrenceModule(item.occurrence) || bindingModule(item.binding) !== occurrenceModule(item.occurrence))
      || [...lexical.problems, ...lexical.pending_regions].some(item => !validOccurrence(item.occurrence))) {
    return protocol('Native lexical analysis contains invalid arena edges');
  }
  if (result.sources.some((item, index) => item.id !== index || !validModule(item.module)
      || !validOwner(item.owner, item.module) || !validOrigin(item.module, item.origin))
      || result.signatures.some(item => !validDeclaration(item.declaration) || !validType(item.ty))
      || result.bodies.some(item => !validSource(item.source) || !validType(item.ty))
      || result.needs.some(item => !validSource(item.source))
      || result.problems.some(item => !validDeclaration(item.declaration))
      || result.body_problems.some(item => !validSource(item.source))
      || result.effects.declarations.some(item => !validDeclaration(item.declaration)
        || item.may.some(effect => !validDeclaration(effect.port) || !validDeclaration(effect.resource))
        || item.internal.some(dependency => !validBinding(dependency.binding))
        || item.needs.some(requirement => !validSource(requirement.source)))
      || [...result.effects.needs, ...result.effects.problems].some(item => !validSource(item.source))) {
    return protocol('Native type, body or effect result contains an invalid arena association');
  }
  return data;
}

/** Checks source/target associations in this native result. It does not replay
 * the Resolver, type checker or Method and cannot issue their qualification. */
export function parseAuthorGeneration(
  value: unknown, capturedSources: ReadonlyMap<string, Uint8Array>,
  expected: AuthorAnalysisExpectation & Readonly<{ target?: string }>
): AuthorGenerationResult {
  const parsed = generationResult.safeParse(value);
  if (!parsed.success) return protocol(`Native generation returned an invalid result at ${parsed.error.issues[0]?.path.join('.') ?? ''}`);
  const data = validateCapturedResult(parsed.data, capturedSources, expected);
  if (revision(Buffer.from(`${data.grammar_revision}\n${data.resolver_binding.revision}`)) !== data.interpretation) {
    return protocol('Native generation metadata does not bind the fixed grammar and installed interpretation');
  }
  if (data.analysis?.names.modules.some(module => module.grammar_revision !== data.grammar_revision)) {
    return protocol('Native generation changed grammar within the captured module set');
  }
  const generated = data.generation;
  if (generated === null) {
    if (data.state === 'prepared') return protocol('Prepared generation omitted its actual Method result');
    return data;
  }
  const analyzed = data.analysis;
  if (data.state !== 'prepared' || analyzed === null || generated.input_basis !== analyzed.input_basis
      || generated.method.implementation_revision !== data.resolver_binding.revision) {
    return protocol('Generation is not bound to its actual retained analysis and implementation');
  }
  const provenance = generated.provenance;
  if (provenance !== null) {
    const profile = data.sources.find(source => source.locator === provenance.profile_locator);
    const lock = data.sources.find(source => source.locator === provenance.lock_locator);
    if (profile?.revision !== provenance.profile_source_revision || lock?.revision !== provenance.lock_revision
        || provenance.binding.interpretation !== data.interpretation
        || provenance.binding.slot.target !== provenance.target
        || (expected.target !== undefined && provenance.target !== expected.target)) {
      return protocol('Generation profile provenance does not bind the captured bytes and requested target');
    }
  }
  if (generated.members_complete && (provenance === null || generated.context === null)
      || generated.state === 'complete' && (!generated.members_complete || generated.needs.length !== 0 || generated.problems.length !== 0)
      || generated.state === 'rejected' && generated.problems.length === 0) {
    return protocol('Generation state conflicts with its members, context or residual obligations');
  }
  if (!generated.members_complete && (generated.artifacts.length !== 0 || generated.source_map.length !== 0)
      || generated.members_complete && (generated.artifacts.length !== 1 || generated.artifacts[0]?.path !== 'lib.rs')) {
    return protocol('Generation exposed a partial or unexpected crate-root member set');
  }
  const declarations = analyzed.names.declarations;
  const validDeclaration = (id: number): boolean => id < declarations.length;
  const lines = new Map(generated.artifacts.map(artifact => [artifact.path, artifact.content.split('\n').length]));
  for (const mapping of generated.source_map) {
    const module = data.modules[mapping.source_module];
    const lineCount = lines.get(mapping.artifact);
    if (module === undefined || !validDeclaration(mapping.declaration)
        || declarations[mapping.declaration]?.module !== mapping.source_module
        || declarations[mapping.declaration]?.name !== mapping.definition
        || mapping.source_revision !== module.source_revision || lineCount === undefined
        || mapping.start_line > mapping.end_line || mapping.end_line > lineCount
        || !analyzed.sources.some(source => source.module === mapping.source_module && source.owner === mapping.declaration
          && (source.origin?.pointer ?? source.path) === mapping.source_pointer)) {
      return protocol('Rust source map lost its captured module, declaration, revision or output range');
    }
  }
  const exports = new Set<string>();
  for (const exported of generated.exports) {
    const key = JSON.stringify([exported.root_id, exported.export]);
    const original = analyzed.names.exports.find(entry => entry.module === exported.root_module && entry.name === exported.export)?.resolution;
    if (exports.has(key) || data.modules[exported.root_module] === undefined || !validDeclaration(exported.declaration)
        || original?.state !== 'resolved' || original.declaration !== exported.declaration
        || original.route.length !== exported.route.length || original.route.some((hop, index) => {
          const projected = exported.route[index]!;
          return hop.module !== projected.module || hop.export !== projected.export
            || hop.via_import !== projected.via_import || hop.qualification !== projected.qualification;
        })) {
      return protocol('Rust export contains duplicate roots or invalid source associations');
    }
    exports.add(key);
  }
  const dependencies = new Set<number>();
  for (const dependency of generated.dependencies) {
    if (dependencies.has(dependency.declaration) || !validDeclaration(dependency.declaration)
        || declarations[dependency.declaration]?.module !== dependency.source_module
        || data.modules[dependency.source_module]?.source_revision !== dependency.source_revision
        || dependency.callees.some(callee => !validDeclaration(callee))
        || new Set(dependency.callees).size !== dependency.callees.length) {
      return protocol('Rust dependency result contains invalid same-generation declarations');
    }
    dependencies.add(dependency.declaration);
  }
  return data;
}

export interface AuthorAnalysisOptions { readonly signal?: AbortSignal }
export interface AuthorGenerationOptions extends AuthorAnalysisOptions { readonly target?: string }

/** Original author transport with one capture and budget lifetime. Rust owns
 * Project selection and semantic interpretation. The host executes typed reads. */
export async function analyzeAuthorModule(
  workspaceRoot: string,
  inputPath: string,
  kernelPath: string,
  options: AuthorAnalysisOptions = {}
): Promise<AuthorAnalysisResult> {
  return runCapturedAuthorOperation(workspaceRoot, inputPath, kernelPath, { purpose: 'analyze' }, options);
}

export async function generateAuthorProject(
  workspaceRoot: string, inputPath: string, kernelPath: string, options: AuthorGenerationOptions = {}
): Promise<AuthorGenerationResult> {
  return runCapturedAuthorOperation(workspaceRoot, inputPath, kernelPath,
    { purpose: 'generate', target: options.target }, options);
}

function runCapturedAuthorOperation(
  workspaceRoot: string, inputPath: string, kernelPath: string,
  operation: Readonly<{ purpose: 'analyze' }>, options: AuthorAnalysisOptions
): Promise<AuthorAnalysisResult>;
function runCapturedAuthorOperation(
  workspaceRoot: string, inputPath: string, kernelPath: string,
  operation: Readonly<{ purpose: 'generate'; target?: string }>, options: AuthorAnalysisOptions
): Promise<AuthorGenerationResult>;
async function runCapturedAuthorOperation(
  workspaceRoot: string, inputPath: string, kernelPath: string,
  operation: Readonly<{ purpose: 'analyze' }> | Readonly<{ purpose: 'generate'; target?: string }>,
  options: AuthorAnalysisOptions
): Promise<AuthorAnalysisResult | AuthorGenerationResult> {
  let capture: LocalCapture;
  try {
    capture = new LocalCapture(workspaceRoot, inputPath, performance.now() + RUN_MILLISECONDS, options.signal);
  } catch (error) {
    throwIfNativeAborted(options.signal);
    if (!(error instanceof PhysicalNoFollowError)) throw error;
    throw new CodedFailure(error.code === 'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED' ? 'AUTHOR-ANALYSIS-RESOURCE' : 'AUTHOR-ANALYSIS-INPUT',
      'Author analysis root could not be captured within its retained scope', {}, { cause: error });
  }
  const root = { locator: capture.rootLocator, bytes: Array.from(capture.rootBytes) };
  let budget = { work: 8_000_000, allocation_bytes: 48 * 1024 * 1024 };
  let basis: string | undefined;
  let interpretation: string | undefined;
  while (true) {
    capture.current();
    const serialized = JSON.stringify({
      schema: operation.purpose === 'analyze' ? 'gift.author-analysis-request/1' : 'gift.author-generation-request/1',
      purpose: operation.purpose, root, context: capture.context,
      ...(operation.purpose === 'generate' && operation.target !== undefined ? { target: operation.target } : {}),
      ...(interpretation === undefined ? {} : { interpretation }),
      observations: [...capture.observations.values()], budget
    });
    if (Buffer.byteLength(serialized, 'utf8') > MAXIMUM_TRANSPORT_BYTES) {
      throw new CodedFailure('AUTHOR-ANALYSIS-RESOURCE', 'Author analysis request exceeds its transport byte budget');
    }
    let outcome: Awaited<ReturnType<typeof runCommandBytes>>;
    try {
      outcome = await runCommandBytes(kernelPath, [operation.purpose === 'analyze' ? '--analyze' : '--generate'], {
        cwd: workspaceRoot, input: Buffer.from(serialized), maxStdinBytes: MAXIMUM_TRANSPORT_BYTES,
        maxStdoutBytes: MAXIMUM_OUTPUT_BYTES, maxStderrBytes: 64 * 1024,
        timeoutMs: Math.max(1, Math.floor(capture.deadline - performance.now())), signal: options.signal
      });
    } catch (error) {
      capture.current();
      throw new CodedFailure('AUTHOR-ANALYSIS-TOOL', 'Native author analysis did not produce a settled result', {}, { cause: error });
    }
    capture.current();
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(outcome.stdout)); }
    catch { return protocol('Native author analysis did not return complete UTF-8 JSON'); }
    if (outcome.code !== 0) {
      const failure = z.object({ schema: z.literal('gift.author-compilation-failure/1'), diagnostic }).strict().safeParse(value);
      if (!failure.success) return protocol('Native author analysis failed without its diagnostic');
      throw new CodedFailure(failure.data.diagnostic.code === 'ResourceLimit' ? 'AUTHOR-ANALYSIS-RESOURCE' : 'AUTHOR-ANALYSIS-NATIVE',
        failure.data.diagnostic.message, failure.data.diagnostic);
    }
    const expected = { budget, basis, interpretation, rootLocator: capture.rootLocator };
    const result = operation.purpose === 'analyze' ? parseAuthorAnalysis(value, capture.sources, expected)
      : parseAuthorGeneration(value, capture.sources, { ...expected, target: operation.target });
    basis = result.basis;
    interpretation = result.interpretation;
    budget = result.budget.remaining;
    if (result.state !== 'waiting' || result.requests.length === 0) return result;
    let progress = false;
    for (const request of result.requests) progress = capture.acquire(request) || progress;
    if (!progress) return result;
  }
}
