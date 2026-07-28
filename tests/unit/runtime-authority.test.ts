import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildHostRuntimeIdentity,
  buildRuntimeExecutionEvidence,
  buildTargetRuntimeProfile,
  buildToolchainProviderIdentity,
  targetRuntimeProfileRevision
} from '../../platform/shared/runtime-authority.ts';

const nodeExecutable = path.join(process.cwd(), '.tmp', 'runtime-authority-fixtures', 'node.exe');
const bunExecutable = path.join(process.cwd(), '.tmp', 'runtime-authority-fixtures', 'bun.exe');

function nodeTarget(packageManager: 'npm' | 'bun' = 'npm') {
  return buildTargetRuntimeProfile({
    capabilities: {
      filesystem: true,
      nativeAddons: false,
      serverApi: 'node:http',
      subprocess: true,
      webStreams: true,
      workerThreads: true
    },
    family: 'node',
    moduleSystem: 'esm',
    packageManager,
    versionRange: '>=22'
  });
}

describe('runtime authority axes', () => {
  test('Node Host, Bun Toolchain, and Node Target remain independent identities', () => {
    const hostRuntime = buildHostRuntimeIdentity({
      architecture: 'x64',
      executablePath: nodeExecutable,
      family: 'node',
      platform: 'win32',
      version: '22.16.0'
    });
    const toolchainProvider = buildToolchainProviderIdentity({
      executablePath: bunExecutable,
      provider: 'bun',
      version: '1.3.14'
    });
    const targetRuntimeProfile = nodeTarget('bun');
    const evidence = buildRuntimeExecutionEvidence({
      hostRuntime,
      targetRuntimeProfile,
      toolchainProvider
    });

    expect(evidence.hostRuntime.family).toBe('node');
    expect(evidence.toolchainProvider.provider).toBe('bun');
    expect(evidence.hostRuntime.executablePath).not.toBe(evidence.toolchainProvider.executablePath);
    expect(targetRuntimeProfile.family).toBe('node');
    expect(targetRuntimeProfile.packageManager).toBe('bun');
    expect(evidence.targetRuntimeProfileRevision).toBe(targetRuntimeProfileRevision(targetRuntimeProfile));
  });

  test('host and toolchain Evidence cannot change the canonical Target revision', () => {
    const targetRuntimeProfile = nodeTarget();
    const nodeHost = buildHostRuntimeIdentity({
      architecture: 'x64',
      executablePath: nodeExecutable,
      family: 'node',
      platform: 'win32',
      version: '22.16.0'
    });
    const bunHost = buildHostRuntimeIdentity({
      architecture: 'x64',
      executablePath: bunExecutable,
      family: 'bun',
      platform: 'win32',
      version: '1.3.14'
    });
    const bunToolchain = buildToolchainProviderIdentity({
      executablePath: bunExecutable,
      provider: 'bun',
      version: '1.3.14'
    });
    const npmToolchain = buildToolchainProviderIdentity({
      executablePath: path.join(process.cwd(), '.tmp', 'runtime-authority-fixtures', 'npm.cmd'),
      provider: 'npm',
      version: '10.9.2'
    });

    const nodeEvidence = buildRuntimeExecutionEvidence({
      hostRuntime: nodeHost,
      targetRuntimeProfile,
      toolchainProvider: bunToolchain
    });
    const bunEvidence = buildRuntimeExecutionEvidence({
      hostRuntime: bunHost,
      targetRuntimeProfile,
      toolchainProvider: npmToolchain
    });

    expect(nodeEvidence.targetRuntimeProfileRevision).toBe(bunEvidence.targetRuntimeProfileRevision);
  });

  test('invalid identities and incomplete Target profiles fail closed', () => {
    expect(() => buildHostRuntimeIdentity({
      architecture: 'x64',
      executablePath: 'node',
      family: 'node',
      platform: 'win32',
      version: '22.16.0'
    })).toThrow('absolute executable path');
    expect(() => buildToolchainProviderIdentity({
      executablePath: bunExecutable,
      provider: 'bun',
      version: 'latest'
    })).toThrow('exact semantic version');
    expect(() => buildTargetRuntimeProfile({
      capabilities: {
        filesystem: true,
        nativeAddons: false,
        serverApi: '',
        subprocess: true,
        webStreams: true,
        workerThreads: true
      },
      family: 'node',
      moduleSystem: 'esm',
      packageManager: 'npm',
      versionRange: '>=22'
    })).toThrow('serverApi');
    expect(() => buildTargetRuntimeProfile({
      capabilities: {
        filesystem: true,
        nativeAddons: false,
        serverApi: 'node:http',
        subprocess: true,
        webStreams: true,
        workerThreads: true
      },
      family: 'edge' as 'node',
      moduleSystem: 'esm',
      packageManager: 'npm',
      versionRange: '>=22'
    })).toThrow('family is unsupported');
  });

  test('runtime authority source never infers Bun Toolchain from process.execPath', async () => {
    const source = await readFile(
      new URL('../../platform/shared/runtime-authority.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('process.execPath');
  });
});
