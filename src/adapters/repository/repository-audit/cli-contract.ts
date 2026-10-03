import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseSecModuleDescriptor } from '../architecture/contract.ts';
import descriptorSource from './module.json' with { type: 'json' };

// Current and baseline derivation share one aggregate audit budget. Its
// capacity belongs to the existing operation descriptor, rather than a second
// hardcoded copy of the physical worker's separate ceiling.
const auditDescriptor = parseSecModuleDescriptor(
  descriptorSource, 'src/adapters/repository/repository-audit/module.json'
);
const auditDuration = auditDescriptor.operationObligations.find(({ operation }) => (
  operation.kind === 'capability' && operation.capability === 'repository-audit.worker'
    && operation.operation === 'executeSupervisedWorkingTreeSourceProgramAudit'
))?.resources.aggregateBudgets.find(({ resource }) => resource === 'duration-ms');
if (auditDuration === undefined) throw new Error('Repository audit has no declared aggregate duration budget.');
export const SOURCE_PROGRAM_AUDIT_MAX_DURATION_MS = auditDuration.maximum;
export const SOURCE_PROGRAM_AUDIT_WORKER_MAX_DURATION_MS = 180_000;
export const SOURCE_PROGRAM_TRANSITION_DEADLINE_ENV = 'SEC_SOURCE_PROGRAM_TRANSITION_DEADLINE_AT_UNIX_MS';

/** Process boundaries may inherit a stricter enclosing deadline, never renew it. */
export function repositoryAuditInheritedDeadline(value: string | undefined, nowUnixMs = Date.now()): number {
  const ownDeadline = repositoryAuditDeadline(undefined, nowUnixMs);
  if (value === undefined) return ownDeadline;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error('Repository audit inherited deadline is not canonical.');
  const inherited = Number(value);
  if (!Number.isSafeInteger(inherited) || inherited <= nowUnixMs) {
    throw new Error('Repository audit inherited deadline is exhausted or invalid.');
  }
  return Math.min(ownDeadline, inherited);
}

/** Choose the single aggregate deadline before any audit work. */
export function repositoryAuditDeadline(
  maximumDurationMs = SOURCE_PROGRAM_AUDIT_MAX_DURATION_MS,
  nowUnixMs = Date.now()
): number {
  if (!Number.isSafeInteger(maximumDurationMs) || maximumDurationMs < 1
      || maximumDurationMs > SOURCE_PROGRAM_AUDIT_MAX_DURATION_MS
      || !Number.isSafeInteger(nowUnixMs) || nowUnixMs < 0
      || !Number.isSafeInteger(nowUnixMs + maximumDurationMs)) {
    throw new Error('Repository audit duration is outside its canonical bound.');
  }
  return nowUnixMs + maximumDurationMs;
}

/** Reading the remaining pool never creates a replacement deadline. */
export function repositoryAuditRemainingDuration(deadlineAtUnixMs: number, nowUnixMs = Date.now()): number {
  const durationMs = deadlineAtUnixMs - nowUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs) || !Number.isSafeInteger(nowUnixMs)
      || !Number.isSafeInteger(durationMs) || durationMs < 1
      || durationMs > SOURCE_PROGRAM_AUDIT_MAX_DURATION_MS) {
    throw new Error('Repository audit deadline is exhausted or outside its canonical bound.');
  }
  return durationMs;
}

/** The worker receives only remaining parent work and its own finite ceiling. */
export function repositoryAuditWorkerDeadline(workDeadlineAtUnixMs: number, nowUnixMs = Date.now()): number {
  return nowUnixMs + Math.min(
    repositoryAuditRemainingDuration(workDeadlineAtUnixMs, nowUnixMs),
    SOURCE_PROGRAM_AUDIT_WORKER_MAX_DURATION_MS
  );
}

/** CLI policy only: neither parsing a command nor reporting its outcome issues
 * a Source Program, provider, mutation or successful-verification capability. */
export const REPOSITORY_AUDIT_SEVERITY_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
});
export type RepositoryAuditSeverity = keyof typeof REPOSITORY_AUDIT_SEVERITY_RANK;
type RepositoryAuditMode = 'repository' | 'module-topology' | 'source-program';
export const DEFAULT_REPOSITORY_AUDIT_REF = 'refs/remotes/origin/main';

