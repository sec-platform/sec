import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiProjectionCommentWriteSession,
  withGitHubApiReadSession
} from '../../../../providers/github-api/operation-session.ts';

const COMMENT_MARKER = '<!-- sec-code-scanning-projection:v1 -->' as const;
const MAX_ALERT_PAGES = 32;
const MAX_CHECK_PAGES = 32;
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
  mergeSha: string;
  codeQlCheckId: number;
  findings: readonly CodeScanningFinding[];
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be one positive integer`);
  }
  return Number(value);
}

function positiveIntegerText(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be one positive integer string`);
  }
  return positiveInteger(Number(value), label);
}

function boundedText(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded text`);
  }
  return value;
}

function gitSha(value: unknown, label: string): string {
  const parsed = boundedText(value, label, 40);
  if (!/^[0-9a-f]{40}$/u.test(parsed)) throw new Error(`${label} must be one Git SHA`);
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

export function parseCodeScanningFinding(
  value: unknown,
  expectedRef: string
): CodeScanningFinding | null {
  const alert = record(value, 'code scanning alert');
  if (alert.state !== 'open') return null;
  const tool = record(alert.tool, 'code scanning alert tool');
  if (tool.name !== 'CodeQL') return null;
  const instance = record(alert.most_recent_instance, 'code scanning alert instance');
  gitSha(instance.commit_sha, 'code scanning alert instance commit');
  if (instance.ref !== expectedRef) return null;
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
    '- PR merge analysis: ' + TICK + projection.mergeSha + TICK,
    '- CodeQL check: ' + TICK + projection.codeQlCheckId + TICK,
    '- Open findings for this exact analysis: **' + findings.length + '**',
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
  return lines.join('\n');
}

function assertFinalCodeQlCheck(
  value: unknown,
  expectedHeadSha: string,
  expectedCheckId: number
): number {
  const check = record(value, 'CodeQL check run');
  const app = record(check.app, 'CodeQL check app');
  const output = record(check.output, 'CodeQL check output');
  const annotations = output.annotations_count;
  if (check.id !== expectedCheckId
      || check.name !== 'CodeQL'
      || check.head_sha !== expectedHeadSha
      || check.status !== 'completed'
      || (check.conclusion !== 'success' && check.conclusion !== 'failure')
      || app.slug !== 'github-advanced-security'
      || !Number.isSafeInteger(annotations)
      || Number(annotations) < 0) {
    throw new Error('CodeQL check is not the final GitHub Advanced Security result for the exact PR head');
  }
  return Number(annotations);
}

export function assertCodeScanningFindingProjectionConsistent(
  codeQlAnnotationCount: number,
  findings: readonly CodeScanningFinding[]
): void {
  if (!Number.isSafeInteger(codeQlAnnotationCount) || codeQlAnnotationCount < 0) {
    throw new Error('CodeQL annotation count must be a non-negative safe integer');
  }
  if (codeQlAnnotationCount > 0 && findings.length === 0) {
    throw new Error(
      'CodeQL reported annotations but the PR-scoped finding projection is empty'
    );
  }
}

async function observeProjection(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
  expectedCheckId: number;
}>): Promise<CodeScanningProjection> {
  return await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const pull = record(await executeGitHubApiOperation(capability, {
        kind: 'pull', pullRequestNumber: input.pullRequestNumber
      }), 'CodeQL pull request');
      const pullHead = record(pull.head, 'CodeQL pull request head');
      const pullHeadRepo = record(pullHead.repo, 'CodeQL pull request head repository');
      const pullBase = record(pull.base, 'CodeQL pull request base');
      if (pull.number !== input.pullRequestNumber
          || pull.state !== 'open'
          || pullBase.ref !== 'main'
          || pullHead.sha !== input.expectedHeadSha
          || pullHeadRepo.full_name !== input.repository) {
        throw new Error('CodeQL projection no longer binds the exact open same-repository main-targeting PR head');
      }
      const mergeSha = gitSha(pull.merge_commit_sha, 'pull request merge analysis SHA');

      const finalChecks: unknown[] = [];
      for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
        const response = record(await executeGitHubApiOperation(capability, {
          kind: 'check-runs', sha: input.expectedHeadSha, page
        }), 'check run inventory');
        const checks = response.check_runs;
        if (!Array.isArray(checks)) throw new Error('check run inventory is invalid');
        for (const check of checks) {
          const item = record(check, 'check run');
          if (item.id === input.expectedCheckId) finalChecks.push(check);
        }
        if (checks.length < PAGE_SIZE) break;
        if (page === MAX_CHECK_PAGES) throw new Error('check run inventory exceeds bounded pagination');
      }
      if (finalChecks.length !== 1) throw new Error('exact CodeQL check is absent or duplicated');
      const codeQlAnnotationCount = assertFinalCodeQlCheck(
        finalChecks[0],
        input.expectedHeadSha,
        input.expectedCheckId
      );

      const expectedRef = `refs/pull/${input.pullRequestNumber}/merge`;
      const findings: CodeScanningFinding[] = [];
      for (let page = 1; page <= MAX_ALERT_PAGES; page += 1) {
        const alerts = await executeGitHubApiOperation(capability, {
          kind: 'code-scanning-alerts', pullRequestNumber: input.pullRequestNumber, page
        });
        if (!Array.isArray(alerts)) throw new Error('code scanning alert inventory is invalid');
        for (const alert of alerts) {
          const finding = parseCodeScanningFinding(alert, expectedRef);
          if (finding !== null) findings.push(finding);
        }
        if (alerts.length < PAGE_SIZE) {
          const byNumber = new Map<number, CodeScanningFinding>();
          for (const finding of findings) byNumber.set(finding.alertNumber, finding);
          const projectedFindings = Object.freeze([...byNumber.values()]);
          assertCodeScanningFindingProjectionConsistent(
            codeQlAnnotationCount,
            projectedFindings
          );
          return Object.freeze({
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            headSha: input.expectedHeadSha,
            mergeSha,
            codeQlCheckId: input.expectedCheckId,
            findings: projectedFindings
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
  return await withGitHubApiProjectionCommentWriteSession({
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
              id: positiveInteger(comment.id, 'issue comment id'),
              body: comment.body
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

export async function projectCodeScanningPullRequest(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  expectedHeadSha: string;
  expectedCheckId: number;
}>): Promise<Readonly<{
  status: 'created' | 'updated' | 'reused';
  commentId: number;
  pullRequestNumber: number;
  headSha: string;
  mergeSha: string;
  codeQlCheckId: number;
  findingCount: number;
}>> {
  const repository = repositoryName(input.repository);
  const projection = await observeProjection({ ...input, repository });
  const published = await publishProjection({ repositoryRoot: input.repositoryRoot, projection });
  return Object.freeze({
    ...published,
    pullRequestNumber: projection.pullRequestNumber,
    headSha: projection.headSha,
    mergeSha: projection.mergeSha,
    codeQlCheckId: projection.codeQlCheckId,
    findingCount: projection.findings.length
  });
}

export async function codeScanningProjectionCli(argv: readonly string[]): Promise<string> {
  if (argv.length !== 1 || argv[0] !== 'publish') {
    throw new Error('usage: code-scanning-projection publish');
  }
  const repository = repositoryName(process.env.GITHUB_REPOSITORY);
  const workflowRef = repository + '/.github/workflows/code-scanning-projection.yml@refs/heads/main';
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target'
      || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_SHA === undefined
      || process.env.GITHUB_SHA !== process.env.GITHUB_WORKFLOW_SHA
      || process.env.GITHUB_WORKFLOW_REF !== workflowRef) {
    throw new Error('Code scanning projection must execute from the exact trusted default-branch workflow identity');
  }
  return JSON.stringify(await projectCodeScanningPullRequest({
    repositoryRoot: process.cwd(),
    repository,
    pullRequestNumber: positiveIntegerText(process.env.SEC_CODE_SCANNING_PR_NUMBER, 'pull request number'),
    expectedHeadSha: gitSha(process.env.SEC_CODE_SCANNING_HEAD_SHA, 'expected pull request head'),
    expectedCheckId: positiveIntegerText(process.env.SEC_CODE_SCANNING_CHECK_ID, 'CodeQL check id')
  }), null, 2);
}

if (import.meta.main) {
  process.stdout.write((await codeScanningProjectionCli(process.argv.slice(2))) + '\n');
}
