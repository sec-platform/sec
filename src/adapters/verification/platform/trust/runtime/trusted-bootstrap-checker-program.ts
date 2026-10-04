import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';
import { trustedBootstrapDigest } from '../../../../../execution/verification/trusted-bootstrap.ts';

import {
  inspectNoFollowDirectoryChain, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertTrustedBootstrapExactGitIdentity, readTrustedBootstrapSourceFacts,
  trustedBootstrapGitBytes
} from './trusted-bootstrap-checker-native.ts';

const ENTRY = 'src/bootstrap/development/trusted-bootstrap-verification.ts' as const;
const OUTPUT = 'checker.mjs' as const;
const MAXIMUM_CHECKER_BYTES = 8 * 1024 * 1024;

function actualTrustedSourceBytes(trustedRoot: string, input: string): Uint8Array {
  if (!input.endsWith('.ts') || !CodexDevelopmentIsCanonicalRepositoryPath(input)) {
    throw new Error('Bun selected a noncanonical checker source input.');
  }
  const tracked = trustedBootstrapGitBytes(trustedRoot,
    ['ls-files', '--stage', '-z', '--', `:(literal)${input}`]).toString('utf8');
  const records = tracked.split('\0').filter(Boolean);
  const stage = records.length === 1 ? /^100644 [0-9a-f]{40} 0\t(.+)$/u.exec(records[0]!) : null;
  if (stage === null || stage[1] !== input) {
    throw new Error('Bun source input is not one exact stage-zero ordinary Git file.');
  }
  const sourcePath = path.join(trustedRoot, ...input.split('/'));
  const sourceParent = inspectNoFollowDirectoryChain(path.dirname(sourcePath), 'Trusted checker source parent');
  const bytes = readNoFollowOrdinaryFile(sourceParent.target, path.basename(sourcePath),
    { maximumBytes: MAXIMUM_CHECKER_BYTES });
  if (bytes === null || !Buffer.from(bytes).equals(
    trustedBootstrapGitBytes(trustedRoot, ['cat-file', 'blob', `HEAD:${input}`]))) {
    throw new Error('Bun consumed source bytes outside exact trusted-base Git.');
  }
  const source = ts.createSourceFile(input, new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  if ((source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
    throw new Error('Trusted checker bundle input has invalid TypeScript syntax.');
  }
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)
        && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
        && (input !== ENTRY || !['main', 'path'].includes(node.name.text))) {
      throw new Error('Trusted checker bundle would relocate a source-relative import.meta resource.');
    }
    if (ts.isIdentifier(node) && node.text === '__dirname') {
      throw new Error('Trusted checker bundle would relocate a source-relative directory resource.');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bytes;
}

function assertActualBundledSourceInputs(trustedRoot: string, inputs: readonly string[],
  captured: ReadonlyMap<string, Uint8Array>): void {
  if (!inputs.includes(ENTRY) || !inputs.includes('src/application/trusted-bootstrap-verification.ts')
      || inputs.length !== new Set(inputs).size || inputs.length !== captured.size
      || inputs.some(input => !captured.has(input))) {
    throw new Error('Bun metafile and consumed trusted source inputs do not form one exact closure.');
  }
  for (const input of inputs) {
    const later = actualTrustedSourceBytes(trustedRoot, input);
    if (!Buffer.from(later).equals(captured.get(input)!)) {
      throw new Error('Trusted checker source changed after Bun consumed its captured bytes.');
    }
  }
}

/** Materialize the one PRE program from already installed, exact trusted-base
 * source. This is a bounded build owner, never a general JS publisher. */
export async function materializeTrustedBootstrapCheckerProgram(outputPath: string): Promise<Readonly<{
  path: string; byteDigest: `sha256:${string}`; byteLength: number;
}>> {
  const facts = readTrustedBootstrapSourceFacts();
  if (process.cwd() !== facts.trustedRoot || !path.isAbsolute(outputPath)
      || path.resolve(outputPath) !== outputPath) {
    throw new Error('Checker materialization is outside the exact trusted-base invocation.');
  }
  const evidenceRoot = process.env.BOOTSTRAP_EVIDENCE_ROOT;
  if (typeof evidenceRoot !== 'string' || !path.isAbsolute(evidenceRoot)
      || path.resolve(evidenceRoot) !== evidenceRoot
      || outputPath !== path.join(evidenceRoot, OUTPUT)) {
    throw new Error('Checker materialization output is not its fixed PRE artifact slot.');
  }
  const parent = inspectNoFollowDirectoryChain(evidenceRoot, 'Trusted bootstrap PRE evidence root');
  const entrypoint = path.join(facts.trustedRoot, ENTRY);
  const consumed = new Map<string, Uint8Array>();
  const result = await Bun.build({
    entrypoints: [entrypoint], target: 'bun', format: 'esm', splitting: false,
    sourcemap: 'none', minify: false, metafile: true,
    plugins: [{ name: 'trusted-bootstrap-exact-git-source', setup(builder) {
      builder.onLoad({ filter: /\.ts$/u, namespace: 'file' }, args => {
        const input = path.relative(facts.trustedRoot, args.path).replaceAll('\\', '/');
        const bytes = actualTrustedSourceBytes(facts.trustedRoot, input);
        const prior = consumed.get(input);
        if (prior !== undefined && !Buffer.from(prior).equals(bytes)) {
          throw new Error('Bun selected changing source bytes within one checker build.');
        }
        consumed.set(input, bytes);
        return { contents: bytes, loader: 'ts' };
      });
    } }]
  });
  if (!result.success || result.outputs.length !== 1 || result.metafile === undefined) {
    throw new Error('Trusted bootstrap checker build did not emit one executable program.');
  }
  const sourceInputs = Object.keys(result.metafile.inputs);
  assertActualBundledSourceInputs(facts.trustedRoot, sourceInputs, consumed);
  const bytes = Buffer.from(await result.outputs[0]!.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAXIMUM_CHECKER_BYTES) {
    throw new Error('Trusted bootstrap checker program bytes are empty or unbounded.');
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const compiled = ts.createSourceFile(OUTPUT, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const parseDiagnostics = (compiled as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) throw new Error('Emitted trusted checker is not valid JavaScript.');
  for (const statement of compiled.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        && statement.moduleSpecifier !== undefined) {
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)
          || (!isBuiltin(statement.moduleSpecifier.text)
            && !statement.moduleSpecifier.text.startsWith('bun:'))) {
        throw new Error('Emitted checker has an unbound static import.');
      }
    }
  }
  let dynamicImports = 0;
  const countDynamicImports = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      dynamicImports += 1;
    }
    ts.forEachChild(node, countDynamicImports);
  };
  countDynamicImports(compiled);
  if (dynamicImports !== 2) {
    throw new Error('Emitted checker import closure is not the two fixed trusted-base native loaders.');
  }
  if (!source.includes('src/adapters/verification/platform/trust/runtime/closure-lock.ts')
      || !source.includes('src/adapters/verification/platform/trust/contract/root.ts')) {
    throw new Error('Emitted checker lost its two exact trusted-base native module addresses.');
  }
  assertTrustedBootstrapExactGitIdentity(facts);
  const byteDigest = trustedBootstrapDigest(bytes);
  publishExclusiveDurableCanonicalFile({ parent: parent.target, name: OUTPUT, bytes,
    validate: observed => {
      if (trustedBootstrapDigest(observed) !== byteDigest
          || !Buffer.from(observed).equals(bytes)) throw new Error('Trusted checker program publication drifted.');
    } });
  const readback = readNoFollowOrdinaryFile(parent.target, OUTPUT, { maximumBytes: MAXIMUM_CHECKER_BYTES });
  if (readback === null || !Buffer.from(readback).equals(bytes)) {
    throw new Error('Trusted checker program final readback differs.');
  }
  assertTrustedBootstrapExactGitIdentity(facts);
  return Object.freeze({ path: outputPath, byteDigest, byteLength: bytes.length });
}
