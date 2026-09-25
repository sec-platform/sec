import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { settleResourcesAsync as settlePhysicalResourcesAsync } from '../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceRunResult,
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR
} from '../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandBoundary } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import {
  assertSealedExecutionTreeRetirementReceipt,
  materializeSealedExecutionTree,
  type RetainedSealedExecutionTreeGeneration,
  type SealedExecutionTreeRetirementReceipt
} from '../../runtime-state/physical/runtime/sealed-execution-tree-generation.ts';
import type { RetainedCompilerDependencyReadGeneration } from '../../toolchain/dependencies/runtime.ts';
import type { SourceProgramModel } from '../source-program-model/contract.ts';
import {
  compileSourceProgramUnusedSymbolProviderReceipt,
  type SourceProgramUnusedSymbolEvidence,
  type SourceProgramUnusedSymbolProviderReceipt
} from '../source-program-model/reduction.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../source-program-model/workspace-source-snapshot.ts';

const KNIP_OPERATION = 'brownfield.repository-audit.knip-provider';
const KNIP_REQUIREMENT = 'brownfield.repository-audit.knip-process';
const KNIP_COMMAND = Object.freeze([
  '--no-env-file',
  'node_modules/knip/bin/knip.js',
  '--no-progress',
  '--include',
  'exports,types',
  '--reporter',
  'json',
  '--no-exit-code'
] as const);
const KNIP_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const KNIP_MAX_STDERR_BYTES = 4 * 1024 * 1024;
const KNIP_MAX_TREE_BYTES = 128 * 1024 * 1024;
const KNIP_MAX_TREE_ENTRIES = 8_192;

type KnipProviderDiagnostic = Readonly<{
  provider: 'knip';
  status: 'unresolved';
  reason:
    | 'configuration-unbound'
    | 'dependency-drift'
    | 'execution-failed'
    | 'output-invalid'
    | 'physical-boundary-unsettled'
    | 'source-drift';
  detailDigest: `sha256:${string}`;
}>;

export type KnipProviderResult =
  | Readonly<{ status: 'completed'; receipt: SourceProgramUnusedSymbolProviderReceipt }>
  | Readonly<{ status: 'unresolved'; diagnostic: KnipProviderDiagnostic }>;

export type ExecuteKnipProviderInput = Readonly<{
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  model: SourceProgramModel;
  dependencyGeneration: Pick<
    RetainedCompilerDependencyReadGeneration,
    'generationDigest' | 'physicalGeneration'
  >;
  generationParent: PhysicalDirectoryIdentity;
  deadlineAtUnixMs: number;
  bunExecutablePath?: string;
}>;

function unresolved(reason: KnipProviderDiagnostic['reason'], detail: unknown): KnipProviderResult {
  return Object.freeze({
    status: 'unresolved' as const,
    diagnostic: Object.freeze({
      provider: 'knip' as const,
      status: 'unresolved' as const,
      reason,
      detailDigest: sha256({
        detail: detail instanceof Error ? detail.message : String(detail)
      }) as `sha256:${string}`
    })
  });
}

function assertBoundKnipConfiguration(snapshot: PhysicalWorkspaceSourceSnapshot): void {
  const config = snapshot.file('knip.json');
  if (config === null) throw new Error('Knip requires snapshot-owned knip.json');
  const parsed = parseExactJson(config.source, 'Knip configuration');
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const slashPath = value.replaceAll('\\', '/');
      if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(slashPath)
          || /^[A-Za-z]:\//u.test(slashPath) || slashPath.startsWith('~/')
          || slashPath.split('/').includes('..')) {
        throw new Error('Knip configuration contains a path outside the sealed snapshot');
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'extends') {
        throw new Error('Knip configuration extends an input outside the sealed snapshot');
      }
      visit(child);
    }
  };
  visit(parsed);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Knip configuration must be an object');
  }
  const entry = (parsed as Record<string, unknown>).entry;
  if (!Array.isArray(entry) || entry.some((value) => typeof value !== 'string')) {
    throw new Error('Knip configuration entry must be a string array');
  }
  const configuredEntrypoints = new Set(entry.map((value) => (
    value.endsWith('!') ? value.slice(0, -1) : value
  )));
  const missingDescriptorEntrypoints = snapshot.moduleMembership.descriptors
    .flatMap(({ externalEntrypoints }) => externalEntrypoints)
    .filter((entrypoint) => !configuredEntrypoints.has(entrypoint));
  if (missingDescriptorEntrypoints.length > 0) {
    throw new Error(
      `Knip configuration does not cover snapshot module entrypoints: ${missingDescriptorEntrypoints.join(', ')}`
    );
  }
}

function isolatedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: 'true', PATH: '' };
  for (const key of ['SYSTEMROOT', 'WINDIR'] as const) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return Object.freeze(environment);
}

