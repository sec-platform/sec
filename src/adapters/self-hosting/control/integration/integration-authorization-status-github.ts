import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs as parseNativeArgs } from 'node:util';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import {
  assertGitHubApiCapability,
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiStatusWriteSession,
  type GitHubApiCapability,
  type GitHubApiOperation
} from '../../../providers/github-api/operation-session.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import {
  MergeGateResultSchema,
  MergeGateTerminalStatusContext,
  ParseMergeGateResult,
  ParseTrustedRuntimeMergeGateResult,
  TrustedRuntimeMergeGateResultSchema,
  type MergeGateResult,
  type TrustedRuntimeMergeGateResult
} from './merge-gate.ts';

const INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA =
  'sec-integration-authorization-status-publication-v1' as const;

export type IntegrationAuthorizationGateResult =
  | MergeGateResult
  | TrustedRuntimeMergeGateResult;

export interface IntegrationAuthorizationStatusPublisherPrincipal {
  readonly creatorLogin: string;
  readonly creatorId: number;
}

export interface IntegrationAuthorizationStatusPublication {
  readonly schema: typeof INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly authorizationId: string;
  readonly authorizationReceiptDigest: `sha256:${string}`;
  readonly gateResultDigest: `sha256:${string}`;
  readonly rulesetDigest: `sha256:${string}`;
  readonly context: typeof MergeGateTerminalStatusContext;
  readonly state: 'success';
  readonly description: string;
  readonly targetUrl: string;
  readonly statusId: number;
  readonly creatorLogin: string;
  readonly creatorId: number;
  readonly publicationDigest: `sha256:${string}`;
}

type GitHubPull = Readonly<{
  state: string;
  draft: boolean;
  base: Readonly<{ ref: string; sha: string }>;
  head: Readonly<{ sha: string }>;
}>;

type GitHubRepository = Readonly<{
  full_name: string;
  default_branch: string;
}>;

type GitHubBranch = Readonly<{ commit: Readonly<{ sha: string }> }>;

type GitHubStatus = Readonly<{
  id: number;
  state: string;
  context: string;
  description: string | null;
  target_url: string | null;
  creator: Readonly<{ login: string; id: number }> | null;
}>;

function fail(message: string): never {
  throw new Error(`IntegrationAuthorizationStatus ${message}`);
}

