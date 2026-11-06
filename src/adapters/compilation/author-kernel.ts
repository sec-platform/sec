import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CodedFailure } from '../../contracts/failure.ts';
import { resolvePathInside } from '../../contracts/relative-path.ts';
import { runCommandBytes } from '../runtime-state/physical/runtime/process.ts';
import { readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';

// Transport validation only. Rust owns interpretation; this host never parses or rewrites author JSON.
const artifact = z.object({ path: z.string(), content: z.string() }).strict();
const bundle = z.object({
  schema: z.literal('gift.author-compilation/1'),
  module_id: z.string().min(1),
  source_revision: z.string(),
  semantic_revision: z.string(),
  method: z.literal('gift:finite-ordered-records/2'),
  artifacts: z.array(artifact),
  source_map: z.array(z.object({
    definition: z.string(), source_pointer: z.string(), source_revision: z.string(),
    artifact: z.string(), start_line: z.number().int().positive(), end_line: z.number().int().positive()
  }).strict())
}).passthrough();

export type AuthorCompilationBundle = z.infer<typeof bundle>;

const nodeId = z.number().int().nonnegative();
const origin = z.object({ pointer: z.string(), start: nodeId, end: nodeId }).strict().nullable();
const wireNode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('null'), origin }).strict(),
  z.object({ kind: z.literal('bool'), value: z.boolean(), origin }).strict(),
  z.object({ kind: z.literal('number'), value: z.string(), origin }).strict(),
  z.object({ kind: z.literal('string'), value: z.string(), origin }).strict(),
  z.object({ kind: z.literal('array'), value: z.array(nodeId), origin }).strict(),
  z.object({ kind: z.literal('object'), value: z.record(z.string(), nodeId), origin }).strict()
]);
const readOutput = z.object({
  schema: z.literal('gift.author-read/1'), stage: z.literal('structural'),
  source_format: z.enum(['gift.author-module/design-converged', 'gift.project/design-converged']),
  source_revision: z.string(), grammar_revision: z.string(),
  source_root: nodeId, expanded_root: nodeId, nodes: z.array(wireNode)
}).strict();
export type AuthorReadOutput = z.infer<typeof readOutput>;

const exportHop = z.object({
  module: nodeId, export: z.string(), via_import: z.string().nullable(),
  qualification: z.enum(['capture-local', 'pending-lock-and-module-use'])
}).strict();
const resolution = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), declaration: nodeId, route: z.array(exportHop) }).strict(),
  z.object({ state: z.literal('needs'), code: z.string(), selector: z.string(), route: z.array(exportHop) }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string(), selector: z.string(), route: z.array(exportHop) }).strict()
]);
const lexicalPhase = z.enum(['static', 'runtime', 'unknown']);
const lexicalDomain = z.enum(['semantic', 'value']);
const binderResolution = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), binding: nodeId }).strict(),
  z.object({ state: z.literal('needs'), code: z.string() }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string() }).strict()
]);
const controlResolution = z.discriminatedUnion('state', [
  z.object({ state: z.literal('resolved'), scope: nodeId }).strict(),
  z.object({ state: z.literal('needs'), code: z.string() }).strict(),
  z.object({ state: z.literal('rejected'), code: z.string() }).strict()
]);
const lexicalProblem = z.object({ occurrence: nodeId, code: z.string() }).strict();
const lexicalOutput = z.object({
  occurrences: z.array(z.object({ id: nodeId, module: nodeId, owner: nodeId.nullable(),
    expanded_path: z.string(), origin, schema_slot: z.string() }).strict()),
  scopes: z.array(z.object({ id: nodeId, parent: nodeId.nullable(), occurrence: nodeId,
    kind: z.enum(['definition', 'function', 'lambda', 'block', 'let', 'branch', 'match_arm', 'handler', 'try_body', 'loop', 'semantic']) }).strict()),
  bindings: z.array(z.object({ id: nodeId, scope: nodeId, occurrence: nodeId, source_key: z.string().nullable(),
    name: z.string(), kind: z.enum(['runtime_parameter', 'let', 'var', 'pattern', 'handler', 'Type', 'Value', 'Region', 'Scope', 'EffectRow', 'constructor', 'pack']),
    domains: z.array(lexicalDomain).min(1).max(2), phase: lexicalPhase, mutable: z.boolean() }).strict()),
  uses: z.array(z.object({ occurrence: nodeId, scope: nodeId, domain: lexicalDomain, selector: z.string(),
    phase: lexicalPhase, expected_kind: z.string().nullable(), resolution: binderResolution }).strict()),
  exits: z.array(z.object({ occurrence: nodeId, kind: z.enum(['return', 'break', 'continue']), target: controlResolution }).strict()),
  captures: z.array(z.object({ scope: nodeId, binding: nodeId, occurrence: nodeId }).strict()),
  problems: z.array(lexicalProblem), pending_regions: z.array(lexicalProblem)
}).strict();
const namesOutput = z.object({
  schema: z.literal('gift.author-names/2'), stage: z.literal('names'), identity_scope: z.literal('capture-local'),
  input_revision: z.string(), source_revision: z.string(), root: nodeId,
  modules: z.array(z.object({ id: nodeId, module_id: z.string(), source_revision: z.string(), grammar_revision: z.string() }).strict()),
  declarations: z.array(z.object({ id: nodeId, module: nodeId, name: z.string(), kind: z.string(), origin }).strict()),
  references: z.array(z.object({ module: nodeId, owner: nodeId.nullable(), expanded_path: z.string(), origin,
    schema_slot: z.string(), domain: z.enum(['source-reference', 'declaration-selector', 'profile-selector', 'dialect-consumer']), resolution }).strict()),
  exports: z.array(z.object({ module: nodeId, name: z.string(), resolution }).strict()),
  reads: z.array(z.object({ module: nodeId, domain: z.string(), name: z.string() }).strict()),
  problems: z.array(z.object({ module: nodeId, path: z.string(), code: z.string() }).strict()),
  pending_regions: z.array(z.object({ module: nodeId, path: z.string(), code: z.string() }).strict()),
  lexical: lexicalOutput,
  unchecked: z.array(z.string())
}).strict();
export type AuthorNameAnalysis = z.infer<typeof namesOutput>;

