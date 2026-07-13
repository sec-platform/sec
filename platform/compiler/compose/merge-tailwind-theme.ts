import fs from 'node:fs/promises';
import path from 'node:path';
import { Node, ObjectLiteralExpression, Project, SyntaxKind } from 'ts-morph';
import { pathExists, readJson, readText, writeText, type CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';

function mergeJsonObjectIntoAst(astObject: ObjectLiteralExpression, jsonObject: any) {
  for (const [key, value] of Object.entries(jsonObject)) {
    const existingProp = astObject.getProperty(key);
    if (existingProp && Node.isPropertyAssignment(existingProp)) {
      const initializer = existingProp.getInitializer();
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (initializer && Node.isObjectLiteralExpression(initializer)) {
          mergeJsonObjectIntoAst(initializer, value);
          continue;
        }
      }
      existingProp.setInitializer(JSON.stringify(value));
    } else {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const newProp = astObject.addPropertyAssignment({
          name: JSON.stringify(key),
          initializer: '{}'
        });
        const newObj = newProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        mergeJsonObjectIntoAst(newObj, value);
      } else {
        astObject.addPropertyAssignment({
          name: JSON.stringify(key),
          initializer: JSON.stringify(value)
        });
      }
    }
  }
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

  // 1. Process tailwind config extend if json exists
  if (await pathExists(extendJsonPath)) {
    const extendJson = await readJson<any>(extendJsonPath);
    const targetConfigPath = path.join(projectRoot, 'tailwind.config.ts');

    // Ensure base tailwind.config.ts exists
    if (!(await pathExists(targetConfigPath))) {
      await writeText(targetConfigPath, `import type { Config } from "tailwindcss";

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
`, commitFence);
    }

    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(targetConfigPath);

    // Find the config object literal
    let configObject: ObjectLiteralExpression | undefined;
    const configVar = sourceFile.getVariableDeclaration('config');
    if (configVar) {
      configObject = configVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
    }

    if (!configObject) {
      // Try default export directly
      const exportAssignment = sourceFile.getExportAssignments().find(ea => !ea.isExportEquals());
      if (exportAssignment) {
        configObject = exportAssignment.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
      }
    }

    if (configObject) {
      // Find or create 'theme'
      let themeProp = configObject.getProperty('theme');
      if (!themeProp) {
        themeProp = configObject.addPropertyAssignment({ name: 'theme', initializer: '{}' });
      }
      if (Node.isPropertyAssignment(themeProp)) {
        let themeObject = themeProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (!themeObject) {
          themeProp.setInitializer('{}');
          themeObject = themeProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        }

        // Find or create 'extend'
        let extendProp = themeObject.getProperty('extend');
        if (!extendProp) {
          extendProp = themeObject.addPropertyAssignment({ name: 'extend', initializer: '{}' });
        }
        if (Node.isPropertyAssignment(extendProp)) {
          let extendObject = extendProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
          if (!extendObject) {
            extendProp.setInitializer('{}');
            extendObject = extendProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
          }

          // Merge JSON properties recursively into theme.extend AST object
          mergeJsonObjectIntoAst(extendObject, extendJson);
        }
      }
      await commitFence?.();
      await sourceFile.save();
      generatedPaths.push('tailwind.config.ts');
    }
  }

  // 2. Process custom CSS if globals.css exists
  if (await pathExists(customCssPath)) {
    const customCss = await readText(customCssPath);
    let targetCssPath = path.join(projectRoot, 'src', 'app', 'globals.css');
    if (!(await pathExists(targetCssPath))) {
      targetCssPath = path.join(projectRoot, 'app', 'globals.css');
    }

    if (await pathExists(targetCssPath)) {
      await commitFence?.();
      await fs.appendFile(targetCssPath, `\n/* Merged from source/assets/theme/globals.css */\n${customCss}\n`, 'utf8');
      const cssRelative = path.relative(projectRoot, targetCssPath).split(path.sep).join('/');
      generatedPaths.push(cssRelative);
    }
  }

  return generatedPaths;
}
