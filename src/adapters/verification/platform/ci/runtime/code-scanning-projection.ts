import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiIssueCommentWriteSession,
  withGitHubApiReadSession
} from '../../../../providers/github-api/operation-session.ts';

const COMMENT_MARKER = '<!-- sec-code-scanning-projection:v1 -->' as const;
const MAX_ALERT_PAGES = 32;
const MAX_COMMENT_PAGES = 64;
const PAGE_SIZE = 100;
const TICK = String.fromCharCode(96);

export type CodeScanningFinding = Readonly<{
  alertNumber: number;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  path: string;
  startLine: number;
  endLine: number;
  htmlUrl: string;
}>;

export type CodeScanningProjection = Readonly<{
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  analysisSha: string;
  sourceRunId: string;
  findings: readonly CodeScanningFinding[];
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be one object');
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(label + ' must be one positive integer');
  return Number(value);
}

function boundedText(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be bounded text');
  }
  return value;
}

function gitSha(value: unknown, label: string): string {
  const parsed = boundedText(value, label, 40);
  if (!/^[0-9a-f]{40}$/u.test(parsed)) throw new Error(label + ' must be one Git SHA');
  return parsed;
}

function repositoryName(value: unknown): string {
  const parsed = boundedText(value, 'repository', 201);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[-A-Za-z0-9._]{1,100}$/u.test(parsed)) {
    throw new Error('repository must be one bounded owner/name identity');
  }
  return parsed;
}

function markdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function severityRank(value: string): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3, error: 4, warning: 5, note: 6 } as Record<string, number>)[value] ?? 7;
}

export function parseCodeScanningFinding(value: unknown, expectedAnalysisSha: string): CodeScanningFinding | null {
  const alert = record(value, 'code scanning alert');
  if (alert.state !== 'open') return null;
  const tool = record(alert.tool, 'code scanning alert tool');
  if (tool.name !== 'CodeQL') return null;
  const instance = record(alert.most_recent_instance, 'code scanning alert instance');
  if (gitSha(instance.commit_sha, 'code scanning alert analysis commit') !== expectedAnalysisSha) return null;
  const rule = record(alert.rule, 'code scanning alert rule');
  const location = record(instance.location, 'code scanning alert location');
  const message = record(instance.message, 'code scanning alert message');
  const securitySeverity = typeof rule.security_severity_level === 'string'
    ? rule.security_severity_level : rule.severity;
  const htmlUrl = boundedText(alert.html_url, 'code scanning alert URL', 2048);
  if (!htmlUrl.startsWith('https://github.com/')) throw new Error('code scanning alert URL is not GitHub');
  return Object.freeze({
    alertNumber: positiveInteger(alert.number, 'code scanning alert number'),
    ruleId: boundedText(rule.id, 'code scanning rule id', 256),
    ruleName: boundedText(rule.name, 'code scanning rule name', 512),
    severity: boundedText(securitySeverity, 'code scanning severity', 32).toLowerCase(),
    message: boundedText(message.text, 'code scanning alert message', 4096),
    path: boundedText(location.path, 'code scanning alert path', 4096),
    startLine: positiveInteger(location.start_line, 'code scanning alert start line'),
    endLine: positiveInteger(location.end_line, 'code scanning alert end line'),
    htmlUrl
  });
}

export function renderCodeScanningProjection(projection: CodeScanningProjection): string {
  const findings = [...projection.findings].sort((left, right) =>
    severityRank(left.severity) - severityRank(right.severity)
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine
    || left.ruleId.localeCompare(right.ruleId)
    || left.alertNumber - right.alertNumber);
  const lines = [
    COMMENT_MARKER,
    '## CodeQL findings',
    '',
    '> SEC projection only. GitHub Code Scanning remains the authoritative security evidence.',
    '',
    '- Exact PR head: ' + TICK + projection.headSha + TICK,
    '- Analysis merge SHA: ' + TICK + projection.analysisSha + TICK,
    '- CodeQL workflow run: ' + TICK + projection.sourceRunId + TICK,
    '- Open findings for this analysis: **' + findings.length + '**',
    ''
  ];
  if (findings.length === 0) {
    lines.push('No open CodeQL findings are reported for this exact PR analysis.');
  } else {
    lines.push('| Severity | Rule | Location | Finding |', '| --- | --- | --- | --- |');
    for (const finding of findings) {
      const location = markdown(finding.path) + ':' + finding.startLine
        + (finding.endLine === finding.startLine ? '' : '-' + finding.endLine);
      lines.push('| ' + markdown(finding.severity) + ' | ' + TICK + markdown(finding.ruleId) + TICK
        + ' ' + markdown(finding.ruleName) + ' | ' + TICK + location + TICK + ' | [#'
        + finding.alertNumber + '](' + finding.htmlUrl + ') ' + markdown(finding.message) + ' |');
    }
  }
  return lines.join('\n') + '\n';
}

