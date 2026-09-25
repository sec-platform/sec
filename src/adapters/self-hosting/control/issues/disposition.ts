import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';

const ISSUE_DISPOSITION_PLAN_SCHEMA = 'sec-issue-disposition-plan-v1' as const;
const ISSUE_DISPOSITION_SCHEMA = 'sec-issue-disposition-v1' as const;
const ISSUE_DISPOSITION_POLICY_REVISION = 'issue-disposition-policy-v1' as const;

export type IssueDispositionDigest = `sha256:${string}`;
export type IssueDispositionMode = 'progress-only' | 'close-tracking-after-readback';

export interface GitHubIssueReference {
  readonly repository: string;
  readonly issueNumber: number;
}

export interface GitHubPullRequestClosingFacts {
  readonly repository: string;
  readonly prNumber: number;
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly title: string;
  readonly body: string;
  readonly mergeCommitSha: string | null;
  readonly closingIssues: readonly GitHubIssueReference[];
  readonly responseDigest: IssueDispositionDigest;
}

export interface GitHubClosingKeywordOccurrence extends GitHubIssueReference {
  readonly keyword: 'close' | 'closes' | 'closed' | 'fix' | 'fixes' | 'fixed'
    | 'resolve' | 'resolves' | 'resolved';
  readonly offset: number;
}

export interface IssueDispositionPlan {
  readonly schema: typeof ISSUE_DISPOSITION_PLAN_SCHEMA;
  readonly policyRevision: typeof ISSUE_DISPOSITION_POLICY_REVISION;
  readonly repository: string;
  readonly prNumber: number;
  readonly manifestPath: string;
  readonly manifestDigest: IssueDispositionDigest;
  readonly trackingIssueNumber: number | null;
  readonly mode: IssueDispositionMode;
  readonly titleBodyDigest: IssueDispositionDigest;
  readonly linkedClosingIssues: readonly GitHubIssueReference[];
  readonly planDigest: IssueDispositionDigest;
}

type IssueDispositionKind = 'progressed';

export interface IssueDisposition {
  readonly schema: typeof ISSUE_DISPOSITION_SCHEMA;
  readonly dispositionId: IssueDispositionDigest;
  readonly operationId: IssueDispositionDigest;
  readonly planDigest: IssueDispositionDigest;
  readonly planMode: IssueDispositionMode;
  readonly repository: string;
  readonly prNumber: number;
  readonly issueNumber: number | null;
  readonly manifestPath: string;
  readonly manifestDigest: IssueDispositionDigest;
  readonly currentSpecRevision: IssueDispositionDigest;
  readonly acceptanceIds: readonly IssueDispositionDigest[];
  readonly newMainSha: string;
  readonly newMainTreeSha: string;
  readonly evidenceRefs: readonly IssueDispositionDigest[];
  readonly completionAssessment: 'unavailable';
  readonly completionAssessmentReason: 'trusted-post-main-closure-assessment-unavailable';
  readonly providerMutationCapability: 'unsupported-no-conditional-write';
  readonly expectedProviderState: 'OPEN' | 'CLOSED';
  readonly kind: IssueDispositionKind;
  readonly blockers: readonly string[];
  readonly receiptDigest: IssueDispositionDigest;
}

function fail(message: string): never {
  throw new Error(`IssueDisposition ${message}`);
}

function hash(value: unknown): IssueDispositionDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function decodedSourceDigest(source: string): IssueDispositionDigest {
  return `sha256:${rawSha256Hex(source)}`;
}

function boundedText(value: unknown, label: string, maximum = 65_536): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || value.normalize('NFC') !== value || /[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    return fail(`${label} must be bounded NFC text without NUL or bidi controls.`);
  }
  return value;
}

function repository(value: unknown, label = 'repository'): string {
  const result = boundedText(value, label, 201);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(result)) {
    return fail(`${label} must be one owner/name identity.`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return fail(`${label} must be positive.`);
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(`${label} must be non-negative.`);
  return Number(value);
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    return fail(`${label} must be one lowercase Git SHA.`);
  }
  return value;
}

