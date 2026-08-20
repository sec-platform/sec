import path from 'node:path';

import { Node, Project, SyntaxKind } from 'ts-morph';

import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import { portableLogicalPathCollisionKeyV1 } from '../../shared/logical-path-identity.ts';
import {
  decodeExactUtf8V1,
  readOptionalRetainedOrdinaryFileV1
} from '../../shared/retained-file-read.ts';
import { publishExpectedCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';

const DEFAULT_PREFIX = 'block-attachment-';

export function prefixClassNameString(classString: string, prefix = DEFAULT_PREFIX): string {
  return classString
    .split(/\s+/u)
    .map((word) => {
      if (!word || word.startsWith(prefix)) return word;
      if (word.startsWith('-')) return `-${prefix}${word.slice(1)}`;
      const parts = word.split(':');
      if (parts.length > 1) {
        const lastPart = parts.at(-1)!;
        const modifiers = parts.slice(0, -1).join(':');
        return lastPart.startsWith('-')
          ? `${modifiers}:-${prefix}${lastPart.slice(1)}`
          : `${modifiers}:${prefix}${lastPart}`;
      }
      return `${prefix}${word}`;
    })
    .join(' ');
}

function styleError(code: 'COMPOSE-STYLE-001' | 'COMPOSE-STYLE-002' | 'COMPOSE-STYLE-003', message: string): never {
  throw new CompilerError(code, message);
}

function findStructuralBrace(source: string, start: number, wanted: '{' | '}'): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let comment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === wanted) return index;
  }
  return -1;
}

function firstSignificantSelectorChar(header: string): string | null {
  let comment = false;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index]!;
    const next = header[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (!/\s/u.test(char)) return char;
  }
  return null;
}

function prefixSelectorHeader(header: string, prefix: string): string {
  if (firstSignificantSelectorChar(header) === '@') {
    return styleError(
      'COMPOSE-STYLE-003',
      'CSS prefix sandboxing requires a real CSS provider for at-rules or nested rules'
    );
  }
  if (/[\[\]"'`\\]/u.test(header)) {
    return styleError(
      'COMPOSE-STYLE-003',
      'CSS prefix sandboxing encountered an unsupported selector grammar'
    );
  }

  let result = '';
  let comment = false;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index]!;
    const next = header[index + 1];
    if (comment) {
      result += char;
      if (char === '*' && next === '/') {
        result += next;
        index += 1;
        comment = false;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      result += '/*';
      index += 1;
      comment = true;
      continue;
    }
    if (char === '.' && /[A-Za-z_]/u.test(next ?? '')) {
      let end = index + 2;
      while (end < header.length && /[A-Za-z0-9_-]/u.test(header[end]!)) end += 1;
      const className = header.slice(index + 1, end);
      result += className.startsWith(prefix) ? `.${className}` : `.${prefix}${className}`;
      index = end - 1;
      continue;
    }
    result += char;
  }
  return result;
}

/**
 * Deliberately small, exact CSS subset. Until a declared CSS parser Provider is
 * adopted, formal Compose supports flat style rules only and refuses at-rules,
 * nested CSS, quoted/attribute selector grammar and malformed braces.
 */
export function prefixCssContent(content: string, prefix = DEFAULT_PREFIX): string {
  let cursor = 0;
  let output = '';
  while (cursor < content.length) {
    const open = findStructuralBrace(content, cursor, '{');
    if (open < 0) {
      const tail = content.slice(cursor);
      if (firstSignificantSelectorChar(tail) !== null) {
        styleError('COMPOSE-STYLE-003', 'CSS prefix sandboxing found trailing content without a rule body');
      }
      output += tail;
      break;
    }
    const close = findStructuralBrace(content, open + 1, '}');
    if (close < 0) styleError('COMPOSE-STYLE-003', 'CSS prefix sandboxing found an unclosed rule');
    const nested = findStructuralBrace(content, open + 1, '{');
    if (nested >= 0 && nested < close) {
      styleError('COMPOSE-STYLE-003', 'CSS prefix sandboxing does not support nested rules without a CSS provider');
    }
    const header = content.slice(cursor, open);
    output += `${prefixSelectorHeader(header, prefix)}${content.slice(open, close + 1)}`;
    cursor = close + 1;
  }
  return output;
}

