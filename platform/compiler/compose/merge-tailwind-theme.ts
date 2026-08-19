import path from 'node:path';

import { Node, ObjectLiteralExpression, Project, SyntaxKind } from 'ts-morph';

import { compareCodeUnits } from '../../shared/canonical-primitives.ts';
import { CompilerError } from '../../shared/errors.ts';
import { writeText, type CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import {
  decodeExactUtf8V1,
  readOptionalRetainedOrdinaryFileV1
} from '../../shared/retained-file-read.ts';

const DEFAULT_TAILWIND_CONFIG = `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
export default config;
`;

const CSS_SECTION_BEGIN = '/* SEC BEGIN source/assets/theme/globals.css */';
const CSS_SECTION_END = '/* SEC END source/assets/theme/globals.css */';

type JsonObject = Record<string, unknown>;

function readOptionalRetainedText(filePath: string, label: string): string | null {
  const bytes = readOptionalRetainedOrdinaryFileV1(filePath, label);
  return bytes === null ? null : decodeExactUtf8V1(bytes, label);
}

function readOptionalJsonObject(filePath: string, label: string): JsonObject | null {
  const source = readOptionalRetainedText(filePath, label);
  if (source === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new CompilerError(
      'COMPOSE-THEME-001',
      `${label} is not valid JSON`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompilerError('COMPOSE-THEME-001', `${label} must contain one JSON object`);
  }
  return value as JsonObject;
}

function jsonInitializer(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new CompilerError('COMPOSE-THEME-001', 'Tailwind theme JSON contains an unsupported value');
  }
  return serialized;
}

function mergeJsonObjectIntoAst(astObject: ObjectLiteralExpression, jsonObject: JsonObject): void {
  const entries = Object.entries(jsonObject)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  for (const [key, value] of entries) {
    const existingProp = astObject.getProperty(key) ?? astObject.getProperty(JSON.stringify(key));
    if (existingProp && !Node.isPropertyAssignment(existingProp)) {
      throw new CompilerError(
        'COMPOSE-THEME-002',
        `Tailwind property "${key}" cannot be deterministically merged because its existing AST shape is unsupported`
      );
    }
    if (existingProp) {
      const initializer = existingProp.getInitializer();
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!initializer || !Node.isObjectLiteralExpression(initializer)) {
          throw new CompilerError(
            'COMPOSE-THEME-002',
            `Tailwind object property "${key}" is dynamic/non-object and cannot be replaced by structural merge`
          );
        }
        mergeJsonObjectIntoAst(initializer, value as JsonObject);
        continue;
      }
      existingProp.setInitializer(jsonInitializer(value));
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const newProp = astObject.addPropertyAssignment({
        name: JSON.stringify(key),
        initializer: '{}'
      });
      mergeJsonObjectIntoAst(
        newProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression),
        value as JsonObject
      );
    } else {
      astObject.addPropertyAssignment({
        name: JSON.stringify(key),
        initializer: jsonInitializer(value)
      });
    }
  }
}

function renderTailwindConfig(currentSource: string, extendJson: JsonObject, targetPath: string): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true
  });
  const sourceFile = project.createSourceFile('/tailwind.config.ts', currentSource, { overwrite: true });

  let configObject: ObjectLiteralExpression | undefined;
  const configVar = sourceFile.getVariableDeclaration('config');
  if (configVar) {
    configObject = configVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  }
  if (!configObject) {
    const exportAssignment = sourceFile.getExportAssignments().find((entry) => !entry.isExportEquals());
    configObject = exportAssignment?.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
  }
  if (!configObject) {
    throw new CompilerError(
      'COMPOSE-THEME-002',
      `Tailwind config cannot be deterministically merged because no supported config object exists: ${targetPath}`
    );
  }

  let themeProp = configObject.getProperty('theme');
  if (!themeProp) themeProp = configObject.addPropertyAssignment({ name: 'theme', initializer: '{}' });
  if (!Node.isPropertyAssignment(themeProp)) {
    throw new CompilerError('COMPOSE-THEME-002', 'Tailwind theme property has an unsupported AST shape');
  }
  const themeObject = themeProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!themeObject) {
    throw new CompilerError(
      'COMPOSE-THEME-002',
      'Tailwind theme property is dynamic/non-object and cannot be replaced by structural merge'
    );
  }

  let extendProp = themeObject.getProperty('extend');
  if (!extendProp) extendProp = themeObject.addPropertyAssignment({ name: 'extend', initializer: '{}' });
  if (!Node.isPropertyAssignment(extendProp)) {
    throw new CompilerError('COMPOSE-THEME-002', 'Tailwind theme.extend property has an unsupported AST shape');
  }
  const extendObject = extendProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!extendObject) {
    throw new CompilerError(
      'COMPOSE-THEME-002',
      'Tailwind theme.extend property is dynamic/non-object and cannot be replaced by structural merge'
    );
  }
  mergeJsonObjectIntoAst(extendObject, extendJson);
  return sourceFile.getFullText();
}

