/** Build-time only: keep the pre-checkout GitHub scripts on the provider's one decoder. */
import path from 'node:path';

import ts from 'typescript';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { publishExpectedCanonicalWorkspaceFile } from '../../filesystem/file-publication.ts';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease } from '../../filesystem/write-lease.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8 } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compileSourceProgramEmbeddedWorkflowPrograms } from '../source-program-model/embedded-programs.ts';

const NORMALIZER_PATH = 'src/adapters/providers/github-api/repository-permission.ts';
const NORMALIZER_NAME = 'normalizeGitHubRepositoryPermission';
const BEGIN = '// BEGIN GENERATED repository-permission.ts';
const END = '// END GENERATED repository-permission.ts';
const SCRIPT_PROVIDER = 'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3';
const TARGETS = [
  ['.github/workflows/merge-gate.yml', 'jobs/plan/steps/0/github-script'],
  ['.github/workflows/compiler-pr-validation.yml', 'jobs/validate-hosted-request/steps/0/github-script'],
  ['.github/workflows/compiler-pr-validation.yml', 'jobs/validate-agent-operation-activation-request/steps/0/github-script'],
  ['.github/workflows/repository-maintenance.yml', 'jobs/retire/steps/0/github-script'],
  ['.github/workflows/trusted-bootstrap.yml', 'jobs/resolve/steps/0/github-script']
] as const;

export type PermissionBootstrapProjectionChange = Readonly<{
  path: string;
  before: string;
  after: string;
}>;

function fail(message: string): never {
  throw new Error(`Permission bootstrap projection: ${message}`);
}

function bindSource(file: ts.SourceFile): ts.Program {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === file.fileName ? file : undefined;
  host.fileExists = (name) => name === file.fileName;
  host.readFile = (name) => name === file.fileName ? file.text : undefined;
  return ts.createProgram([file.fileName], options, host);
}

/** Parse, bind and erase types; never import or evaluate the source being projected. */
function emitNormalizer(source: string): string {
  const file = ts.createSourceFile(NORMALIZER_PATH, source, ts.ScriptTarget.ES2022, true);
  const program = bindSource(file);
  if (program.getSyntacticDiagnostics(file).length !== 0) fail('canonical source is not valid TypeScript');
  const functions = file.statements.filter(ts.isFunctionDeclaration);
  const fn = functions[0];
  if (functions.length !== 1 || fn?.name?.text !== NORMALIZER_NAME || fn.body === undefined ||
      !fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
      fn.asteriskToken !== undefined || fn.modifiers?.some((modifier) =>
        modifier.kind !== ts.SyntaxKind.ExportKeyword) ||
      file.statements.some((statement) => statement !== fn && !ts.isTypeAliasDeclaration(statement))) {
    fail('canonical source must contain one ordinary exported function and erased type aliases only');
  }
  const checker = program.getTypeChecker();
  const inspect = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword ||
        node.kind === ts.SyntaxKind.ImportKeyword) fail('unsupported runtime dependency');
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
        !(ts.isPropertyAssignment(node.parent) && node.parent.name === node && !ts.isComputedPropertyName(node.parent.name))) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      if (!declarations.some((declaration) => declaration.getSourceFile() === file &&
          declaration.pos >= fn.pos && declaration.end <= fn.end) &&
          !['Array', 'undefined'].includes(node.text)) {
        fail(`unsupported free runtime dependency ${node.text}`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(fn);
  const declaration = ts.factory.updateFunctionDeclaration(fn, undefined, undefined, fn.name,
    fn.typeParameters, fn.parameters, fn.type, fn.body);
  const text = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
    .printNode(ts.EmitHint.Unspecified, declaration, file);
  const emitted = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Legacy, alwaysStrict: true,
      newLine: ts.NewLineKind.LineFeed, removeComments: true },
    reportDiagnostics: true
  });
  if (emitted.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    fail(`canonical function cannot be emitted: ${emitted.diagnostics?.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')).join('; ')}`);
  }
  const output = ts.createSourceFile('permission.js', emitted.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const declarations = output.statements.filter((statement) => !(ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) && statement.expression.text === 'use strict'));
  const outputFunction = declarations[0];
  if (declarations.length !== 1 || outputFunction === undefined || !ts.isFunctionDeclaration(outputFunction) ||
      outputFunction.modifiers?.length) fail('emission introduced a runtime wrapper or module dependency');
  // The host script owns strict mode; do not turn a compiler directive into a workflow behavior change.
  const javascript = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
    .printNode(ts.EmitHint.Unspecified, outputFunction, output);
  if (javascript.includes('${{')) fail('emitted source contains Actions interpolation');
  return `${BEGIN}\n${javascript}\n${END}`;
}

