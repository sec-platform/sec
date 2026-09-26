import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import {
  compileRepositoryModuleMembershipSnapshot,
  parseModuleDescriptor
} from '../../../repository/architecture/contract.ts';
import { compileRepositoryModel } from '../../../repository/source-program-model/repository.ts';
import { PhysicalNoFollowError } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalRuntimeDependencySourceGeneration } from './dependency-transition/codec.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationOptions,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';
import { readRuntimeDependencyOperationTelemetry } from './operation-telemetry.ts';
import {
  assertRuntimeDependencySourceGenerationIssued,
  issuedRuntimeDependencySourceGenerationWithPath,
  runtimeDependencySourceGeneration,
  sameRuntimeDependencySourceGenerationContent
} from './source-generation.ts';

test('dependency generation and environment owners remain bound to their readback operations', async () => {
  const descriptorPath = 'src/adapters/toolchain/dependencies/module.json';
  const descriptorSource = await fs.readFile(descriptorPath, 'utf8');
  const descriptor = parseModuleDescriptor(JSON.parse(descriptorSource), descriptorPath);
  const roles = descriptor.capabilityProviders.flatMap(({ capability, operationRoles }) => (
    operationRoles.map((binding) => Object.freeze({ capability, ...binding }))
  ));
  const environmentOwner = roles.find(({ operation }) => (
    operation === 'disposeCompilerDependencyEnvironment'
  ));
  const environmentReadback = roles.find(({ operation }) => (
    operation === 'assertCompilerDependencyEnvironmentRetirementReceipt'
  ));
  const readGenerationOwner = roles.find(({ operation }) => (
    operation === 'retainCompilerDependencyReadGeneration'
  ));
  const readGenerationReadback = roles.find(({ operation }) => (
    operation === 'assertCompilerDependencyReadGenerationRetirementReceipt'
  ));
  expect(environmentOwner?.role).toBe('domain-owner');
  expect(environmentReadback?.role).toBe('readback-issuer');
  expect(environmentReadback?.semanticOperation).toBe(environmentOwner?.semanticOperation);
  expect(environmentReadback?.requirementId).toBe(environmentOwner?.capability);
  expect(readGenerationOwner?.role).toBe('domain-owner');
  expect(readGenerationReadback?.role).toBe('readback-issuer');
  expect(readGenerationReadback?.semanticOperation).toBe(readGenerationOwner?.semanticOperation);
  expect(readGenerationReadback?.requirementId).toBe(readGenerationOwner?.capability);

  const sourcePath = 'src/adapters/toolchain/dependencies/runtime/project-runtime.ts';
  const operations = descriptor.capabilityProviders.flatMap(({ operations }) => operations);
  const source = operations.map((operation) => `export function ${operation}(): void {}`).join('\n');
  const files = [Object.freeze({ path: sourcePath, source, contentDigest: rawSha256(source) })];
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [descriptorPath, 'src/adapters/toolchain/dependencies/runtime.ts', sourcePath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path: filePath, contentDigest }) => ({
      path: filePath,
      contentDigest
    }))),
    files,
    moduleMembership
  });
  expect(model.candidates.filter(({ code }) => code.startsWith('operation-issuer'))).toEqual([]);
});

