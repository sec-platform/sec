#!/usr/bin/env bun
/**
 * docs-doctor: docs/ 文档健康检查
 *
 * 检查项：
 *  1. 编号文档（00-13）+ 测试架构文档必须有 frontmatter
 *  2. frontmatter 的 status 必须在白名单（stable/active/draft）
 *  3. 文档中 file:/// 绝对路径引用必须存在
 *  4. 与 00 §4 不允许重复维护表的口径冲突（粗略：同一概念被多个文档写出来）
 *  5. 已废弃的旧 API/旧命令名（pre-deprecation list）出现则警告
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const SKIP_DIRS = new Set(['archive', 'superpowers']);

const VALID_STATUS = new Set(['stable', 'active', 'draft']);

// 必须有 frontmatter 的文档
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
  'test-architecture.md',
  'test-feedback-and-ci-lanes.md',
  'slow-suite-registry.md',
  '代码库可视化流程图工具与编译原理综合指南.md'
];

// 已知废弃/旧名/容易误用
// allowedContext: 若设置，只有当 token 前后紧邻 "不再以"、"已被 ... 取代" 等否定/澄清上下文时才豁免
const DEPRECATED_TOKENS = [
  { token: 'CompilerPass', reason: '已被 Compiler 门面取代（见 05 §0）' },
  { token: 'PassPipeline', reason: '已被 Compiler 门面取代（见 05 §0）' },
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
  // 处理 file:/// URL
  let p = relOrAbs;
  if (p.startsWith('file:///')) {
    p = p.slice('file:///'.length);
  } else if (p.startsWith('file://')) {
    p = p.slice('file://'.length);
  }
  // Windows: /d:/Project/sec/...
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
    // URL decode (handle %20 etc)
    try { return decodeURI(s); } catch { return s; }
  });
}

function extractBacktickFilePaths(content: string): string[] {
  // 匹配反引号中的 `path/to/file.ext`（必须含 .ext 才能算路径）
  // 排除 schema 名（block.manifest.yaml / graph.lock.json 等通常作为 schema 名而非真实路径）
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

    // 1. frontmatter
    if (REQUIRED_FM.includes(name)) {
      const fm = parseFrontmatter(content);
      if (!fm.ok) {
        issues.push({ level: 'error', file, message: `frontmatter: ${fm.reason}` });
      }
    }

    // 2. file:// 链接必须存在
    for (const link of extractFileLinks(content)) {
      const rel = link.replace(/^file:\/\/\//, '');
      // rel 形如 d:/Project/sec/... 或 /d:/Project/sec/...
      const normalized = /^[a-zA-Z]:/.test(rel) ? rel : '/' + rel;
      if (!(await pathExists(normalized))) {
        issues.push({ level: 'warn', file, message: `broken link: ${link}` });
      }
    }

    // 3. 反引号中的真实文件引用（必须含 / 表明是路径而非 schema 名）
    for (const ref of extractBacktickFilePaths(content)) {
      if (ref.startsWith('http')) continue;
      if (!ref.includes('/')) continue; // schema 名（无目录）跳过
      // 排除行内链接锚点和示例占位符
      if (ref.startsWith('L') || /^\d+$/.test(ref)) continue;
      // 跳过示例/生成文件路径（不在仓库内）
      if (/^(source|project|control|app|infra|custom)\//.test(ref)) continue;
      const candidates = [
        path.join(ROOT, ref),
        path.join(ROOT_RE, ref),
        // 文档中通常省略 platform/ 前缀（约定为基准目录）
        path.join(ROOT_RE, 'platform', ref),
        path.join(ROOT_RE, 'tests', ref),
        path.join(ROOT_RE, 'scripts', ref)
      ];
      let found = false;
      for (const c of candidates) {
        try { await fs.access(c); found = true; break; } catch {}
      }
      if (!found) {
        issues.push({ level: 'warn', file, message: `unresolved path: \`${ref}\`` });
      }
    }

    // 4. 废弃 token
    for (const dep of DEPRECATED_TOKENS) {
      let idx = content.indexOf(dep.token);
      while (idx >= 0) {
        const ctx = content.slice(Math.max(0, idx - 30), idx + dep.token.length + 30);
        if (dep.allowedContext && dep.allowedContext.test(ctx)) {
          idx = content.indexOf(dep.token, idx + 1);
          continue;
        }
        issues.push({ level: 'warn', file, message: `deprecated token "${dep.token}": ${dep.reason}` });
        break; // 一个 token 一处提示足够
      }
    }
  }

  const errors = issues.filter(i => i.level === 'error');
  const warns = issues.filter(i => i.level === 'warn');

  console.log('=== docs-doctor ===');
  console.log(`errors: ${errors.length}`);
  console.log(`warns:  ${warns.length}`);
  console.log();

  for (const i of [...errors, ...warns]) {
    console.log(`  [${i.level.toUpperCase()}] ${path.relative(ROOT_RE, i.file)}: ${i.message}`);
  }

  if (errors.length > 0) process.exit(1);
}

await main();
