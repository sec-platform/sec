#!/usr/bin/env bun
/**
 * 批量给 docs/ 下所有编号文档和测试架构文档加 frontmatter 元数据。
 *
 * - 跳过已有 frontmatter 的文档
 * - 跳过 archive/ 和 superpowers/
 * - 默认 status / last-reviewed，可单独覆盖
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const TODAY = '2026-07-04';

const META: Record<string, { title: string; status: 'stable' | 'active' | 'draft' }> = {
  '00-文档索引与一致性规则.md': { title: '文档索引与一致性规则', status: 'active' },
  '01-用户能力模块化开发-主题整理稿.md': { title: '用户能力模块化开发主题整理稿', status: 'stable' },
  '02-工程编译器-MVP-PRD与架构稿.md': { title: '工程编译器 MVP PRD 与架构稿', status: 'active' },
  '03-MVP实施计划与路线图.md': { title: 'MVP 实施计划与路线图', status: 'active' },
  '04-AI自主实现执行蓝图.md': { title: 'AI 自主实现执行蓝图', status: 'active' },
  '05-编译器核心实现规格.md': { title: '编译器核心实现规格', status: 'active' },
  '06-Registry与Block协议规范.md': { title: 'Registry 与 Block 协议规范', status: 'stable' },
  '07-Pass状态机、错误码与恢复机制.md': { title: 'Pass 状态机、错误码与恢复机制', status: 'stable' },
  '08-Verification、Provenance与Graph规范.md': { title: 'Verification、Provenance 与 Graph 规范', status: 'active' },
  '09-AI Runtime、任务信封与治理规范.md': { title: 'AI Runtime、任务信封与治理规范', status: 'active' },
  '10-升级迁移与Override规范.md': { title: '升级迁移与 Override 规范', status: 'stable' },
  '11-Workbench与可视化规范.md': { title: 'Workbench 与可视化规范', status: 'active' },
  '12-编译管道与行为流图示.md': { title: '编译管道与行为流图示', status: 'stable' },
  '13-独立工具分发与打包规划.md': { title: '独立工具分发与打包规划', status: 'draft' },
  'test-architecture.md': { title: '测试架构', status: 'active' },
  'test-feedback-and-ci-lanes.md': { title: '测试反馈与 CI 分层', status: 'active' },
  'slow-suite-registry.md': { title: 'Slow Suite Registry', status: 'active' },
  '代码库可视化流程图工具与编译原理综合指南.md': { title: '代码库可视化流程图工具与编译原理综合指南', status: 'stable' }
};

const SKIP_DIRS = new Set(['archive', 'superpowers', 'scripts']);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) yield full;
  }
}

function buildFrontmatter(meta: { title: string; status: string }): string {
  return `---\ntitle: ${meta.title}\nstatus: ${meta.status}\nlast-reviewed: ${TODAY}\n---\n\n`;
}

let added = 0;
let skipped = 0;
let unknown = 0;

for await (const file of walk(ROOT)) {
  const name = path.basename(file);
  const meta = META[name];
  if (!meta) {
    unknown++;
    continue;
  }
  const content = await fs.readFile(file, 'utf8');
  if (content.startsWith('---')) {
    skipped++;
    continue;
  }
  await fs.writeFile(file, buildFrontmatter(meta) + content, 'utf8');
  added++;
}

console.log(`Added frontmatter: ${added}`);
console.log(`Already had frontmatter: ${skipped}`);
console.log(`Unknown (no metadata mapping): ${unknown}`);
