import ts from 'typescript';
import { isMap, isScalar, isSeq } from 'yaml';

import { rawSha256 } from '../../../contracts/canonical.ts';
import { parseYamlDocument } from '../../formats/yaml.ts';
import type { RepositoryModuleGraphImport } from '../architecture/contract.ts';
import {
  isSourceProgramInputPath,
  sourceProgramSurfaceForPath,
  type SourceProgramFileInput,
  type SourceProgramSpan
} from './contract.ts';

const WORKFLOW_MAXIMUM_BYTES = 2 * 1024 * 1024;

function isWorkflowSourceProgramInput(repositoryPath: string): boolean {
  return isSourceProgramInputPath(repositoryPath)
    && sourceProgramSurfaceForPath(repositoryPath) === 'workflow';
}

type SourceProgramEmbeddedProgramLanguage = 'javascript' | 'shell';
type SourceProgramEmbeddedProgramKind = 'github-script' | 'workflow-run';

type SourceProgramEmbeddedProgramUnknown = Readonly<{
  code:
    | 'embedded-javascript-dynamic-source'
    | 'embedded-provider-revision-unresolved'
    | 'embedded-relative-module-base-unresolved'
    | 'embedded-shell-import-closure-unresolved';
  detail: string;
}>;

export type SourceProgramEmbeddedProgramUnit = Readonly<{
  ownerPath: string;
  address: string;
  name: string;
  kind: SourceProgramEmbeddedProgramKind;
  language: SourceProgramEmbeddedProgramLanguage;
  contentDigest: `sha256:${string}`;
  provider: string;
  source: string;
  imports: readonly RepositoryModuleGraphImport[];
  graphImports: readonly RepositoryModuleGraphImport[];
  targetPackages: readonly string[];
  unknowns: readonly SourceProgramEmbeddedProgramUnknown[];
  span: SourceProgramSpan;
}>;

export type SourceProgramEmbeddedTypeScriptLiteralObservation = Readonly<{
  executable: boolean;
  contentDigest: `sha256:${string}`;
  observationDigest: `sha256:${string}`;
}>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scalarString(value: unknown): string | null {
  return isScalar(value) && typeof value.value === 'string' ? value.value : null;
}

function mapValue(value: unknown, key: string): unknown {
  if (!isMap(value)) return undefined;
  for (const item of value.items) {
    if (scalarString(item.key) === key) return item.value;
  }
  return undefined;
}

function position(source: string, offset: number): Readonly<{ line: number; column: number }> {
  let line = 0;
  let column = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 0x0a) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return Object.freeze({ line, column });
}

function scalarSpan(source: string, value: unknown): SourceProgramSpan {
  if (!isScalar(value) || value.range === undefined || value.range === null) {
    throw new Error('Workflow embedded program has no exact YAML source range');
  }
  const start = value.range[0];
  const end = value.range[2];
  const startPosition = position(source, start);
  const endPosition = position(source, end);
  return Object.freeze({
    start,
    end,
    startLine: startPosition.line,
    startColumn: startPosition.column,
    endLine: endPosition.line,
    endColumn: endPosition.column
  });
}

function packageName(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0] ?? specifier;
}

