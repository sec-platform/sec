#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  classifySecRepositorySurface,
  resolveSecMarkdownSkillCoverage,
  resolveSecRepositoryHeuristicSkills,
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_OWNERS,
  type SecAgentSkillId,
  type SecRepositorySurfaceKind
} from '../../platform/shared/agent-skill-contract.ts';

const DEFAULT_REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.ejs', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
  '.ps1', '.py', '.sh', '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml'
]);
const TEXT_BASENAMES = new Set([
  '.bun-version', '.dependency-cruiser.json', '.gitattributes', '.gitignore',
  '.npmrc', 'Dockerfile', 'LICENSE'
]);
const MAX_TEXT_FILE_BYTES = 2_000_000;
const HEURISTIC_MARKER = /(?:必须|不得|禁止|只允许|仅当|只有|需要|应当|优先|默认|触发|停止|回退|重算|fail[- ]?closed|DO NOT MERGE|reload_if|gate_owner|Work Package|Task Envelope|Agent Skill)/iu;
const AGENT_CONTEXT_MARKER = /(?:Agent|Codex|Work Package|Task Envelope|Skill|Review|CI|Gate|merge|branch|tool|工具|文档|验证|仓库|上下文|恢复|分派|权限|owner|authority)/iu;
const STRONG_AGENT_CONTEXT_MARKER = /(?:Agent|Codex|Work Package|Task Envelope|Agent Skill)/iu;
const MALFORMED_REPOSITORY_REFERENCE = /(?:\t(?:ests|platform|scripts|docs)\/|\\(?:tests|platform|scripts|docs)\/)/u;
const DYNAMIC_IDENTITY = /(?:\b[0-9a-f]{40}\b|\bPR\s*#\d+\b|\b(?:run|job)\s*#?\d{8,}\b)/iu;

export type RepositoryAuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RepositoryAuditFinding {
  code: string;
  line?: number;
  message: string;
  path?: string;
  severity: RepositoryAuditSeverity;
  skills?: readonly SecAgentSkillId[];
}

export interface RepositoryAuditReport {
  behaviorOwners: typeof SEC_REPOSITORY_BEHAVIOR_OWNERS;
  findings: readonly RepositoryAuditFinding[];
  optimizations: readonly string[];
  revision: Readonly<{
    defaultHead: string | null;
    defaultRef: string;
    head: string;
  }>;
  schema: 'sec-repository-audit-v1';
  summary: Readonly<{
    activeMarkdown: number;
    behaviorCandidates: number;
    findings: Readonly<Record<RepositoryAuditSeverity, number>>;
    markdown: number;
    skills: number;
    trackedPaths: number;
    unknowns: number;
  }>;
  surfaces: Readonly<Record<SecRepositorySurfaceKind, number>>;
  unknowns: readonly string[];
}

export interface BehaviorCandidate {
  line: number;
  path: string;
  skills: readonly SecAgentSkillId[];
  text: string;
}

interface GitOptions {
  allowFailure?: boolean;
}

function runGitBytes(
  repositoryRoot: string,
  args: readonly string[],
  options: GitOptions = {}
): Buffer | null {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    windowsHide: true
  });
  if (result.error) {
    if (options.allowFailure) return null;
    throw result.error;
  }
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr).trim();
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
  if (!Buffer.isBuffer(result.stdout)) {
    return Buffer.from(String(result.stdout), 'utf8');
  }
  return result.stdout;
}

function runGitText(
  repositoryRoot: string,
  args: readonly string[],
  options: GitOptions = {}
): string | null {
  return runGitBytes(repositoryRoot, args, options)?.toString('utf8').trim() ?? null;
}

export function trackedRepositoryFiles(repositoryRoot = DEFAULT_REPOSITORY_ROOT): string[] {
  const raw = runGitBytes(repositoryRoot, ['ls-files', '-z']);
  if (!raw) throw new Error('git ls-files returned no output');
  return raw.toString('utf8').split('\0').filter(Boolean).sort();
}

function isTextPath(repositoryPath: string): boolean {
  const basename = path.posix.basename(repositoryPath);
  return TEXT_BASENAMES.has(basename) || TEXT_EXTENSIONS.has(path.posix.extname(repositoryPath));
}

async function readTextCandidate(
  repositoryRoot: string,
  repositoryPath: string
): Promise<string | null> {
  if (!isTextPath(repositoryPath)) return null;
  const absolutePath = path.join(repositoryRoot, repositoryPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size > MAX_TEXT_FILE_BYTES) return null;
  const content = await readFile(absolutePath, 'utf8');
  return content.includes('\0') ? null : content;
}