function bounded(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be bounded canonical text.`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const result = bounded(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a lowercase Git SHA.`);
  return result;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  const result = bounded(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest.`);
  return result as `sha256:${string}`;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(`${label} must be a positive safe integer.`);
  return value as number;
}

function githubRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`GitHub ${label} response must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function nullableBounded(value: unknown, label: string): string | null {
  return value === null ? null : bounded(value, label);
}

function parseGitHubRepository(value: unknown): GitHubRepository {
  const record = githubRecord(value, 'repository');
  return Object.freeze({
    full_name: repository(record.full_name),
    default_branch: bounded(record.default_branch, 'repository default branch')
  });
}

function parseGitHubPull(value: unknown): GitHubPull {
  const record = githubRecord(value, 'pull request');
  const base = githubRecord(record.base, 'pull request base');
  const head = githubRecord(record.head, 'pull request head');
  if (typeof record.draft !== 'boolean') fail('GitHub pull request draft must be boolean.');
  return Object.freeze({
    state: bounded(record.state, 'pull request state'),
    draft: record.draft,
    base: Object.freeze({
      ref: bounded(base.ref, 'pull request base ref'),
      sha: sha(base.sha, 'pull request base SHA')
    }),
    head: Object.freeze({ sha: sha(head.sha, 'pull request head SHA') })
  });
}

function parseGitHubBranch(value: unknown): GitHubBranch {
  const record = githubRecord(value, 'branch');
  const commit = githubRecord(record.commit, 'branch commit');
  return Object.freeze({
    commit: Object.freeze({ sha: sha(commit.sha, 'branch commit SHA') })
  });
}

function parseGitHubStatus(value: unknown): GitHubStatus {
  const record = githubRecord(value, 'commit status');
  let creator: GitHubStatus['creator'];
  if (record.creator === null) {
    creator = null;
  } else {
    const creatorRecord = githubRecord(record.creator, 'commit status creator');
    creator = Object.freeze({
      login: bounded(creatorRecord.login, 'commit status creator login'),
      id: positiveInteger(creatorRecord.id, 'commit status creator id')
    });
  }
  return Object.freeze({
    id: positiveInteger(record.id, 'commit status id'),
    state: bounded(record.state, 'commit status state'),
    context: bounded(record.context, 'commit status context'),
    description: nullableBounded(record.description, 'commit status description'),
    target_url: nullableBounded(record.target_url, 'commit status target URL'),
    creator
  });
}

function parseGitHubStatuses(value: unknown): readonly GitHubStatus[] {
  if (!Array.isArray(value) || value.length > 100) {
    fail('GitHub commit status page must be an array of at most 100 records.');
  }
  return Object.freeze(value.map(parseGitHubStatus));
}

function repository(value: unknown): string {
  const result = bounded(value, 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) fail('repository must be owner/name.');
  return result;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

export function parseIntegrationAuthorizationGateResult(source: string): IntegrationAuthorizationGateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('merge-gate result is not JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('merge-gate result must be an object.');
  }
  const schema = (parsed as Record<string, unknown>).schema;
  if (schema === MergeGateResultSchema) {
    return ParseMergeGateResult(source);
  }
  if (schema === TrustedRuntimeMergeGateResultSchema) {
    return ParseTrustedRuntimeMergeGateResult(source);
  }
  return fail('merge-gate result schema is not supported by the terminal publisher.');
}

export function createIntegrationAuthorizationStatusDescription(
  result: IntegrationAuthorizationGateResult
): string {
  const gate = digest(result.resultDigest, 'gate result digest');
  const rules = digest(result.authorization.rulesetDigest, 'ruleset digest');
  return `gate ${gate.slice(7, 19)} rules ${rules.slice(7, 19)}`;
}

export function createIntegrationAuthorizationStatusPublication(input: Readonly<{
  result: IntegrationAuthorizationGateResult;
  targetUrl: string;
  statusId: number;
  principal: IntegrationAuthorizationStatusPublisherPrincipal;
}>): IntegrationAuthorizationStatusPublication {
  const result = input.result;
  const targetUrl = bounded(input.targetUrl, 'targetUrl');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//u.test(targetUrl)) {
    fail('targetUrl must be one GitHub repository HTTPS URL.');
  }
  const creatorLogin = bounded(input.principal.creatorLogin, 'creatorLogin');
  const creatorId = positiveInteger(input.principal.creatorId, 'creatorId');
  const withoutDigest = Object.freeze({
    schema: INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA,
    repository: repository(result.authorization.repository),
    pullRequestNumber: positiveInteger(result.authorization.prNumber, 'pullRequestNumber'),
    baseSha: sha(result.authorization.baseSha, 'baseSha'),
    headSha: sha(result.authorization.headSha, 'headSha'),
    authorizationId: bounded(result.authorization.authorizationId, 'authorizationId'),
    authorizationReceiptDigest: digest(result.authorization.receiptDigest, 'authorizationReceiptDigest'),
    gateResultDigest: digest(result.resultDigest, 'gateResultDigest'),
    rulesetDigest: digest(result.authorization.rulesetDigest, 'rulesetDigest'),
    context: MergeGateTerminalStatusContext,
    state: 'success' as const,
    description: createIntegrationAuthorizationStatusDescription(result),
    targetUrl,
    statusId: positiveInteger(input.statusId, 'statusId'),
    creatorLogin,
    creatorId
  });
  return Object.freeze({ ...withoutDigest, publicationDigest: hash(withoutDigest) });
}