function workflowRunBinding(run: Record<string, unknown>): Readonly<{
  pullRequestNumber: number;
  headSha: string;
  analysisSha: string;
}> {
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) {
    throw new Error('CodeQL workflow run must bind exactly one pull request');
  }
  const pull = record(run.pull_requests[0], 'workflow run pull request');
  const head = record(pull.head, 'workflow run pull request head');
  const base = record(pull.base, 'workflow run pull request base');
  if (base.ref !== 'main') throw new Error('CodeQL workflow run is not for main');
  return Object.freeze({
    pullRequestNumber: positiveInteger(pull.number, 'pull request number'),
    headSha: gitSha(head.sha, 'workflow run pull request head SHA'),
    analysisSha: gitSha(run.head_sha, 'CodeQL analysis merge SHA')
  });
}

async function observeProjection(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  runId: string;
}>): Promise<CodeScanningProjection> {
  return await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const run = record(await executeGitHubApiOperation(capability, {
        kind: 'workflow-run', runId: input.runId
      }), 'CodeQL workflow run');
      if (String(run.id) !== input.runId || run.name !== 'CodeQL' || run.event !== 'pull_request'
          || run.status !== 'completed' || run.conclusion !== 'success') {
        throw new Error('workflow run is not one successful completed pull-request CodeQL run');
      }
      const binding = workflowRunBinding(run);
      const pull = record(await executeGitHubApiOperation(capability, {
        kind: 'pull', pullRequestNumber: binding.pullRequestNumber
      }), 'CodeQL pull request');
      const pullHead = record(pull.head, 'CodeQL pull request head');
      const pullBase = record(pull.base, 'CodeQL pull request base');
      if (pull.number !== binding.pullRequestNumber || pull.state !== 'open'
          || pullHead.sha !== binding.headSha || pullBase.ref !== 'main') {
        throw new Error('CodeQL workflow run no longer binds the exact open main-targeting PR head');
      }
      const findings: CodeScanningFinding[] = [];
      for (let page = 1; page <= MAX_ALERT_PAGES; page += 1) {
        const alerts = await executeGitHubApiOperation(capability, {
          kind: 'code-scanning-alerts', pullRequestNumber: binding.pullRequestNumber, page
        });
        if (!Array.isArray(alerts)) throw new Error('code scanning alert inventory is invalid');
        for (const alert of alerts) {
          const finding = parseCodeScanningFinding(alert, binding.analysisSha);
          if (finding !== null) findings.push(finding);
        }
        if (alerts.length < PAGE_SIZE) {
          const byNumber = new Map<number, CodeScanningFinding>();
          for (const finding of findings) byNumber.set(finding.alertNumber, finding);
          return Object.freeze({
            repository: input.repository,
            pullRequestNumber: binding.pullRequestNumber,
            headSha: binding.headSha,
            analysisSha: binding.analysisSha,
            sourceRunId: input.runId,
            findings: Object.freeze([...byNumber.values()])
          });
        }
      }
      throw new Error('code scanning alert inventory exceeds bounded pagination');
    }
  });
}