function markdownStatus(source: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
  if (!frontmatter) return null;
  return /^status:\s*([^\s#]+)\s*$/mu.exec(frontmatter)?.[1] ?? null;
}

function behaviorSkills(repositoryPath: string): SecAgentSkillId[] {
  const markdown = resolveSecMarkdownSkillCoverage(repositoryPath);
  return markdown?.skills ?? resolveSecRepositoryHeuristicSkills(repositoryPath);
}

export function extractHeuristicBehaviorCandidates(
  repositoryPath: string,
  source: string
): BehaviorCandidate[] {
  const markdown = resolveSecMarkdownSkillCoverage(repositoryPath);
  if (markdown && (
    markdown.kind === 'historical'
    || markdown.kind === 'evidence'
    || markdown.kind === 'frozen-work-package'
    || markdown.kind === 'verification-fixture'
  )) {
    return [];
  }

  const skills = behaviorSkills(repositoryPath);
  const contextMarker = skills.length > 0 ? AGENT_CONTEXT_MARKER : STRONG_AGENT_CONTEXT_MARKER;
  const candidates: BehaviorCandidate[] = [];
  let fenced = false;
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || !HEURISTIC_MARKER.test(line) || !contextMarker.test(line)) {
      continue;
    }
    candidates.push(Object.freeze({
      line: index + 1,
      path: repositoryPath,
      skills: Object.freeze([...skills]),
      text: line
    }));
  }
  return candidates;
}

function countFindings(
  findings: readonly RepositoryAuditFinding[]
): Readonly<Record<RepositoryAuditSeverity, number>> {
  return Object.freeze({
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length
  });
}

function pushFinding(
  findings: RepositoryAuditFinding[],
  finding: RepositoryAuditFinding
): void {
  findings.push(Object.freeze({
    ...finding,
    skills: finding.skills ? Object.freeze([...finding.skills]) : undefined
  }));
}

function parseActiveManifest(pointer: string): string | null {
  return /^\s*manifest:\s*(\S+)\s*$/mu.exec(pointer)?.[1] ?? null;
}

function parseManifestDigest(pointer: string): string | null {
  return /^\s*manifestDigest:\s*sha256:([a-f0-9]{64})\s*$/mu.exec(pointer)?.[1] ?? null;
}

function currentRollingPackage(rollingPlan: string): string | null {
  const currentSection = /## 当前唯一 Work Package\s+([\s\S]*?)(?:\n## |\s*$)/u.exec(rollingPlan)?.[1];
  return currentSection
    ? /^###\s+([^\s]+)\s*$/mu.exec(currentSection)?.[1] ?? null
    : null;
}

