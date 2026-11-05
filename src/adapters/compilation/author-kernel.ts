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

/** Explicit local compiler invocation. Generation returns a bundle; it does not write target files,
 * install a compiler, execute target code, or acquire project/default-branch mutation authority. */
export async function compileAuthorModule(
  workspaceRoot: string,
  inputFile: string,
  kernelFile: string
): Promise<AuthorCompilationBundle> {
  const inputPath = resolvePathInside(workspaceRoot, inputFile);
  const kernelPath = resolvePathInside(workspaceRoot, kernelFile);
  if (inputPath === null || kernelPath === null) {
    throw new CodedFailure('AUTHOR-COMPILE-PATH', 'Author input and compiler must be workspace-relative paths without parent traversal');
  }
  const bytes = readOptionalRetainedOrdinaryFile(inputPath, 'Gift author source');
  if (bytes === null) throw new CodedFailure('AUTHOR-COMPILE-INPUT', 'Gift author source is missing');
  if (bytes.length > 4 * 1024 * 1024) throw new CodedFailure('AUTHOR-COMPILE-LIMIT', 'Gift author source exceeds the input budget');
  const sourceRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const result = await runCommandBytes(kernelPath, [], {
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
  const parsed = bundle.safeParse(value);
  if (!parsed.success) throw new CodedFailure('AUTHOR-COMPILE-PROTOCOL', 'Author compiler returned an invalid artifact bundle');
  if (parsed.data.source_revision !== sourceRevision || parsed.data.source_map.some(mapping => mapping.source_revision !== sourceRevision)) {
    throw new CodedFailure('AUTHOR-COMPILE-REVISION', 'Compiler output does not bind the exact captured author bytes');
  }
  return parsed.data;
}