async function withSourceGenerationFixture(
  run: (fixture: Readonly<{ ownerRoot: string; sourcePath: string; foreignPath: string }>) => Promise<void>
): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-source-generation-'));
  const ownerRoot = path.join(temporaryRoot, 'owner');
  const sourcePath = path.join(ownerRoot, 'node_modules');
  const foreignPath = path.join(temporaryRoot, 'foreign');
  try {
    await Promise.all([
      fs.mkdir(sourcePath, { recursive: true }),
      fs.mkdir(foreignPath)
    ]);
    await run(Object.freeze({ ownerRoot, sourcePath, foreignPath }));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function operationOptions(input: Readonly<{
  lockTimeoutMs?: number;
  monotonicNowMs?: () => number;
  signal?: AbortSignal;
}> = {}): RuntimeDependencyOperationOptions {
  return runtimeDependencyOperationOptions({
    lockTimeoutMs: input.lockTimeoutMs ?? 5_000,
    monotonicNowMs: input.monotonicNowMs,
    signal: input.signal
  });
}

test('source generation binds content identity to one exact physical owner topology', async () => {
  await withSourceGenerationFixture(async ({ ownerRoot, sourcePath, foreignPath }) => {
    await fs.writeFile(path.join(sourcePath, 'package.json'), '{"name":"fixture"}\n');
    const options = operationOptions();
    const input = { binding: { packageManager: 'bun' }, options, ownerRoot, sourcePath };
    const first = await runtimeDependencySourceGeneration(input);
    const repeated = await runtimeDependencySourceGeneration(input);
    expect(() => assertRuntimeDependencySourceGenerationIssued(first)).not.toThrow();
    expect(() => assertRuntimeDependencySourceGenerationIssued({ ...first }))
      .toThrow('not issued by the physical source compiler');
    const relocated = issuedRuntimeDependencySourceGenerationWithPath(
      first,
      path.join(ownerRoot, 'immutable-generation')
    );
    expect(() => assertRuntimeDependencySourceGenerationIssued(relocated)).not.toThrow();
    expect(isCanonicalRuntimeDependencySourceGeneration({
      ...first,
      epoch: `sha256:${'0'.repeat(64)}`
    })).toBe(false);
    expect(repeated).toEqual(first);
    expect(sameRuntimeDependencySourceGenerationContent(first, repeated)).toBe(true);

    await fs.writeFile(path.join(sourcePath, 'package.json'), '{"name":"changed"}\n');
    const changed = await runtimeDependencySourceGeneration(input);
    expect(changed.epoch).not.toBe(first.epoch);
    expect(sameRuntimeDependencySourceGenerationContent(first, changed)).toBe(false);
    const telemetry = readRuntimeDependencyOperationTelemetry(options);
    expect(telemetry).toMatchObject({
      authority: 'none-diagnostic-only',
      operationId: expect.any(String),
      phases: [
        {
          phase: 'source-scan',
          count: 3,
          outcomes: { completed: 3, aborted: 0, 'deadline-exhausted': 0, failed: 0 }
        }
      ]
    });
    expect(JSON.stringify(telemetry)).not.toContain(temporaryPathFragment(ownerRoot));

    await fs.writeFile(path.join(foreignPath, 'package.json'), '{"name":"fixture"}\n');
    await expect(runtimeDependencySourceGeneration({
      binding: input.binding,
      options,
      ownerRoot,
      sourcePath: foreignPath
    })).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
    await expect(runtimeDependencySourceGeneration({
      binding: input.binding,
      options,
      ownerRoot,
      sourcePath: path.join(ownerRoot, 'missing')
    })).rejects.toBeInstanceOf(PhysicalNoFollowError);
  });
});

function temporaryPathFragment(ownerRoot: string): string {
  return path.basename(path.dirname(ownerRoot));
}

test('source generation enforces caller deadline abort byte and entry bounds', async () => {
  await withSourceGenerationFixture(async ({ ownerRoot, sourcePath }) => {
    await Promise.all([
      fs.writeFile(path.join(sourcePath, 'a.json'), '{"a":1}\n'),
      fs.writeFile(path.join(sourcePath, 'b.json'), '{"b":2}\n')
    ]);
    const binding = { packageManager: 'bun' };
    await expect(runtimeDependencySourceGeneration(
      { binding, options: operationOptions(), ownerRoot, sourcePath },
      { maximumBytes: 0 }
    )).rejects.toBeInstanceOf(PhysicalNoFollowError);
    await expect(runtimeDependencySourceGeneration(
      { binding, options: operationOptions(), ownerRoot, sourcePath },
      { maximumEntries: 1 }
    )).rejects.toBeInstanceOf(PhysicalNoFollowError);

    const controller = new AbortController();
    const aborted = operationOptions({ signal: controller.signal });
    controller.abort(new Error('source-generation-aborted'));
    await expect(runtimeDependencySourceGeneration({
      binding,
      options: aborted,
      ownerRoot,
      sourcePath
    })).rejects.toThrow('source-generation-aborted');

    let nowMs = 0;
    const expired = operationOptions({ lockTimeoutMs: 10, monotonicNowMs: () => nowMs });
    nowMs = 11;
    await expect(runtimeDependencySourceGeneration({
      binding,
      options: expired,
      ownerRoot,
      sourcePath
    })).rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
  });
});

test('source generation coalesces only callers with the same operation bounds', async () => {
  await withSourceGenerationFixture(async ({ ownerRoot, sourcePath }) => {
    await fs.writeFile(path.join(sourcePath, 'package.json'), '{"name":"fixture"}\n');
    const shared = operationOptions({ lockTimeoutMs: 1_000 });
    const rewrapped = runtimeDependencyOperationOptions(shared);
    expect(runtimeDependencyOperationContext(rewrapped))
      .toBe(runtimeDependencyOperationContext(shared));
    const input = { binding: { packageManager: 'bun' }, options: shared, ownerRoot, sourcePath };
    const first = runtimeDependencySourceGeneration(input);
    const second = runtimeDependencySourceGeneration(input);
    const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);

    const long = operationOptions({ lockTimeoutMs: 1_000 });
    const short = runtimeDependencyOperationOptions({ ...long, lockTimeoutMs: 1 });
    const pending = runtimeDependencySourceGeneration({ ...input, options: long });
    await expect(runtimeDependencySourceGeneration({ ...input, options: short }))
      .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
    await expect(pending).resolves.toMatchObject({ sourcePath });
  });
});