function readOptionalStyleText(filePath: string, label: string): string | null {
  const bytes = readOptionalRetainedOrdinaryFileV1(filePath, label);
  return bytes === null ? null : decodeExactUtf8V1(bytes, label);
}

type PlannedStyleWriteV1 = Readonly<{
  filePath: string;
  expectedBytes: Uint8Array;
  text: string;
}>;

function planTailwindPrefix(projectRoot: string): PlannedStyleWriteV1 | null {
  const configPath = path.join(projectRoot, 'tailwind.config.ts');
  const source = readOptionalStyleText(configPath, 'Tailwind prefix config');
  if (source === null) return null;

  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  });
  const sourceFile = project.createSourceFile('/tailwind.config.ts', source, { overwrite: true });
  let configObject = sourceFile.getVariableDeclaration('config')
    ?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!configObject) {
    const exportAssignment = sourceFile.getExportAssignments().find((entry) => !entry.isExportEquals());
    configObject = exportAssignment?.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
  }
  if (!configObject) {
    return styleError('COMPOSE-STYLE-001', 'Tailwind prefix injection requires one supported static config object');
  }

  const prefixProp = configObject.getProperty('prefix');
  if (prefixProp) {
    if (!Node.isPropertyAssignment(prefixProp)) {
      return styleError('COMPOSE-STYLE-001', 'Tailwind prefix has an unsupported AST shape');
    }
    const initializer = prefixProp.getInitializerIfKind(SyntaxKind.StringLiteral);
    if (!initializer || initializer.getLiteralValue() !== DEFAULT_PREFIX) {
      return styleError('COMPOSE-STYLE-001', 'Tailwind config already declares a conflicting prefix');
    }
    return null;
  }

  configObject.addPropertyAssignment({ name: 'prefix', initializer: JSON.stringify(DEFAULT_PREFIX) });
  return Object.freeze({
    filePath: configPath,
    expectedBytes: Buffer.from(source, 'utf8'),
    text: sourceFile.getFullText()
  });
}

async function publishPlannedStyleWrite(
  projectRoot: string,
  planned: PlannedStyleWriteV1,
  commitFence?: CommitFence
): Promise<void> {
  await publishExpectedCanonicalWorkspaceFileV1({
    workspaceRoot: projectRoot,
    targetPath: planned.filePath,
    expectedBytes: planned.expectedBytes,
    bytes: Buffer.from(planned.text, 'utf8'),
    label: `Style transform ${path.relative(projectRoot, planned.filePath).split(path.sep).join('/')}`,
    commitFence
  });
}

function assertPlannedStylePreimagesCurrent(plannedWrites: readonly PlannedStyleWriteV1[]): void {
  for (const planned of plannedWrites) {
    const current = readOptionalRetainedOrdinaryFileV1(
      planned.filePath,
      `Style transform preimage ${planned.filePath}`
    );
    if (current === null || !Buffer.from(current).equals(Buffer.from(planned.expectedBytes))) {
      throw new CompilerError(
        'COMPOSE-STYLE-003',
        `Style transform preimage changed after planning: ${planned.filePath}`
      );
    }
  }
}

export async function injectTailwindPrefix(
  projectRoot: string,
  commitFence?: CommitFence
): Promise<boolean> {
  const planned = planTailwindPrefix(projectRoot);
  if (planned === null) return false;
  await commitFence?.();
  assertPlannedStylePreimagesCurrent([planned]);
  await publishPlannedStyleWrite(projectRoot, planned, commitFence);
  return true;
}