function managedCssSection(customCss: string): string {
  return `${CSS_SECTION_BEGIN}\n${customCss.trimEnd()}\n${CSS_SECTION_END}`;
}

function mergeManagedCss(existing: string, customCss: string): string {
  const begin = existing.indexOf(CSS_SECTION_BEGIN);
  const end = existing.indexOf(CSS_SECTION_END);
  const secondBegin = begin < 0 ? -1 : existing.indexOf(CSS_SECTION_BEGIN, begin + CSS_SECTION_BEGIN.length);
  const secondEnd = end < 0 ? -1 : existing.indexOf(CSS_SECTION_END, end + CSS_SECTION_END.length);
  if ((begin < 0) !== (end < 0) || secondBegin >= 0 || secondEnd >= 0 || (begin >= 0 && end < begin)) {
    throw new CompilerError(
      'COMPOSE-THEME-003',
      'Tailwind globals.css contains an ambiguous or partial SEC-managed theme section'
    );
  }
  const section = managedCssSection(customCss);
  if (begin < 0) return `${existing.trimEnd()}\n\n${section}\n`;
  const after = end + CSS_SECTION_END.length;
  return `${existing.slice(0, begin)}${section}${existing.slice(after)}`;
}

export async function mergeTailwindTheme(
  workspaceRoot: string,
  projectRoot: string,
  commitFence?: CommitFence
): Promise<string[]> {
  const { sourceCodeRoot } = getWorkspacePaths(workspaceRoot);
  const themeDir = path.join(sourceCodeRoot, 'assets', 'theme');
  const extendJsonPath = path.join(themeDir, 'tailwind.config.extend.json');
  const customCssPath = path.join(themeDir, 'globals.css');
  const generatedPaths: string[] = [];

  const extendJson = readOptionalJsonObject(extendJsonPath, 'Tailwind theme extension');
  if (extendJson !== null) {
    const targetConfigPath = path.join(projectRoot, 'tailwind.config.ts');
    const currentConfig = readOptionalRetainedText(targetConfigPath, 'Tailwind config target')
      ?? DEFAULT_TAILWIND_CONFIG;
    const nextConfig = renderTailwindConfig(currentConfig, extendJson, targetConfigPath);
    if (nextConfig !== currentConfig) {
      await writeText(targetConfigPath, nextConfig, commitFence);
    }
    generatedPaths.push('tailwind.config.ts');
  }

  const customCss = readOptionalRetainedText(customCssPath, 'Tailwind custom CSS source');
  if (customCss !== null) {
    const candidates = [
      path.join(projectRoot, 'src', 'app', 'globals.css'),
      path.join(projectRoot, 'app', 'globals.css')
    ];
    const existingCandidates = candidates
      .map((targetPath) => ({
        targetPath,
        source: readOptionalRetainedText(targetPath, `Tailwind CSS target ${targetPath}`)
      }))
      .filter((entry): entry is { targetPath: string; source: string } => entry.source !== null);
    if (existingCandidates.length !== 1) {
      throw new CompilerError(
        'COMPOSE-THEME-003',
        existingCandidates.length === 0
          ? 'Tailwind custom CSS has no canonical globals.css target'
          : 'Tailwind custom CSS has multiple candidate globals.css targets'
      );
    }
    const target = existingCandidates[0]!;
    const nextCss = mergeManagedCss(target.source, customCss);
    if (nextCss !== target.source) {
      await writeText(target.targetPath, nextCss, commitFence);
    }
    generatedPaths.push(path.relative(projectRoot, target.targetPath).split(path.sep).join('/'));
  }

  return generatedPaths;
}
