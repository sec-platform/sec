import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  CodexDevelopmentMergeGateResultSchemaV2,
  CodexDevelopmentMergeGateTerminalStatusContextV2,
  CodexDevelopmentParseMergeGateResultV2,
  CodexDevelopmentParseTrustedRuntimeMergeGateResultV1,
  CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1,
  type CodexDevelopmentMergeGateResultV2,
  type CodexDevelopmentTrustedRuntimeMergeGateResultV1
} from './merge-gate.ts';

export const INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA_V1 =
  'sec-integration-authorization-status-publication-v1' as const;

export type IntegrationAuthorizationGateResultV1 =
  | CodexDevelopmentMergeGateResultV2
  | CodexDevelopmentTrustedRuntimeMergeGateResultV1;

export interface IntegrationAuthorizationStatusPublisherPrincipalV1 {
  readonly creatorLogin: string;
  readonly creatorId: number;
}

export interface IntegrationAuthorizationStatusPublicationV1 {
  readonly schema: typeof INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA_V1;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly authorizationId: string;
  readonly authorizationReceiptDigest: `sha256:${string}`;
  readonly gateResultDigest: `sha256:${string}`;
  readonly rulesetDigest: `sha256:${string}`;
  readonly context: typeof CodexDevelopmentMergeGateTerminalStatusContextV2;
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

function repository(value: unknown): string {
  const result = bounded(value, 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) fail('repository must be owner/name.');
  return result;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

export function parseIntegrationAuthorizationGateResultV1(source: string): IntegrationAuthorizationGateResultV1 {
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
  if (schema === CodexDevelopmentMergeGateResultSchemaV2) {
    return CodexDevelopmentParseMergeGateResultV2(source);
  }
  if (schema === CodexDevelopmentTrustedRuntimeMergeGateResultSchemaV1) {
    return CodexDevelopmentParseTrustedRuntimeMergeGateResultV1(source);
  }
  return fail('merge-gate result schema is not supported by the terminal publisher.');
}

export function createIntegrationAuthorizationStatusDescriptionV1(
  result: IntegrationAuthorizationGateResultV1
): string {
  const gate = digest(result.resultDigest, 'gate result digest');
  const rules = digest(result.authorization.rulesetDigest, 'ruleset digest');
  return `gate ${gate.slice(7, 19)} rules ${rules.slice(7, 19)}`;
}

export function createIntegrationAuthorizationStatusPublicationV1(input: Readonly<{
  result: IntegrationAuthorizationGateResultV1;
  targetUrl: string;
  statusId: number;
  principal: IntegrationAuthorizationStatusPublisherPrincipalV1;
}>): IntegrationAuthorizationStatusPublicationV1 {
  const result = input.result;
  const targetUrl = bounded(input.targetUrl, 'targetUrl');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//u.test(targetUrl)) {
    fail('targetUrl must be one GitHub repository HTTPS URL.');
  }
  const creatorLogin = bounded(input.principal.creatorLogin, 'creatorLogin');
  const creatorId = positiveInteger(input.principal.creatorId, 'creatorId');
  const withoutDigest = Object.freeze({
    schema: INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA_V1,
    repository: repository(result.authorization.repository),
    pullRequestNumber: positiveInteger(result.authorization.prNumber, 'pullRequestNumber'),
    baseSha: sha(result.authorization.baseSha, 'baseSha'),
    headSha: sha(result.authorization.headSha, 'headSha'),
    authorizationId: bounded(result.authorization.authorizationId, 'authorizationId'),
    authorizationReceiptDigest: digest(result.authorization.receiptDigest, 'authorizationReceiptDigest'),
    gateResultDigest: digest(result.resultDigest, 'gateResultDigest'),
    rulesetDigest: digest(result.authorization.rulesetDigest, 'rulesetDigest'),
    context: CodexDevelopmentMergeGateTerminalStatusContextV2,
    state: 'success' as const,
    description: createIntegrationAuthorizationStatusDescriptionV1(result),
    targetUrl,
    statusId: positiveInteger(input.statusId, 'statusId'),
    creatorLogin,
    creatorId
  });
  return Object.freeze({ ...withoutDigest, publicationDigest: hash(withoutDigest) });
}

export function parseIntegrationAuthorizationStatusPublicationV1(
  source: string
): IntegrationAuthorizationStatusPublicationV1 {
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
  if (record.schema !== INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA_V1
      || record.context !== CodexDevelopmentMergeGateTerminalStatusContextV2
      || record.state !== 'success') {
    fail('publication semantic identity is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: INTEGRATION_AUTHORIZATION_STATUS_PUBLICATION_SCHEMA_V1,
    repository: repository(record.repository),
    pullRequestNumber: positiveInteger(record.pullRequestNumber, 'pullRequestNumber'),
    baseSha: sha(record.baseSha, 'baseSha'),
    headSha: sha(record.headSha, 'headSha'),
    authorizationId: bounded(record.authorizationId, 'authorizationId'),
    authorizationReceiptDigest: digest(record.authorizationReceiptDigest, 'authorizationReceiptDigest'),
    gateResultDigest: digest(record.gateResultDigest, 'gateResultDigest'),
    rulesetDigest: digest(record.rulesetDigest, 'rulesetDigest'),
    context: CodexDevelopmentMergeGateTerminalStatusContextV2,
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
export function integrationAuthorizationStatusMergeMarkersV1(input: Readonly<{
  result: IntegrationAuthorizationGateResultV1;
  publication: IntegrationAuthorizationStatusPublicationV1;
}>): readonly string[] {
  const publication = parseIntegrationAuthorizationStatusPublicationV1(
    encodeVerificationActionDataV2(input.publication)
  );
  const result = parseIntegrationAuthorizationGateResultV1(
    encodeVerificationActionDataV2(input.result)
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
  result: IntegrationAuthorizationGateResultV1,
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
  result: IntegrationAuthorizationGateResultV1,
  targetUrl: string,
  principal: IntegrationAuthorizationStatusPublisherPrincipalV1
): void {
  if (status.state !== 'success'
      || status.context !== CodexDevelopmentMergeGateTerminalStatusContextV2
      || status.description !== createIntegrationAuthorizationStatusDescriptionV1(result)
      || status.target_url !== targetUrl
      || status.creator?.login !== principal.creatorLogin
      || status.creator.id !== principal.creatorId) {
    fail('terminal status exact provider readback failed.');
  }
}

type GitHubFetchV1 = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export function canonicalGitHubApiTargetV1(input: string | URL): URL {
  const target = new URL(input);
  if (
    target.protocol !== 'https:'
    || target.hostname !== 'api.github.com'
    || target.port !== ''
    || target.username !== ''
    || target.password !== ''
    || target.hash !== ''
  ) fail('GitHub network dispatcher only permits credential-free https://api.github.com targets.');
  return target;
}

export function dispatchGitHubApiRequestV1(
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  const target = canonicalGitHubApiTargetV1(input);
  return globalThis.fetch(target, { ...init, redirect: 'error' });
}

async function githubJson<T>(
  fetchImpl: GitHubFetchV1,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sec-integration-authorization-status-v1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) fail(`GitHub ${method} ${path} failed with HTTP ${response.status}.`);
  return await response.json() as T;
}

async function readDefaultBranchSubject(
  fetchImpl: GitHubFetchV1,
  token: string,
  repositoryName: string,
  pullRequestNumber: number
): Promise<GitHubDefaultBranchSubject> {
  const [repositoryReadback, pull] = await Promise.all([
    githubJson<GitHubRepository>(fetchImpl, token, 'GET', `/repos/${repositoryName}`),
    githubJson<GitHubPull>(fetchImpl, token, 'GET', `/repos/${repositoryName}/pulls/${pullRequestNumber}`)
  ]);
  const defaultBranch = bounded(repositoryReadback.default_branch, 'repository default branch');
  const pullBaseRef = bounded(pull.base.ref, 'pull request base ref');
  if (repository(repositoryReadback.full_name).toLocaleLowerCase('en-US')
      !== repositoryName.toLocaleLowerCase('en-US') || pullBaseRef !== defaultBranch) {
    fail('authorization subject drifted at terminal status boundary.');
  }
  const branch = await githubJson<GitHubBranch>(
    fetchImpl,
    token,
    'GET',
    `/repos/${repositoryName}/branches/${encodeURIComponent(defaultBranch)}`
  );
  return Object.freeze({ repository: repositoryReadback, pull, branch });
}

async function listStatuses(
  fetchImpl: GitHubFetchV1,
  token: string,
  repositoryName: string,
  headSha: string
): Promise<readonly GitHubStatus[]> {
  const output: GitHubStatus[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const current = await githubJson<GitHubStatus[]>(
      fetchImpl,
      token,
      'GET',
      `/repos/${repositoryName}/commits/${headSha}/statuses?per_page=100&page=${page}`
    );
    output.push(...current);
    if (current.length < 100) return Object.freeze(output);
  }
  return fail('terminal status inventory exceeded the bounded pagination limit.');
}

export async function publishIntegrationAuthorizationStatusV1(input: Readonly<{
  result: IntegrationAuthorizationGateResultV1;
  token: string;
  targetUrl: string;
  principal: IntegrationAuthorizationStatusPublisherPrincipalV1;
  fetchImpl: GitHubFetchV1;
}>): Promise<IntegrationAuthorizationStatusPublicationV1> {
  const result = input.result;
  const repositoryName = repository(result.authorization.repository);
  const token = bounded(input.token, 'token');
  const targetUrl = bounded(input.targetUrl, 'targetUrl');
  const principal = Object.freeze({
    creatorLogin: bounded(input.principal.creatorLogin, 'creatorLogin'),
    creatorId: positiveInteger(input.principal.creatorId, 'creatorId')
  });
  const fetchImpl = input.fetchImpl;
  const subjectBefore = await readDefaultBranchSubject(
    fetchImpl,
    token,
    repositoryName,
    result.authorization.prNumber
  );
  const defaultBranch = exactPullSubject(subjectBefore, result);

  const created = await githubJson<GitHubStatus>(
    fetchImpl,
    token,
    'POST',
    `/repos/${repositoryName}/statuses/${result.authorization.headSha}`,
    {
      state: 'success',
      context: CodexDevelopmentMergeGateTerminalStatusContextV2,
      description: createIntegrationAuthorizationStatusDescriptionV1(result),
      target_url: targetUrl
    }
  );
  exactStatus(created, result, targetUrl, principal);
  positiveInteger(created.id, 'created status id');

  const [subjectAfter, statuses] = await Promise.all([
    readDefaultBranchSubject(fetchImpl, token, repositoryName, result.authorization.prNumber),
    listStatuses(fetchImpl, token, repositoryName, result.authorization.headSha)
  ]);
  exactPullSubject(subjectAfter, result, defaultBranch);
  const exact = statuses.filter((status) => status.id === created.id);
  if (exact.length !== 1) fail('terminal status exact id is absent or duplicated in provider readback.');
  exactStatus(exact[0]!, result, targetUrl, principal);
  const newerSamePrincipalContext = statuses.some((status) => status.id > created.id
    && status.context === CodexDevelopmentMergeGateTerminalStatusContextV2
    && status.creator?.login === principal.creatorLogin
    && status.creator.id === principal.creatorId);
  if (newerSamePrincipalContext) fail('a newer terminal status exists for the same principal/context; publication is stale.');
  return createIntegrationAuthorizationStatusPublicationV1({
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
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--') || values.has(key)) {
      fail('CLI arguments must be unique --key value pairs.');
    }
    values.set(key, value);
  }
  const allowed = new Set(['--input', '--output', '--target-url', '--creator-login', '--creator-id']);
  if (values.size !== allowed.size || [...values.keys()].some((key) => !allowed.has(key))) {
    fail('Usage: bun scripts/codex/integration-authorization-status-github.ts --input <merge-gate.json> --output <receipt.json> --target-url <https://github.com/...> --creator-login <bot> --creator-id <id>');
  }
  const rawCreatorId = values.get('--creator-id')!;
  if (!/^[1-9][0-9]*$/u.test(rawCreatorId)) fail('--creator-id must be canonical positive decimal text.');
  const creatorId = Number(rawCreatorId);
  positiveInteger(creatorId, '--creator-id');
  return Object.freeze({
    input: bounded(values.get('--input'), '--input'),
    output: bounded(values.get('--output'), '--output'),
    targetUrl: bounded(values.get('--target-url'), '--target-url'),
    creatorLogin: bounded(values.get('--creator-login'), '--creator-login'),
    creatorId
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.SEC_GITHUB_STATUS_TOKEN;
  if (typeof token !== 'string' || token.length < 20) fail('SEC_GITHUB_STATUS_TOKEN is required.');
  const result = parseIntegrationAuthorizationGateResultV1(readFileSync(args.input, 'utf8'));
  const receipt = await publishIntegrationAuthorizationStatusV1({
    result,
    token,
    targetUrl: args.targetUrl,
    principal: { creatorLogin: args.creatorLogin, creatorId: args.creatorId },
    fetchImpl: dispatchGitHubApiRequestV1
  });
  writeFileSync(args.output, `${encodeVerificationActionDataV2(receipt)}\n`, 'utf8');
}

if (import.meta.main) await main();