const CLI_OPTIONS = {
  json: { type: 'boolean' },
  full: { type: 'boolean' },
  diagnostic: { type: 'boolean' },
  enforce: { type: 'boolean' },
  'worktree-module-topology': { type: 'boolean' },
  'worktree-source-program': { type: 'boolean' },
  candidates: { type: 'boolean' },
  'blocking-details': { type: 'boolean' },
  'blocking-details-page': { type: 'string' },
  'blocking-details-domain': { type: 'string' },
  'aggregate-import-reductions': { type: 'boolean' },
  'graph-cuts': { type: 'boolean' },
  'version-reductions': { type: 'boolean' },
  output: { type: 'string' },
  query: { type: 'string' },
  'fail-on': { type: 'string' },
  'default-ref': { type: 'string' },
  'supersession-baseline': { type: 'string' },
  'transition-candidate-root': { type: 'string' },
  'transition-expected-head': { type: 'string' },
  'test-author-input': { type: 'string' }
} as const;

export type RepositoryAuditCliOptions = Readonly<{
  mode: RepositoryAuditMode;
  diagnostic: boolean;
  enforce: boolean;
  full: boolean;
  includeCandidates: boolean;
  blockingDetails: boolean;
  blockingDetailsPage: number;
  blockingDetailsDomain: 'priority' | 'source-program' | 'declaration-topology'
    | 'test-retirement' | 'implementation-dominance' | 'test-value'
    | 'supersession' | 'module-architecture';
  failOn: RepositoryAuditSeverity | 'none';
  defaultRef: string | undefined;
  outputPath: string | null;
  query: string | null;
  reductionMode: 'aggregate-import' | 'graph-cut' | 'none' | 'version';
  supersessionBaseline: string;
  transitionCandidateRoot: string | null;
  transitionExpectedHead: string | null;
  testAuthorInput: string | null;
}>;
export type WorkingTreeSourceProgramAuditOptions = Pick<RepositoryAuditCliOptions,
  'blockingDetails' | 'blockingDetailsDomain' | 'blockingDetailsPage' | 'enforce' | 'full' | 'includeCandidates' | 'outputPath' | 'query' |
  'reductionMode' | 'supersessionBaseline'>;

function requireFailOn(value: unknown): RepositoryAuditSeverity | 'none' {
  if (value === 'none' || (typeof value === 'string'
      && Object.hasOwn(REPOSITORY_AUDIT_SEVERITY_RANK, value))) {
    return value as RepositoryAuditSeverity | 'none';
  }
  throw new TypeError(`Unsupported --fail-on value: ${String(value)}`);
}

function requireBlockingDetailsPage(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`Unsupported --blocking-details-page value: ${String(value)}`);
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page)) {
    throw new TypeError(`Unsupported --blocking-details-page value: ${value}`);
  }
  return page;
}

const BLOCKING_DETAIL_DOMAINS = new Set([
  'priority', 'source-program', 'declaration-topology', 'test-retirement',
  'implementation-dominance', 'test-value', 'supersession', 'module-architecture'
]);

function requireBlockingDetailsDomain(
  value: unknown
): RepositoryAuditCliOptions['blockingDetailsDomain'] {
  const domain = value ?? 'priority';
  if (typeof domain !== 'string' || !BLOCKING_DETAIL_DOMAINS.has(domain)) {
    throw new TypeError(`Unsupported --blocking-details-domain value: ${String(value)}`);
  }
  return domain as RepositoryAuditCliOptions['blockingDetailsDomain'];
}

/** One grammar for the executable, programmatic CLI and supervised audit entry.
 * Native tokens distinguish an option from a value that happens to spell it.
 * Unknown switches, incomplete values and positionals are never silently ignored.
 * The returned record captures cwd-based output resolution, but does not write it.
 */
