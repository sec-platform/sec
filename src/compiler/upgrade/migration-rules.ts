import { CompilerError } from '../errors.ts';
import type { UpgradeMigrationEntry } from '../../semantics/upgrade/manifest-types.ts';
import type { UpgradePlan } from '../../semantics/upgrade/upgrade-artifact.ts';

export function ensureMigrationString(value: unknown, field: string, entryPath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires ${field}`);
  }
  return value;
}

function ensureMigrationStringArray(value: unknown, field: string, entryPath: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires ${field}`);
  }
  return value;
}

function assertSafeJsonMutationKey(key: string, field: string): void {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    throw new CompilerError(
      'UPGRADE-MIGRATION-030',
      `${field} contains reserved JSON mutation key "${key}"`
    );
  }
}

// JSON paths address own data, never an inherited object or an accessor.
function ownJsonValue(object: Record<string, unknown>, key: string): unknown {
  assertSafeJsonMutationKey(key, 'JSON mutation property');
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) {
    throw new CompilerError('UPGRADE-MIGRATION-030', 'JSON mutation properties must be data properties');
  }
  return descriptor.value;
}

function setOwnJsonValue(object: Record<string, unknown>, key: string, value: unknown): void {
  assertSafeJsonMutationKey(key, 'JSON mutation property');
  // Defining an own property cannot dispatch an inherited setter.
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

function assertSafeJsonMutationPath(pathSegments: string[], field: string): void {
  for (const segment of pathSegments) assertSafeJsonMutationKey(segment, field);
}

function assertSafeJsonMergeObject(value: Record<string, unknown>, field: string): void {
  for (const key of Object.keys(value)) {
    assertSafeJsonMutationKey(key, field);
    const child = ownJsonValue(value, key);
    if (isJsonObject(child)) assertSafeJsonMergeObject(child, field);
  }
}

export type MigrationEntryValidationContext<K extends UpgradeMigrationEntry['kind'] = UpgradeMigrationEntry['kind']> = {
  entry: Extract<UpgradeMigrationEntry, { kind: K }>;
  entryPath: string;
};

type SourceMigrationEntryValidationContext = {
  entry: Extract<UpgradeMigrationEntry, { source: string }>;
  entryPath: string;
};

type JsonArrayMigrationEntryValidationContext = {
  entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-append' | 'json-array-remove' }>;
  entryPath: string;
};

export function validateSourceMigrationEntry({ entry, entryPath }: SourceMigrationEntryValidationContext): void {
  ensureMigrationString(entry.source, 'source', entryPath);
}

export function validateConfigRewriteMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'config-rewrite'>): void {
  if (!Array.isArray(entry.updates)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates`);
  }
  for (const update of entry.updates) {
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[]`);
    }
    ensureMigrationStringArray(update.path, 'updates[].path', entryPath);
    if (update.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'Config rewrite path must not be empty');
    }
    assertSafeJsonMutationPath(update.path, 'Config rewrite path');
    if (update.operation !== undefined && update.operation !== 'set' && update.operation !== 'delete') {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].operation`);
    }
    if ((update.operation === undefined || update.operation === 'set') && !Object.prototype.hasOwnProperty.call(update, 'value')) {
      throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires updates[].value`);
    }
  }
}

