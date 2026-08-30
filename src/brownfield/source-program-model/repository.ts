import path from 'node:path';
import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleGraph, type SecRepositoryModuleMembership } from '../../system-architecture/repository-modules/contract.ts';
import type {
  SourceProgramCandidate,
  SourceProgramCapabilityAuthorityClass,
  SourceProgramDeclaration,
  SourceProgramDependency,
  SourceProgramDependencyScope,
  SourceProgramEntrypoint,
  SourceProgramEntrypointAddress,
  SourceProgramEntrypointClosure,
  SourceProgramFile,
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramPackage,
  SourceProgramTopologySummary,
  SourceProgramUnknown
} from './contract.ts';
import { sourceProgramSurfaceForPath } from './contract.ts';
import {
  compileTypeScriptSourceProgramModel,
  isCompiledTypeScriptSourceProgramModel
} from './typescript.ts';

export interface CompileRepositorySourceProgramModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: SecRepositoryModuleMembership;
  readonly unknowns?: readonly SourceProgramUnknown[];
  /** Exact process dispatcher identities admitted by the current TCB compiler. */
  readonly reviewedProcessDispatchers?: readonly string[];
  /**
   * Exact TypeScript facts compiled by this package's incremental compiler.
   * The repository compiler validates the snapshot before consuming it.
   */
  readonly typescriptModel?: SourceProgramModel;
}

type JsonRecord = Record<string, unknown>;

const DIRECT_BUN_SOURCE = /^bun\s+(?:\.\/)?([A-Za-z0-9_./-]+\.[cm]?[jt]sx?)(?:\s|$)/u;
const BUN_SCRIPT_REFERENCE = /^bun\s+run\s+([A-Za-z0-9:_-]+)(?:\s+.*)?$/u;
const UNSUPPORTED_SHELL_COMPOSITION = /(?:\|\||[;|]|`|\$\(|&&)/u;
const IDENTITY_TOKEN_NAME = /(?:^|_)(?:format(?:_?version)?|schema|revision|version)(?:$|_)/iu;
const VERSIONED_DECLARATION_NAME = /^(.*?)(?:_?V)([1-9][0-9]*)$/u;

function identityFieldName(declarationName: string): string | null {
  const canonicalName = declarationName.replace(/_V[1-9][0-9]*$/u, '');
  if (/(?:^|_)FORMAT_VERSION$/u.test(canonicalName)) return 'formatVersion';
  if (/(?:^|_)SCHEMA$/u.test(canonicalName)) return 'schema';
  if (/(?:^|_)REVISION$/u.test(canonicalName)) return 'revision';
  if (/(?:^|_)VERSION$/u.test(canonicalName)) return 'version';
  if (/(?:^|_)FORMAT$/u.test(canonicalName)) return 'format';
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function dependencyPackageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function observedEntrypoint(input: Omit<SourceProgramEntrypoint, 'observationId'>): SourceProgramEntrypoint {
  return Object.freeze({
    ...input,
    observationId: sha256(input)
  });
}

function entrypointAddress(
  kind: SourceProgramEntrypoint['kind'],
  entrypointPath: string,
  name: string
): SourceProgramEntrypointAddress {
  return `${kind}:${entrypointPath}#${name}` as SourceProgramEntrypointAddress;
}