async function auditControlPlane(
  repositoryRoot: string,
  tracked: readonly string[],
  defaultRef: string,
  findings: RepositoryAuditFinding[],
  unknowns: string[]
): Promise<void> {
  const pointerPath = 'docs/work/active-work-package.md';
  const rollingPath = 'docs/work/rolling-plan.md';
  if (!tracked.includes(pointerPath) || !tracked.includes(rollingPath)) {
    unknowns.push('docs/work control plane is incomplete');
    return;
  }

  const pointer = await readFile(path.join(repositoryRoot, pointerPath), 'utf8');
  const rollingPlan = await readFile(path.join(repositoryRoot, rollingPath), 'utf8');
  const manifestPath = parseActiveManifest(pointer);
  const expectedDigest = parseManifestDigest(pointer);
  const rollingPackage = currentRollingPackage(rollingPlan);
  if (!manifestPath || !expectedDigest) {
    pushFinding(findings, {
      code: 'control-plane-pointer-invalid',
      message: 'active Work Package pointer does not expose one canonical manifest path and sha256 digest',
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }
  if (!tracked.includes(manifestPath)) {
    pushFinding(findings, {
      code: 'control-plane-manifest-missing',
      message: `active pointer references untracked manifest ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }

  const manifestBytes = runGitBytes(repositoryRoot, ['show', `HEAD:${manifestPath}`]);
  if (manifestBytes === null) {
    pushFinding(findings, {
      code: 'control-plane-manifest-blob-unavailable',
      message: `active manifest has no raw Git blob at HEAD: ${manifestPath}`,
      path: pointerPath,
      severity: 'critical'
    });
    return;
  }
  const actualDigest = createHash('sha256').update(manifestBytes).digest('hex');
  if (actualDigest !== expectedDigest) {
    pushFinding(findings, {
      code: 'control-plane-digest-drift',
      message: `active manifest digest mismatch: expected=${expectedDigest} actual=${actualDigest}`,
      path: pointerPath,
      severity: 'critical'
    });
  }

  const defaultManifestBytes = runGitBytes(
    repositoryRoot,
    ['show', `${defaultRef}:${manifestPath}`],
    { allowFailure: true }
  );
  if (defaultManifestBytes !== null) {
    const defaultDigest = createHash('sha256').update(defaultManifestBytes).digest('hex');
    if (defaultDigest === expectedDigest) {
      pushFinding(findings, {
        code: 'control-plane-selected-manifest-already-on-default',
        message: 'active pointer selects a manifest whose exact digest is already present on the default branch',
        path: pointerPath,
        severity: 'high'
      });
    }
  }

  const manifestId = path.posix.basename(manifestPath, '.md');
  if (rollingPackage !== manifestId) {
    pushFinding(findings, {
      code: 'control-plane-rolling-drift',
      message: `rolling plan current package ${rollingPackage ?? '<missing>'} does not match ${manifestId}`,
      path: rollingPath,
      severity: 'high'
    });
  }

  const liveManifests = tracked.filter((file) => /^docs\/work-packages\/[^/]+\.md$/u.test(file));
  if (liveManifests.length !== 1 || liveManifests[0] !== manifestPath) {
    pushFinding(findings, {
      code: 'control-plane-live-manifest-census',
      message: `docs/work-packages must contain only the selected manifest; found ${liveManifests.join(', ') || '<none>'}`,
      path: 'docs/work-packages',
      severity: 'high'
    });
  }
}

export async function auditRepository(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: { defaultRef?: string } = {}
): Promise<RepositoryAuditReport> {
  const defaultRef = options.defaultRef ?? 'refs/remotes/origin/main';
  const tracked = trackedRepositoryFiles(repositoryRoot);
  const findings: RepositoryAuditFinding[] = [];
  const unknowns: string[] = [];
  const surfaceCounts: Record<SecRepositorySurfaceKind, number> = {
    configuration: 0,
    'heuristic-runtime': 0,
    markdown: 0,
    'product-implementation': 0,
    'repository-content': 0,
    'verification-test': 0
  };
  const candidates: BehaviorCandidate[] = [];
  let markdown = 0;
  let activeMarkdown = 0;

  for (const repositoryPath of tracked) {
    const surface = classifySecRepositorySurface(repositoryPath);
    surfaceCounts[surface.kind] += 1;
    if (repositoryPath.endsWith('.md')) markdown += 1;

    let source: string | null;
    try {
      source = await readTextCandidate(repositoryRoot, repositoryPath);
    } catch (error) {
      unknowns.push(`${repositoryPath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (source === null) continue;

    const markdownCoverage = resolveSecMarkdownSkillCoverage(repositoryPath);
    if (markdownCoverage?.kind === 'active-authority'
      || markdownCoverage?.kind === 'agent-projection') {
      activeMarkdown += 1;
      if (markdownCoverage.skills.length === 0) {
        pushFinding(findings, {
          code: 'active-markdown-unowned',
          message: 'active Markdown has no Skill coverage',
          path: repositoryPath,
          severity: 'critical'
        });
      }
      const status = markdownStatus(source);
      if (repositoryPath.startsWith('docs/') && status === null) {
        pushFinding(findings, {
          code: 'active-markdown-status-missing',
          message: 'active documentation has no frontmatter status',
          path: repositoryPath,
          severity: 'high'
        });
      }
    }

    const extracted = extractHeuristicBehaviorCandidates(repositoryPath, source);
    candidates.push(...extracted);
    for (const candidate of extracted) {
      if (candidate.skills.length === 0) {
        pushFinding(findings, {
          code: 'possible-heuristic-outside-governance',
          line: candidate.line,
          message: `possible Agent behavior requires deterministic-vs-heuristic triage: ${candidate.text}`,
          path: candidate.path,
          severity: 'medium'
        });
      } else if (
        markdownCoverage?.kind !== 'skill-definition'
        && candidate.skills.every((skill) => skill === 'sec-documentation-governance')
      ) {
        pushFinding(findings, {
          code: 'heuristic-catch-all-only',
          line: candidate.line,
          message: `Agent behavior resolves only to documentation governance: ${candidate.text}`,
          path: candidate.path,
          severity: 'high',
          skills: candidate.skills
        });
      }
    }

    for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
      if (MALFORMED_REPOSITORY_REFERENCE.test(rawLine)) {
        pushFinding(findings, {
          code: 'malformed-repository-reference',
          line: index + 1,
          message: `malformed repository path reference: ${rawLine.trim()}`,
          path: repositoryPath,
          severity: 'high'
        });
      }
      if (markdownCoverage?.kind === 'active-authority'
        && !repositoryPath.startsWith('docs/work/')
        && DYNAMIC_IDENTITY.test(rawLine)) {
        pushFinding(findings, {
          code: 'dynamic-identity-in-stable-authority',
          line: index + 1,
          message: `dynamic revision/PR/run identity appears in stable authority: ${rawLine.trim()}`,
          path: repositoryPath,
          severity: 'medium'
        });
      }
    }

    if (repositoryPath === 'scripts/discover-all.ts'
      && (source.includes("const PLATFORM_ROOT = join(ROOT, 'platform');")
        || source.includes('calls: calls.slice(0, 500)'))) {
      pushFinding(findings, {
        code: 'partial-discovery-named-all',
        message: 'discover-all has a partial repository scope or silently truncates call relations',
        path: repositoryPath,
        severity: 'medium'
      });
    }
  }

  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const owned = SEC_REPOSITORY_BEHAVIOR_IDS.filter(
      (behavior) => SEC_REPOSITORY_BEHAVIOR_OWNERS[behavior] === skillId
    );
    if (owned.length === 0) {
      pushFinding(findings, {
        code: 'skill-without-behavior-owner',
        message: `${skillId} does not own any registered repository behavior`,
        path: `.agents/skills/${skillId}/SKILL.md`,
        severity: 'high',
        skills: [skillId]
      });
    }
  }

  await auditControlPlane(repositoryRoot, tracked, defaultRef, findings, unknowns);

  const head = runGitText(repositoryRoot, ['rev-parse', 'HEAD']) ?? '<unresolved>';
  const defaultHead = runGitText(
    repositoryRoot,
    ['rev-parse', '--verify', defaultRef],
    { allowFailure: true }
  );
  if (defaultHead === null) unknowns.push(`default ref unavailable: ${defaultRef}`);

  const rank: Record<RepositoryAuditSeverity, number> = {
    critical: 0,
    high: 1,
    low: 3,
    medium: 2
  };
  findings.sort((left, right) =>
    rank[left.severity] - rank[right.severity]
    || (left.path ?? '').localeCompare(right.path ?? '')
    || (left.line ?? 0) - (right.line ?? 0)
    || left.code.localeCompare(right.code));

  return Object.freeze({
    behaviorOwners: SEC_REPOSITORY_BEHAVIOR_OWNERS,
    findings: Object.freeze(findings),
    optimizations: Object.freeze([
      '把未覆盖的 Agent 行为交给 sec-heuristic-governance，不在原文件追加孤立指令。',
      '把跨 owner 的架构 finding 交给 sec-architecture-evolution，冻结 authority/contract 后再实现。',
      '把产品 finding 拆为依赖明确的最小 Work Package；审计报告只作 exact-revision Evidence。',
      '删除无消费者配置、已退役路径 owner 和重复权威；保留机器可验证 registry，而不是新增叙述文档。'
    ]),
    revision: Object.freeze({ defaultHead, defaultRef, head }),
    schema: 'sec-repository-audit-v1',
    summary: Object.freeze({
      activeMarkdown,
      behaviorCandidates: candidates.length,
      findings: countFindings(findings),
      markdown,
      skills: SEC_AGENT_SKILL_IDS.length,
      trackedPaths: tracked.length,
      unknowns: unknowns.length
    }),
    surfaces: Object.freeze({ ...surfaceCounts }),
    unknowns: Object.freeze(unknowns.sort())
  });
}

function severityFails(
  severity: RepositoryAuditSeverity,
  threshold: RepositoryAuditSeverity
): boolean {
  const rank: Record<RepositoryAuditSeverity, number> = {
    critical: 0,
    high: 1,
    low: 3,
    medium: 2
  };
  return rank[severity] <= rank[threshold];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  const failIndex = args.indexOf('--fail-on');
  const failOn = failIndex >= 0
    ? args[failIndex + 1] as RepositoryAuditSeverity | 'none' | undefined
    : 'high';
  if (failOn !== undefined
    && failOn !== 'none'
    && !['critical', 'high', 'medium', 'low'].includes(failOn)) {
    throw new Error(`Unsupported --fail-on value: ${failOn}`);
  }

  const report = await auditRepository();
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const absoluteOutput = path.resolve(outputPath);
    await mkdir(path.dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, encoded, 'utf8');
  }
  if (args.includes('--json') || !outputPath) {
    process.stdout.write(encoded);
  } else {
    process.stdout.write(
      `Tracked ${report.summary.trackedPaths} paths; `
      + `findings=${JSON.stringify(report.summary.findings)}; `
      + `unknowns=${report.summary.unknowns}\n`
    );
  }

  if (failOn && failOn !== 'none'
    && report.findings.some((finding) => severityFails(finding.severity, failOn))) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
