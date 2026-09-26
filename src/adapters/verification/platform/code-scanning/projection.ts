#!/usr/bin/env bun

import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiIssueCommentWriteSession,
  withGitHubApiReadSession
} from '../../../providers/github-api/operation-session.ts';

const PROJECTION_MARKER = '<!-- sec-code-scanning-projection:v1 -->';
const PAGE_SIZE = 100;
const MAX_PAGES = 64;
const MAX_FINDINGS = 100;
const WAIT_EXIT_CODE = 75;
const TICK = String.fromCharCode(96);

type Finding = Readonly<{
  number: number;
  ruleId: string;
  securitySeverity: string | null;
  severity: string;
  message: string;
  path: string;
  startLine: number;
  endLine: number;
  commitSha: string;
  htmlUrl: string;
}>;

export type CodeScanningProjectionOutcome =
  | Readonly<{ status: 'waiting'; reason: string }>
  | Readonly<{
      status: 'projected' | 'reused';
      commentId: number;
      findingCount: number;
      projectionDigest: string;
    }>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be one object');
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(label + ' must be one positive integer');
  }
  return Number(value);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be bounded text');
  }
  return value;
}

function gitSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(label + ' must be one lowercase Git SHA');
  }
  return value;
}

function assertPullIdentity(
  value: unknown,
  repository: string,
  pullRequestNumber: number,
  expectedHeadSha: string
): void {
  const pull = record(value, 'GitHub pull request');
  const head = record(pull.head, 'GitHub pull request head');
  const headRepository = record(head.repo, 'GitHub pull request head repository');
  if (pull.number !== pullRequestNumber || pull.state !== 'open'
      || head.sha !== expectedHeadSha || headRepository.full_name !== repository) {
    throw new Error('Code scanning projection PR/head identity drifted');
  }
}

function parseCheckRun(value: unknown): Readonly<{
  id: number;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
}> {
  const run = record(value, 'GitHub check run');
  return Object.freeze({
    id: positiveInteger(run.id, 'check run id'),
    name: boundedText(run.name, 'check run name', 256),
    headSha: gitSha(run.head_sha, 'check run head SHA'),
    status: boundedText(run.status, 'check run status', 64),
    conclusion: run.conclusion === null
      ? null
      : boundedText(run.conclusion, 'check run conclusion', 64)
  });
}

function parseFinding(value: unknown): Finding {
  const alert = record(value, 'Code scanning alert');
  const rule = record(alert.rule, 'Code scanning rule');
  const tool = record(alert.tool, 'Code scanning tool');
  const instance = record(alert.most_recent_instance, 'Code scanning instance');
  const message = record(instance.message, 'Code scanning message');
  const location = record(instance.location, 'Code scanning location');
  if (alert.state !== 'open' || tool.name !== 'CodeQL') {
    throw new Error('Code scanning projection received a non-open/non-CodeQL alert');
  }
  const htmlUrl = boundedText(alert.html_url, 'Code scanning alert URL', 2048);
  if (!htmlUrl.startsWith('https://github.com/')) {
    throw new Error('Code scanning alert URL is not a canonical GitHub URL');
  }
  const securitySeverity = rule.security_severity_level === null
    || rule.security_severity_level === undefined
    ? null
    : boundedText(rule.security_severity_level, 'Code scanning security severity', 64);
  return Object.freeze({
    number: positiveInteger(alert.number, 'Code scanning alert number'),
    ruleId: boundedText(rule.id, 'Code scanning rule id', 256),
    securitySeverity,
    severity: boundedText(rule.severity, 'Code scanning severity', 64),
    message: boundedText(message.text, 'Code scanning message', 1024),
    path: boundedText(location.path, 'Code scanning path', 2048),
    startLine: positiveInteger(location.start_line, 'Code scanning start line'),
    endLine: positiveInteger(location.end_line, 'Code scanning end line'),
    commitSha: gitSha(instance.commit_sha, 'Code scanning instance commit SHA'),
    htmlUrl
  });
}

function markdownText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(String.fromCharCode(96), '\\' + TICK).replaceAll('\n', ' ');
}

function severityRank(value: string | null): number {
  switch (value) {
    case 'critical': return 0;
    case 'high': return 1;
    case 'medium': return 2;
    case 'low': return 3;
    case 'warning': return 4;
    case 'note': return 5;
    default: return 6;
  }
}

