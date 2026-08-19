import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import { writeText, type CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import {
  decodeExactUtf8V1,
  readOptionalRetainedOrdinaryFileV1
} from '../../shared/retained-file-read.ts';

export interface PrismaBlock {
  type: string;
  name: string;
  content: string;
}

function prismaParseError(message: string): never {
  throw new CompilerError('COMPOSE-PRISMA-002', message);
}

function braceDelta(line: string): number {
  let delta = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    const next = line[index + 1];
    if (!quoted && char === '/' && next === '/') break;
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === '{') delta += 1;
    if (char === '}') delta -= 1;
  }
  return delta;
}

function assertUniqueBlocks(blocks: readonly PrismaBlock[], label: string): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = `${block.type}:${block.name}`;
    if (seen.has(key)) prismaParseError(`${label} declares duplicate Prisma block ${key}`);
    seen.add(key);
  }
}

export function parsePrismaSchema(content: string): { blocks: PrismaBlock[]; headerTrivia: string } {
  const blocks: PrismaBlock[] = [];
  const lines = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  let currentBlock: { type: string; name: string; lines: string[] } | null = null;
  let braceCount = 0;
  const headerLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!currentBlock) {
      const match = /^(model|enum|datasource|generator|type)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/u.exec(trimmed);
      if (match) {
        currentBlock = {
          type: match[1]!,
          name: match[2]!,
          lines: [line]
        };
        braceCount = braceDelta(line);
        if (braceCount <= 0) {
          blocks.push({ type: currentBlock.type, name: currentBlock.name, content: line });
          currentBlock = null;
          braceCount = 0;
        }
      } else {
        if (trimmed.length > 0 && !trimmed.startsWith('//')) {
          prismaParseError(`Unsupported top-level Prisma syntax: ${trimmed}`);
        }
        headerLines.push(line);
      }
      continue;
    }

    currentBlock.lines.push(line);
    braceCount += braceDelta(line);
    if (braceCount < 0) prismaParseError(`Prisma block ${currentBlock.type}:${currentBlock.name} closes unexpectedly`);
    if (braceCount === 0) {
      blocks.push({
        type: currentBlock.type,
        name: currentBlock.name,
        content: currentBlock.lines.join('\n')
      });
      currentBlock = null;
    }
  }

  if (currentBlock !== null) {
    prismaParseError(`Prisma block ${currentBlock.type}:${currentBlock.name} is not closed`);
  }
  assertUniqueBlocks(blocks, 'Schema');
  return { blocks, headerTrivia: headerLines.join('\n') };
}

function bodyLines(content: string): string[] {
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    prismaParseError('Prisma block has no valid body');
  }
  return content.slice(firstBrace + 1, lastBrace).split('\n');
}

function normalizedBlock(content: string): string {
  return content
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function mergeModelLike(existingContent: string, templateContent: string, blockLabel: string): string {
  const existingLines = bodyLines(existingContent);
  const templateLines = bodyLines(templateContent);
  const fields = new Map<string, string>();
  const fieldOrder: string[] = [];
  const blockAttributes = new Set<string>();
  const commentsAndOthers: string[] = [];

  const consume = (lines: readonly string[], source: 'existing' | 'template'): void => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('//')) {
        if (source === 'existing') commentsAndOthers.push(line);
        continue;
      }
      if (trimmed.startsWith('@@')) {
        blockAttributes.add(trimmed);
        continue;
      }
      const match = /^([A-Za-z][A-Za-z0-9_]*)\s+/u.exec(trimmed);
      if (!match) {
        if (source === 'existing') {
          commentsAndOthers.push(line);
          continue;
        }
        prismaParseError(`${blockLabel} contains unsupported template syntax: ${trimmed}`);
      }
      const fieldName = match[1]!;
      const previous = fields.get(fieldName);
      if (previous === undefined) {
        fields.set(fieldName, line);
        fieldOrder.push(fieldName);
        continue;
      }
      if (previous.trim() !== trimmed) {
        prismaParseError(`${blockLabel} field "${fieldName}" conflicts with the existing schema`);
      }
    }
  };

  consume(existingLines, 'existing');
  consume(templateLines, 'template');

  const bodyParts = [
    ...commentsAndOthers,
    ...fieldOrder.map((field) => fields.get(field)!),
    ...[...blockAttributes].sort().map((attribute) => `  ${attribute}`)
  ];
  const header = existingContent.slice(0, existingContent.indexOf('{') + 1);
  return `${header}\n${bodyParts.join('\n')}\n}`;
}