function digest(value: unknown, label: string): IssueDispositionDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    return fail(`${label} must be one SHA-256 digest.`);
  }
  return value as IssueDispositionDigest;
}

function manifestPath(value: unknown): string {
  if (typeof value !== 'string'
    || !/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)) {
    return fail('manifestPath must be canonical.');
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail(`${label} must be one plain object.`);
  }
  return value as Record<string, unknown>;
}

function normalizeReferences(
  value: readonly GitHubIssueReference[],
  label: string
): readonly GitHubIssueReference[] {
  if (!Array.isArray(value) || value.length > 256) return fail(`${label} must be a bounded array.`);
  const normalized = value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    exactKeys(item, ['repository', 'issueNumber'], `${label}[${index}]`);
    return Object.freeze({ repository: repository(item.repository, `${label}[${index}].repository`),
      issueNumber: positiveInteger(item.issueNumber, `${label}[${index}].issueNumber`) });
  }).sort((left, right) => left.repository.localeCompare(right.repository)
    || left.issueNumber - right.issueNumber);
  const keys = normalized.map((entry) => `${entry.repository.toLowerCase()}#${entry.issueNumber}`);
  if (new Set(keys).size !== keys.length) return fail(`${label} contains duplicate issue identities.`);
  return Object.freeze(normalized);
}

