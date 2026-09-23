import { expect, test } from 'bun:test';
import {
  applyConfigUpdates,
  applyJsonArrayAppend,
  applyJsonArrayRemove,
  applyJsonObjectMerge,
  compileUpgradeMigrationProjectPaths
} from './migration-rules.ts';

const identity = { id: 'change', reason: 'migration', target: 'config.json' };

test('database copy job is a planned write and its migration id is a portable leaf', () => {
  const entry = {
    id: 'copy-phone', kind: 'db-expand-contract' as const, reason: 'copy',
    target: 'prisma/schema.prisma', entity: 'Customer',
    expandField: 'phoneNumber String?', contractField: 'phone', copyJobCode: 'await copy();'
  };
  expect(compileUpgradeMigrationProjectPaths(entry)).toEqual([
    ['target', 'prisma/schema.prisma'],
    ['target', 'src/jobs/db-migrations/copy-phone.ts']
  ]);
  expect(() => compileUpgradeMigrationProjectPaths({ ...entry, id: '../../../src/bootstrap/cli/cli' }))
    .toThrow('one canonical portable leaf');
});

test('config paths never mutate inherited object members', () => {
  const inherited = { settings: { enabled: false } };
  const config = Object.create(inherited) as Record<string, unknown>;
  expect(applyConfigUpdates(config, [{ path: ['settings', 'enabled'], value: true }])).toBe(config);
  expect(inherited.settings).toEqual({ enabled: false });
  expect(Object.hasOwn(config, 'settings')).toBe(true);
  expect(config.settings).toEqual({ enabled: true });
});

test('deleting a path present only on the prototype is a no-op', () => {
  const inherited = { settings: { enabled: true } };
  const config = Object.create(inherited) as Record<string, unknown>;
  applyConfigUpdates(config, [{ path: ['settings', 'enabled'], operation: 'delete' }]);
  expect(inherited.settings).toEqual({ enabled: true });
  expect(Object.keys(config)).toEqual([]);
});

test('array append and remove distinguish own arrays from inherited arrays', () => {
  const inherited = { items: ['original'] };
  const appended = Object.create(inherited) as Record<string, unknown>;
  applyJsonArrayAppend(appended, { ...identity, kind: 'json-array-append', path: ['items'], items: ['new'] });
  expect(appended.items).toEqual(['new']);
  expect(inherited.items).toEqual(['original']);
  const removed = Object.create(inherited) as Record<string, unknown>;
  applyJsonArrayRemove(removed, { ...identity, kind: 'json-array-remove', path: ['items'], items: ['original'] });
  expect(Object.keys(removed)).toEqual([]);
  expect(inherited.items).toEqual(['original']);
});

test('array parent creation does not borrow an inherited container', () => {
  const inherited = { settings: { items: ['original'] } };
  const config = Object.create(inherited) as Record<string, unknown>;
  applyJsonArrayAppend(config, { ...identity, kind: 'json-array-append', path: ['settings', 'items'], items: ['new'] });
  expect(config.settings).toEqual({ items: ['new'] });
  expect(inherited.settings).toEqual({ items: ['original'] });
});

test('object merge isolates both inherited destination and nested merge targets', () => {
  const inherited = { settings: { enabled: false } };
  const config = Object.create(inherited) as Record<string, unknown>;
  applyJsonObjectMerge(config, { ...identity, kind: 'json-object-merge', path: ['settings'], value: { enabled: true } });
  expect(config.settings).toEqual({ enabled: true });
  expect(inherited.settings).toEqual({ enabled: false });
  const shared = { original: true };
  const nested = { settings: Object.create({ options: shared }) as Record<string, unknown> };
  applyJsonObjectMerge(nested, { ...identity, kind: 'json-object-merge', path: ['settings'], value: { options: { added: true } } });
  expect(nested.settings.options).toEqual({ added: true });
  expect(shared).toEqual({ original: true });
});

test('data writes do not dispatch inherited setters', () => {
  let writes = 0;
  const prototype = Object.defineProperty({}, 'settings', {
    set() { writes += 1; }, configurable: true
  });
  const config = Object.create(prototype) as Record<string, unknown>;
  applyConfigUpdates(config, [{ path: ['settings', 'enabled'], value: true }]);
  expect(writes).toBe(0);
  expect(Object.getOwnPropertyDescriptor(config, 'settings')?.value).toEqual({ enabled: true });
});

test('own accessors are rejected without invoking them during traversal or merge', () => {
  let reads = 0;
  const accessor = () => Object.defineProperty({}, 'settings', {
    get() { reads += 1; return {}; }, enumerable: true, configurable: true
  });
  expect(() => applyConfigUpdates(accessor(), [{ path: ['settings', 'enabled'], value: true }])).toThrow('data properties');
  const destination = { target: {} };
  expect(() => applyJsonObjectMerge(destination, {
    ...identity, kind: 'json-object-merge', path: ['target'], value: accessor()
  })).toThrow('data properties');
  expect(reads).toBe(0);
  expect(destination).toEqual({ target: {} });
});

test('reserved path segments and nested merge keys remain rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const config = {};
    expect(() => applyConfigUpdates(config, [{ path: ['settings', key, 'value'], value: true }])).toThrow('reserved JSON mutation key');
    const value: Record<string, unknown> = { nested: { [key]: { value: true } } };
    expect(() => applyJsonObjectMerge(config, {
      ...identity, kind: 'json-object-merge', path: ['settings'], value
    })).toThrow('reserved JSON mutation key');
    expect(config).toEqual({});
  }
});

test('ordinary own data preserves in-place merge, append deduplication and removal', () => {
  const config: Record<string, unknown> = { settings: { original: true }, items: ['original'] };
  expect(applyJsonObjectMerge(config, {
    ...identity, kind: 'json-object-merge', path: ['settings'], value: { added: true }
  })).toBe(config);
  applyJsonArrayAppend(config, { ...identity, kind: 'json-array-append', path: ['items'], items: ['original', 'new'] });
  applyJsonArrayRemove(config, { ...identity, kind: 'json-array-remove', path: ['items'], items: ['original'] });
  expect(config).toEqual({ settings: { original: true, added: true }, items: ['new'] });
});