export function parseIntegrationAuthorizationStatusPublication(
  source: string
): IntegrationAuthorizationStatusPublication {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail('publication is not JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('publication must be an object.');
  const record = value as Record<string, unknown>;
  const expected = [
    'schema', 'repository', 'pullRequestNumber', 'baseSha', 'headSha', 'authorizationId',
    'authorizationReceiptDigest', 'gateResultDigest', 'rulesetDigest', 'context', 'state',
    'description', 'targetUrl', 'statusId', 'creatorLogin', 'creatorId', 'publicationDigest'
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`publication must contain exactly: ${expected.join(', ')}.`);
  }
  if (record.schema !== INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA
      || record.context !== MergeGateTerminalStatusContext
      || record.state !== 'success') {
    fail('publication semantic identity is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA,
    repository: repository(record.repository),
    pullRequestNumber: positiveInteger(record.pullRequestNumber, 'pullRequestNumber'),
    baseSha: sha(record.baseSha, 'baseSha'),
    headSha: sha(record.headSha, 'headSha'),
    authorizationId: bounded(record.authorizationId, 'authorizationId'),
    authorizationReceiptDigest: digest(record.authorizationReceiptDigest, 'authorizationReceiptDigest'),
    gateResultDigest: digest(record.gateResultDigest, 'gateResultDigest'),
    rulesetDigest: digest(record.rulesetDigest, 'rulesetDigest'),
    context: MergeGateTerminalStatusContext,
    state: 'success' as const,
    description: bounded(record.description, 'description'),
    targetUrl: bounded(record.targetUrl, 'targetUrl'),
    statusId: positiveInteger(record.statusId, 'statusId'),
    creatorLogin: bounded(record.creatorLogin, 'creatorLogin'),
    creatorId: positiveInteger(record.creatorId, 'creatorId')
  });
  const publicationDigest = digest(record.publicationDigest, 'publicationDigest');
  if (publicationDigest !== hash(withoutDigest)) fail('publication digest mismatch.');
  return Object.freeze({ ...withoutDigest, publicationDigest });
}

/** Canonical merge-message binding for either hosted or trusted-runtime Gate transport. */
export function integrationAuthorizationStatusMergeMarkers(input: Readonly<{
  result: IntegrationAuthorizationGateResult;
  publication: IntegrationAuthorizationStatusPublication;
}>): readonly string[] {
  const publication = parseIntegrationAuthorizationStatusPublication(
    encodeVerificationActionData(input.publication)
  );
  const result = parseIntegrationAuthorizationGateResult(
    encodeVerificationActionData(input.result)
  );
  if (publication.repository !== result.authorization.repository
      || publication.pullRequestNumber !== result.authorization.prNumber
      || publication.baseSha !== result.authorization.baseSha
      || publication.headSha !== result.authorization.headSha
      || publication.authorizationId !== result.authorization.authorizationId
      || publication.authorizationReceiptDigest !== result.authorization.receiptDigest
      || publication.gateResultDigest !== result.resultDigest
      || publication.rulesetDigest !== result.authorization.rulesetDigest) {
    fail('merge marker publication differs from its Gate result.');
  }
  return Object.freeze([
    `Verification-Session: ${result.authorization.sessionRevision}`,
    `Integration-Authorization: ${result.authorization.authorizationId}`,
    `Integration-Authorization-Receipt: ${result.authorization.receiptDigest}`,
    `Integration-Authorization-Operation: ${result.authorization.consumptionOperationId}`,
    `Integration-Authorization-Status-Publication: ${publication.publicationDigest}`,
    `Integration-Authorization-Status-Id: ${publication.statusId}`,
    `Merge-Gate-Result: ${result.resultDigest}`,
    `Platform-Observation: ${result.authorization.rulesetDigest}`,
    `Platform-Enforcement: ${result.platformObservation.status}`,
    'Platform-No-Bypass-Claim: false'
  ]);
}

type GitHubDefaultBranchSubject = Readonly<{
  repository: GitHubRepository;
  pull: GitHubPull;
  branch: GitHubBranch;
}>;