/** Validate the native wire against the captured bytes. This checks transport
 * integrity only; it does not issue lexical, type, runtime or effect authority. */
export function parseAuthorNameAnalysis(value: unknown, bytes: Uint8Array): AuthorNameAnalysis {
  const parsed = namesOutput.safeParse(value);
  if (!parsed.success) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author name analyzer returned an invalid result');
  const data = parsed.data;
  const sourceRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (data.source_revision !== sourceRevision || data.modules.some(module => module.source_revision !== sourceRevision)) {
    throw new CodedFailure('AUTHOR-COMPILE-REVISION', 'Name analysis does not bind the exact captured author bytes');
  }
  const validOrigin = (item: z.infer<typeof origin>): boolean => item === null || (item.start <= item.end && item.end <= bytes.length);
  const validOwner = (owner: number | null): boolean => owner === null || owner < data.declarations.length;
  const validResolution = (item: z.infer<typeof resolution>): boolean =>
    (item.state !== 'resolved' || item.declaration < data.declarations.length) && item.route.every(hop => hop.module === 0);
  if (data.root !== 0 || data.modules.length !== 1 || data.modules[0]?.id !== 0 ||
    data.declarations.some((declaration, index) => declaration.id !== index || declaration.module !== 0 || !validOrigin(declaration.origin)) ||
    data.references.some(reference => reference.module !== 0 || !validOwner(reference.owner) ||
      !validOrigin(reference.origin) || !validResolution(reference.resolution)) ||
    data.exports.some(item => item.module !== 0 || !validResolution(item.resolution)) ||
    [...data.reads, ...data.problems, ...data.pending_regions].some(item => item.module !== 0)) {
    throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Name analysis contains an invalid capture ID, reference or source range');
  }
  const arena = data.lexical;
  const occurrenceExists = (id: number): boolean => id < arena.occurrences.length;
  const scopeExists = (id: number): boolean => id < arena.scopes.length;
  const bindingExists = (id: number): boolean => id < arena.bindings.length;
  if (arena.occurrences.some((item, index) => item.id !== index || item.module !== 0 || !validOwner(item.owner) || !validOrigin(item.origin)) ||
    arena.scopes.some((item, index) => item.id !== index || !occurrenceExists(item.occurrence) || (item.parent !== null && item.parent >= index)) ||
    arena.bindings.some((item, index) => item.id !== index || !scopeExists(item.scope) || !occurrenceExists(item.occurrence) ||
      new Set(item.domains).size !== item.domains.length) ||
    arena.uses.some(item => !scopeExists(item.scope) || !occurrenceExists(item.occurrence) ||
      (item.resolution.state === 'resolved' && !bindingExists(item.resolution.binding))) ||
    arena.exits.some(item => !occurrenceExists(item.occurrence) || (item.target.state === 'resolved' &&
      (!scopeExists(item.target.scope) || (item.kind === 'return'
        ? !['function', 'lambda'].includes(arena.scopes[item.target.scope]!.kind)
        : arena.scopes[item.target.scope]!.kind !== 'loop')))) ||
    arena.captures.some(item => !scopeExists(item.scope) || arena.scopes[item.scope]?.kind !== 'lambda' ||
      !bindingExists(item.binding) || !occurrenceExists(item.occurrence)) ||
    [...arena.problems, ...arena.pending_regions].some(item => !occurrenceExists(item.occurrence))) {
    throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Lexical analysis contains an invalid arena ID, edge, control target or source range');
  }
  return data;
}