/** One separately addressed embedded TypeScript value, never its host file. */
export function observeSourceProgramEmbeddedTypeScriptLiteral(
  source: string
): SourceProgramEmbeddedTypeScriptLiteralObservation {
  const contentDigest = rawSha256(source);
  const sourceFile = ts.createSourceFile(
    `embedded-${contentDigest.slice('sha256:'.length)}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const diagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  const executable = diagnostics.length === 0 && sourceFile.statements.some((statement) => (
    ts.isImportDeclaration(statement)
    || ts.isExportDeclaration(statement)
    || ts.isFunctionDeclaration(statement)
    || ts.isClassDeclaration(statement)
    || ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement)
    || ts.isEnumDeclaration(statement)
    || ts.isVariableStatement(statement)
  ));
  const canonical = Object.freeze({
    language: 'typescript' as const,
    contentDigest,
    executable
  });
  return Object.freeze({
    executable,
    contentDigest,
    observationDigest: rawSha256(JSON.stringify(canonical))
  });
}

function compileEmbeddedJavaScriptFacts(source: string): Readonly<{
  imports: readonly RepositoryModuleGraphImport[];
  unknowns: readonly SourceProgramEmbeddedProgramUnknown[];
}> {
  const sourceFile = ts.createSourceFile(
    'workflow-embedded-program.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const imports: RepositoryModuleGraphImport[] = [];
  let dynamic = false;
  const add = (
    kind: RepositoryModuleGraphImport['kind'],
    specifier: string,
    typeOnly = false
  ): void => {
    imports.push(Object.freeze({ kind, specifier, typeOnly }));
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier !== undefined
        && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add('static', node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]!)) {
        dynamic = true;
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add('dynamic', node.arguments[0]!.text);
      } else {
        add('require', node.arguments[0]!.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const diagnostics = (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  const unknowns = dynamic || diagnostics.length > 0
    ? Object.freeze([Object.freeze({
      code: 'embedded-javascript-dynamic-source' as const,
      detail: diagnostics.length > 0
        ? ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' ')
        : 'dynamic import or require does not identify one static module'
    })])
    : Object.freeze([]);
  const uniqueImports = [...new Map(imports.map((observation) => [
    `${observation.kind}\0${observation.specifier}`,
    observation
  ] as const)).values()].sort((left, right) => (
    compareCodeUnits(left.specifier, right.specifier)
    || compareCodeUnits(left.kind, right.kind)
  ));
  return Object.freeze({ imports: Object.freeze(uniqueImports), unknowns });
}

function compileUnit(input: Readonly<{
  ownerPath: string;
  workflowSource: string;
  jobId: string;
  stepIndex: number;
  stepName: string;
  kind: SourceProgramEmbeddedProgramKind;
  provider: string;
  sourceNode: unknown;
}>): SourceProgramEmbeddedProgramUnit {
  const source = scalarString(input.sourceNode);
  if (source === null) throw new Error('Workflow embedded program source is not one scalar string');
  const language = input.kind === 'github-script' ? 'javascript' as const : 'shell' as const;
  const javascriptFacts = language === 'javascript'
    ? compileEmbeddedJavaScriptFacts(source)
    : null;
  const imports = language === 'javascript'
    ? javascriptFacts!.imports
    : Object.freeze([]);
  const graphImports = Object.freeze(imports.filter(({ specifier }) => !specifier.startsWith('.')));
  const targetPackages = Object.freeze([...new Set(imports
    .filter(({ specifier }) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
    .map(({ specifier }) => packageName(specifier)))].sort(compareCodeUnits));
  const unknowns = language === 'javascript'
    ? Object.freeze([
      ...javascriptFacts!.unknowns,
      .../^actions\/github-script@[0-9a-f]{40}$/u.test(input.provider)
        ? []
        : [Object.freeze({
          code: 'embedded-provider-revision-unresolved' as const,
          detail: 'embedded action provider is not bound to one immutable commit revision'
        })],
      ...imports.some(({ specifier }) => specifier.startsWith('.'))
        ? [Object.freeze({
          code: 'embedded-relative-module-base-unresolved' as const,
          detail: 'relative module import requires a provider-owned embedded execution base'
        })]
        : []
    ])
    : Object.freeze([Object.freeze({
      code: 'embedded-shell-import-closure-unresolved' as const,
      detail: 'shell program is content-addressed but its internal command/import closure is external to the TypeScript compiler'
    })]);
  const address = `jobs/${input.jobId}/steps/${input.stepIndex}/${input.kind}`;
  return Object.freeze({
    ownerPath: input.ownerPath,
    address,
    name: input.stepName,
    kind: input.kind,
    language,
    contentDigest: rawSha256(source),
    provider: input.provider,
    source,
    imports: Object.freeze([...imports]),
    graphImports,
    targetPackages,
    unknowns,
    span: scalarSpan(input.workflowSource, input.sourceNode)
  });
}

/**
 * Compile the executable values of one workflow into owner-bound Source
 * Program units. YAML is the host grammar; JavaScript and shell remain
 * explicitly different embedded languages and never become loose literals.
 */
export function compileSourceProgramEmbeddedWorkflowPrograms(
  file: SourceProgramFileInput
): readonly SourceProgramEmbeddedProgramUnit[] {
  if (!isWorkflowSourceProgramInput(file.path)) return Object.freeze([]);
  if (rawSha256(file.source) !== file.contentDigest) {
    throw new Error(`Source Program workflow bytes differ from their input digest: ${file.path}`);
  }
  const document = parseYamlDocument(file.source, {
    label: `Source Program workflow ${file.path}`,
    maximumInputBytes: WORKFLOW_MAXIMUM_BYTES
  });
  const root = document.contents;
  const jobs = mapValue(root, 'jobs');
  if (!isMap(jobs)) throw new Error('Source Program workflow jobs is not one mapping');
  const units: SourceProgramEmbeddedProgramUnit[] = [];
  for (const job of jobs.items) {
    const jobId = scalarString(job.key);
    if (jobId === null || !isMap(job.value)) {
      throw new Error('Source Program workflow job is not one named mapping');
    }
    const steps = mapValue(job.value, 'steps');
    if (steps === undefined) continue;
    if (!isSeq(steps)) throw new Error(`Source Program workflow job steps is not one sequence: ${jobId}`);
    for (let stepIndex = 0; stepIndex < steps.items.length; stepIndex += 1) {
      const step = steps.items[stepIndex];
      if (!isMap(step)) throw new Error(`Source Program workflow step is not one mapping: ${jobId}/${stepIndex}`);
      const uses = scalarString(mapValue(step, 'uses'));
      const runNode = mapValue(step, 'run');
      const run = scalarString(runNode);
      const stepName = scalarString(mapValue(step, 'name')) ?? `${jobId}/${stepIndex}`;
      if (uses !== null && run !== null) {
        throw new Error(`Source Program workflow step cannot contain both uses and run: ${jobId}/${stepIndex}`);
      }
      if (run !== null) {
        units.push(compileUnit({
          ownerPath: file.path,
          workflowSource: file.source,
          jobId,
          stepIndex,
          stepName,
          kind: 'workflow-run',
          provider: scalarString(mapValue(step, 'shell')) ?? 'runner-default-shell',
          sourceNode: runNode
        }));
        continue;
      }
      if (uses === null || !uses.startsWith('actions/github-script@')) continue;
      const scriptNode = mapValue(mapValue(step, 'with'), 'script');
      if (scalarString(scriptNode) === null) {
        throw new Error(`actions/github-script step has no scalar script: ${jobId}/${stepIndex}`);
      }
      units.push(compileUnit({
        ownerPath: file.path,
        workflowSource: file.source,
        jobId,
        stepIndex,
        stepName,
        kind: 'github-script',
        provider: uses,
        sourceNode: scriptNode
      }));
    }
  }
  const addresses = units.map(({ address }) => address);
  if (new Set(addresses).size !== addresses.length) {
    throw new Error(`Source Program workflow embedded program address is not unique: ${file.path}`);
  }
  return Object.freeze(units.sort((left, right) => compareCodeUnits(left.address, right.address)));
}

/** Embedded-language facts only; ordinary TypeScript always uses the Language Service frontend. */
export function sourceProgramModuleImports(
  repositoryPath: string,
  source: string
): readonly RepositoryModuleGraphImport[] {
  if (!isWorkflowSourceProgramInput(repositoryPath)) return Object.freeze([]);
  const units = compileSourceProgramEmbeddedWorkflowPrograms(Object.freeze({
    path: repositoryPath,
    source,
    contentDigest: rawSha256(source)
  }));
  return Object.freeze(units.flatMap(({ graphImports }) => graphImports));
}
