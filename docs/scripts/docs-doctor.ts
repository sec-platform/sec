#!/usr/bin/env bun
/**
 * docs-doctor: SEC 文档与上下文工程健康检查
 *
 * 检查项：
 *  1. 编号文档（00-14）与测试架构文档必须有合法 frontmatter
 *  2. 文档中的 file:/// 绝对路径引用必须存在
 *  3. 已废弃的旧 API/旧命令名出现则警告
 *  4. 根上下文文件、Work Package 计划合同与 Skills 发现边界必须完整
 *  5. 每个仓库级 Skill 必须有合法、唯一且与目录一致的元数据
 */
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DOCS_ROOT = path.resolve(import.meta.dir, '..');
const REPO_ROOT = path.resolve(DOCS_ROOT, '..');
const SKILLS_ROOT = path.join(REPO_ROOT, '.agents', 'skills');
const SKIP_DIRS = new Set(['archive', 'superpowers']);

const VALID_STATUS = new Set(['stable', 'active', 'draft', 'historical', 'archive']);

const REQUIRED_FM = [
  '00-文档索引与一致性规则.md',
  '01-用户能力模块化开发-主题整理稿.md',
  '02-工程编译器-MVP-PRD与架构稿.md',
  '03-MVP实施计划与路线图.md',
  '04-AI自主实现执行蓝图.md',
  '05-编译器核心实现规格.md',
  '06-Registry与Block协议规范.md',
  '07-Pass状态机、错误码与恢复机制.md',
  '08-Verification、Provenance与Graph规范.md',
  '09-AI Runtime、任务信封与治理规范.md',
  '10-升级迁移与Override规范.md',
  '11-Workbench与可视化规范.md',
  '12-编译管道与行为流图示.md',
  '13-独立工具分发与打包规划.md',
  '14-Engineering IR与语义事实规范.md',
  'test-architecture.md',
  'test-feedback-and-ci-lanes.md',
  'slow-suite-registry.md',
  '代码库可视化流程图工具与编译原理综合指南.md'
];

const REQUIRED_CONTEXT_FILES = [
  'AGENTS.md',
  'PLANS.md',
  '.codex/config.toml',
  '.codex/agents/repo-state-auditor.toml',
  '.codex/agents/architecture-reviewer.toml',
  '.codex/agents/implementation-worker.toml',
  '.codex/agents/integration-reviewer.toml',
  '.codex/agents/verification-evidence-reviewer.toml',
  'docs/04-AI自主实现执行蓝图.md'
];

const REQUIRED_SKILL_NAMES = new Set([
  'sec-repo-audit',
  'sec-work-package-plan',
  'sec-architecture-change',
  'sec-verification-evidence',
  'sec-ci-triage',
  'sec-pr-closeout'
]);

const REQUIRED_CUSTOM_AGENT_NAMES = new Set([
  'repo-state-auditor',
  'architecture-reviewer',
  'implementation-worker',
  'integration-reviewer',
  'verification-evidence-reviewer'
]);

const DEPRECATED_TOKENS = [
  { token: 'CompilerPass', reason: '已被 Compiler 门面取代（见 05）' },
  { token: 'PassPipeline', reason: '已被 Compiler 门面取代（见 05）' },
  {
    token: 'PASS_DEPENDENCIES',
    reason: '已被 orchestrator 调用顺序 + assertPassStatus 取代',
    allowedContext: /不再以.*形式|已被.*取代/
  },
  { token: 'pino.transport', reason: '已删除（pino 整体被 zero-dep logger 取代）' }
];

interface Issue {
  level: 'error' | 'warn';
  file: string;
  message: string;
}

interface FrontmatterResult {
  ok: boolean;
  values: Map<string, string>;
  reason?: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield full;
  }
}

function parseFrontmatter(content: string): FrontmatterResult {
  if (!content.startsWith('---')) {
    return { ok: false, values: new Map(), reason: 'missing frontmatter' };
  }

  const end = content.indexOf('\n---', 3);
  if (end < 0) {
    return { ok: false, values: new Map(), reason: 'unterminated frontmatter' };
  }

  const values = new Map<string, string>();
  for (const line of content.slice(3, end).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }

  return { ok: true, values };
}