export function validateJsonArrayMigrationEntry({
  entry,
  entryPath
}: JsonArrayMigrationEntryValidationContext): void {
  ensureMigrationStringArray(entry.path, 'path', entryPath);
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array migration path must not be empty');
  }
  assertSafeJsonMutationPath(entry.path, 'JSON array migration path');
  if (!Array.isArray(entry.items) || entry.items.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires items`);
  }
}

export function validateJsonObjectMergeMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'json-object-merge'>): void {
  ensureMigrationStringArray(entry.path, 'path', entryPath);
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON object merge path must not be empty');
  }
  assertSafeJsonMutationPath(entry.path, 'JSON object merge path');
  if (!isJsonObject(entry.value)) {
    throw new CompilerError('UPGRADE-MIGRATION-011', `Migration entry "${entryPath}" requires value`);
  }
  assertSafeJsonMergeObject(entry.value, 'JSON object merge value');
}

export function validateDbExpandContractMigrationEntry({
  entry,
  entryPath
}: MigrationEntryValidationContext<'db-expand-contract'>): void {
  ensureMigrationString(entry.entity, 'entity', entryPath);
  ensureMigrationString(entry.expandField, 'expandField', entryPath);
  ensureMigrationString(entry.contractField, 'contractField', entryPath);
  if (entry.copyJobCode !== undefined) {
    ensureMigrationString(entry.copyJobCode, 'copyJobCode', entryPath);
  }
}

export function ensureJsonObject(config: unknown, label: string): Record<string, unknown> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new CompilerError('UPGRADE-MIGRATION-009', `${label} target must contain a JSON object`);
  }
  return config as Record<string, unknown>;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function applyConfigUpdates(config: unknown, updates: Array<{ path: string[]; value?: unknown; operation?: 'set' | 'delete' }>): unknown {
  const root = ensureJsonObject(config, 'Config rewrite');

  for (const update of updates) {
    if (update.path.length === 0) {
      throw new CompilerError('UPGRADE-MIGRATION-010', 'Config rewrite path must not be empty');
    }
    assertSafeJsonMutationPath(update.path, 'Config rewrite path');
    let current = root;
    for (const segment of update.path.slice(0, -1)) {
      const next = ownJsonValue(current, segment);
      if (update.operation === 'delete' && (typeof next !== 'object' || next === null || Array.isArray(next))) {
        current = {};
        break;
      }
      if (typeof next !== 'object' || next === null || Array.isArray(next)) {
        setOwnJsonValue(current, segment, {});
      }
      current = ownJsonValue(current, segment) as Record<string, unknown>;
    }
    const key = update.path[update.path.length - 1];
    if (update.operation === 'delete') {
      delete current[key];
      continue;
    }
    setOwnJsonValue(current, key, update.value);
  }

  return config;
}

function resolveJsonArrayTarget(
  config: unknown,
  pathSegments: string[],
  label: string,
  options: { createParents: boolean }
): { root: Record<string, unknown>; parent: Record<string, unknown>; key: string; target: unknown } {
  if (pathSegments.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON array migration path must not be empty');
  }
  assertSafeJsonMutationPath(pathSegments, `${label} path`);
  const root = ensureJsonObject(config, label);
  let current = root;
  for (const segment of pathSegments.slice(0, -1)) {
    const next = ownJsonValue(current, segment);
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      if (!options.createParents) {
        return { root, parent: {}, key: pathSegments[pathSegments.length - 1], target: undefined };
      }
      setOwnJsonValue(current, segment, {});
    }
    current = ownJsonValue(current, segment) as Record<string, unknown>;
  }

  const key = pathSegments[pathSegments.length - 1];
  return { root, parent: current, key, target: ownJsonValue(current, key) };
}

export function applyJsonArrayAppend(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-append' }>): unknown {
  const { parent, key, target } = resolveJsonArrayTarget(config, entry.path, 'JSON array append', { createParents: true });
  if (target !== undefined && !Array.isArray(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-012', 'JSON array append target must be an array');
  }

  const existing = Array.isArray(target) ? target : [];
  const seen = new Set(existing.map((item) => JSON.stringify(item)));
  for (const item of entry.items) {
    const serialized = JSON.stringify(item);
    if (!seen.has(serialized)) {
      existing.push(item);
      seen.add(serialized);
    }
  }
  setOwnJsonValue(parent, key, existing);

  return config;
}

export function applyJsonArrayRemove(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-array-remove' }>): unknown {
  const { parent, key, target } = resolveJsonArrayTarget(config, entry.path, 'JSON array remove', { createParents: false });
  if (target === undefined) {
    return config;
  }
  if (!Array.isArray(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-012', 'JSON array remove target must be an array');
  }

  const removeItems = new Set(entry.items.map((item) => JSON.stringify(item)));
  setOwnJsonValue(parent, key, target.filter((item) => !removeItems.has(JSON.stringify(item))));
  return config;
}

function mergeJsonObjects(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    assertSafeJsonMutationKey(key, 'JSON object merge value');
    const value = ownJsonValue(source, key);
    const existing = ownJsonValue(target, key);
    if (isJsonObject(existing) && isJsonObject(value)) {
      mergeJsonObjects(existing, value);
      continue;
    }
    setOwnJsonValue(target, key, value);
  }
}

export function applyJsonObjectMerge(config: unknown, entry: Extract<UpgradeMigrationEntry, { kind: 'json-object-merge' }>): unknown {
  if (entry.path.length === 0) {
    throw new CompilerError('UPGRADE-MIGRATION-010', 'JSON object merge path must not be empty');
  }
  assertSafeJsonMutationPath(entry.path, 'JSON object merge path');
  assertSafeJsonMergeObject(entry.value, 'JSON object merge value');
  const root = ensureJsonObject(config, 'JSON object merge');
  let current = root;
  for (const segment of entry.path.slice(0, -1)) {
    const next = ownJsonValue(current, segment);
    if (next !== undefined && !isJsonObject(next)) {
      throw new CompilerError('UPGRADE-MIGRATION-013', 'JSON object merge parent must be an object');
    }
    if (next === undefined) {
      setOwnJsonValue(current, segment, {});
    }
    current = ownJsonValue(current, segment) as Record<string, unknown>;
  }

  const key = entry.path[entry.path.length - 1];
  const target = ownJsonValue(current, key);
  if (target !== undefined && !isJsonObject(target)) {
    throw new CompilerError('UPGRADE-MIGRATION-013', 'JSON object merge target must be an object');
  }
  const targetObject = isJsonObject(target) ? target : {};
  mergeJsonObjects(targetObject, entry.value);
  setOwnJsonValue(current, key, targetObject);
  return config;
}

export function applyTextReplace(source: string, entry: Extract<UpgradeMigrationEntry, { kind: 'text-replace' }>): string {
  if (!source.includes(entry.search)) {
    throw new CompilerError('UPGRADE-MIGRATION-015', `Text replacement pattern did not match "${entry.target}"`);
  }
  return source.split(entry.search).join(entry.replacement);
}


export type UpgradeMigrationOperation = UpgradePlan['migrationOperations'][number];
export type UpgradeMigrationProjectPath = readonly ['source' | 'target', string];

function migrationOperationRecord(
  entry: UpgradeMigrationEntry,
  role: UpgradeMigrationOperation['role'],
  details: Omit<Partial<UpgradeMigrationOperation>, 'id' | 'kind' | 'target' | 'role'> = {}
): UpgradeMigrationOperation {
  return {
    id: entry.id,
    kind: entry.kind,
    target: entry.target,
    role,
    ...details
  };
}

export function compileUpgradeMigrationOperation(
  entry: UpgradeMigrationEntry
): UpgradeMigrationOperation {
  switch (entry.kind) {
    case 'file-replace':
    case 'copy-file':
      return migrationOperationRecord(entry, 'file', { source: entry.source });
    case 'copy-directory':
      return migrationOperationRecord(entry, 'directory', { source: entry.source });
    case 'config-rewrite':
      return migrationOperationRecord(entry, 'json', { updateCount: entry.updates.length });
    case 'json-array-append':
    case 'json-array-remove':
      return migrationOperationRecord(entry, 'json', {
        path: [...entry.path],
        itemCount: entry.items.length
      });
    case 'json-object-merge':
      return migrationOperationRecord(entry, 'json', {
        path: [...entry.path],
        valueKeyCount: Object.keys(entry.value).length
      });
    case 'text-append':
      return migrationOperationRecord(entry, 'text', { contentLength: entry.content.length });
    case 'text-replace':
      return migrationOperationRecord(entry, 'text', {
        searchLength: entry.search.length,
        replacementLength: entry.replacement.length
      });
    case 'create-directory':
      return migrationOperationRecord(entry, 'directory');
    case 'delete-file':
      return migrationOperationRecord(entry, 'file');
    case 'delete-directory':
      return migrationOperationRecord(entry, 'directory');
    case 'rename-file':
      return migrationOperationRecord(entry, 'file', { source: entry.source });
    case 'rename-directory':
      return migrationOperationRecord(entry, 'directory', { source: entry.source });
    case 'db-expand-contract':
      return migrationOperationRecord(entry, 'prisma', {
        entity: entry.entity,
        expandField: entry.expandField,
        contractField: entry.contractField
      });
    default: {
      const unsupported = entry as { kind: string };
      throw new CompilerError(
        'UPGRADE-MIGRATION-006',
        `Unsupported migration kind "${unsupported.kind}"`
      );
    }
  }
}

export function compileUpgradeMigrationProjectPaths(
  entry: UpgradeMigrationEntry
): readonly UpgradeMigrationProjectPath[] {
  return entry.kind === 'rename-file' || entry.kind === 'rename-directory'
    ? Object.freeze([
        Object.freeze(['source', entry.source] as const),
        Object.freeze(['target', entry.target] as const)
      ])
    : Object.freeze([Object.freeze(['target', entry.target] as const)]);
}