async function publishProjection(input: Readonly<{
  repositoryRoot: string;
  projection: CodeScanningProjection;
}>): Promise<Readonly<{ status: 'created' | 'updated' | 'reused'; commentId: number }>> {
  const body = renderCodeScanningProjection(input.projection);
  return await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.projection.repository,
    operation: async (capability) => {
      const principal = inspectGitHubApiCapability(capability).principal.login;
      const matching: Array<Readonly<{ id: number; body: string }>> = [];
      for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
        const comments = await executeGitHubApiOperation(capability, {
          kind: 'issue-comments', issueNumber: input.projection.pullRequestNumber, page
        });
        if (!Array.isArray(comments)) throw new Error('issue comment inventory is invalid');
        for (const value of comments) {
          const comment = record(value, 'issue comment');
          const user = record(comment.user, 'issue comment user');
          if (user.login === principal && typeof comment.body === 'string'
              && comment.body.startsWith(COMMENT_MARKER)) {
            matching.push(Object.freeze({
              id: positiveInteger(comment.id, 'issue comment id'), body: comment.body
            }));
          }
        }
        if (comments.length < PAGE_SIZE) break;
        if (page === MAX_COMMENT_PAGES) throw new Error('issue comment inventory exceeds bounded pagination');
      }
      if (matching.length > 1) throw new Error('multiple CodeQL projection comments exist for this pull request');
      let status: 'created' | 'updated' | 'reused';
      let commentId: number;
      if (matching.length === 0) {
        const created = record(await executeGitHubApiOperation(capability, {
          kind: 'create-issue-comment', issueNumber: input.projection.pullRequestNumber, body
        }), 'created CodeQL projection comment');
        commentId = positiveInteger(created.id, 'created CodeQL projection comment id');
        status = 'created';
      } else if (matching[0]!.body === body) {
        commentId = matching[0]!.id;
        status = 'reused';
      } else {
        commentId = matching[0]!.id;
        await executeGitHubApiOperation(capability, {
          kind: 'update-issue-comment', commentId, body
        });
        status = 'updated';
      }
      const readback = record(await executeGitHubApiOperation(capability, {
        kind: 'issue-comment', commentId
      }), 'CodeQL projection comment readback');
      const user = record(readback.user, 'CodeQL projection comment readback user');
      if (readback.id !== commentId || readback.body !== body || user.login !== principal) {
        throw new Error('CodeQL projection comment readback differs from exact publication');
      }
      return Object.freeze({ status, commentId });
    }
  });
}

export async function projectCodeScanningRun(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  runId: string;
}>): Promise<Readonly<{
  status: 'created' | 'updated' | 'reused';
  commentId: number;
  pullRequestNumber: number;
  headSha: string;
  analysisSha: string;
  findingCount: number;
}>> {
  const repository = repositoryName(input.repository);
  if (!/^[1-9][0-9]*$/u.test(input.runId)) throw new Error('runId must be one positive integer string');
  const projection = await observeProjection({ ...input, repository });
  const published = await publishProjection({ repositoryRoot: input.repositoryRoot, projection });
  return Object.freeze({
    ...published,
    pullRequestNumber: projection.pullRequestNumber,
    headSha: projection.headSha,
    analysisSha: projection.analysisSha,
    findingCount: projection.findings.length
  });
}

export async function codeScanningProjectionCli(argv: readonly string[]): Promise<string> {
  if (argv.length !== 2 || argv[0] !== 'publish' || !/^[1-9][0-9]*$/u.test(argv[1] ?? '')) {
    throw new Error('usage: code-scanning-projection publish <workflow-run-id>');
  }
  const repository = repositoryName(process.env.GITHUB_REPOSITORY);
  const workflowRef = repository + '/.github/workflows/code-scanning-projection.yml@refs/heads/main';
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_run'
      || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_SHA === undefined
      || process.env.GITHUB_SHA !== process.env.GITHUB_WORKFLOW_SHA
      || process.env.GITHUB_WORKFLOW_REF !== workflowRef) {
    throw new Error('Code scanning projection must execute from the exact trusted default-branch workflow identity');
  }
  return JSON.stringify(await projectCodeScanningRun({
    repositoryRoot: process.cwd(),
    repository,
    runId: argv[1]!
  }), null, 2);
}

if (import.meta.main) {
  process.stdout.write((await codeScanningProjectionCli(process.argv.slice(2))) + '\n');
}
