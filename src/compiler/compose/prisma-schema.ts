import { CompilerError } from '../errors.ts';

export interface PrismaBlock {
  type: string;
  name: string;
  content: string;
}

function prismaParseError(message: string): never {
  throw new CompilerError('COMPOSE-PRISMA-002', message);
}

/** Scan the block delimiters used by the supported line-oriented merge subset.
 * Strings and line comments cannot contribute delimiters. Do not silently
 * swallow another top-level construct after closing the current block. */
function scanPrismaLine(line: string, initialDepth: number) {
  let depth = initialDepth;
  let quoted = false;
  let escaped = false;
  let opening = -1;
  let closing = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (!quoted && char === '/' && line[index + 1] === '/') break;
    if (closing !== -1) {
      if (char.trim() !== '') prismaParseError('Prisma block has trailing syntax after its closing brace');
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') {
      if (depth === 0) opening = index;
      depth += 1;
    }
    if (char === '}') {
      depth -= 1;
      if (depth < 0) prismaParseError('Prisma block closes unexpectedly');
      if (depth === 0) closing = index;
    }
  }
  if (quoted) prismaParseError('Prisma string is not closed on its source line');
  return { depth, opening, closing };
}

function assertUniqueBlocks(blocks: readonly PrismaBlock[], label: string): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = `${block.type}:${block.name}`;
    if (seen.has(key)) prismaParseError(`${label} declares duplicate Prisma block ${key}`);
    seen.add(key);
  }
}

interface PrismaDocumentBlock extends PrismaBlock { readonly before: string }

/** One scanner serves the public block projection and lossless merge layout. */
function parsePrismaDocument(content: string) {
  const source = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const blocks: PrismaDocumentBlock[] = [];
  let currentBlock: { type: string; name: string; start: number } | null = null;
  let braceCount = 0, offset = 0, previousEnd = 0;
  const headerLines: string[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (currentBlock === null) {
      const match = /^(model|enum|datasource|generator|type)\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/u.exec(trimmed);
      if (match) {
        currentBlock = { type: match[1]!, name: match[2]!, start: offset };
        braceCount = scanPrismaLine(line, 0).depth;
      } else {
        if (trimmed.length > 0 && !trimmed.startsWith('//')) prismaParseError(`Unsupported top-level Prisma syntax: ${trimmed}`);
        headerLines.push(line);
      }
    } else {
      braceCount = scanPrismaLine(line, braceCount).depth;
    }
    if (currentBlock !== null && braceCount === 0) {
      const end = offset + line.length;
      blocks.push({ type: currentBlock.type, name: currentBlock.name,
        content: source.slice(currentBlock.start, end), before: source.slice(previousEnd, currentBlock.start) });
      previousEnd = end;
      currentBlock = null;
    }
    offset += line.length + 1;
  }
  if (currentBlock !== null) prismaParseError(`Prisma block ${currentBlock.type}:${currentBlock.name} is not closed`);
  assertUniqueBlocks(blocks, 'Schema');
  return { source, blocks, trailing: source.slice(previousEnd), headerTrivia: headerLines.join('\n') };
}

export function parsePrismaSchema(content: string): { blocks: PrismaBlock[]; headerTrivia: string } {
  const parsed = parsePrismaDocument(content);
  return { blocks: parsed.blocks.map(({ type, name, content }) => ({ type, name, content })), headerTrivia: parsed.headerTrivia };
}

function bodyBounds(content: string): { opening: number; closing: number } {
  let depth = 0, offset = 0, opening = -1;
  for (const line of content.split('\n')) {
    const observed = scanPrismaLine(line, depth);
    if (opening === -1 && observed.opening !== -1) opening = offset + observed.opening;
    if (observed.closing !== -1 && opening !== -1) {
      return { opening, closing: offset + observed.closing };
    }
    depth = observed.depth;
    offset += line.length + 1;
  }
  return prismaParseError('Prisma block has no valid body');
}