const CLOSING_KEYWORD_PATTERN = /(?<![A-Za-z])(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*(?::\s*)?(?:<?https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/issues\/([1-9][0-9]*)>?|(?:([A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})\s*)?#([1-9][0-9]*))\b/giu;

export function parseGitHubClosingKeywordOccurrences(
  source: string,
  defaultRepository: string
): readonly GitHubClosingKeywordOccurrence[] {
  const text = boundedText(source, 'GitHub closing-keyword source', 131_072);
  const fallback = repository(defaultRepository, 'defaultRepository');
  const occurrences: GitHubClosingKeywordOccurrence[] = [];
  for (const match of text.matchAll(CLOSING_KEYWORD_PATTERN)) {
    const keyword = match[1]!.toLowerCase() as GitHubClosingKeywordOccurrence['keyword'];
    const targetRepository = match[2] !== undefined
      ? repository(`${match[2]}/${match[3]}`, 'closing URL repository')
      : match[5] === undefined ? fallback : repository(match[5], 'closing reference repository');
    occurrences.push(Object.freeze({ keyword, repository: targetRepository,
      issueNumber: positiveInteger(Number(match[4] ?? match[6]), 'closing reference issueNumber'),
      offset: match.index }));
  }
  return Object.freeze(occurrences);
}

export function parseGitHubPullRequestClosingFactsPage(input: Readonly<{
  source: string;
  repository: string;
  prNumber: number;
  expectedCursor: string | null;
  observedBeforeCount: number;
  expectedTotalCount: number | null;
}>): Readonly<{
  facts: Omit<GitHubPullRequestClosingFacts, 'closingIssues' | 'responseDigest'>;
  closingIssues: readonly GitHubIssueReference[];
  totalCount: number;
  nextCursor: string | null;
  responseDigest: IssueDispositionDigest;
}> {
  try {
    let decoded: unknown;
    try {
      decoded = JSON.parse(input.source) as unknown;
    } catch {
      return fail('pull request GraphQL response is not valid JSON.');
    }
    const root = record(decoded, 'pull request GraphQL response');
    if ('errors' in root) {
      if (!Array.isArray(root.errors) || root.errors.length > 0) {
        return fail('pull request GraphQL response contains provider errors or malformed errors.');
      }
      exactKeys(root, ['data', 'errors'], 'pull request GraphQL response');
    } else {
      exactKeys(root, ['data'], 'pull request GraphQL response');
    }
    const data = record(root.data, 'pull request GraphQL data');
    const repositoryRecord = record(data.repository, 'pull request repository');
    const pull = record(repositoryRecord.pullRequest, 'pull request');
    const expectedRepository = repository(input.repository);
    const expectedPrNumber = positiveInteger(input.prNumber, 'prNumber');
    if (pull.number !== expectedPrNumber || typeof pull.title !== 'string'
      || typeof pull.body !== 'string') {
      return fail('pull request GraphQL identity or prose is invalid.');
    }
    if (pull.state !== 'OPEN' && pull.state !== 'MERGED' && pull.state !== 'CLOSED') {
      return fail('pull request GraphQL state is unsupported.');
    }
    const mergeCommit = pull.mergeCommit === null ? null : record(pull.mergeCommit,
      'pull request mergeCommit');
    const mergeCommitSha = mergeCommit === null ? null : sha(mergeCommit.oid,
      'pull request mergeCommit.oid');
    if ((pull.state === 'MERGED') !== (mergeCommitSha !== null)) {
      return fail('pull request merged state and merge commit are inconsistent.');
    }
    const connection = record(pull.closingIssuesReferences,
      'pull request closingIssuesReferences');
    exactKeys(connection, ['totalCount', 'nodes', 'pageInfo'],
      'pull request closingIssuesReferences');
    if (!Array.isArray(connection.nodes) || connection.nodes.length > 100) {
      return fail('pull request closing issue page is invalid or overbound.');
    }
    const totalCount = nonnegativeInteger(connection.totalCount,
      'pull request closing issue totalCount');
    const observedBeforeCount = nonnegativeInteger(input.observedBeforeCount,
      'pull request closing issue observedBeforeCount');
    const expectedTotalCount = input.expectedTotalCount === null ? null
      : nonnegativeInteger(input.expectedTotalCount,
        'pull request closing issue expectedTotalCount');
    if (totalCount > 256 || connection.nodes.length > totalCount) {
      return fail('pull request closing issue totalCount is invalid or overbound.');
    }
    if (expectedTotalCount !== null && totalCount !== expectedTotalCount) {
      return fail('pull request closing issue totalCount changed during pagination.');
    }
    const closingIssues = connection.nodes.map((node, index) => {
      const issue = record(node, `closing issue ${index}`);
      const issueRepository = record(issue.repository, `closing issue ${index} repository`);
      return Object.freeze({ repository: repository(issueRepository.nameWithOwner,
        `closing issue ${index} repository.nameWithOwner`),
      issueNumber: positiveInteger(issue.number, `closing issue ${index} number`) });
    });
    const pageInfo = record(connection.pageInfo, 'pull request closing issue pageInfo');
    if (typeof pageInfo.hasNextPage !== 'boolean'
      || (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string')) {
      return fail('pull request closing issue cursor is invalid.');
    }
    const nextCursor = pageInfo.hasNextPage ? pageInfo.endCursor as string | null : null;
    if (pageInfo.hasNextPage && (nextCursor === null || nextCursor === input.expectedCursor)) {
      return fail('pull request closing issue cursor did not advance.');
    }
    if (!pageInfo.hasNextPage && pageInfo.endCursor !== null && closingIssues.length === 0) {
      return fail('pull request closing issue terminal cursor is inconsistent.');
    }
    const observedThroughPage = observedBeforeCount + closingIssues.length;
    if (observedThroughPage > totalCount
      || (pageInfo.hasNextPage && observedThroughPage >= totalCount)
      || (!pageInfo.hasNextPage && observedThroughPage !== totalCount)) {
      return fail('pull request closing issue page is incomplete or inconsistent with totalCount.');
    }
    return Object.freeze({ facts: Object.freeze({ repository: expectedRepository,
      prNumber: expectedPrNumber, state: pull.state, title: pull.title, body: pull.body,
      mergeCommitSha }), closingIssues: Object.freeze(closingIssues), totalCount, nextCursor,
      responseDigest: decodedSourceDigest(input.source) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown provider response shape';
    throw new Error(`${reason}; decoded response digest ${decodedSourceDigest(input.source)}.`);
  }
}

function parseIssueDispositionDirective(body: string): IssueDispositionMode {
  const lines = boundedText(body, 'pull request body').replaceAll('\r\n', '\n').split('\n');
  const directives = lines.filter((line) => /^[\t ]*Issue-Disposition\s*:/iu.test(line));
  if (directives.length !== 1) {
    return fail(`pull request body must contain exactly one Issue-Disposition field; found ${directives.length}.`);
  }
  const match = /^Issue-Disposition: (progress-only|close-tracking-after-readback)$/u.exec(directives[0]!);
  if (match === null) return fail('pull request Issue-Disposition field is invalid.');
  return match[1] as IssueDispositionMode;
}

function parseWorkPackageLocatorForDisposition(body: string): string {
  const lines = boundedText(body, 'pull request body').replaceAll('\r\n', '\n').split('\n');
  const locators = lines.filter((line) => /^[\t ]*Work-Package\s*:/iu.test(line));
  if (locators.length !== 1) {
    return fail(`pull request body must contain exactly one Work-Package locator; found ${locators.length}.`);
  }
  const match = /^Work-Package: (config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md)$/u.exec(locators[0]!);
  if (match === null) return fail('pull request Work-Package locator is invalid.');
  return match[1]!;
}

export function renderPullRequestBody(input: Readonly<{
  summary: string;
  manifestPath: string;
  mode: IssueDispositionMode;
}>): string {
  const summary = boundedText(input.summary, 'pull request summary').trim();
  if (summary.length === 0
    || /^[\t ]*(?:Work-Package|Issue-Disposition)\s*:/imu.test(summary)) {
    return fail('pull request summary must be non-empty and cannot contain control fields.');
  }
  if (input.mode !== 'progress-only' && input.mode !== 'close-tracking-after-readback') {
    return fail('pull request disposition mode is invalid.');
  }
  const path = manifestPath(input.manifestPath);
  const rendered = `${summary}\n\nWork-Package: ${path}\nIssue-Disposition: ${input.mode}\n`;
  if (parseGitHubClosingKeywordOccurrences(rendered, 'invalid/invalid').length > 0) {
    return fail('pull request renderer input contains a GitHub closing-keyword pattern.');
  }
  parseWorkPackageLocatorForDisposition(rendered);
  parseIssueDispositionDirective(rendered);
  return rendered;
}

function parseTrackingIssueNumber(tracking: string): number | null {
  if (tracking === 'none') return null;
  const match = /^issue-([1-9][0-9]*)$/u.exec(tracking);
  if (match === null) return fail('tracking must be none or issue-<positive integer>.');
  return positiveInteger(Number(match[1]), 'tracking issue number');
}

export function createIssueDispositionPlan(input: Readonly<{
  repository: string;
  prNumber: number;
  manifestPath: string;
  manifestDigest: IssueDispositionDigest;
  tracking: string;
  title: string;
  body: string;
  linkedClosingIssues: readonly GitHubIssueReference[];
}>): IssueDispositionPlan {
  const repositoryIdentity = repository(input.repository);
  const title = boundedText(input.title, 'pull request title', 512);
  const body = boundedText(input.body, 'pull request body');
  const path = manifestPath(input.manifestPath);
  if (parseWorkPackageLocatorForDisposition(body) !== path) {
    return fail('pull request Work-Package locator differs from the selected manifest.');
  }
  const mode = parseIssueDispositionDirective(body);
  const trackingIssueNumber = parseTrackingIssueNumber(input.tracking);
  if (mode === 'close-tracking-after-readback' && trackingIssueNumber === null) {
    return fail('close-tracking-after-readback requires one tracking Issue.');
  }
  const lexical = [
    ...parseGitHubClosingKeywordOccurrences(title, repositoryIdentity),
    ...parseGitHubClosingKeywordOccurrences(body, repositoryIdentity)
  ];
  const linkedClosingIssues = normalizeReferences(input.linkedClosingIssues, 'linkedClosingIssues');
  if (lexical.length > 0 || linkedClosingIssues.length > 0) {
    return fail('controlled pull request prose and provider links must contain zero closing authority.');
  }
  const withoutDigest = Object.freeze({ schema: ISSUE_DISPOSITION_PLAN_SCHEMA,
    policyRevision: ISSUE_DISPOSITION_POLICY_REVISION,
    repository: repositoryIdentity, prNumber: positiveInteger(input.prNumber, 'prNumber'),
    manifestPath: path, manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    trackingIssueNumber, mode,
    titleBodyDigest: hash({ title, body }), linkedClosingIssues });
  return Object.freeze({ ...withoutDigest, planDigest: hash(withoutDigest) });
}

export function parseIssueDispositionPlan(source: string): IssueDispositionPlan {
  const value = record(JSON.parse(source) as unknown, 'plan');
  exactKeys(value, ['schema', 'policyRevision', 'repository', 'prNumber', 'manifestPath',
    'manifestDigest', 'trackingIssueNumber', 'mode', 'titleBodyDigest', 'linkedClosingIssues',
    'planDigest'], 'plan');
  if (value.schema !== ISSUE_DISPOSITION_PLAN_SCHEMA
    || value.policyRevision !== ISSUE_DISPOSITION_POLICY_REVISION) return fail('plan schema or policy mismatch.');
  const rebuilt = createParsedPlan(value);
  if (rebuilt.planDigest !== value.planDigest) return fail('plan digest mismatch.');
  return rebuilt;
}

function createParsedPlan(value: Record<string, unknown>): IssueDispositionPlan {
  if (value.mode !== 'progress-only' && value.mode !== 'close-tracking-after-readback') {
    return fail('plan mode is invalid.');
  }
  const trackingIssueNumber = value.trackingIssueNumber === null ? null
    : positiveInteger(value.trackingIssueNumber, 'plan trackingIssueNumber');
  if (value.mode === 'close-tracking-after-readback' && trackingIssueNumber === null) {
    return fail('close plan has no tracking Issue.');
  }
  const withoutDigest = Object.freeze({ schema: ISSUE_DISPOSITION_PLAN_SCHEMA,
    policyRevision: ISSUE_DISPOSITION_POLICY_REVISION,
    repository: repository(value.repository), prNumber: positiveInteger(value.prNumber, 'plan prNumber'),
    manifestPath: manifestPath(value.manifestPath),
    manifestDigest: digest(value.manifestDigest, 'plan manifestDigest'),
    trackingIssueNumber, mode: value.mode,
    titleBodyDigest: digest(value.titleBodyDigest, 'plan titleBodyDigest'),
    linkedClosingIssues: normalizeReferences(
      value.linkedClosingIssues as readonly GitHubIssueReference[], 'plan linkedClosingIssues') });
  return Object.freeze({ ...withoutDigest, planDigest: hash(withoutDigest) });
}

export function createIssueAcceptanceId(input: Readonly<{
  manifestDigest: IssueDispositionDigest;
  index: number;
  text: string;
}>): IssueDispositionDigest {
  const index = nonnegativeInteger(input.index, 'acceptance index');
  return hash({ manifestDigest: digest(input.manifestDigest, 'acceptance manifestDigest'), index,
    text: boundedText(input.text, 'acceptance text', 4_096) });
}

function normalizeAcceptanceIds(
  value: readonly IssueDispositionDigest[]
): readonly IssueDispositionDigest[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    return fail('acceptanceIds must be one non-empty bounded array.');
  }
  const normalized = value.map((entry, index) => digest(entry,
    `acceptanceIds[${index}]`)).sort();
  if (new Set(normalized).size !== normalized.length) {
    return fail('acceptanceIds contains duplicate IDs.');
  }
  return Object.freeze(normalized);
}

function normalizeDigests(value: readonly IssueDispositionDigest[], label: string): readonly IssueDispositionDigest[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    return fail(`${label} must be one non-empty bounded array.`);
  }
  const normalized = value.map((entry, index) => digest(entry, `${label}[${index}]`)).sort();
  if (new Set(normalized).size !== normalized.length) return fail(`${label} contains duplicate digests.`);
  return Object.freeze(normalized);
}

export function compileIssueDisposition(input: Readonly<{
  plan: IssueDispositionPlan;
  currentSpecRevision: IssueDispositionDigest;
  acceptanceIds: readonly IssueDispositionDigest[];
  newMainSha: string;
  newMainTreeSha: string;
  evidenceRefs: readonly IssueDispositionDigest[];
  expectedProviderState: 'OPEN' | 'CLOSED';
}>): IssueDisposition {
  const plan = parseIssueDispositionPlan(encodeVerificationActionData(input.plan));
  const acceptanceIds = normalizeAcceptanceIds(input.acceptanceIds);
  const evidenceRefs = normalizeDigests(input.evidenceRefs, 'evidenceRefs');
  if (input.expectedProviderState !== 'OPEN' && input.expectedProviderState !== 'CLOSED') {
    return fail('expectedProviderState is invalid.');
  }
  const blockers = ['provider-conditional-write-unsupported',
    'trusted-completion-assessment-unavailable'];
  if (plan.mode === 'progress-only') blockers.push('plan-progress-only');
  if (plan.trackingIssueNumber === null) blockers.push('no-tracking-issue');
  if (input.expectedProviderState !== 'OPEN') blockers.push('expected-provider-state-not-open');
  const kind = 'progressed' as const;
  const semantic = Object.freeze({ schema: ISSUE_DISPOSITION_SCHEMA,
    planDigest: plan.planDigest, planMode: plan.mode,
    repository: plan.repository, prNumber: plan.prNumber,
    issueNumber: plan.trackingIssueNumber, manifestPath: plan.manifestPath,
    manifestDigest: plan.manifestDigest,
    currentSpecRevision: digest(input.currentSpecRevision, 'currentSpecRevision'), acceptanceIds,
    newMainSha: sha(input.newMainSha, 'newMainSha'),
    newMainTreeSha: sha(input.newMainTreeSha, 'newMainTreeSha'), evidenceRefs,
    completionAssessment: 'unavailable' as const,
    completionAssessmentReason: 'trusted-post-main-closure-assessment-unavailable' as const,
    providerMutationCapability: 'unsupported-no-conditional-write' as const,
    expectedProviderState: input.expectedProviderState, kind, blockers: Object.freeze(blockers.sort()) });
  const dispositionId = hash(semantic);
  const operationId = hash({ dispositionId, effect: 'none' });
  const receipt = Object.freeze({ ...semantic, dispositionId, operationId });
  return Object.freeze({ ...receipt, receiptDigest: hash(receipt) });
}

export function parseIssueDisposition(source: string): IssueDisposition {
  const value = record(JSON.parse(source) as unknown, 'disposition');
  exactKeys(value, ['schema', 'dispositionId', 'operationId', 'planDigest', 'planMode', 'repository', 'prNumber',
    'issueNumber', 'manifestPath', 'manifestDigest', 'currentSpecRevision', 'acceptanceIds', 'newMainSha',
    'newMainTreeSha', 'evidenceRefs', 'completionAssessment', 'completionAssessmentReason',
    'providerMutationCapability', 'expectedProviderState', 'kind', 'blockers', 'receiptDigest'], 'disposition');
  if (value.schema !== ISSUE_DISPOSITION_SCHEMA) return fail('disposition schema mismatch.');
  if (value.planMode !== 'progress-only' && value.planMode !== 'close-tracking-after-readback') {
    return fail('disposition planMode is invalid.');
  }
  const acceptanceIds = normalizeAcceptanceIds(value.acceptanceIds as readonly IssueDispositionDigest[]);
  const evidenceRefs = normalizeDigests(value.evidenceRefs as readonly IssueDispositionDigest[], 'evidenceRefs');
  if (value.completionAssessment !== 'unavailable'
    || value.completionAssessmentReason !== 'trusted-post-main-closure-assessment-unavailable'
    || value.providerMutationCapability !== 'unsupported-no-conditional-write') {
    return fail('disposition completion or provider capability state is invalid.');
  }
  if (value.expectedProviderState !== 'OPEN' && value.expectedProviderState !== 'CLOSED') {
    return fail('disposition expectedProviderState is invalid.');
  }
  const issueNumber = value.issueNumber === null ? null : positiveInteger(value.issueNumber, 'issueNumber');
  if (value.planMode === 'close-tracking-after-readback' && issueNumber === null) {
    return fail('close disposition has no tracking Issue.');
  }
  const blockers = ['provider-conditional-write-unsupported',
    'trusted-completion-assessment-unavailable'];
  if (value.planMode === 'progress-only') blockers.push('plan-progress-only');
  if (issueNumber === null) blockers.push('no-tracking-issue');
  if (value.expectedProviderState !== 'OPEN') blockers.push('expected-provider-state-not-open');
  const kind = 'progressed' as const;
  const semantic = Object.freeze({ schema: ISSUE_DISPOSITION_SCHEMA,
    planDigest: digest(value.planDigest, 'planDigest'), planMode: value.planMode,
    repository: repository(value.repository), prNumber: positiveInteger(value.prNumber, 'prNumber'),
    issueNumber, manifestPath: manifestPath(value.manifestPath),
    manifestDigest: digest(value.manifestDigest, 'manifestDigest'),
    currentSpecRevision: digest(value.currentSpecRevision, 'currentSpecRevision'), acceptanceIds,
    newMainSha: sha(value.newMainSha, 'newMainSha'), newMainTreeSha: sha(value.newMainTreeSha, 'newMainTreeSha'),
    evidenceRefs, completionAssessment: 'unavailable' as const,
    completionAssessmentReason: 'trusted-post-main-closure-assessment-unavailable' as const,
    providerMutationCapability: 'unsupported-no-conditional-write' as const,
    expectedProviderState: value.expectedProviderState,
    kind, blockers: Object.freeze(blockers.sort()) });
  if (!Array.isArray(value.blockers)
    || encodeVerificationActionData(value.blockers) !== encodeVerificationActionData(semantic.blockers)
    || value.kind !== kind) return fail('disposition kind or blockers are not canonical.');
  const normalized = Object.freeze({ ...semantic,
    dispositionId: digest(value.dispositionId, 'dispositionId'),
    operationId: digest(value.operationId, 'operationId'),
    receiptDigest: digest(value.receiptDigest, 'receiptDigest') });
  const { receiptDigest, ...receipt } = normalized;
  const { dispositionId, operationId, ...semanticReceipt } = receipt;
  if (hash(semanticReceipt) !== dispositionId
    || hash({ dispositionId, effect: 'none' }) !== operationId
    || hash(receipt) !== receiptDigest) return fail('disposition identity or receipt digest mismatch.');
  return normalized;
}

export function decideUnexpectedIssueReopen(input: Readonly<{
  repository: string;
  issueNumber: number;
  issueState: 'OPEN' | 'CLOSED';
  authorizedIssueNumbers: readonly number[];
  closer: null | Readonly<{
    repository: string;
    prNumber: number;
    mergeCommitSha: string;
  }>;
  expectedPrNumber: number;
  expectedMergeCommitSha: string;
}>): Readonly<{
  decision: 'no-op' | 'manual-reopen-required' | 'blocked';
  reason: string;
}> {
  const repositoryIdentity = repository(input.repository);
  const issueNumber = positiveInteger(input.issueNumber, 'issueNumber');
  const expectedPrNumber = positiveInteger(input.expectedPrNumber, 'expectedPrNumber');
  const expectedMergeCommitSha = sha(input.expectedMergeCommitSha, 'expectedMergeCommitSha');
  const authorized = input.authorizedIssueNumbers.map((entry, index) => positiveInteger(entry,
    `authorizedIssueNumbers[${index}]`));
  if (new Set(authorized).size !== authorized.length) return fail('authorizedIssueNumbers contains duplicates.');
  if (input.issueState === 'OPEN') return Object.freeze({ decision: 'no-op', reason: 'issue-already-open' });
  if (authorized.includes(issueNumber)) return Object.freeze({ decision: 'no-op', reason: 'issue-authorized' });
  if (input.closer === null) return Object.freeze({ decision: 'blocked', reason: 'closer-unavailable' });
  if (repository(input.closer.repository, 'closer.repository').toLowerCase() !== repositoryIdentity.toLowerCase()
    || positiveInteger(input.closer.prNumber, 'closer.prNumber') !== expectedPrNumber
    || sha(input.closer.mergeCommitSha, 'closer.mergeCommitSha') !== expectedMergeCommitSha) {
    return Object.freeze({ decision: 'blocked', reason: 'closer-does-not-match-operation' });
  }
  return Object.freeze({ decision: 'manual-reopen-required',
    reason: 'exact-pr-merge-caused-unauthorized-close-but-provider-conditional-write-is-unsupported' });
}
