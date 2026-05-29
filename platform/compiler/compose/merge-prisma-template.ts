import path from 'node:path';
import { pathExists, readText, writeText } from '../../shared/fs.ts';
import { runCommand } from '../../shared/process.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';

export interface PrismaBlock {
  type: string;
  name: string;
  content: string;
}

export function parsePrismaSchema(content: string): { blocks: PrismaBlock[]; headerTrivia: string } {
  const blocks: PrismaBlock[] = [];
  const lines = content.split('\n');
  let currentBlock: { type: string; name: string; lines: string[] } | null = null;
  let braceCount = 0;
  const headerLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!currentBlock) {
      const match = trimmed.match(/^(model|enum|datasource|generator|type)\s+([A-Za-z0-9_.-]+)\s*\{/);
      if (match) {
        currentBlock = {
          type: match[1],
          name: match[2],
          lines: [line]
        };
        braceCount = 1;
      } else {
        headerLines.push(line);
      }
    } else {
      currentBlock.lines.push(line);
      if (trimmed.includes('{')) {
        braceCount += (trimmed.match(/\{/g) || []).length;
      }
      if (trimmed.includes('}')) {
        braceCount -= (trimmed.match(/\}/g) || []).length;
      }
      if (braceCount <= 0) {
        blocks.push({
          type: currentBlock.type,
          name: currentBlock.name,
          content: currentBlock.lines.join('\n')
        });
        currentBlock = null;
      }
    }
  }
  return { blocks, headerTrivia: headerLines.join('\n') };
}

function mergeModels(existingContent: string, templateContent: string): string {
  const getLines = (c: string) => {
    const firstBrace = c.indexOf('{');
    const lastBrace = c.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) return [];
    return c.substring(firstBrace + 1, lastBrace).split('\n');
  };

  const existingLines = getLines(existingContent);
  const templateLines = getLines(templateContent);

  const fields = new Map<string, string>(); // fieldName -> line
  const blockAttributes = new Set<string>();
  const commentsAndOthers: string[] = [];

  const processLines = (lines: string[], isTemplate: boolean) => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        if (!isTemplate) commentsAndOthers.push(line);
        continue;
      }
      if (trimmed.startsWith('@@')) {
        blockAttributes.add(trimmed);
        continue;
      }
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s+/);
      if (match) {
        const fieldName = match[1];
        if (!isTemplate || !fields.has(fieldName)) {
          fields.set(fieldName, line);
        }
      } else {
        if (!isTemplate) commentsAndOthers.push(line);
      }
    }
  };

  processLines(existingLines, false);
  processLines(templateLines, true);

  const bodyParts: string[] = [];
  if (commentsAndOthers.length > 0) {
    bodyParts.push(...commentsAndOthers);
  }
  for (const [_, fieldLine] of fields) {
    bodyParts.push(fieldLine);
  }
  for (const attr of blockAttributes) {
    bodyParts.push(`  ${attr}`);
  }

  const firstBrace = existingContent.indexOf('{');
  const header = existingContent.substring(0, firstBrace + 1);
  return `${header}\n${bodyParts.join('\n')}\n}`;
}

function mergeEnums(existingContent: string, templateContent: string): string {
  const getLines = (c: string) => {
    const firstBrace = c.indexOf('{');
    const lastBrace = c.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) return [];
    return c.substring(firstBrace + 1, lastBrace).split('\n');
  };

  const existingLines = getLines(existingContent);
  const templateLines = getLines(templateContent);

  const values = new Set<string>();
  const comments: string[] = [];

  const processLines = (lines: string[], isTemplate: boolean) => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        if (!isTemplate) comments.push(line);
        continue;
      }
      const match = trimmed.match(/^([A-Za-z0-9_]+)/);
      if (match) {
        values.add(trimmed);
      }
    }
  };

  processLines(existingLines, false);
  processLines(templateLines, true);

  const bodyParts = [...comments, ...Array.from(values).map(v => `  ${v}`)];
  const firstBrace = existingContent.indexOf('{');
  const header = existingContent.substring(0, firstBrace + 1);
  return `${header}\n${bodyParts.join('\n')}\n}`;
}

export function mergePrismaSchemas(existingContent: string, templateContent: string): string {
  const existing = parsePrismaSchema(existingContent);
  const template = parsePrismaSchema(templateContent);

  const blockMap = new Map<string, PrismaBlock>();
  const mergedList: PrismaBlock[] = [];

  for (const block of existing.blocks) {
    const key = `${block.type}:${block.name}`;
    blockMap.set(key, block);
    mergedList.push(block);
  }

  for (const block of template.blocks) {
    const key = `${block.type}:${block.name}`;
    const existingBlock = blockMap.get(key);
    if (!existingBlock) {
      mergedList.push(block);
    } else {
      if (block.type === 'model') {
        existingBlock.content = mergeModels(existingBlock.content, block.content);
      } else if (block.type === 'enum') {
        existingBlock.content = mergeEnums(existingBlock.content, block.content);
      }
      // generator or datasource from template is ignored
    }
  }

  const header = existing.headerTrivia.trim();
  const blocksContent = mergedList.map(b => b.content).join('\n\n');
  return (header ? header + '\n\n' : '') + blocksContent + '\n';
}

export async function mergePrismaTemplate(workspaceRoot: string, projectRoot: string): Promise<void> {
  const { developerSourceRoot } = getWorkspacePaths(workspaceRoot);
  const templatePath = path.join(developerSourceRoot, 'schema', 'db.prisma.template');
  const targetPath = path.join(projectRoot, 'prisma', 'schema.prisma');

  if (!(await pathExists(templatePath))) {
    return;
  }

  const templateContent = await readText(templatePath);
  const existingContent = (await pathExists(targetPath)) ? await readText(targetPath) : '';

  const mergedContent = mergePrismaSchemas(existingContent, templateContent);
  await writeText(targetPath, mergedContent);

  // Trigger prisma db push using bunx
  const result = await runCommand('bunx', ['prisma@6', 'db', 'push', '--accept-data-loss'], {
    cwd: projectRoot
  });

  if (result.code !== 0) {
    throw new CompilerError(
      'COMPOSE-PRISMA-001',
      `Failed to push merged Prisma schema to database: ${result.stderr}`,
      { result }
    );
  }
}