function exactPullSubject(
  subject: GitHubDefaultBranchSubject,
  result: IntegrationAuthorizationGateResult,
  expectedDefaultBranch?: string
): string {
  const repositoryName = repository(result.authorization.repository);
  const observedRepository = repository(subject.repository.full_name);
  const defaultBranch = bounded(subject.repository.default_branch, 'repository default branch');
  if (observedRepository.toLocaleLowerCase('en-US') !== repositoryName.toLocaleLowerCase('en-US')
      || subject.pull.base.ref !== defaultBranch
      || (expectedDefaultBranch !== undefined && defaultBranch !== expectedDefaultBranch)
      || subject.pull.state !== 'open' || subject.pull.draft
      || subject.pull.base.sha !== result.authorization.baseSha
      || subject.pull.head.sha !== result.authorization.headSha
      || subject.branch.commit.sha !== result.authorization.baseSha) {
    fail('authorization subject drifted at terminal status boundary.');
  }
  return defaultBranch;
}

function exactStatus(
  status: GitHubStatus,
  result: IntegrationAuthorizationGateResult,
  targetUrl: string,
  principal: IntegrationAuthorizationStatusPublisherPrincipal
): void {
  if (status.state !== 'success'
      || status.context !== MergeGateTerminalStatusContext
      || status.description !== createIntegrationAuthorizationStatusDescription(result)
      || status.target_url !== targetUrl
      || status.creator?.login !== principal.creatorLogin
      || status.creator.id !== principal.creatorId) {
    fail('terminal status exact provider readback failed.');
  }
}

async function githubJson(
  capability: GitHubApiCapability,
  operation: GitHubApiOperation
): Promise<unknown> {
  return await executeGitHubApiOperation(capability, operation);
}

async function readDefaultBranchSubject(
  capability: GitHubApiCapability,
  repositoryName: string,
  pullRequestNumber: number
): Promise<GitHubDefaultBranchSubject> {
  const [repositoryReadbackValue, pullValue] = await Promise.all([
    githubJson(capability, { kind: 'repository' }),
    githubJson(capability, { kind: 'pull', pullRequestNumber })
  ]);
  const repositoryReadback = parseGitHubRepository(repositoryReadbackValue);
  const pull = parseGitHubPull(pullValue);
  const defaultBranch = bounded(repositoryReadback.default_branch, 'repository default branch');
  const pullBaseRef = bounded(pull.base.ref, 'pull request base ref');
  if (repository(repositoryReadback.full_name).toLocaleLowerCase('en-US')
      !== repositoryName.toLocaleLowerCase('en-US') || pullBaseRef !== defaultBranch) {
    fail('authorization subject drifted at terminal status boundary.');
  }
  const branch = parseGitHubBranch(await githubJson(
    capability,
    { kind: 'branch', branch: defaultBranch }
  ));
  return Object.freeze({ repository: repositoryReadback, pull, branch });
}

async function listStatuses(
  capability: GitHubApiCapability,
  headSha: string
): Promise<readonly GitHubStatus[]> {
  const output: GitHubStatus[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const current = parseGitHubStatuses(await githubJson(
      capability,
      { kind: 'commit-statuses', sha: headSha, page }
    ));
    output.push(...current);
    if (current.length < 100) return Object.freeze(output);
  }
  return fail('terminal status inventory exceeded the bounded pagination limit.');
}