async function pathExists(relOrAbs: string): Promise<boolean> {
  let candidate = relOrAbs;
  if (candidate.startsWith('file:///')) {
    candidate = candidate.slice('file:///'.length);
  } else if (candidate.startsWith('file://')) {
    candidate = candidate.slice('file://'.length);
  }
  if (/^\/[A-Za-z]:\//.test(candidate)) candidate = candidate.slice(1);

  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function extractFileLinks(content: string): string[] {
  const re = /file:\/\/\/[^\s)`'"]+/g;
  return (content.match(re) ?? []).map(value => {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  });
}

function extractBacktickFilePaths(content: string): string[] {
  const re = /`(?:[a-zA-Z][\w./-]*\/)?[a-zA-Z0-9_-]+\.[a-z]{2,4}(?:#L\d+(?:-L?\d+)?)?`/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) out.push(match[0].slice(1, -1));
  return out;
}

async function validateRequiredContext(issues: Issue[]): Promise<void> {
  for (const rel of REQUIRED_CONTEXT_FILES) {
    const full = path.join(REPO_ROOT, rel);
    if (!(await pathExists(full))) {
      issues.push({ level: 'error', file: full, message: 'required context file is missing' });
    }
  }

  const plansPath = path.join(REPO_ROOT, 'PLANS.md');
  try {
    const plans = await fs.readFile(plansPath, 'utf8');
    if (!plans.includes('docs/work-packages/<id>.md')) {
      issues.push({
        level: 'error',
        file: plansPath,
        message: 'planning contract must declare the unique Work Package plan path'
      });
    }
    if (!plans.includes('docs/03-MVP实施计划与路线图.md')) {
      issues.push({
        level: 'error',
        file: plansPath,
        message: 'planning contract must defer stage/order authority to docs/03'
      });
    }
  } catch {
    // Missing file is already reported above.
  }

  const blueprintPath = path.join(REPO_ROOT, 'docs', '04-AI自主实现执行蓝图.md');
  try {
    const blueprint = await fs.readFile(blueprintPath, 'utf8');
    for (const expected of [...REQUIRED_SKILL_NAMES, ...REQUIRED_CUSTOM_AGENT_NAMES]) {
      if (!blueprint.includes(`\`${expected}\``)) {
        issues.push({
          level: 'error',
          file: blueprintPath,
          message: `context blueprint does not index required workflow or role: ${expected}`
        });
      }
    }
  } catch {
    // Missing file is already reported above.
  }

  const gitignorePath = path.join(REPO_ROOT, '.gitignore');
  try {
    const gitignore = await fs.readFile(gitignorePath, 'utf8');
    for (const required of ['!.agents/skills/', '!.agents/skills/**']) {
      if (!gitignore.split(/\r?\n/).includes(required)) {
        issues.push({
          level: 'error',
          file: gitignorePath,
          message: `repository Skills discovery path is not tracked: ${required}`
        });
      }
    }
  } catch {
    issues.push({ level: 'error', file: gitignorePath, message: 'cannot read .gitignore' });
  }
}

async function readSkillDirectories(): Promise<Dirent[]> {
  try {
    return await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function validateSkills(issues: Issue[]): Promise<void> {
  const entries = (await readSkillDirectories()).filter(entry => entry.isDirectory());
  if (entries.length === 0) {
    issues.push({
      level: 'error',
      file: SKILLS_ROOT,
      message: 'no repository-level Skills found under .agents/skills'
    });
    return;
  }

  const seenNames = new Map<string, string>();

  for (const entry of entries) {
    const skillPath = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = await fs.readFile(skillPath, 'utf8');
    } catch {
      issues.push({ level: 'error', file: skillPath, message: 'skill directory is missing SKILL.md' });
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter.ok) {
      issues.push({
        level: 'error',
        file: skillPath,
        message: `frontmatter: ${frontmatter.reason}`
      });
      continue;
    }

    const name = frontmatter.values.get('name') ?? '';
    const description = frontmatter.values.get('description') ?? '';

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      issues.push({ level: 'error', file: skillPath, message: `invalid skill name "${name}"` });
    }
    if (name !== entry.name) {
      issues.push({
        level: 'error',
        file: skillPath,
        message: `skill name "${name}" must match directory "${entry.name}"`
      });
    }
    if (description.trim().length < 20) {
      issues.push({
        level: 'error',
        file: skillPath,
        message: 'skill description must state a sufficiently specific trigger boundary'
      });
    }

    const prior = seenNames.get(name);
    if (prior) {
      issues.push({
        level: 'error',
        file: skillPath,
        message: `duplicate skill name "${name}" also declared by ${path.relative(REPO_ROOT, prior)}`
      });
    } else if (name) {
      seenNames.set(name, skillPath);
    }
  }

  for (const expected of REQUIRED_SKILL_NAMES) {
    if (!seenNames.has(expected)) {
      issues.push({
        level: 'error',
        file: SKILLS_ROOT,
        message: `required SEC workflow Skill is missing: ${expected}`
      });
    }
  }
}

async function validateDocs(issues: Issue[]): Promise<void> {
  for await (const file of walk(DOCS_ROOT)) {
    const name = path.basename(file);
    const content = await fs.readFile(file, 'utf8');

    if (REQUIRED_FM.includes(name)) {
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter.ok) {
        issues.push({
          level: 'error',
          file,
          message: `frontmatter: ${frontmatter.reason}`
        });
      } else {
        const status = frontmatter.values.get('status');
        if (!status) {
          issues.push({ level: 'error', file, message: 'frontmatter: missing status' });
        } else if (!VALID_STATUS.has(status)) {
          issues.push({
            level: 'error',
            file,
            message: `frontmatter: invalid status "${status}"`
          });
        }
      }
    }

    for (const link of extractFileLinks(content)) {
      const rel = link.replace(/^file:\/\/\//, '');
      const normalized = /^[a-zA-Z]:/.test(rel) ? rel : `/${rel}`;
      if (!(await pathExists(normalized))) {
        issues.push({ level: 'warn', file, message: `broken link: ${link}` });
      }
    }

    for (const ref of extractBacktickFilePaths(content)) {
      if (ref.startsWith('http')) continue;
      if (!ref.includes('/')) continue;
      if (ref.startsWith('L') || /^\d+$/.test(ref)) continue;
      if (/^(source|project|control|app|infra|custom)\//.test(ref)) continue;

      const candidates = [
        path.join(DOCS_ROOT, ref),
        path.join(REPO_ROOT, ref),
        path.join(REPO_ROOT, 'platform', ref),
        path.join(REPO_ROOT, 'tests', ref),
        path.join(REPO_ROOT, 'scripts', ref)
      ];

      let found = false;
      for (const candidate of candidates) {
        try {
          await fs.access(candidate);
          found = true;
          break;
        } catch {
          // Try next candidate.
        }
      }

      if (!found) {
        issues.push({ level: 'warn', file, message: `unresolved path: \`${ref}\`` });
      }
    }

    for (const deprecated of DEPRECATED_TOKENS) {
      let index = content.indexOf(deprecated.token);
      while (index >= 0) {
        const context = content.slice(
          Math.max(0, index - 30),
          index + deprecated.token.length + 30
        );
        if (deprecated.allowedContext && deprecated.allowedContext.test(context)) {
          index = content.indexOf(deprecated.token, index + 1);
          continue;
        }
        issues.push({
          level: 'warn',
          file,
          message: `deprecated token "${deprecated.token}": ${deprecated.reason}`
        });
        break;
      }
    }
  }
}

async function main(): Promise<void> {
  const issues: Issue[] = [];

  await validateRequiredContext(issues);
  await validateSkills(issues);
  await validateDocs(issues);

  const errors = issues.filter(issue => issue.level === 'error');
  const warnings = issues.filter(issue => issue.level === 'warn');

  console.log('=== docs-doctor ===');
  console.log(`errors: ${errors.length}`);
  console.log(`warns:  ${warnings.length}`);
  console.log();

  for (const issue of [...errors, ...warnings]) {
    console.log(
      `  [${issue.level.toUpperCase()}] ${path.relative(REPO_ROOT, issue.file)}: ${issue.message}`
    );
  }

  if (errors.length > 0) process.exit(1);
}

await main();