function required(sources: ReadonlyMap<string, string | null>, repositoryPath: string): string {
  const source = sources.get(repositoryPath);
  if (source === undefined || source === null) fail(`missing source ${repositoryPath}`);
  return source;
}

/** Exact targets only. The result describes edits; compilation/checking never writes. */
export function compilePermissionBootstrapProjection(
  sources: ReadonlyMap<string, string | null>
): readonly PermissionBootstrapProjectionChange[] {
  const generated = emitNormalizer(required(sources, NORMALIZER_PATH));
  const changes: PermissionBootstrapProjectionChange[] = [];
  for (const repositoryPath of new Set(TARGETS.map(([ownerPath]) => ownerPath))) {
    const before = required(sources, repositoryPath);
    const targets = TARGETS.filter(([ownerPath]) => ownerPath === repositoryPath);
    const units = compileSourceProgramEmbeddedWorkflowPrograms({
      path: repositoryPath, source: before, contentDigest: rawSha256(before)
    });
    if (before.split(BEGIN).length - 1 !== targets.length || before.split(END).length - 1 !== targets.length) {
      fail(`missing or duplicate generated regions in ${repositoryPath}`);
    }
    const replacements = targets.map(([, address]) => {
      const matching = units.filter((unit) => unit.address === address);
      const unit = matching[0];
      if (matching.length !== 1 || unit === undefined || unit.provider !== SCRIPT_PROVIDER ||
          unit.source.split(BEGIN).length !== 2 || unit.source.split(END).length !== 2) {
        fail(`missing, duplicate or unpinned script ${repositoryPath}:${address}`);
      }
      const scalar = before.slice(unit.span.start, unit.span.end);
      const begin = scalar.indexOf(BEGIN);
      const end = scalar.indexOf(END);
      if (begin < 0 || end < begin) fail(`invalid generated region ${repositoryPath}:${address}`);
      const lineStart = scalar.lastIndexOf('\n', begin) + 1;
      const indentation = scalar.slice(lineStart, begin);
      if (!/^ +$/u.test(indentation) || scalar.slice(end + END.length).split('\n')[0]!.trim() !== '') {
        fail(`generated markers must occupy ordinary block-scalar lines: ${repositoryPath}:${address}`);
      }
      const scriptStart = unit.source.indexOf(BEGIN);
      const scriptEnd = unit.source.indexOf(END) + END.length;
      const projectedScript = unit.source.slice(0, scriptStart) + generated + unit.source.slice(scriptEnd);
      const parsed = ts.createSourceFile('permission-bootstrap.js', projectedScript, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const declarations = parsed.statements.filter((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === NORMALIZER_NAME);
      if (declarations.length !== 1 || declarations[0]!.getStart(parsed) !== scriptStart + BEGIN.length + 1 ||
          declarations[0]!.end > scriptStart + generated.indexOf(END)) {
        fail(`generated function is not one top-level declaration: ${repositoryPath}:${address}`);
      }
      // Model github-script's async-function host so lexical captures and syntax are checked
      // where the generated function will actually bind, rather than as an isolated snippet.
      const hostFile = ts.createSourceFile('permission-host.js',
        `async function __permissionBootstrapHost() {\n${projectedScript}\n}`, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      const hostProgram = bindSource(hostFile);
      if (hostProgram.getSyntacticDiagnostics(hostFile).length !== 0) fail(`malformed host script ${repositoryPath}:${address}`);
      const hostFunction = hostFile.statements[0] as ts.FunctionDeclaration;
      const binding = hostFunction.body!.statements.find((statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === NORMALIZER_NAME)!;
      const hostChecker = hostProgram.getTypeChecker();
      const inspectBinding = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && (node.text === 'Array' || node.text === 'undefined') &&
            !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
          const symbol = hostChecker.getSymbolAtLocation(node);
          if (symbol?.declarations?.some((declaration) => declaration.pos < binding.pos || declaration.end > binding.end)) {
            fail(`host script captures canonical intrinsic ${node.text}: ${repositoryPath}:${address}`);
          }
        }
        ts.forEachChild(node, inspectBinding);
      };
      inspectBinding(binding);
      const newline = before.includes('\r\n') ? '\r\n' : '\n';
      return { start: unit.span.start + begin, end: unit.span.start + end + END.length,
        text: generated.split('\n').join(`${newline}${indentation}`) };
    }).sort((left, right) => right.start - left.start);
    let after = before;
    for (const replacement of replacements) {
      after = after.slice(0, replacement.start) + replacement.text + after.slice(replacement.end);
    }
    changes.push(Object.freeze({ path: repositoryPath, before, after }));
  }
  return Object.freeze(changes);
}

/** Explicit local maintenance only. CLI selection is not workspace Effect authorization. */
export async function synchronizePermissionBootstrapProjection(root: string, mode: 'check' | 'write'): Promise<readonly string[]> {
  if (mode !== 'check' && mode !== 'write') fail('mode must be check or write');
  const workspaceRoot = inspectNoFollowDirectoryChain(path.resolve(root), 'Permission projection workspace').target.path;
  const sources = new Map<string, string>();
  const observations = [...new Set([NORMALIZER_PATH, ...TARGETS.map(([ownerPath]) => ownerPath)])].map((repositoryPath) => {
    const absolute = path.join(workspaceRoot, repositoryPath);
    const parent = inspectNoFollowDirectoryChain(path.dirname(absolute), `Permission projection ${repositoryPath}`).target;
    const name = path.basename(absolute);
    const observed = inspectNoFollowOrdinaryFileEntry(parent, name, { maximumBytes: 2 * 1024 * 1024 });
    if (observed === null || observed.kind !== 'file' || observed.bytes === null) fail(`missing ordinary source ${repositoryPath}`);
    sources.set(repositoryPath, decodeExactUtf8(observed.bytes, repositoryPath));
    return { path: repositoryPath, parent, name, observed };
  });
  // Compile and validate every destination before even acquiring a mutating lease.
  const stale = compilePermissionBootstrapProjection(sources).filter(({ before, after }) => before !== after);
  const paths = Object.freeze(stale.map(({ path: repositoryPath }) => repositoryPath));
  if (mode === 'check' || stale.length === 0) return paths;
  return withWorkspaceWriteLease(workspaceRoot, undefined, async (token) => {
    const leaseFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
    const commitFence = async () => {
      await leaseFence();
      for (const input of observations) {
        const current = inspectNoFollowOrdinaryFileEntry(input.parent, input.name, { maximumBytes: 2 * 1024 * 1024 });
        if (current === null || current.kind !== 'file' || current.bytes === null ||
            current.device !== input.observed.device || current.inode !== input.observed.inode ||
            decodeExactUtf8(current.bytes, input.path) !== sources.get(input.path)) fail(`preimage changed: ${input.path}`);
      }
    };
    await commitFence();
    for (const change of stale) {
      await publishExpectedCanonicalWorkspaceFile({
        workspaceRoot, targetPath: path.join(workspaceRoot, change.path),
        expectedBytes: Buffer.from(change.before), bytes: Buffer.from(change.after),
        label: `Permission bootstrap projection ${change.path}`, commitFence
      });
      const input = observations.find(({ path: repositoryPath }) => repositoryPath === change.path)!;
      const current = inspectNoFollowOrdinaryFileEntry(input.parent, input.name, { maximumBytes: 2 * 1024 * 1024 });
      if (current === null || current.kind !== 'file' || current.bytes === null ||
          decodeExactUtf8(current.bytes, change.path) !== change.after) fail(`publication readback differs: ${change.path}`);
      input.observed = current;
      sources.set(change.path, change.after);
    }
    await commitFence();
    return paths;
  });
}

if (import.meta.main) {
  const [mode, ...extra] = process.argv.slice(2);
  if ((mode !== '--check' && mode !== '--write') || extra.length !== 0) {
    fail('usage: bun src/adapters/repository/repository-audit/permission-bootstrap-projection.ts --check|--write');
  }
  const paths = await synchronizePermissionBootstrapProjection(process.cwd(), mode === '--write' ? 'write' : 'check');
  if (mode === '--check' && paths.length !== 0) {
    process.stderr.write(`Stale permission bootstrap projections: ${paths.join(', ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${mode === '--write' ? 'Updated' : 'Checked'} permission bootstrap projections (${paths.length} changed files).\n`);
  }
}