function parseEntrypointAddress(
  address: SourceProgramEntrypointAddress
): Readonly<{
  kind: SourceProgramEntrypoint['kind'];
  path: string;
  name: string;
}> | null {
  const kindSeparator = address.indexOf(':');
  const nameSeparator = address.lastIndexOf('#');
  if (
    kindSeparator <= 0
    || nameSeparator <= kindSeparator + 1
    || nameSeparator >= address.length - 1
  ) return null;
  const kind = address.slice(0, kindSeparator);
  if (
    kind !== 'package-script'
    && kind !== 'package-bin'
    && kind !== 'cli-command'
    && kind !== 'module-entrypoint'
    && kind !== 'git-hook'
    && kind !== 'workflow'
  ) return null;
  return Object.freeze({
    kind,
    path: address.slice(kindSeparator + 1, nameSeparator),
    name: address.slice(nameSeparator + 1)
  });
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return null;
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function packageNameFromLockedResolution(value: string): string | null {
  const separator = value.startsWith('@') ? value.indexOf('@', 1) : value.lastIndexOf('@');
  return separator > 0 ? value.slice(0, separator) : null;
}

function executableSourceLiteralPaths(
  files: readonly SourceProgramFileInput[]
): readonly Readonly<{ ownerPath: string; digest: string }>[] {
  const observations: Readonly<{ ownerPath: string; digest: string }>[] = [];
  for (const file of files) {
    if (sourceProgramSurfaceForPath(file.path) !== 'production' || !/\.[cm]?[jt]sx?$/iu.test(file.path)) continue;
    const sourceFile = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && node.text.includes('\n') && node.text.length >= 32) {
        const embedded = ts.createSourceFile(
          'embedded.ts',
          node.text,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const diagnostics = (embedded as ts.SourceFile & {
          readonly parseDiagnostics?: readonly ts.Diagnostic[];
        }).parseDiagnostics ?? [];
        const executable = diagnostics.length === 0 && embedded.statements.some((statement) => (
          ts.isImportDeclaration(statement)
          || ts.isExportDeclaration(statement)
          || ts.isFunctionDeclaration(statement)
          || ts.isClassDeclaration(statement)
          || ts.isInterfaceDeclaration(statement)
          || ts.isTypeAliasDeclaration(statement)
          || ts.isEnumDeclaration(statement)
          || ts.isVariableStatement(statement)
        ));
        if (executable) {
          observations.push(Object.freeze({
            ownerPath: file.path,
            digest: rawSha256(Buffer.from(node.text, 'utf8'))
          }));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return Object.freeze(observations);
}

export function compileRepositorySourceProgramModel(
  input: CompileRepositorySourceProgramModelInput
): SourceProgramModel {
  const typescriptModel = input.typescriptModel ?? compileTypeScriptSourceProgramModel(input);
  if (typescriptModel.sourceRevision !== input.sourceRevision
      || !isCompiledTypeScriptSourceProgramModel(typescriptModel)) {
    throw new Error('Repository Source Program Model received an invalid TypeScript fact snapshot');
  }
  const expectedTypeScriptFiles = input.files
    .filter(({ path: repositoryPath }) => /\.(?:[cm]?[jt]sx?)$/iu.test(repositoryPath))
    .map(({ path: repositoryPath, contentDigest }) => `${repositoryPath}\0${contentDigest}`)
    .sort(compareCodeUnits);
  const observedTypeScriptFiles = typescriptModel.files
    .map(({ path: repositoryPath, contentDigest }) => `${repositoryPath}\0${contentDigest}`)
    .sort(compareCodeUnits);
  if (expectedTypeScriptFiles.length !== observedTypeScriptFiles.length
      || expectedTypeScriptFiles.some((identity, index) => identity !== observedTypeScriptFiles[index])) {
    throw new Error('Repository Source Program Model TypeScript facts do not bind the exact source files');
  }
  const entrypoints: SourceProgramEntrypoint[] = [...typescriptModel.entrypoints];
  const packages: SourceProgramPackage[] = [];
  const dependencies: SourceProgramDependency[] = [];
  const unknowns: SourceProgramUnknown[] = [
    ...(input.unknowns ?? []),
    ...typescriptModel.unknowns
  ];
  const filePaths = new Set(input.files.map(({ path: repositoryPath }) => repositoryPath));
  const externalConsumers = new Map<string, Set<string>>();
  for (const unknown of typescriptModel.unknowns) {
    if (unknown.code !== 'external-module-opaque') continue;
    const dependency = dependencyPackageName(unknown.detail);
    const consumers = externalConsumers.get(dependency) ?? new Set<string>();
    consumers.add(unknown.path);
    externalConsumers.set(dependency, consumers);
  }
  const ambientTypeConsumers = new Map<string, Set<string>>();
  for (const file of input.files) {
    if (path.posix.basename(file.path) !== 'tsconfig.json') continue;
    const parsed = ts.parseConfigFileTextToJson(file.path, file.source);
    if (parsed.error || !isRecord(parsed.config)) {
      unknowns.push(Object.freeze({
        code: 'typescript-config-unresolved',
        path: file.path,
        detail: parsed.error
          ? ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')
          : 'configuration root is not an object',
        span: null
      }));
      continue;
    }
    const compilerOptions = isRecord(parsed.config.compilerOptions)
      ? parsed.config.compilerOptions
      : null;
    const types = compilerOptions?.types;
    if (!Array.isArray(types) || types.some((entry) => typeof entry !== 'string')) continue;
    for (const typeName of types as string[]) {
      const packageName = `@types/${typeName}`;
      const consumers = ambientTypeConsumers.get(packageName) ?? new Set<string>();
      consumers.add(file.path);
      ambientTypeConsumers.set(packageName, consumers);
    }
  }

  const packageBins = new Map<string, Set<string>>();
  const packageForBin = new Map<string, string | null>();
  for (const file of input.files) {
    if (path.posix.basename(file.path) !== 'bun.lock') continue;
    const parsed = ts.parseConfigFileTextToJson(file.path, file.source);
    if (parsed.error || !isRecord(parsed.config) || !isRecord(parsed.config.packages)) {
      unknowns.push(Object.freeze({
        code: 'package-lock-unresolved',
        path: file.path,
        detail: parsed.error
          ? ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')
          : 'Bun lock package table is absent',
        span: null
      }));
      continue;
    }
    for (const locked of Object.values(parsed.config.packages)) {
      if (!Array.isArray(locked) || typeof locked[0] !== 'string' || !isRecord(locked[2])) continue;
      const packageName = packageNameFromLockedResolution(locked[0]);
      const bins = stringRecord(locked[2].bin);
      if (packageName === null || bins === null) continue;
      const names = packageBins.get(packageName) ?? new Set<string>();
      for (const binName of Object.keys(bins)) {
        names.add(binName);
        if (!packageForBin.has(binName)) packageForBin.set(binName, packageName);
        else if (packageForBin.get(binName) !== packageName) packageForBin.set(binName, null);
      }
      packageBins.set(packageName, names);
    }
    for (const [binName, packageName] of packageForBin) {
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'package-bin',
        name: binName,
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([]),
        targetPackages: Object.freeze(packageName === null ? [] : [packageName]),
        observationClass: packageName === null ? 'unknown' : 'derived',
        span: null
      }));
    }
  }

  for (const descriptor of input.moduleMembership.descriptors) {
    for (const targetPath of descriptor.externalEntrypoints) {
      entrypoints.push(observedEntrypoint({
        path: `${descriptor.root}/sec.module.json`,
        kind: 'module-entrypoint',
        name: `${descriptor.moduleId}:${targetPath}`,
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([targetPath]),
        targetPackages: Object.freeze([]),
        observationClass: filePaths.has(targetPath) ? 'observed' : 'unknown',
        span: null
      }));
    }
  }

  for (const file of input.files) {
    if (file.path === 'package.json' || file.path.endsWith('/package.json')) {
      let manifest: JsonRecord;
      try {
        const parsed: unknown = JSON.parse(file.source);
        if (!isRecord(parsed)) throw new Error('package manifest root is not an object');
        manifest = parsed;
      } catch (error) {
        unknowns.push(Object.freeze({
          code: 'package-manifest-unresolved',
          path: file.path,
          detail: error instanceof Error ? error.message : String(error),
          span: null
        }));
        continue;
      }
      const packageName = typeof manifest.name === 'string'
        ? manifest.name
        : path.posix.basename(path.posix.dirname(file.path)) || '<repository-root>';
      packages.push(Object.freeze({
        manifestPath: file.path,
        name: packageName,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        private: typeof manifest.private === 'boolean' ? manifest.private : null
      }));

      const scripts = stringRecord(manifest.scripts);
      if (manifest.scripts !== undefined && scripts === null) {
        unknowns.push(Object.freeze({
          code: 'package-scripts-unresolved',
          path: file.path,
          detail: 'scripts must be an object of string commands',
          span: null
        }));
      }
      for (const [name, command] of Object.entries(scripts ?? {})) {
        const segments = command.split(/\s+&&\s+/u);
        const targetEntrypoints: SourceProgramEntrypointAddress[] = [];
        const targetPaths: string[] = [];
        const targetPackages: string[] = [];
        let structured = segments.length > 0;
        for (const segment of segments) {
          if (UNSUPPORTED_SHELL_COMPOSITION.test(segment)) {
            structured = false;
            break;
          }
          const scriptReference = BUN_SCRIPT_REFERENCE.exec(segment)?.[1] ?? null;
          if (scriptReference !== null) {
            targetEntrypoints.push(entrypointAddress('package-script', file.path, scriptReference));
            continue;
          }
          const directSource = DIRECT_BUN_SOURCE.exec(segment)?.[1] ?? null;
          if (directSource !== null) {
            targetPaths.push(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), directSource)));
            continue;
          }
          const executable = /^([A-Za-z0-9_.@/-]+)(?:\s|$)/u.exec(segment)?.[1] ?? null;
          const providerPackage = executable === null ? undefined : packageForBin.get(executable);
          if (executable !== null && providerPackage !== undefined && providerPackage !== null) {
            targetEntrypoints.push(entrypointAddress('package-bin', 'bun.lock', executable));
            targetPackages.push(providerPackage);
            continue;
          }
          structured = false;
          break;
        }
        const resolved = structured
          && targetPaths.every((targetPath) => filePaths.has(targetPath))
          && targetEntrypoints.every((address) => {
            const target = parseEntrypointAddress(address);
            if (target === null) return false;
            return target.kind === 'package-bin'
              ? target.path === 'bun.lock'
                && packageForBin.get(target.name) !== null
                && packageForBin.has(target.name)
              : target.kind === 'package-script'
                && target.path === file.path
                && Object.hasOwn(scripts ?? {}, target.name);
          });
        entrypoints.push(observedEntrypoint({
          path: file.path,
          kind: 'package-script',
          name,
          command,
          targetEntrypoints: Object.freeze(targetEntrypoints),
          targetPaths: Object.freeze(targetPaths),
          targetPackages: Object.freeze([...new Set(targetPackages)].sort(compareCodeUnits)),
          observationClass: resolved ? 'derived' : 'unknown',
          span: null
        }));
        if (!resolved) {
          unknowns.push(Object.freeze({
            code: /(?:&&|\|\||[;|]|`|\$\()/u.test(command)
              ? 'package-script-shell-opaque'
              : targetPaths.length > 0 || targetEntrypoints.length > 0
                ? 'package-script-target-unresolved'
                : 'package-script-command-unresolved',
            path: file.path,
            detail: `${name}: ${command}`,
            span: null
          }));
        }
      }
      const reportedCycles = new Set<string>();
      for (const initial of Object.keys(scripts ?? {}).sort(compareCodeUnits)) {
        const chain: string[] = [];
        let current: string | null = initial;
        while (current !== null) {
          const repeatedAt = chain.indexOf(current);
          if (repeatedAt >= 0) {
            const cycle = chain.slice(repeatedAt).sort(compareCodeUnits);
            const cycleKey = cycle.join('\0');
            if (!reportedCycles.has(cycleKey)) {
              reportedCycles.add(cycleKey);
              unknowns.push(Object.freeze({
                code: 'package-script-cycle',
                path: file.path,
                detail: cycle.join(' -> '),
                span: null
              }));
            }
            break;
          }
          chain.push(current);
          const referencedCommand: string | undefined = scripts?.[current];
          if (referencedCommand === undefined || UNSUPPORTED_SHELL_COMPOSITION.test(referencedCommand)) break;
          current = BUN_SCRIPT_REFERENCE.exec(referencedCommand)?.[1] ?? null;
        }
      }

      const packageSourceValue = typeof manifest.source === 'string' ? manifest.source : null;
      const packageSourcePath = packageSourceValue !== null
        && packageSourceValue.startsWith('./')
        && !packageSourceValue.includes('\\')
        && !packageSourceValue.split('/').includes('..')
        ? path.posix.normalize(path.posix.join(
            path.posix.dirname(file.path),
            packageSourceValue.slice(2)
          ))
        : null;
      if (manifest.source !== undefined && (
        packageSourcePath === null
        || !filePaths.has(packageSourcePath)
      )) {
        unknowns.push(Object.freeze({
          code: 'package-source-unresolved',
          path: file.path,
          detail: String(manifest.source),
          span: null
        }));
      }

      const bins = typeof manifest.bin === 'string'
        ? { [packageName]: manifest.bin }
        : stringRecord(manifest.bin) ?? {};
      for (const [name, target] of Object.entries(bins)) {
        const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), target));
        const targetObserved = filePaths.has(targetPath);
        const sourceCommand = scripts?.[name];
        const directSource = sourceCommand === undefined
          ? null
          : DIRECT_BUN_SOURCE.exec(sourceCommand)?.[1] ?? null;
        const directSourcePath = directSource === null
          ? null
          : path.posix.normalize(path.posix.join(path.posix.dirname(file.path), directSource));
        const sourceBound = packageSourcePath !== null
          && filePaths.has(packageSourcePath)
          && directSourcePath === packageSourcePath;
        entrypoints.push(observedEntrypoint({
          path: file.path,
          kind: 'package-bin',
          name,
          command: null,
          targetEntrypoints: Object.freeze(sourceBound
            ? [entrypointAddress('package-script', file.path, name)]
            : []),
          targetPaths: Object.freeze([targetPath]),
          targetPackages: Object.freeze([packageName]),
          observationClass: targetObserved ? 'observed' : sourceBound ? 'derived' : 'unknown',
          span: null
        }));
        if (!targetObserved && !sourceBound) {
          unknowns.push(Object.freeze({
            code: 'generated-output-unresolved',
            path: file.path,
            detail: `package bin ${name} targets ${targetPath}, but no canonical source/build mapping is present in the observed snapshot`,
            span: null
          }));
        }
      }

      const scopes: readonly [keyof JsonRecord, SourceProgramDependencyScope][] = [
        ['dependencies', 'runtime'],
        ['devDependencies', 'development'],
        ['peerDependencies', 'peer'],
        ['optionalDependencies', 'optional']
      ];
      for (const [field, scope] of scopes) {
        const declared = stringRecord(manifest[field]);
        if (manifest[field] !== undefined && declared === null) {
          unknowns.push(Object.freeze({
            code: 'package-dependencies-unresolved',
            path: file.path,
            detail: `${String(field)} must be an object of string requirements`,
            span: null
          }));
          continue;
        }
        for (const [name, requirement] of Object.entries(declared ?? {})) {
          const consumers = new Set(externalConsumers.get(name) ?? []);
          for (const consumer of ambientTypeConsumers.get(name) ?? []) consumers.add(consumer);
          if (name.startsWith('@types/')) {
            const baseName = name.slice('@types/'.length).replace('__', '/');
            for (const consumer of externalConsumers.get(baseName) ?? []) consumers.add(consumer);
            if (baseName === 'node') {
              for (const [specifier, paths] of externalConsumers) {
                if (!specifier.startsWith('node:')) continue;
                for (const consumer of paths) consumers.add(consumer);
              }
            } else if (baseName === 'bun') {
              for (const [specifier, paths] of externalConsumers) {
                if (specifier !== 'bun' && !specifier.startsWith('bun:')) continue;
                for (const consumer of paths) consumers.add(consumer);
              }
            }
          }
          const executableNames = packageBins.get(name) ?? new Set<string>();
          if (Object.values(scripts ?? {}).some((command) => command
            .split(/\s+&&\s+/u)
            .some((segment) => [...executableNames].some((executableName) => (
              segment === executableName || segment.startsWith(`${executableName} `)
            ))))) {
            consumers.add(file.path);
          }
          const consumerPaths = [...consumers].sort(compareCodeUnits);
          dependencies.push(Object.freeze({
            manifestPath: file.path,
            name,
            requirement,
            scope,
            consumerPaths: Object.freeze(consumerPaths),
            observationClass: consumerPaths.length > 0 ? 'derived' : 'unknown'
          }));
        }
      }
    }
    if (file.path.startsWith('.githooks/') && !file.path.endsWith('/')) {
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'git-hook',
        name: path.posix.basename(file.path),
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([file.path]),
        targetPackages: Object.freeze([]),
        observationClass: 'observed',
        span: null
      }));
    }
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/iu.test(file.path)) {
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'workflow',
        name: path.posix.basename(file.path),
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([file.path]),
        targetPackages: Object.freeze([]),
        observationClass: 'observed',
        span: null
      }));
    }
  }

  const sourceFiles = new Set(typescriptModel.files.map(({ path: repositoryPath }) => repositoryPath));
  const files: SourceProgramFile[] = [
    ...typescriptModel.files,
    ...input.files
      .filter(({ path: repositoryPath }) => !sourceFiles.has(repositoryPath))
      .map((file) => Object.freeze({
        path: file.path,
        contentDigest: file.contentDigest,
        moduleId: input.moduleMembership.moduleForPath(file.path)?.moduleId ?? null,
        surface: sourceProgramSurfaceForPath(file.path)
      }))
  ].sort((left, right) => compareCodeUnits(left.path, right.path));
  entrypoints.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.name, right.name)
  );
  packages.sort((left, right) => compareCodeUnits(left.manifestPath, right.manifestPath));
  dependencies.sort((left, right) =>
    compareCodeUnits(left.manifestPath, right.manifestPath)
    || compareCodeUnits(left.scope, right.scope)
    || compareCodeUnits(left.name, right.name)
  );
  const declaredDependencyNames = new Set(dependencies.map(({ name }) => name));
  for (let index = unknowns.length - 1; index >= 0; index -= 1) {
    const unknown = unknowns[index]!;
    if (unknown.code !== 'external-module-opaque') continue;
    const packageName = dependencyPackageName(unknown.detail);
    const runtimeBuiltin = unknown.detail === 'bun'
      || unknown.detail.startsWith('bun:')
      || unknown.detail.startsWith('node:');
    if (runtimeBuiltin || declaredDependencyNames.has(packageName)) {
      unknowns.splice(index, 1);
    }
  }
  unknowns.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.detail, right.detail)
  );
  const sourceByPath = new Map(input.files
    .filter(({ path: repositoryPath }) => /\.[cm]?[jt]sx?$/iu.test(repositoryPath))
    .map((file) => [file.path, file.source] as const));
  const importGraph = compileSecRepositoryModuleGraph({
    files: Object.freeze([...sourceByPath.keys()].sort(compareCodeUnits)),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath) ?? null
  });
  const entrypointByAddress = new Map(entrypoints.map((entrypoint) => [
    entrypointAddress(entrypoint.kind, entrypoint.path, entrypoint.name),
    entrypoint
  ]));
  const resolveEntrypointTargets = (entrypoint: SourceProgramEntrypoint): Readonly<{
    paths: readonly string[];
    packages: readonly string[];
    unresolved: boolean;
  }> => {
    const paths = new Set<string>();
    const packages = new Set<string>();
    const visited = new Set<string>();
    let unresolved = false;
    const collect = (current: SourceProgramEntrypoint): void => {
      const address = entrypointAddress(current.kind, current.path, current.name);
      if (visited.has(address)) {
        unresolved = true;
        return;
      }
      visited.add(address);
      for (const targetPath of current.targetPaths) paths.add(targetPath);
      for (const targetPackage of current.targetPackages) packages.add(targetPackage);
      for (const targetAddress of current.targetEntrypoints) {
        const target = entrypointByAddress.get(targetAddress);
        if (target === undefined) unresolved = true;
        else collect(target);
      }
      visited.delete(address);
    };
    collect(entrypoint);
    return Object.freeze({
      paths: Object.freeze([...paths].sort(compareCodeUnits)),
      packages: Object.freeze([...packages].sort(compareCodeUnits)),
      unresolved
    });
  };
  const capabilitiesByPath = new Map<string, typeof typescriptModel.capabilities[number][]>();
  for (const capability of typescriptModel.capabilities) {
    const group = capabilitiesByPath.get(capability.path) ?? [];
    group.push(capability);
    capabilitiesByPath.set(capability.path, group);
  }
  const graphUnknowns = new Set(importGraph.unresolvedFiles);
  const entrypointClosures: SourceProgramEntrypointClosure[] = entrypoints.map((entrypoint) => {
    const targets = resolveEntrypointTargets(entrypoint);
    const reachable = new Set<string>();
    const frontier = targets.paths.filter((targetPath) => sourceByPath.has(targetPath));
    while (frontier.length > 0) {
      const current = frontier.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const dependency of importGraph.directDependencies(current)) {
        if (!reachable.has(dependency)) frontier.push(dependency);
      }
    }
    const reachablePaths = [...reachable].sort(compareCodeUnits);
    const handlerModuleIds = [...new Set(targets.paths.flatMap((targetPath) => {
      const handler = input.moduleMembership.moduleForPath(targetPath);
      return handler === null ? [] : [handler.moduleId];
    }))].sort(compareCodeUnits);
    const capabilityInvocations = reachablePaths.flatMap((repositoryPath) => capabilitiesByPath.get(repositoryPath) ?? []);
    const capabilityPaths = [...new Set(capabilityInvocations.map(({ path: repositoryPath }) => repositoryPath))]
      .sort(compareCodeUnits);
    const transports = [...new Set(capabilityInvocations.map(({ transport }) => transport))]
      .sort(compareCodeUnits);
    const providerModuleIds = [...new Set(capabilityInvocations.flatMap(({ providerModuleId }) => (
      providerModuleId === null ? [] : [providerModuleId]
    )))].sort(compareCodeUnits);
    const unknownPaths = reachablePaths.filter((repositoryPath) => graphUnknowns.has(repositoryPath));
    if (targets.unresolved || (targets.paths.length === 0
        && targets.packages.length === 0
        && entrypoint.observationClass === 'unknown')) unknownPaths.push(entrypoint.path);
    return Object.freeze({
      entrypointObservationId: entrypoint.observationId,
      path: entrypoint.path,
      name: entrypoint.name,
      targetPaths: targets.paths,
      targetPackages: targets.packages,
      handlerModuleIds: Object.freeze(handlerModuleIds),
      reachablePaths: Object.freeze(reachablePaths),
      capabilityPaths: Object.freeze(capabilityPaths),
      transports: Object.freeze(transports),
      providerModuleIds: Object.freeze(providerModuleIds),
      unknownPaths: Object.freeze([...new Set(unknownPaths)].sort(compareCodeUnits)),
      observationClass: entrypoint.observationClass === 'unknown' || unknownPaths.length > 0
        ? 'unknown'
        : 'derived'
    });
  }).sort((left, right) =>
    compareCodeUnits(left.path, right.path) || compareCodeUnits(left.name, right.name)
  );
  const candidates: SourceProgramCandidate[] = [];
  for (const embedded of executableSourceLiteralPaths(input.files)) {
    candidates.push(Object.freeze({
      code: 'production-embeds-executable-source-text',
      subject: embedded.digest,
      paths: Object.freeze([embedded.ownerPath]),
      reason: 'production module embeds executable source bytes in a string; use the canonical source/template/AST owner and derive emitted bytes instead of creating a hidden second source graph',
      observationClass: 'derived'
    }));
  }
  for (const entrypoint of entrypoints) {
    if (
      entrypoint.kind !== 'package-bin'
      || entrypoint.observationClass !== 'unknown'
      || entrypoint.targetPaths.length === 0
    ) continue;
    candidates.push(Object.freeze({
      code: 'generated-output-unresolved',
      subject: entrypointAddress(entrypoint.kind, entrypoint.path, entrypoint.name),
      paths: Object.freeze([
        entrypoint.path,
        ...entrypoint.targetPaths
      ].sort(compareCodeUnits)),
      reason: `package bin ${entrypoint.name} points outside the observed source snapshot; a canonical generated-artifact source/build binding is required before closure can be complete`,
      observationClass: 'unknown'
    }));
  }
  const exportedOperationsByModule = new Map<string, Set<string>>();
  const declaredCapabilityOperationsByModule = new Map<string, Set<string>>();
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported) continue;
    const owner = input.moduleMembership.moduleForPath(declaration.path);
    if (owner === null) continue;
    const operations = exportedOperationsByModule.get(owner.moduleId) ?? new Set<string>();
    operations.add(declaration.name);
    exportedOperationsByModule.set(owner.moduleId, operations);
  }
  for (const descriptor of input.moduleMembership.descriptors) {
    const exportedOperations = exportedOperationsByModule.get(descriptor.moduleId) ?? new Set<string>();
    const declaredCapabilityOperations = declaredCapabilityOperationsByModule.get(descriptor.moduleId)
      ?? new Set<string>();
    for (const provider of descriptor.capabilityProviders) {
      for (const operation of provider.operations) {
        declaredCapabilityOperations.add(operation);
        if (exportedOperations.has(operation)) continue;
        candidates.push(Object.freeze({
          code: 'capability-provider-operation-unresolved',
          subject: `${provider.capability}:${operation}`,
          paths: Object.freeze([`${descriptor.root}/sec.module.json`]),
          reason: `provider ${descriptor.moduleId} declares an operation with no exported implementation in its module`,
          observationClass: 'unknown'
        }));
      }
    }
    declaredCapabilityOperationsByModule.set(descriptor.moduleId, declaredCapabilityOperations);
  }
  const nativeProcessOwners = new Set(input.moduleMembership.descriptors
    .filter(({ capabilityProviders }) => capabilityProviders.some(({ capability }) => capability === 'process.native'))
    .map(({ moduleId }) => moduleId));
  const directNativeProcessByPath = new Map<string, typeof typescriptModel.capabilities[number][]>();
  const reviewedProcessDispatchersByPath = new Map<string, number>();
  for (const identity of input.reviewedProcessDispatchers ?? []) {
    const separator = identity.indexOf('::');
    if (separator < 1) throw new Error(`Reviewed process dispatcher identity is malformed: ${identity}`);
    const dispatcherPath = identity.slice(0, separator);
    reviewedProcessDispatchersByPath.set(
      dispatcherPath,
      (reviewedProcessDispatchersByPath.get(dispatcherPath) ?? 0) + 1
    );
  }
  for (const invocation of typescriptModel.capabilities) {
    if (invocation.capability !== 'process'
        || invocation.transport !== 'native-runtime'
        || invocation.surface !== 'production'
        || (invocation.moduleId !== null && nativeProcessOwners.has(invocation.moduleId))) continue;
    const group = directNativeProcessByPath.get(invocation.path) ?? [];
    group.push(invocation);
    directNativeProcessByPath.set(invocation.path, group);
  }
  for (const [invocationPath, invocations] of directNativeProcessByPath) {
    const reviewedCount = reviewedProcessDispatchersByPath.get(invocationPath) ?? 0;
    if (reviewedCount === invocations.length) continue;
    const subjects = [...new Set(invocations.map(({ subject, operation }) => subject ?? operation))]
      .sort(compareCodeUnits);
    candidates.push(Object.freeze({
      code: 'direct-process-transport-outside-owner',
      subject: invocationPath,
      paths: Object.freeze([invocationPath]),
      reason: `${invocations.length - Math.min(reviewedCount, invocations.length)} of ${invocations.length} native process call(s) (${subjects.join(', ')}) have neither owner ${[...nativeProcessOwners].sort(compareCodeUnits).join(', ') || '<unresolved>'} nor an exact current TCB dispatcher admission`,
      observationClass: 'derived'
    }));
  }
  const entrypointsByCommand = new Map<string, SourceProgramEntrypoint[]>();
  for (const entrypoint of entrypoints) {
    if (entrypoint.command === null) continue;
    const group = entrypointsByCommand.get(entrypoint.command) ?? [];
    group.push(entrypoint);
    entrypointsByCommand.set(entrypoint.command, group);
    if (entrypoint.observationClass === 'unknown') {
      candidates.push(Object.freeze({
        code: 'entrypoint-resolution-unknown',
        subject: entrypoint.name,
        paths: Object.freeze([entrypoint.path]),
        reason: `command relation is unresolved: ${entrypoint.command}`,
        observationClass: 'unknown'
      }));
    }
  }
  for (const [command, group] of entrypointsByCommand) {
    if (group.length < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-entrypoint-command',
      subject: command,
      paths: Object.freeze([...new Set(group.map(({ path: entryPath }) => entryPath))].sort(compareCodeUnits)),
      reason: `same command is projected by ${group.map(({ name }) => name).sort(compareCodeUnits).join(', ')}`,
      observationClass: 'derived'
    }));
  }
  for (const dependency of dependencies) {
    if (dependency.consumerPaths.length > 0) continue;
    candidates.push(Object.freeze({
      code: 'declared-dependency-without-source-consumer',
      subject: dependency.name,
      paths: Object.freeze([dependency.manifestPath]),
      reason: 'manifest declaration has no supported source import; generated, config, executable, or external consumers remain possible',
      observationClass: 'unknown'
    }));
  }
  const fileSurface = new Map(files.map((file) => [file.path, file.surface]));
  const literalsByPath = new Map<string, typeof typescriptModel.literals[number][]>();
  for (const literal of typescriptModel.literals) {
    const pathLiterals = literalsByPath.get(literal.path) ?? [];
    pathLiterals.push(literal);
    literalsByPath.set(literal.path, pathLiterals);
  }
  const referencesByTarget = new Map<string, typeof typescriptModel.references[number][]>();
  const productionNamespaceImportTargets = new Set(
    typescriptModel.references
      .filter((reference) => reference.kind === 'import'
        && reference.name === '*'
        && reference.targetPath !== null
        && fileSurface.get(reference.path) === 'production')
      .map(({ targetPath }) => targetPath!)
  );
  for (const reference of typescriptModel.references) {
    if (reference.targetObservationId === null) continue;
    const group = referencesByTarget.get(reference.targetObservationId) ?? [];
    group.push(reference);
    referencesByTarget.set(reference.targetObservationId, group);
  }
  const declarationsByOwnerAndName = new Map<string, SourceProgramDeclaration[]>();
  const declarationsByPathAndName = new Map<string, SourceProgramDeclaration[]>();
  const versionedDeclarationsByOwnerAndBase = new Map<string, Readonly<{
    baseName: string;
    owner: string;
    versions: Map<number, SourceProgramDeclaration[]>;
  }>>();
  for (const declaration of typescriptModel.declarations) {
    if (fileSurface.get(declaration.path) !== 'production') continue;
    const owner = declaration.exported
      ? declaration.moduleId ?? declaration.path
      : declaration.path;
    const declarationKey = `${owner}\u0000${declaration.name}`;
    const sameName = declarationsByOwnerAndName.get(declarationKey) ?? [];
    sameName.push(declaration);
    declarationsByOwnerAndName.set(declarationKey, sameName);
    const pathDeclarationKey = `${declaration.path}\u0000${declaration.name}`;
    const samePathName = declarationsByPathAndName.get(pathDeclarationKey) ?? [];
    samePathName.push(declaration);
    declarationsByPathAndName.set(pathDeclarationKey, samePathName);
    const match = VERSIONED_DECLARATION_NAME.exec(declaration.name);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const groupKey = `${owner}\u0000${match[1]}`;
    const group = versionedDeclarationsByOwnerAndBase.get(groupKey) ?? Object.freeze({
      baseName: match[1],
      owner,
      versions: new Map<number, SourceProgramDeclaration[]>()
    });
    const version = Number(match[2]);
    const declarations = group.versions.get(version) ?? [];
    declarations.push(declaration);
    group.versions.set(version, declarations);
    versionedDeclarationsByOwnerAndBase.set(groupKey, group);
  }
  for (const group of versionedDeclarationsByOwnerAndBase.values()) {
    if (group.versions.size > 1) continue;
    const canonicalDeclarations = declarationsByOwnerAndName.get(
      `${group.owner}\u0000${group.baseName}`
    ) ?? [];
    for (const declaration of [...group.versions.values()].flat()) {
      const productionConsumers = (referencesByTarget.get(declaration.observationId) ?? [])
        .filter(({ path: consumerPath }) => fileSurface.get(consumerPath) === 'production');
      if (productionConsumers.length === 0
        && !productionNamespaceImportTargets.has(declaration.path)) continue;
      candidates.push(Object.freeze({
        code: canonicalDeclarations.length === 0
          ? 'versioned-declaration-without-coexisting-version'
          : 'versioned-declaration-conflicts-with-canonical-name',
        subject: declaration.name,
        paths: Object.freeze([...new Set([
          declaration.path,
          ...canonicalDeclarations.map(({ path: canonicalPath }) => canonicalPath),
          ...new Set(productionConsumers.map(({ path: consumerPath }) => consumerPath))
        ])].sort(compareCodeUnits)),
        reason: canonicalDeclarations.length === 0
          ? `production declaration carries a Vn suffix without a coexisting code version; canonical rename target is ${group.baseName}`
          : `versioned declaration and canonical declaration coexist without a second version; reconcile behavior into ${group.baseName} instead of retaining a compatibility-shaped duplicate`,
        observationClass: 'derived'
      }));
    }
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported || fileSurface.get(declaration.path) !== 'production') continue;
    const declarationOwner = input.moduleMembership.moduleForPath(declaration.path);
    const ownsDeclaredCapability = declarationOwner !== null
      && declaredCapabilityOperationsByModule
        .get(declarationOwner.moduleId)
        ?.has(declaration.name) === true;
    if (ownsDeclaredCapability) continue;
    const consumers = referencesByTarget.get(declaration.observationId) ?? [];
    if (consumers.length === 0 && !productionNamespaceImportTargets.has(declaration.path)) {
      candidates.push(Object.freeze({
        code: IDENTITY_TOKEN_NAME.test(declaration.name)
          ? 'identity-token-without-consumer'
          : 'production-declaration-without-consumer',
        subject: declaration.name,
        paths: Object.freeze([declaration.path]),
        reason: IDENTITY_TOKEN_NAME.test(declaration.name)
          ? 'exported version/schema/format identity has no supported source consumer'
          : 'exported production declaration has no supported source consumer; external or dynamic consumers remain possible until its entrypoint closure is proven',
        observationClass: 'unknown'
      }));
    } else if (consumers.length > 0
      && !productionNamespaceImportTargets.has(declaration.path)
      && consumers.every(({ path: consumerPath }) => fileSurface.get(consumerPath) === 'test')) {
      candidates.push(Object.freeze({
        code: 'production-declaration-only-test-consumers',
        subject: declaration.name,
        paths: Object.freeze([
          declaration.path,
          ...new Set(consumers.map(({ path: consumerPath }) => consumerPath))
        ].sort(compareCodeUnits)),
        reason: 'supported references are all test-surface references; runtime, external, or dynamic consumers remain possible',
        observationClass: 'unknown'
      }));
    }
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || !IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedValues = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.context === 'producer'
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    if (ownedValues.size === 0) continue;
    const identityField = identityFieldName(declaration.name);
    const semanticTargets = [
      declaration,
      ...(identityField === null
        ? []
        : declarationsByPathAndName.get(`${declaration.path}\u0000${identityField}`) ?? [])
    ];
    const testReferences = semanticTargets.flatMap((target) =>
      referencesByTarget.get(target.observationId) ?? [])
      .filter(({ kind, path: consumerPath }) =>
        kind !== 'import' && fileSurface.get(consumerPath) === 'test');
    const mirrors = testReferences.flatMap((reference) =>
      (literalsByPath.get(reference.path) ?? []).filter((literal) =>
        literal.context === 'assertion'
        && literal.contextSpan !== null
        && reference.span.start >= literal.contextSpan.start
        && reference.span.end <= literal.contextSpan.end
        && ownedValues.has(literal.value)));
    if (mirrors.length === 0) continue;
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-identity-literal',
      subject: declaration.name,
      paths: Object.freeze([
        declaration.path,
        ...new Set(mirrors.map(({ path: mirrorPath }) => mirrorPath))
      ].sort(compareCodeUnits)),
      reason: 'test assertion repeats a production schema/version/revision literal instead of exercising its reader or rejection boundary',
      observationClass: 'derived'
    }));
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || declaration.kind !== 'VariableDeclaration'
      || IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedValues = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.value.length > 0
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    if (ownedValues.size < 3) continue;
    const testReferences = (referencesByTarget.get(declaration.observationId) ?? [])
      .filter(({ kind, path: consumerPath }) =>
        kind !== 'import' && fileSurface.get(consumerPath) === 'test');
    const directTestConsumers = new Set(
      testReferences.map(({ path: consumerPath }) => consumerPath)
    );
    if (directTestConsumers.size === 0) continue;
    const mirrorsByPath = new Map<string, Set<string>>();
    const testReferencesByPath = new Map<string, typeof testReferences>();
    for (const reference of testReferences) {
      const pathReferences = testReferencesByPath.get(reference.path) ?? [];
      pathReferences.push(reference);
      testReferencesByPath.set(reference.path, pathReferences);
    }
    for (const consumerPath of directTestConsumers) {
      const pathReferences = testReferencesByPath.get(consumerPath) ?? [];
      for (const literal of literalsByPath.get(consumerPath) ?? []) {
        if (literal.context !== 'assertion'
          || literal.contextSpan === null
          || !pathReferences.some((reference) =>
            reference.span.start >= literal.contextSpan!.start
            && reference.span.end <= literal.contextSpan!.end)
          || !ownedValues.has(literal.value)) continue;
        const values = mirrorsByPath.get(literal.path) ?? new Set<string>();
        values.add(literal.value);
        mirrorsByPath.set(literal.path, values);
      }
    }
    const mirrorPaths = [...mirrorsByPath]
      .filter(([, values]) => values.size >= 3 && values.size / ownedValues.size >= 0.6)
      .map(([mirrorPath]) => mirrorPath)
      .sort(compareCodeUnits);
    if (mirrorPaths.length === 0) continue;
    const mirroredValueCount = Math.max(...mirrorPaths.map((mirrorPath) =>
      mirrorsByPath.get(mirrorPath)?.size ?? 0));
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-literal-collection',
      subject: declaration.name,
      paths: Object.freeze([
        declaration.path,
        ...mirrorPaths
      ].sort(compareCodeUnits)),
      reason: `one test file repeats up to ${mirroredValueCount}/${ownedValues.size} literals owned by one production collection instead of observing its behavior or consuming its canonical projection`,
      observationClass: 'derived'
    }));
  }
  const productionSourcePaths = new Set(files
    .filter(({ path: repositoryPath, surface }) => surface === 'production'
      && /^src\//u.test(repositoryPath)
      && /\.[cm]?[jt]sx?$/u.test(repositoryPath))
    .map(({ path: repositoryPath }) => repositoryPath));
  const derivedSourceAddressPaths = new Set<string>();
  for (const entrypoint of entrypoints) {
    for (const targetPath of entrypoint.targetPaths) {
      if (productionSourcePaths.has(targetPath)) derivedSourceAddressPaths.add(targetPath);
    }
    const commandPath = entrypoint.command?.match(
      /(?:^|\s)(?:\.\/)?(src\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?)(?:\s|$)/u
    )?.[1];
    if (commandPath !== undefined && productionSourcePaths.has(commandPath)) {
      derivedSourceAddressPaths.add(commandPath);
    }
  }
  for (const dispatcher of input.reviewedProcessDispatchers ?? []) {
    const separator = dispatcher.indexOf('::');
    const dispatcherPath = separator < 0 ? null : dispatcher.slice(0, separator);
    if (dispatcherPath !== null && productionSourcePaths.has(dispatcherPath)) {
      derivedSourceAddressPaths.add(dispatcherPath);
    }
  }
  const productionReferencesByDeclaration = new Map<string, number>();
  for (const reference of typescriptModel.references) {
    if (reference.targetObservationId === null || fileSurface.get(reference.path) !== 'production') continue;
    productionReferencesByDeclaration.set(
      reference.targetObservationId,
      (productionReferencesByDeclaration.get(reference.targetObservationId) ?? 0) + 1
    );
  }
  const declarationsByPathAndSpan = new Map(
    typescriptModel.declarations.map((declaration) => [
      `${declaration.path}\0${declaration.span.start}\0${declaration.span.end}`,
      declaration
    ] as const)
  );
  for (const literal of typescriptModel.literals) {
    if (literal.context !== 'producer' || literal.contextSpan === null) continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!productionSourcePaths.has(normalizedValue)) continue;
    const declaration = declarationsByPathAndSpan.get(
      `${literal.path}\0${literal.contextSpan.start}\0${literal.contextSpan.end}`
    );
    if (declaration?.exported === true
        && (productionReferencesByDeclaration.get(declaration.observationId) ?? 0) > 0) {
      derivedSourceAddressPaths.add(normalizedValue);
    }
  }
  const productionSourcePathMirrors = new Map<string, Set<string>>();
  for (const literal of typescriptModel.literals) {
    if (fileSurface.get(literal.path) !== 'production') continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (normalizedValue === literal.path
      || !productionSourcePaths.has(normalizedValue)
      || derivedSourceAddressPaths.has(normalizedValue)) continue;
    const mirrorPaths = productionSourcePathMirrors.get(normalizedValue) ?? new Set<string>();
    mirrorPaths.add(literal.path);
    productionSourcePathMirrors.set(normalizedValue, mirrorPaths);
  }
  for (const [sourcePath, mirrorPaths] of productionSourcePathMirrors) {
    candidates.push(Object.freeze({
      code: 'production-mirrors-source-path',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: 'production code repeats another source file address instead of deriving the relation from an entrypoint, module, capability, or artifact owner',
      observationClass: 'derived'
    }));
    if (mirrorPaths.size < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-source-path-owner',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: `${mirrorPaths.size} production modules repeat one source address; derive the relation from one module, entrypoint, capability, or artifact owner`,
      observationClass: 'derived'
    }));
  }

  const identityOwnersByLiteral = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || !IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedIdentityLiterals = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.context === 'producer'
        && literal.value.length >= 8
        && /[-:]/u.test(literal.value)
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    for (const value of ownedIdentityLiterals) {
      const owners = identityOwnersByLiteral.get(value) ?? [];
      owners.push(declaration);
      identityOwnersByLiteral.set(value, owners);
    }
  }
  for (const [value, owners] of identityOwnersByLiteral) {
    const ownerPaths = [...new Set(owners.map(({ path: ownerPath }) => ownerPath))]
      .sort(compareCodeUnits);
    if (owners.length < 2 || ownerPaths.length < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-identity-token',
      subject: value,
      paths: Object.freeze(ownerPaths),
      reason: `one schema/version/revision token is produced by ${owners.length} declarations; retain one canonical owner and derive or retire the others`,
      observationClass: 'derived'
    }));
  }

  const endpointPathsByLiteral = new Map<string, Set<string>>();
  for (const literal of typescriptModel.literals) {
    if (fileSurface.get(literal.path) !== 'production'
      || !/^https?:\/\/[^\s]+$/iu.test(literal.value)) continue;
    const ownerPaths = endpointPathsByLiteral.get(literal.value) ?? new Set<string>();
    ownerPaths.add(literal.path);
    endpointPathsByLiteral.set(literal.value, ownerPaths);
  }
  for (const [endpoint, ownerPaths] of endpointPathsByLiteral) {
    if (ownerPaths.size < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-endpoint-literal',
      subject: endpoint,
      paths: Object.freeze([...ownerPaths].sort(compareCodeUnits)),
      reason: 'one external endpoint is hard-coded by multiple production modules instead of one provider or configuration owner',
      observationClass: 'derived'
    }));
  }

  const sourcePathMirrors = new Map<string, Set<string>>();
  for (const literal of typescriptModel.literals) {
    if (fileSurface.get(literal.path) !== 'test' || literal.context !== 'assertion') continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!productionSourcePaths.has(normalizedValue)) continue;
    const mirrorPaths = sourcePathMirrors.get(normalizedValue) ?? new Set<string>();
    mirrorPaths.add(literal.path);
    sourcePathMirrors.set(normalizedValue, mirrorPaths);
  }
  for (const [sourcePath, mirrorPaths] of sourcePathMirrors) {
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-source-path',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: 'test assertion repeats a production source path; observe a public behavior/contract or derive the path from the source-program owner instead of freezing repository layout',
      observationClass: 'derived'
    }));
  }
  const deduplicatedCandidates = [...new Map(candidates.map((candidate) => [
    sha256(candidate),
    candidate
  ] as const)).values()];
  deduplicatedCandidates.sort((left, right) =>
    compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.subject, right.subject)
    || compareCodeUnits(left.paths.join('\0'), right.paths.join('\0'))
  );
  const canonicalModel = {
    sourceRevision: typescriptModel.sourceRevision,
    providers: Object.freeze([
      ...typescriptModel.providers,
      Object.freeze({ id: 'ecmascript-json', revision: process.versions.bun })
    ]),
    files: Object.freeze(files),
    declarations: typescriptModel.declarations,
    references: typescriptModel.references,
    literals: typescriptModel.literals,
    entrypoints: Object.freeze(entrypoints),
    entrypointClosures: Object.freeze(entrypointClosures),
    packages: Object.freeze(packages),
    dependencies: Object.freeze(dependencies),
    capabilities: typescriptModel.capabilities,
    candidates: Object.freeze(deduplicatedCandidates),
    unknowns: Object.freeze(unknowns)
  };
  return Object.freeze({
    ...canonicalModel,
    modelDigest: sha256(canonicalModel)
  });
}

function countTopologyValues(values: readonly string[]): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.freeze(Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareCodeUnits(left, right))
  ));
}

/** Compact decision surface for a complete Source Program Model. */
export function summarizeSourceProgramTopology(
  model: SourceProgramModel
): SourceProgramTopologySummary {
  const entrypointByObservationId = new Map(model.entrypoints.map((entrypoint) => [
    entrypoint.observationId,
    entrypoint
  ]));
  const entrypointRole = (entrypoint: SourceProgramEntrypoint): string => {
    if (entrypoint.kind === 'package-bin') {
      return entrypoint.path === 'bun.lock'
        ? 'dependency-executable'
        : 'package-executable';
    }
    if (entrypoint.kind === 'package-script') return 'package-operation';
    if (entrypoint.kind === 'cli-command') return 'product-cli-operation';
    if (entrypoint.kind === 'module-entrypoint') return 'module-process-boundary';
    return entrypoint.kind === 'git-hook' ? 'host-hook' : 'host-workflow';
  };
  const declaredPackageNames = new Set(model.dependencies.map(({ name }) => name));
  const capabilityAuthorityClass = (
    capability: SourceProgramModel['capabilities'][number]
  ): SourceProgramCapabilityAuthorityClass => {
    if (capability.providerModuleId !== null) return 'repository-provider';
    // A raw native process call remains unresolved even when its import is a
    // runtime builtin: builtin provenance does not provide process authority.
    if (capability.capability === 'process' && capability.transport === 'native-runtime') {
      return 'unresolved-transport';
    }
    if (
      capability.transport === 'runtime-built-in-api'
      && capability.moduleSpecifier !== null
    ) return 'runtime-built-in-api';
    if (
      capability.transport === 'package-api'
      && capability.moduleSpecifier !== null
      && declaredPackageNames.has(dependencyPackageName(capability.moduleSpecifier))
    ) return 'external-package-api';
    return 'unresolved-transport';
  };
  const capabilityProviderModule = (
    capability: SourceProgramModel['capabilities'][number]
  ): string => {
    if (capability.providerModuleId !== null) return capability.providerModuleId;
    if (capability.capability === 'process' && capability.transport === 'native-runtime') {
      return '<unresolved>';
    }
    if (
      capability.transport === 'runtime-built-in-api'
      && capability.moduleSpecifier !== null
    ) return capability.moduleSpecifier;
    if (
      capability.transport === 'package-api'
      && capability.moduleSpecifier !== null
      && declaredPackageNames.has(dependencyPackageName(capability.moduleSpecifier))
    ) return dependencyPackageName(capability.moduleSpecifier);
    return '<unresolved>';
  };
  return Object.freeze({
    packages: model.packages.length,
    dependencyScopes: countTopologyValues(model.dependencies.map(({ scope }) => scope)),
    entrypointKinds: countTopologyValues(model.entrypoints.map(({ kind }) => kind)),
    entrypointRoles: countTopologyValues(model.entrypoints.map(entrypointRole)),
    entrypointHandlerModules: countTopologyValues(model.entrypointClosures.flatMap(
      (closure) => {
        if (closure.handlerModuleIds.length > 0) return closure.handlerModuleIds;
        const entrypoint = entrypointByObservationId.get(closure.entrypointObservationId);
        if (closure.targetPackages.length > 0) return ['<external-package>'];
        if (entrypoint?.kind === 'git-hook' || entrypoint?.kind === 'workflow') {
          return ['<host-adapter>'];
        }
        return ['<unresolved>'];
      }
    )),
    entrypointObservationClasses: countTopologyValues(
      model.entrypointClosures.map(({ observationClass }) => observationClass)
    ),
    capabilityKinds: countTopologyValues(model.capabilities.map(({ capability }) => capability)),
    capabilityTransports: countTopologyValues(model.capabilities.map(({ transport }) => transport)),
    capabilityAuthorityClasses: countTopologyValues(
      model.capabilities.map(capabilityAuthorityClass)
    ),
    providerModules: countTopologyValues(model.capabilities.map(capabilityProviderModule)),
    candidateCodes: countTopologyValues(model.candidates.map(({ code }) => code)),
    unknownCodes: countTopologyValues(model.unknowns.map(({ code }) => code)),
    directProcessTransportPaths: new Set(model.candidates
      .filter(({ code }) => code === 'direct-process-transport-outside-owner')
      .flatMap(({ paths }) => paths)).size
  });
}