export function renderCodeScanningProjection(input: Readonly<{
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  findings: readonly Finding[];
}>): Readonly<{ body: string; projectionDigest: string }> {
  const findings = [...input.findings].sort((left, right) =>
    severityRank(left.securitySeverity) - severityRank(right.securitySeverity)
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine
    || left.ruleId.localeCompare(right.ruleId)
    || left.number - right.number
  );
  if (findings.length > MAX_FINDINGS) {
    throw new Error('Code scanning projection exceeds ' + MAX_FINDINGS + ' open findings');
  }
  const projectionDigest = sha256(Object.freeze({
    schema: 'sec-code-scanning-projection-v1',
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    findings
  }));
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = finding.securitySeverity ?? finding.severity;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const summary = findings.length === 0
    ? '0 open CodeQL findings.'
    : [...counts.entries()]
      .sort(([left], [right]) => severityRank(left) - severityRank(right) || left.localeCompare(right))
      .map(([severity, count]) => String(count) + ' ' + severity).join(', ');
  const detail = findings.length === 0
    ? ['- No open CodeQL findings are associated with the current PR observation.']
    : findings.map((finding) => {
      const severity = finding.securitySeverity ?? finding.severity;
      return '- **' + markdownText(severity) + '** '
        + TICK + markdownText(finding.ruleId) + TICK + ' — '
        + TICK + markdownText(finding.path) + ':' + finding.startLine + TICK + ' — '
        + markdownText(finding.message) + ' — '
        + '[alert #' + finding.number + '](' + finding.htmlUrl + ')';
    });
  const body = [
    PROJECTION_MARKER,
    '### Code scanning findings',
    '',
    'Exact PR head: ' + TICK + input.headSha + TICK,
    'GitHub Code Scanning / CodeQL: **' + summary + '**',
    'This comment is a durable human-readable projection only; GitHub Code Scanning remains the authoritative merge/security evidence.',
    '',
    ...detail,
    '',
    'Projection digest: ' + TICK + projectionDigest + TICK
  ].join('\n');
  if (Buffer.byteLength(body, 'utf8') > 60_000) {
    throw new Error('Code scanning projection comment exceeds the bounded publication size');
  }
  return Object.freeze({ body, projectionDigest });
}

async function observeCurrentFindings(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
}>): Promise<Readonly<{ status: 'waiting'; reason: string } | {
  status: 'ready';
  findings: readonly Finding[];
}>> {
  return await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      assertPullIdentity(
        await executeGitHubApiOperation(capability, {
          kind: 'pull',
          pullRequestNumber: input.pullRequestNumber
        }),
        input.repository,
        input.pullRequestNumber,
        input.expectedHeadSha
      );

      const checkRuns: ReturnType<typeof parseCheckRun>[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = record(await executeGitHubApiOperation(capability, {
          kind: 'check-runs',
          sha: input.expectedHeadSha,
          page
        }), 'GitHub check runs page');
        if (!Array.isArray(response.check_runs)) {
          throw new Error('GitHub check runs response lacks check_runs');
        }
        checkRuns.push(...response.check_runs.map(parseCheckRun));
        if (response.check_runs.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) throw new Error('GitHub check runs exceed bounded pagination');
      }
      const javascriptRuns = checkRuns
        .filter((run) => run.name === 'Analyze (javascript-typescript)'
          && run.headSha === input.expectedHeadSha)
        .sort((left, right) => right.id - left.id);
      const javascriptRun = javascriptRuns[0];
      if (javascriptRun === undefined || javascriptRun.status !== 'completed') {
        return Object.freeze({
          status: 'waiting' as const,
          reason: 'exact-head JavaScript/TypeScript CodeQL analysis is not complete'
        });
      }
      if (javascriptRun.conclusion !== 'success') {
        throw new Error(
          'exact-head JavaScript/TypeScript CodeQL analysis completed as '
            + (javascriptRun.conclusion ?? 'unknown')
        );
      }

      const findings: Finding[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await executeGitHubApiOperation(capability, {
          kind: 'code-scanning-alerts',
          pullRequestNumber: input.pullRequestNumber,
          page
        });
        if (!Array.isArray(response)) {
          throw new Error('GitHub code scanning alerts response is not an array');
        }
        findings.push(...response.map(parseFinding));
        if (response.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) throw new Error('GitHub code scanning alerts exceed bounded pagination');
      }
      return Object.freeze({ status: 'ready' as const, findings: Object.freeze(findings) });
    }
  });
}

