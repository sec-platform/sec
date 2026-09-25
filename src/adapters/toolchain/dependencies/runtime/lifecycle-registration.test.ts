import { describe, expect, test } from 'bun:test';

import { FailureError } from '../../../../contracts/failure.ts';
import type {
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from '../../../runtime-state/generated-state/contract.ts';
import {
  bindAndRetireCompilerDependencyPreimage,
  bindExistingCompilerDependencyGeneration,
  birthAndBindCompilerDependencyGeneration
} from './lifecycle-registration.ts';
import {
  runtimeDependencyOperationOptions,
  type RuntimeDependencyInstallOptions
} from './operation-context.ts';

const physical = Object.freeze({
  device: 'device',
  inode: 'inode',
  objectId: 'object'
}) satisfies GeneratedStatePhysicalIdentity;

function registration(relativePath: string): GeneratedStateRegistration {
  return Object.freeze({
    schema: 'sec-generated-state-registration-v1',
    registrationId: `sha256:${'1'.repeat(64)}`,
    repositoryRoot: 'D:/repository',
    workspace: physical,
    ruleId: 'rule',
    relativePath,
    root: physical,
    owner: 'owner',
    producer: 'producer',
    operationId: 'operation',
    phase: 'active',
    retirementRef: null,
    generatedAt: '2026-01-01T00:00:00.000Z',
    registrationDigest: `sha256:${'2'.repeat(64)}`
  });
}

function lifecycleOptions(input: Readonly<{
  bind?: NonNullable<RuntimeDependencyInstallOptions['generatedStateLifecycle']>['bind'];
  born?: NonNullable<RuntimeDependencyInstallOptions['generatedStateLifecycle']>['born'];
  retired?: NonNullable<RuntimeDependencyInstallOptions['generatedStateLifecycle']>['retired'];
}>): RuntimeDependencyInstallOptions {
  return {
    generatedStateLifecycle: {
      born: input.born ?? (async () => undefined),
      inspect: async () => {
        throw new Error('inventory inspection is outside this test boundary');
      },
      bind: input.bind,
      retired: input.retired ?? (async () => undefined),
      disposed: async () => {
        throw new Error('disposal is outside this test boundary');
      }
    }
  };
}

describe('dependency lifecycle registration owner', () => {
  test('adopts the exact compiler identity before retiring a compiler preimage', async () => {
    const effects: Array<Readonly<{ operation: string; relativePath: string; expected?: unknown }>> = [];
    const retiredDigest = `sha256:${'3'.repeat(64)}` as const;
    const options = lifecycleOptions({
      bind: async (relativePath, expected) => {
        effects.push({ operation: 'bind', relativePath, expected });
        return registration(relativePath);
      },
      retired: async (relativePath) => {
        effects.push({ operation: 'retired', relativePath });
        return Object.freeze({ ...registration(relativePath), registrationDigest: retiredDigest });
      }
    });

    await bindExistingCompilerDependencyGeneration(options, physical);
    expect(await bindAndRetireCompilerDependencyPreimage(options, physical, 'replacement')).toBe(
      retiredDigest
    );

    expect(effects.map(({ operation, relativePath }) => `${operation}:${relativePath}`)).toEqual([
      'bind:node_modules',
      'bind:node_modules',
      'retired:node_modules'
    ]);
    expect(effects[0]?.expected).toEqual({
      owner: 'compiler-dependency-runtime',
      producer: 'ensure-compiler-deps-ready',
      ruleId: 'compiler-node-modules',
      physical
    });
  });

  test('admits birth through the operation fence and binds its exact physical identity', async () => {
    const effects: string[] = [];
    const options = runtimeDependencyOperationOptions({
      beforeCommit: async () => {
        effects.push('fence');
      },
      deadlineAtUnixMs: Date.now() + 10_000,
      generatedStateLifecycle: lifecycleOptions({
        born: async (relativePath) => {
          effects.push(`born:${relativePath}`);
        },
        bind: async (relativePath) => {
          effects.push(`bind:${relativePath}`);
          return registration(relativePath);
        }
      }).generatedStateLifecycle
    });

    await birthAndBindCompilerDependencyGeneration(
      options,
      'D:/repository/.tmp/dependency-installs/compiler.candidate',
      physical
    );

    expect(effects).toEqual(['fence', 'born:node_modules', 'bind:node_modules']);
  });

  test('preserves a typed blocker when adoption authority is absent or rejects the identity', async () => {
    await expect(bindExistingCompilerDependencyGeneration(lifecycleOptions({}), physical)).rejects.toMatchObject({
      code: 'IMPORT-AUTHORITY-004'
    } satisfies Partial<FailureError>);

  });
});