export function compileAuthorModule(workspaceRoot: string, inputFile: string, kernelFile: string): Promise<AuthorCompilationBundle>;
export function compileAuthorModule(workspaceRoot: string, inputFile: string, kernelFile: string, readOnly: true): Promise<AuthorReadOutput>;
export function compileAuthorModule(workspaceRoot: string, inputFile: string, kernelFile: string, readOnly: boolean): Promise<AuthorCompilationBundle | AuthorReadOutput>;
export function compileAuthorModule(workspaceRoot: string, inputFile: string, kernelFile: string, mode: 'names'): Promise<AuthorNameAnalysis>;
export function compileAuthorModule(workspaceRoot: string, inputFile: string, kernelFile: string, mode: boolean | 'names'): Promise<AuthorCompilationBundle | AuthorReadOutput | AuthorNameAnalysis>;

/** Explicit local compiler invocation. Generation returns a bundle; it does not write target files,
 * install a compiler, execute target code, or acquire project/default-branch mutation authority. */
export async function compileAuthorModule(
  workspaceRoot: string,
  inputFile: string,
  kernelFile: string,
  mode: boolean | 'names' = false
): Promise<AuthorCompilationBundle | AuthorReadOutput | AuthorNameAnalysis> {
  const inputPath = resolvePathInside(workspaceRoot, inputFile);
  const kernelPath = resolvePathInside(workspaceRoot, kernelFile);
  if (inputPath === null || kernelPath === null) {
    throw new CodedFailure('AUTHOR-COMPILE-PATH', 'Author input and compiler must be workspace-relative paths without parent traversal');
  }
  const bytes = readOptionalRetainedOrdinaryFile(inputPath, 'Gift author source');
  if (bytes === null) throw new CodedFailure('AUTHOR-COMPILE-INPUT', 'Gift author source is missing');
  if (bytes.length > 4 * 1024 * 1024) throw new CodedFailure('AUTHOR-COMPILE-LIMIT', 'Gift author source exceeds the input budget');
  const result = await runCommandBytes(kernelPath, mode === 'names' ? ['--names'] : mode ? ['--read'] : [], {
    cwd: workspaceRoot, input: bytes, maxStdinBytes: 4 * 1024 * 1024,
    maxStdoutBytes: 64 * 1024 * 1024, maxStderrBytes: 64 * 1024, timeoutMs: 30_000
  });
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)); }
  catch { throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author compiler did not return a complete UTF-8 JSON result'); }
  if (result.code !== 0) {
    const failure = z.object({ schema: z.literal('gift.author-compilation-failure/1'), diagnostic: z.object({
      code: z.string(), path: z.string(), message: z.string()
    }).strict() }).strict().safeParse(value);
    if (!failure.success) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author compiler failed without a diagnostic');
    const { code, path, message } = failure.data.diagnostic;
    throw new CodedFailure('AUTHOR-COMPILE-REJECTED', `${code} at ${path || '/'}: ${message}`);
  }
  if (mode === 'names') {
    return parseAuthorNameAnalysis(value, bytes);
  }
  const sourceRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (mode) {
    const parsed = readOutput.safeParse(value);
    if (!parsed.success) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author Reader returned an invalid structural result');
    const data = parsed.data;
    if (data.source_revision !== sourceRevision) throw new CodedFailure('AUTHOR-COMPILE-REVISION', 'Reader output does not bind the exact captured author bytes');
    if (data.source_root >= data.nodes.length || data.expanded_root >= data.nodes.length || data.nodes.some((node, index) => {
      const children = node.kind === 'array' ? node.value : node.kind === 'object' ? Object.values(node.value) : [];
      return children.some(child => child >= index) || (node.origin !== null && (node.origin.start > node.origin.end || node.origin.end > bytes.length));
    })) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Reader graph contains invalid edges or source ranges');
    return data;
  }
  const parsed = bundle.safeParse(value);
  if (!parsed.success) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author compiler returned an invalid artifact bundle');
  if (parsed.data.source_revision !== sourceRevision || parsed.data.source_map.some(mapping => mapping.source_revision !== sourceRevision)) {
    throw new CodedFailure('AUTHOR-COMPILE-REVISION', 'Compiler output does not bind the exact captured author bytes');
  }
  return parsed.data;
}