export function parseRepositoryAuditCliOptions(
  args: readonly string[],
  defaultMode: RepositoryAuditMode = 'repository'
): RepositoryAuditCliOptions {
  const { values, tokens } = parseArgs({
    args: [...args], options: CLI_OPTIONS, strict: true, allowPositionals: false, tokens: true
  });
  const supplied = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (token.value !== undefined) {
      if (supplied.has(token.name)) throw new Error(`--${token.name} may be supplied exactly once`);
      if (token.value.length === 0 || token.value.includes('\0')) {
        throw new Error(`--${token.name} requires one non-empty value without NUL`);
      }
    }
    supplied.add(token.name);
  }
  if (values['worktree-module-topology'] && values['worktree-source-program']) {
    throw new Error('Choose exactly one repository audit mode');
  }
  const mode = values['worktree-module-topology'] ? 'module-topology'
    : values['worktree-source-program'] ? 'source-program' : defaultMode;
  const reductions = ([
    ['aggregate-import-reductions', 'aggregate-import'],
    ['graph-cuts', 'graph-cut'],
    ['version-reductions', 'version']
  ] as const).filter(([flag]) => values[flag]);
  if (reductions.length > 1) throw new Error('Choose exactly one reduction mode per exact source snapshot');
  const reductionMode: RepositoryAuditCliOptions['reductionMode'] = reductions.length === 0
    ? 'none' : reductions[0]![1];
  const failOn = requireFailOn(values['fail-on'] ?? 'high');
  if (values.enforce && (values.diagnostic || failOn === 'none')) {
    throw new Error('--enforce cannot be combined with --diagnostic or --fail-on none');
  }
  const onlyIn = (expected: RepositoryAuditMode, flags: readonly string[]): void => {
    const incompatible = flags.find(flag => supplied.has(flag));
    if (mode !== expected && incompatible !== undefined) {
      throw new Error(`--${incompatible} is only supported by ${expected} audit`);
    }
  };
  onlyIn('repository', ['diagnostic', 'fail-on', 'default-ref']);
  onlyIn('source-program', ['blocking-details', 'blocking-details-domain', 'blocking-details-page', 'candidates', 'aggregate-import-reductions',
    'graph-cuts', 'version-reductions', 'supersession-baseline',
    'transition-candidate-root', 'transition-expected-head', 'test-author-input']);
  if (mode === 'module-topology' && supplied.has('query')) {
    throw new Error('--query is not supported by module-topology audit');
  }
  if (mode === 'source-program' && supplied.has('output') && reductionMode === 'none') {
    throw new Error('--output requires one reduction mode for source-program audit');
  }
  if (supplied.has('blocking-details-page') && !values['blocking-details']) {
    throw new Error('--blocking-details-page requires --blocking-details');
  }
  if (supplied.has('blocking-details-domain') && !values['blocking-details']) {
    throw new Error('--blocking-details-domain requires --blocking-details');
  }
  if (values['blocking-details'] && values.full) {
    throw new Error('--blocking-details cannot be combined with --full');
  }
  const supersessionBaseline = values['supersession-baseline'] ?? 'HEAD';
  if (supersessionBaseline.startsWith('-')) throw new Error('--supersession-baseline requires one Git revision');
  const transitionRoot = values['transition-candidate-root'];
  const transitionHead = values['transition-expected-head'];
  if (transitionRoot !== undefined || transitionHead !== undefined || values['test-author-input'] !== undefined) {
    if (transitionRoot === undefined || transitionHead === undefined || !/^[0-9a-f]{40}$/u.test(transitionHead)
        || !supplied.has('supersession-baseline') || !/^[0-9a-f]{40}$/u.test(supersessionBaseline)
        || reductionMode !== 'none' || values.enforce || values.query || values.output || values['blocking-details']) {
      throw new Error('Transition assessment requires exact candidate/base/head without mutation or ordinary enforcement options');
    }
  }
  if (values['default-ref']?.startsWith('-')) throw new Error('--default-ref requires one Git revision');
  return Object.freeze({
    mode,
    diagnostic: values.diagnostic ?? false,
    blockingDetails: values['blocking-details'] ?? false,
    blockingDetailsDomain: requireBlockingDetailsDomain(values['blocking-details-domain']),
    blockingDetailsPage: requireBlockingDetailsPage(values['blocking-details-page']),
    enforce: values.enforce ?? false,
    full: values.full ?? false,
    includeCandidates: values.candidates ?? false,
    failOn,
    defaultRef: values['default-ref'],
    outputPath: values.output === undefined ? null : path.resolve(values.output),
    query: values.query ?? null,
    reductionMode,
    supersessionBaseline,
    transitionCandidateRoot: transitionRoot === undefined ? null : path.resolve(transitionRoot),
    transitionExpectedHead: transitionHead ?? null,
    testAuthorInput: values['test-author-input'] === undefined ? null : path.resolve(values['test-author-input'])
  });
}