function compileOperation(input: Readonly<{
  bunDigest: `sha256:${string}`;
  dependencyGenerationDigest: `sha256:${string}`;
  generationDigest: `sha256:${string}`;
  sourceRevision: `sha256:${string}`;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const contractDigest = sha256({
    schema: 'sec-knip-provider-operation-v1',
    command: KNIP_COMMAND,
    input: 'one-compiler-issued-physical-workspace-snapshot',
    output: 'knip-json-exports-and-types',
    authority: 'candidate-evidence-only'
  }) as OperationDigest;
  return bindSemanticOperation(compileSemanticOperationPlan({
    operation: KNIP_OPERATION,
    intentDigest: sha256(input) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: input.deadlineAtUnixMs - Date.now() },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: KNIP_MAX_OUTPUT_BYTES + KNIP_MAX_STDERR_BYTES },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: KNIP_REQUIREMENT,
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed']
    }]
  }), [compileCapabilityBinding({
    requirementId: KNIP_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      bunDigest: input.bunDigest,
      dependencyGenerationDigest: input.dependencyGenerationDigest,
      command: KNIP_COMMAND
    }) as OperationDigest
  })]);
}

function canonicalPath(value: string): string {
  if (value.length === 0 || path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) {
    throw new Error(`Knip emitted a non-repository path: ${value}`);
  }
  const normalized = value.split('/').filter((part) => part !== '.').join('/');
  if (normalized !== value || value.split('/').some((part) => part === '..' || part.length === 0)) {
    throw new Error(`Knip emitted a non-canonical repository path: ${value}`);
  }
  return value;
}

function parseNamedIssue(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Knip issue is not an object');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(['name', 'namespace', 'kind', 'specifier', 'pos', 'line', 'col']);
  if (Object.keys(record).some((key) => !allowed.has(key))
      || typeof record.name !== 'string' || record.name.trim() !== record.name
      || record.name.length === 0 || record.name.includes('\0')) {
    throw new Error('Knip issue has an invalid named-symbol shape');
  }
  return record.name;
}

function parseCandidates(bytes: Uint8Array): readonly SourceProgramUnusedSymbolEvidence[] {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const parsed = parseExactJson(source, 'Knip JSON report');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || !Array.isArray((parsed as { issues?: unknown }).issues)) {
    throw new Error('Knip JSON report has an invalid root shape');
  }
  const candidates: SourceProgramUnusedSymbolEvidence[] = [];
  for (const row of (parsed as { issues: unknown[] }).issues) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Knip JSON report row is not an object');
    }
    const record = row as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['file', 'exports', 'types'].includes(key))
        || typeof record.file !== 'string') {
      throw new Error('Knip JSON report row has an invalid shape');
    }
    const repositoryPath = canonicalPath(record.file);
    for (const issueType of ['exports', 'types'] as const) {
      const issues = record[issueType];
      if (issues === undefined) continue;
      if (!Array.isArray(issues)) throw new Error(`Knip ${issueType} issues are not an array`);
      for (const issue of issues) {
        candidates.push(Object.freeze({ path: repositoryPath, name: parseNamedIssue(issue) }));
      }
    }
  }
  candidates.sort((left, right) => left.path < right.path ? -1
    : left.path > right.path ? 1 : left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (new Set(candidates.map(({ path: p, name }) => `${p}\0${name}`)).size !== candidates.length) {
    throw new Error('Knip JSON report contains duplicate symbol evidence');
  }
  return Object.freeze(candidates);
}