function mergeEnums(existingContent: string, templateContent: string, blockLabel: string): string {
  const values = new Map<string, string>();
  const order: string[] = [];
  const comments: string[] = [];

  const consume = (lines: readonly string[], source: 'existing' | 'template'): void => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('//')) {
        if (source === 'existing') comments.push(line);
        continue;
      }
      const match = /^([A-Za-z][A-Za-z0-9_]*)\b/u.exec(trimmed);
      if (!match) prismaParseError(`${blockLabel} contains unsupported enum syntax: ${trimmed}`);
      const valueName = match[1]!;
      const previous = values.get(valueName);
      if (previous === undefined) {
        values.set(valueName, trimmed);
        order.push(valueName);
        continue;
      }
      if (previous !== trimmed) {
        prismaParseError(`${blockLabel} enum value "${valueName}" conflicts with the existing schema`);
      }
    }
  };

  consume(bodyLines(existingContent), 'existing');
  consume(bodyLines(templateContent), 'template');
  const header = existingContent.slice(0, existingContent.indexOf('{') + 1);
  return `${header}\n${[...comments, ...order.map((value) => `  ${values.get(value)!}`)].join('\n')}\n}`;
}

export function mergePrismaSchemas(existingContent: string, templateContent: string): string {
  const existing = parsePrismaSchema(existingContent);
  const template = parsePrismaSchema(templateContent);
  assertUniqueBlocks(existing.blocks, 'Existing schema');
  assertUniqueBlocks(template.blocks, 'Template schema');

  const blockMap = new Map<string, PrismaBlock>();
  const mergedList = existing.blocks.map((block) => ({ ...block }));
  for (const block of mergedList) blockMap.set(`${block.type}:${block.name}`, block);

  for (const templateBlock of template.blocks) {
    const key = `${templateBlock.type}:${templateBlock.name}`;
    const existingBlock = blockMap.get(key);
    if (!existingBlock) {
      const added = { ...templateBlock };
      mergedList.push(added);
      blockMap.set(key, added);
      continue;
    }

    if (templateBlock.type === 'model' || templateBlock.type === 'type') {
      existingBlock.content = mergeModelLike(existingBlock.content, templateBlock.content, key);
      continue;
    }
    if (templateBlock.type === 'enum') {
      existingBlock.content = mergeEnums(existingBlock.content, templateBlock.content, key);
      continue;
    }
    if (normalizedBlock(existingBlock.content) !== normalizedBlock(templateBlock.content)) {
      prismaParseError(`${key} conflicts with the existing schema; Compose cannot choose a winner by source order`);
    }
  }

  const header = existing.headerTrivia.trim();
  const blocksContent = mergedList.map((block) => block.content).join('\n\n');
  return `${header ? `${header}\n\n` : ''}${blocksContent}${blocksContent ? '\n' : ''}`;
}

function readOptionalPrismaText(filePath: string, label: string): string | null {
  const bytes = readOptionalRetainedOrdinaryFileV1(filePath, label);
  return bytes === null ? null : decodeExactUtf8V1(bytes, label);
}

/**
 * Compose owns deterministic Prisma schema materialization only. Applying the
 * schema to a live database is an external, potentially destructive effect and
 * requires its own explicit Operation/provider authority; it must never be
 * hidden behind compilation or any data-loss-accepting database push flag.
 */
export async function mergePrismaTemplate(
  workspaceRoot: string,
  projectRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const { developerSourceRoot } = getWorkspacePaths(workspaceRoot);
  const templatePath = path.join(developerSourceRoot, 'schema', 'db.prisma.template');
  const targetPath = path.join(projectRoot, 'prisma', 'schema.prisma');
  const templateContent = readOptionalPrismaText(templatePath, 'Prisma schema template');
  if (templateContent === null) return;

  const existingContent = readOptionalPrismaText(targetPath, 'Prisma schema target') ?? '';
  const mergedContent = mergePrismaSchemas(existingContent, templateContent);
  if (mergedContent === existingContent) return;
  await writeText(targetPath, mergedContent, commitFence);
}