function bodyLines(content: string): string[] {
  const { opening, closing } = bodyBounds(content);
  return content.slice(opening + 1, closing).split('\n');
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

/** Existing body order and comments remain attached to their declarations.
 * Only genuinely new template members are appended. An identical/subset merge
 * returns the existing bytes, so applying the same template is idempotent. */
function mergeMemberLines(existingContent: string, templateContent: string,
  blockLabel: string, enumeration: boolean): string {
  const existing = bodyLines(existingContent);
  const members = new Map<string, string>();
  const attributes = new Set<string>();
  const additions: string[] = [];
  const memberName = (text: string): string | undefined =>
    (enumeration ? /^([A-Za-z][A-Za-z0-9_]*)\b/u : /^([A-Za-z][A-Za-z0-9_]*)\s+/u).exec(text)?.[1];
  const remember = (text: string, name: string): boolean => {
    const previous = members.get(name);
    if (previous !== undefined && previous !== text) {
      prismaParseError(`${blockLabel} ${enumeration ? 'enum value' : 'field'} "${name}" conflicts with the existing schema`);
    }
    if (previous !== undefined) return false;
    members.set(name, text);
    return true;
  };
  for (const line of existing) {
    const text = line.trim();
    if (text === '' || text.startsWith('//')) continue;
    if (!enumeration && text.startsWith('@@')) { attributes.add(text); continue; }
    const name = memberName(text);
    if (name !== undefined) remember(text, name);
    else if (enumeration) prismaParseError(`${blockLabel} contains unsupported enum syntax: ${text}`);
  }
  let comments: string[] = [];
  for (const line of bodyLines(templateContent)) {
    const text = line.trim();
    if (text === '') continue;
    if (text.startsWith('//')) { comments.push(line); continue; }
    let added: boolean;
    if (!enumeration && text.startsWith('@@')) {
      added = !attributes.has(text); attributes.add(text);
    } else {
      const name = memberName(text);
      if (name === undefined) prismaParseError(`${blockLabel} contains unsupported ${enumeration ? 'enum' : 'template'} syntax: ${text}`);
      added = remember(text, name);
    }
    if (added) additions.push(...comments, line);
    comments = [];
  }
  if (additions.length === 0) return existingContent;
  // Remove only the empty edges introduced by the block braces. Interior
  // whitespace, declaration order and leading documentation are not reordered.
  let first = 0, last = existing.length;
  while (first < last && existing[first]!.trim() === '') first++;
  while (last > first && existing[last - 1]!.trim() === '') last--;
  const body = existing.slice(first, last);
  const { opening, closing } = bodyBounds(existingContent);
  const header = existingContent.slice(0, opening + 1);
  const closingLine = existingContent.slice(closing);
  return `${header}\n${[...body, ...additions].join('\n')}\n${closingLine}`;
}

function mergeModelLike(existingContent: string, templateContent: string, blockLabel: string): string {
  return mergeMemberLines(existingContent, templateContent, blockLabel, false);
}

function mergeEnums(existingContent: string, templateContent: string, blockLabel: string): string {
  return mergeMemberLines(existingContent, templateContent, blockLabel, true);
}

export function mergePrismaSchemas(existingContent: string, templateContent: string): string {
  const existing = parsePrismaDocument(existingContent);
  const template = parsePrismaDocument(templateContent);

  const blockMap = new Map<string, PrismaDocumentBlock>();
  const mergedList = existing.blocks.map((block) => ({ ...block }));
  const addedBlocks: PrismaDocumentBlock[] = [];
  for (const block of mergedList) blockMap.set(`${block.type}:${block.name}`, block);

  for (const templateBlock of template.blocks) {
    const key = `${templateBlock.type}:${templateBlock.name}`;
    const existingBlock = blockMap.get(key);
    if (!existingBlock) {
      const added = { ...templateBlock };
      addedBlocks.push(added);
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

  // Preserve existing inter-block trivia and attached documentation instead of
  // collecting all comments at the file header. New blocks retain their own
  // leading template documentation. No-op merges preserve normalized source.
  const output = mergedList.map(block => block.before + block.content).join('') + existing.trailing;
  if (addedBlocks.length === 0) return output;
  const additions = addedBlocks.map(block => (block.before + block.content).trim());
  return [...(output.trimEnd() ? [output.trimEnd()] : []), ...additions].join('\n\n') + '\n';
}