export async function executeKnipUnusedSymbolProvider(
  input: ExecuteKnipProviderInput
): Promise<KnipProviderResult> {
  try {
    assertPhysicalWorkspaceSourceSnapshot(input.workspaceSnapshot);
    input.workspaceSnapshot.assertMatches({
      sourceRevision: input.model.sourceRevision,
      files: input.workspaceSnapshot.files,
      moduleMembership: input.workspaceSnapshot.moduleMembership
    });
  } catch (error) {
    return unresolved('source-drift', error);
  }
  try {
    assertBoundKnipConfiguration(input.workspaceSnapshot);
  } catch (error) {
    return unresolved('configuration-unbound', error);
  }

  try {
    input.dependencyGeneration.physicalGeneration.assertCurrent();
    await input.dependencyGeneration.physicalGeneration.assertAuthorityCurrent();
  } catch (error) {
    return unresolved('dependency-drift', error);
  }

  const executablePath = path.resolve(input.bunExecutablePath ?? process.execPath);
  const environment = isolatedEnvironment();
  let executable: RetainedNoFollowOrdinaryFile | null = null;
  let generation: RetainedSealedExecutionTreeGeneration | null = null;
  let retirement: SealedExecutionTreeRetirementReceipt | null = null;
  let boundary: RetainedCommandBoundary | null = null;
  let operation: BoundSemanticOperation | null = null;
  let session: ProcessResourceSession | null = null;
  let sessionReceipt: ProcessResourceSessionReceipt | null = null;
  let run: ProcessResourceRunResult | null = null;
  let bunDigest: `sha256:${string}` | null = null;
  let failure: { readonly error: unknown } | undefined;
  let executionFailed = false;
  try {
    input.dependencyGeneration.physicalGeneration.assertCurrent();
    generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      directoryNamePrefix: 'knip-provider-',
      files: input.workspaceSnapshot.files.map((file) => Object.freeze({
        path: file.path,
        bytes: Buffer.from(file.source, 'utf8')
      })),
      generationParent: input.generationParent,
      links: [{ path: 'node_modules', source: input.dependencyGeneration.physicalGeneration }],
      maximumBytes: KNIP_MAX_TREE_BYTES,
      maximumEntries: KNIP_MAX_TREE_ENTRIES
    });
    executable = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(executablePath), 'Knip Bun parent'),
      path.basename(executablePath),
      undefined,
      'Knip retained Bun executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    bunDigest = executable.digest().byteDigest;
    operation = compileOperation({
      bunDigest,
      dependencyGenerationDigest: input.dependencyGeneration.generationDigest,
      generationDigest: generation.identity.generationDigest,
      sourceRevision: input.workspaceSnapshot.sourceRevision,
      deadlineAtUnixMs: input.deadlineAtUnixMs
    });
    session = openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: KNIP_REQUIREMENT,
        resourceCeilings: [
          { resource: 'duration-ms', maximum: input.deadlineAtUnixMs - Date.now() },
          { resource: 'input-bytes', maximum: 1 },
          { resource: 'output-bytes', maximum: KNIP_MAX_OUTPUT_BYTES + KNIP_MAX_STDERR_BYTES },
          { resource: 'processes', maximum: 1 }
        ]
      })
    });
    boundary = issueRetainedCommandBoundary({ executable, workingDirectory: generation.workingDirectory });
    run = await session.run(boundary, KNIP_COMMAND, {
      env: environment,
      envMode: 'replace',
      maxStdoutBytes: KNIP_MAX_OUTPUT_BYTES,
      maxStderrBytes: KNIP_MAX_STDERR_BYTES
    });
    if (run.result.code !== 0) throw new Error(`Knip exited with code ${run.result.code}`);
  } catch (error) {
    executionFailed = true;
    failure = { error };
  } finally {
    const cleanup: Array<Readonly<{ label: string; settle(): void | Promise<void> }>> = [];
    if (session !== null) cleanup.push(Object.freeze({
      label: 'Knip process session', settle: () => { sessionReceipt = session!.close(); }
    }));
    if (generation !== null) cleanup.push(Object.freeze({
      label: 'Knip sealed execution tree', settle: async () => { retirement = await generation!.retire(); }
    }));
    if (executable !== null) cleanup.push(Object.freeze({
      label: 'Knip retained Bun executable', settle: () => executable!.dispose()
    }));
    try {
      await settlePhysicalResourcesAsync({
        ...(failure === undefined ? {} : { primary: { label: 'Knip provider execution', error: failure.error } }),
        cleanup
      });
      failure = undefined;
    } catch (error) {
      failure = { error };
    }
  }
  if (failure !== undefined) {
    return unresolved(executionFailed ? 'execution-failed' : 'physical-boundary-unsettled', failure.error);
  }
  if (run === null || sessionReceipt === null || boundary === null || operation === null
      || generation === null || retirement === null || bunDigest === null) {
    return unresolved('physical-boundary-unsettled', 'Knip execution did not produce a complete terminal tuple');
  }
  try {
    assertProcessResourceRunResult(run, sessionReceipt, {
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: KNIP_REQUIREMENT,
      boundary,
      args: KNIP_COMMAND,
      env: environment,
      envMode: 'replace'
    });
    assertSealedExecutionTreeRetirementReceipt(retirement, generation);
    input.dependencyGeneration.physicalGeneration.assertCurrent();
    await input.dependencyGeneration.physicalGeneration.assertAuthorityCurrent();
    const candidates = parseCandidates(run.result.stdout);
    if (candidates.some(({ path: candidatePath }) => input.workspaceSnapshot.file(candidatePath) === null)) {
      throw new Error('Knip emitted candidate evidence outside the exact workspace snapshot');
    }
    const providerRevision = sha256({
      schema: 'sec-knip-provider-revision-v1',
      bunDigest,
      dependencyGenerationDigest: input.dependencyGeneration.generationDigest,
      command: KNIP_COMMAND,
      contract: 'sealed-workspace-json-exports-types-candidate-evidence'
    }) as `sha256:${string}`;
    return Object.freeze({
      status: 'completed' as const,
      receipt: compileSourceProgramUnusedSymbolProviderReceipt({
        model: input.model,
        files: input.workspaceSnapshot.files,
        providerRevision,
        configuration: Object.freeze({
          includedIssueTypes: Object.freeze(['exports', 'types'] as const),
          isShowProgress: false as const
        }),
        settlement: 'completed',
        candidates
      })
    });
  } catch (error) {
    return unresolved('output-invalid', error);
  }
}