/** Existing finding/unknown policy, independent of compact/full presentation.
 * Deliberate diagnostic reports remain possible; malformed policy is not one. */
export function repositoryAuditShouldFail(
  report: Readonly<{
    findings: readonly Readonly<{ severity: RepositoryAuditSeverity }>[];
    unknowns: readonly string[];
    /** Original detailed observations when the full report is available. Their
     * absence preserves the legacy findings/unknowns-only decision surface. */
    sourceProgram?: Readonly<{ unknowns: readonly unknown[] }>;
    declarationTopology?: Readonly<{ unknowns: readonly unknown[] }>;
    contentCoverage?: readonly Readonly<{ status: 'excluded' | 'scanned' | 'unknown' }>[];
  }>,
  options: Readonly<{ diagnostic?: boolean; failOn?: RepositoryAuditSeverity | 'none' }> = {}
): boolean {
  const { diagnostic = false, failOn = 'high' } = options;
  if (typeof diagnostic !== 'boolean') throw new TypeError('Audit diagnostic policy must be boolean');
  const threshold = requireFailOn(failOn);
  if (!Array.isArray(report.findings) || !Array.isArray(report.unknowns)) {
    throw new TypeError('Audit findings and unknowns must be arrays');
  }
  let findingFails = false;
  const findings: readonly Readonly<{ severity: RepositoryAuditSeverity }>[] = report.findings;
  for (const finding of findings) {
    if (finding === null || typeof finding !== 'object'
        || typeof finding.severity !== 'string'
        || !Object.hasOwn(REPOSITORY_AUDIT_SEVERITY_RANK, finding.severity)) {
      throw new TypeError('Audit finding severity is invalid');
    }
    if (threshold !== 'none'
        && REPOSITORY_AUDIT_SEVERITY_RANK[finding.severity] <= REPOSITORY_AUDIT_SEVERITY_RANK[threshold]) {
      findingFails = true;
    }
  }
  // A complete report already carries these independent observations. Do not
  // rely on another producer having copied every unknown into the top-level
  // string list, or on presentation counts being mutually consistent.
  let hasUnknown = report.unknowns.length > 0;
  for (const [label, observation] of [
    ['Source Program', report.sourceProgram],
    ['declaration topology', report.declarationTopology]
  ] as const) {
    if (observation === undefined) continue;
    if (observation === null || !Array.isArray(observation.unknowns)) {
      throw new TypeError(`Audit ${label} must expose its original unknown observations`);
    }
    if (observation.unknowns.length > 0) hasUnknown = true;
  }
  if (report.contentCoverage !== undefined) {
    if (!Array.isArray(report.contentCoverage)) throw new TypeError('Audit content coverage must be an array');
    for (const entry of report.contentCoverage) {
      if (entry === null || typeof entry !== 'object'
          || !['excluded', 'scanned', 'unknown'].includes(entry.status)) {
        throw new TypeError('Audit content coverage status is invalid');
      }
      if (entry.status === 'unknown') hasUnknown = true;
    }
  }
  return (!diagnostic && hasUnknown) || findingFails;
}

/** A topology with unparsed files is not a clean, enforced topology result.
 * Evaluate the complete producer result, never the compact count/digest view. */
export function repositoryModuleTopologyShouldFail(
  report: Readonly<{
    unresolvedFiles: readonly unknown[];
    topology: Readonly<{ violations: readonly unknown[] }>;
  }>,
  enforce: boolean
): boolean {
  if (typeof enforce !== 'boolean' || !Array.isArray(report.unresolvedFiles)
      || !Array.isArray(report.topology?.violations)) {
    throw new TypeError('Topology enforcement requires a complete observation and boolean policy');
  }
  return enforce && (report.unresolvedFiles.length > 0 || report.topology.violations.length > 0);
}