export async function publishIntegrationAuthorizationStatus(input: Readonly<{
  result: IntegrationAuthorizationGateResult;
  targetUrl: string;
  capability: GitHubApiCapability;
}>): Promise<IntegrationAuthorizationStatusPublication> {
  const result = input.result;
  const repositoryName = repository(result.authorization.repository);
  const targetUrl = bounded(input.targetUrl, 'targetUrl');
  assertGitHubApiCapability(input.capability, repositoryName, 'status-write');
  const capabilityPrincipal = inspectGitHubApiCapability(input.capability).principal;
  if (capabilityPrincipal.userId === null) {
    fail('owner-issued GitHub status capability has no numeric principal id.');
  }
  const principal = Object.freeze({
    creatorLogin: bounded(capabilityPrincipal.login, 'creatorLogin'),
    creatorId: positiveInteger(capabilityPrincipal.userId, 'creatorId')
  });
  const subjectBefore = await readDefaultBranchSubject(
    input.capability,
    repositoryName,
    result.authorization.prNumber
  );
  const defaultBranch = exactPullSubject(subjectBefore, result);

  const created = parseGitHubStatus(await githubJson(
    input.capability,
    {
      kind: 'create-commit-status',
      sha: result.authorization.headSha,
      status: Object.freeze({
        state: 'success',
        context: MergeGateTerminalStatusContext,
        description: createIntegrationAuthorizationStatusDescription(result),
        targetUrl
      })
    }
  ));
  exactStatus(created, result, targetUrl, principal);
  positiveInteger(created.id, 'created status id');

  const [subjectAfter, statuses] = await Promise.all([
    readDefaultBranchSubject(input.capability, repositoryName, result.authorization.prNumber),
    listStatuses(input.capability, result.authorization.headSha)
  ]);
  exactPullSubject(subjectAfter, result, defaultBranch);
  const exact = statuses.filter((status) => status.id === created.id);
  if (exact.length !== 1) fail('terminal status exact id is absent or duplicated in provider readback.');
  exactStatus(exact[0]!, result, targetUrl, principal);
  const newerSamePrincipalContext = statuses.some((status) => status.id > created.id
    && status.context === MergeGateTerminalStatusContext
    && status.creator?.login === principal.creatorLogin
    && status.creator.id === principal.creatorId);
  if (newerSamePrincipalContext) fail('a newer terminal status exists for the same principal/context; publication is stale.');
  return createIntegrationAuthorizationStatusPublication({
    result,
    targetUrl,
    statusId: created.id,
    principal
  });
}

function parseArgs(argv: readonly string[]): Readonly<{
  input: string;
  output: string;
  targetUrl: string;
  creatorLogin: string;
  creatorId: number;
}> {
  const options = {
    input: { type: 'string' }, output: { type: 'string' },
    'target-url': { type: 'string' }, 'creator-login': { type: 'string' },
    'creator-id': { type: 'string' }
  } as const;
  const { values, tokens } = parseNativeArgs({
    args: [...argv], options, strict: true, allowPositionals: false, tokens: true
  });
  const supplied = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option' || token.inlineValue || supplied.has(token.name)) {
      fail('CLI arguments must be unique --key value pairs.');
    }
    supplied.add(token.name);
  }
  if (supplied.size !== Object.keys(options).length) {
    fail('Usage: bun src/adapters/self-hosting/control/integration/integration-authorization-status-github.ts --input <merge-gate.json> --output <receipt.json> --target-url <https://github.com/...> --creator-login <bot> --creator-id <id>');
  }
  const rawCreatorId = values['creator-id']!;
  if (!/^[1-9][0-9]*$/u.test(rawCreatorId)) fail('--creator-id must be canonical positive decimal text.');
  const creatorId = Number(rawCreatorId);
  positiveInteger(creatorId, '--creator-id');
  return Object.freeze({
    input: bounded(values.input, '--input'),
    output: bounded(values.output, '--output'),
    targetUrl: bounded(values['target-url'], '--target-url'),
    creatorLogin: bounded(values['creator-login'], '--creator-login'),
    creatorId
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = parseIntegrationAuthorizationGateResult(readFileSync(args.input, 'utf8'));
  const receipt = await withGitHubApiStatusWriteSession({
    repositoryRoot: process.cwd(),
    repository: result.authorization.repository,
    operation: async (capability) => {
      const principal = inspectGitHubApiCapability(capability).principal;
      if (principal.login !== args.creatorLogin || principal.userId !== args.creatorId) {
        fail('owner-issued GitHub status capability principal differs from CLI admission.');
      }
      return await publishIntegrationAuthorizationStatus({
        result,
        targetUrl: args.targetUrl,
        capability
      });
    }
  });
  writeFileSync(args.output, `${encodeVerificationActionData(receipt)}\n`, 'utf8');
}

if (import.meta.main) await main();
