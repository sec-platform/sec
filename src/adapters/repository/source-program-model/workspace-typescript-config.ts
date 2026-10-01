import path from 'node:path';
import ts from 'typescript';

export function parseContainedTypeScriptProjectConfig(
  source: string,
  projectConfigPath: string
): Readonly<Record<string, unknown>> {
  const parsed = ts.parseConfigFileTextToJson(projectConfigPath, source);
  if (parsed.error !== undefined || parsed.config === undefined || parsed.config === null
      || typeof parsed.config !== 'object' || Array.isArray(parsed.config)) {
    throw new Error('TypeScript ProjectInput config is invalid');
  }
  const config = parsed.config as Record<string, unknown>;
  if ('extends' in config || 'references' in config) {
    throw new Error('TypeScript ProjectInput config cannot escape through extends or references');
  }
  const contained = (value: unknown, label: string): void => {
    if (typeof value !== 'string' || path.isAbsolute(value)
        || value.split(/[\\/]+/u).includes('..') || value.includes('\0')) {
      throw new Error(`TypeScript ProjectInput ${label} is not repository-contained`);
    }
  };
  for (const key of ['files', 'include', 'exclude'] as const) {
    const value = config[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error(`TypeScript ProjectInput ${key} is invalid`);
    for (const entry of value) contained(entry, key);
  }
  const compilerOptions = config.compilerOptions;
  if (compilerOptions === undefined) return Object.freeze(config);
  if (compilerOptions === null || typeof compilerOptions !== 'object'
      || Array.isArray(compilerOptions)) {
    throw new Error('TypeScript ProjectInput compilerOptions is invalid');
  }
  const options = compilerOptions as Record<string, unknown>;
  if ('plugins' in options) {
    throw new Error('TypeScript ProjectInput cannot load compiler plugins');
  }
  for (const key of ['baseUrl', 'rootDir', 'outDir', 'declarationDir'] as const) {
    if (options[key] !== undefined) contained(options[key], `compilerOptions.${key}`);
  }
  for (const key of ['rootDirs', 'typeRoots'] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw new Error(`TypeScript ProjectInput compilerOptions.${key} is invalid`);
    }
    for (const entry of value) contained(entry, `compilerOptions.${key}`);
  }
  const paths = options.paths;
  if (paths === undefined) return Object.freeze(config);
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new Error('TypeScript ProjectInput compilerOptions.paths is invalid');
  }
  for (const targets of Object.values(paths as Record<string, unknown>)) {
    if (!Array.isArray(targets)) {
      throw new Error('TypeScript ProjectInput compilerOptions.paths targets are invalid');
    }
    for (const target of targets) contained(target, 'compilerOptions.paths');
  }
  return Object.freeze(config);
}

export function parseTypeScriptProjectConfiguration(
  configPath: string,
  configSource: string,
  config: Readonly<Record<string, unknown>>,
  host: ts.ParseConfigHost,
  virtualRoot: string
): ts.ParsedCommandLine {
  const absoluteConfigPath = path.resolve(virtualRoot, configPath);
  const configDirectory = path.dirname(absoluteConfigPath);
  const sourceFile = ts.parseJsonText(absoluteConfigPath, configSource);
  const parsed = ts.parseJsonSourceFileConfigFileContent(
    sourceFile,
    host,
    configDirectory,
    { noEmit: true },
    absoluteConfigPath
  );
  if (parsed.fileNames.length > 0 || parsed.errors.length === 0) return parsed;

  const emptyProjectValidation = ts.parseJsonConfigFileContent(
    Object.freeze({
      ...config,
      ...(!Object.prototype.hasOwnProperty.call(config, 'references')
        ? { references: Object.freeze([]) }
        : {})
    }),
    host,
    configDirectory,
    { noEmit: true },
    absoluteConfigPath
  );
  return emptyProjectValidation.fileNames.length === 0
    && emptyProjectValidation.errors.length === 0
    ? emptyProjectValidation
    : parsed;
}