async function publishProjection(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
  body: string;
}>): Promise<Readonly<{ status: 'projected' | 'reused'; commentId: number }>> {
  return await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      assertPullIdentity(
        await executeGitHubApiOperation(capability, {
          kind: 'pull',
          pullRequestNumber: input.pullRequestNumber
        }),
        input.repository,
        input.pullRequestNumber,
        input.expectedHeadSha
      );
      const principal = inspectGitHubApiCapability(capability).principal;
      const comments: Record<string, unknown>[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await executeGitHubApiOperation(capability, {
          kind: 'issue-comments',
          issueNumber: input.pullRequestNumber,
          page
        });
        if (!Array.isArray(response)) throw new Error('GitHub issue comments response is not an array');
        comments.push(...response.map((entry) => record(entry, 'GitHub issue comment')));
        if (response.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) throw new Error('GitHub issue comments exceed bounded pagination');
      }
      const owned = comments.filter((comment) =>
        typeof comment.body === 'string' && comment.body.startsWith(PROJECTION_MARKER)
      );
      if (owned.length > 1) throw new Error('multiple Code scanning projection comments exist');
      const current = owned[0];
      if (current !== undefined) {
        const author = record(current.user, 'Code scanning projection comment author');
        if (author.login !== principal.login) {
          throw new Error('Code scanning projection marker is owned by another principal');
        }
        const commentId = positiveInteger(current.id, 'Code scanning projection comment id');
        if (current.body === input.body) return Object.freeze({ status: 'reused' as const, commentId });
        const updated = record(await executeGitHubApiOperation(capability, {
          kind: 'update-issue-comment',
          commentId,
          body: input.body
        }), 'updated Code scanning projection comment');
        if (updated.id !== commentId || updated.body !== input.body) {
          throw new Error('Code scanning projection update readback differs');
        }
        return Object.freeze({ status: 'projected' as const, commentId });
      }
      const created = record(await executeGitHubApiOperation(capability, {
        kind: 'create-issue-comment',
        issueNumber: input.pullRequestNumber,
        body: input.body
      }), 'created Code scanning projection comment');
      const commentId = positiveInteger(created.id, 'created Code scanning projection comment id');
      if (created.body !== input.body) throw new Error('Code scanning projection creation readback differs');
      return Object.freeze({ status: 'projected' as const, commentId });
    }
  });
}

export async function projectCodeScanningFindings(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
}>): Promise<CodeScanningProjectionOutcome> {
  gitSha(input.expectedHeadSha, 'expected head SHA');
  positiveInteger(input.pullRequestNumber, 'pull request number');
  const observed = await observeCurrentFindings(input);
  if (observed.status === 'waiting') return observed;
  const projection = renderCodeScanningProjection({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.expectedHeadSha,
    findings: observed.findings
  });
  const publication = await publishProjection({
    ...input,
    body: projection.body
  });
  return Object.freeze({
    ...publication,
    findingCount: observed.findings.length,
    projectionDigest: projection.projectionDigest
  });
}

function environmentRequest(): Readonly<{
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
}> {
  const repository = boundedText(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY', 256);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is not owner/name');
  }
  const rawPr = process.env.SEC_CODE_SCANNING_PR_NUMBER;
  if (rawPr === undefined || !/^[1-9][0-9]*$/u.test(rawPr)) {
    throw new Error('SEC_CODE_SCANNING_PR_NUMBER is invalid');
  }
  return Object.freeze({
    repository,
    pullRequestNumber: positiveInteger(Number(rawPr), 'SEC_CODE_SCANNING_PR_NUMBER'),
    expectedHeadSha: gitSha(process.env.SEC_CODE_SCANNING_EXPECTED_HEAD, 'SEC_CODE_SCANNING_EXPECTED_HEAD')
  });
}

if (import.meta.main) {
  const request = environmentRequest();
  const outcome = await projectCodeScanningFindings({
    repositoryRoot: path.resolve(process.cwd()),
    ...request
  });
  process.stdout.write(JSON.stringify(outcome) + '\n');
  if (outcome.status === 'waiting') process.exitCode = WAIT_EXIT_CODE;
}
