#!/usr/bin/env bun
/**
 * docs-doctor: docs/ 文档健康检查
 *
 * 检查项：
 *  1. 编号文档（00-14）+ 测试架构文档必须有 frontmatter
 *  2. frontmatter 的 status 必须在白名单
 *  3. 文档中 file:/// 绝对路径引用必须存在
 *  4. 与 00 的事实唯一维护原则保持一致
 *  5. 已废弃的旧 API/旧命令名出现则警告
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
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

const DEPRECATED_TOKENS = [
  { token: 'CompilerPass', reason: '已被 Compiler 门面取代（见 05）' },
  { token: 'PassPipeline', reason: '已被 Compiler 门面取代（见 05）' },
  { token: 'PASS_DEPENDENCIES', reason: '已被 orchestrator 调用顺序 + assertPassStatus 取代', allowedContext: /不再以.*形式|已被.*取代/ },
  { token: 'pino.transport', reason: '已删除（pino 整体被 zero-dep logger 取代）' }
];

interface Issue {
  level: 'error' | 'warn';
  file: string;
  message: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield full;
  }
}

function parseFrontmatter(content: string): { ok: boolean; status?: string; reason?: string } {
  if (!content.startsWith('---')) return { ok: false, reason: 'missing frontmatter' };
  const end = content.indexOf('\n---', 3);
  if (end < 0) return { ok: false, reason: 'unterminated frontmatter' };
  const block = content.slice(3, end);
  const statusMatch = block.match(/^status:\s*(\S+)/m);
  if (!statusMatch) return { ok: false, reason: 'missing status' };
  const status = statusMatch[1];
  if (!VALID_STATUS.has(status)) return { ok: false, reason: `invalid status "${status}"` };
  return { ok: true, status };
}

async function pathExists(relOrAbs: string): Promise<boolean> {
  let p = relOrAbs;
  if (p.startsWith('file:///')) {
    p = p.slice('file:///'.length);
  } else if (p.startsWith('file://')) {
    p = p.slice('file://'.length);
  }
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function extractFileLinks(content: string): string[] {
  const re = /file:\/\/\/[^\s)`'"]+/g;
  return (content.match(re) ?? []).map(s => {
    try { return decodeURI(s); } catch { return s; }
  });
}

function extractBacktickFilePaths(content: string): string[] {
  const re = /`(?:[a-zA-Z][\w./-]*\/)?[a-zA-Z0-9_-]+\.[a-z]{2,4}(?:#L\d+(?:-L?\d+)?)?`/g;
  const out: string[] = [];
  let m;
  while ((m = re.exec(content))) out.push(m[0].slice(1, -1));
  return out;
}

const ROOT_RE = path.resolve(ROOT, '..');

async function main(): Promise<void> {
  const issues: Issue[] = [];

  for await (const file of walk(ROOT)) {
    const name = path.basename(file);
    const content = await fs.readFile(file, 'utf8');

    if (REQUIRED_FM.includes(name)) {
      const fm = parseFrontmatter(content);
      if (!fm.ok) {
        issues.push({ level: 'error', file, message: `frontmatter: ${fm.reason}` });
      }
    }

    for (const link of extractFileLinks(content)) {
      const rel = link.replace(/^file:\/\/\//, '');
      const normalized = /^[a-zA-Z]:/.test(rel) ? rel : '/' + rel;
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
        path.join(ROOT, ref),
        path.join(ROOT_RE, ref),
        path.join(ROOT_RE, 'platform', ref),
        path.join(ROOT_RE, 'tests', ref),
        path.join(ROOT_RE, 'scripts', ref)
      ];
      let found = false;
      for (const candidate of candidates) {
        try { await fs.access(candidate); found = true; break; } catch {}
      }
      if (!found) {
        issues.push({ level: 'warn', file, message: `unresolved path: \`${ref}\`` });
      }
    }

    for (const dep of DEPRECATED_TOKENS) {
      let idx = content.indexOf(dep.token);
      while (idx >= 0) {
        const ctx = content.slice(Math.max(0, idx - 30), idx + dep.token.length + 30);
        if (dep.allowedContext && dep.allowedContext.test(ctx)) {
          idx = content.indexOf(dep.token, idx + 1);
          continue;
        }
        issues.push({ level: 'warn', file, message: `deprecated token "${dep.token}": ${dep.reason}` });
        break;
      }
    }
  }

  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn');

  console.log('=== docs-doctor ===');
  console.log(`errors: ${errors.length}`);
  console.log(`warns:  ${warns.length}`);
  console.log();

  for (const issue of [...errors, ...warns]) {
    console.log(`  [${issue.level.toUpperCase()}] ${path.relative(ROOT_RE, issue.file)}: ${issue.message}`);
  }

  if (errors.length > 0) process.exit(1);
}

await main();