function planJsxClassNames(
  filePath: string,
  prefix = DEFAULT_PREFIX,
  project?: Project
): PlannedStyleWriteV1 | null {
  const source = readOptionalStyleText(filePath, `Style sandbox JSX ${filePath}`);
  if (source === null) return null;
  const resolvedProject = project ?? new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  });
  const sourceFile = resolvedProject.createSourceFile(
    `/${path.basename(filePath)}-${Buffer.from(filePath).toString('hex')}.tsx`,
    source,
    { overwrite: true }
  );
  let changed = false;

  for (const attr of sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() !== 'className') continue;
    const initializer = attr.getInitializer();
    if (!initializer) continue;
    if (Node.isStringLiteral(initializer)) {
      const original = initializer.getLiteralValue();
      const next = prefixClassNameString(original, prefix);
      if (next !== original) {
        initializer.setLiteralValue(next);
        changed = true;
      }
      continue;
    }
    if (Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (expression && Node.isStringLiteral(expression)) {
        const original = expression.getLiteralValue();
        const next = prefixClassNameString(original, prefix);
        if (next !== original) {
          expression.setLiteralValue(next);
          changed = true;
        }
        continue;
      }
    }
    return styleError(
      'COMPOSE-STYLE-002',
      `Dynamic className in ${filePath} requires an explicit Style Transform Provider`
    );
  }

  return changed ? Object.freeze({
    filePath,
    expectedBytes: Buffer.from(source, 'utf8'),
    text: sourceFile.getFullText()
  }) : null;
}

export async function prefixJsxClassNames(
  filePath: string,
  prefix = DEFAULT_PREFIX,
  commitFence?: CommitFence,
  project?: Project
): Promise<boolean> {
  const planned = planJsxClassNames(filePath, prefix, project);
  if (planned === null) return false;
  const projectRoot = path.dirname(filePath);
  await commitFence?.();
  assertPlannedStylePreimagesCurrent([planned]);
  await publishPlannedStyleWrite(projectRoot, planned, commitFence);
  return true;
}

export async function applyPrefixSandboxing(
  projectRoot: string,
  generatedPaths: string[],
  commitFence?: CommitFence
): Promise<string[]> {
  const pathsByIdentity = new Map<string, string>();
  for (const relPath of generatedPaths) {
    const identity = portableLogicalPathCollisionKeyV1(relPath, 'Style sandbox publication path');
    const previous = pathsByIdentity.get(identity);
    if (previous !== undefined && previous !== relPath) {
      throw new CompilerError(
        'COMPOSE-PATH-004',
        `Style sandbox paths alias one portable publication target: ${previous}, ${relPath}`
      );
    }
    pathsByIdentity.set(identity, relPath);
  }
  const plannedWrites: PlannedStyleWriteV1[] = [];
  const tailwind = planTailwindPrefix(projectRoot);
  if (tailwind !== null) plannedWrites.push(tailwind);
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  });
  for (const relPath of [...pathsByIdentity.values()].sort()) {
    const filePath = path.join(projectRoot, ...relPath.split('/'));
    const ext = path.extname(relPath).toLowerCase();
    if (ext === '.css') {
      const content = readOptionalStyleText(filePath, `Style sandbox CSS ${relPath}`);
      if (content === null) continue;
      const updated = prefixCssContent(content);
      if (content !== updated) plannedWrites.push(Object.freeze({
        filePath,
        expectedBytes: Buffer.from(content, 'utf8'),
        text: updated
      }));
    } else if (ext === '.tsx' || ext === '.jsx') {
      const planned = planJsxClassNames(filePath, DEFAULT_PREFIX, project);
      if (planned !== null) plannedWrites.push(planned);
    }
  }
  await commitFence?.();
  assertPlannedStylePreimagesCurrent(plannedWrites);
  for (const planned of plannedWrites) {
    await publishPlannedStyleWrite(projectRoot, planned, commitFence);
  }
  return tailwind === null ? [] : ['tailwind.config.ts'];
}
