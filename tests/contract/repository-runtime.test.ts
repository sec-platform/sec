import { describe, expect, test } from 'bun:test';

import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

describe('test budget and benchmark contracts', () => {
  test('external architecture tools are explicit, version-pinned package capabilities', async () => {
    const { scripts, devDependencies, trustedDependencies } = await readCompilerPackageJson();

    for (const scriptName of [
      'depcruise', 'jscpd', 'discover', 'gitnexus:analyze', 'gitnexus:status',
      'graphify', 'graphify:update', 'graphify:extract'
    ]) {
      expect(typeof scripts[scriptName], scriptName).toBe('string');
      expect(scripts[scriptName], scriptName).not.toMatch(/(?:@|==)latest(?:\s|$)/u);
    }
    const canonicalSemver = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
    expect(scripts.depcruise).toMatch(new RegExp(`\\bdependency-cruiser@${canonicalSemver}\\b`, 'u'));
    expect(scripts.jscpd).toMatch(new RegExp(`\\bjscpd@${canonicalSemver}\\b`, 'u'));
    expect(scripts.graphify).toMatch(new RegExp(`\\bgraphifyy==${canonicalSemver}\\b`, 'u'));
    expect(devDependencies?.gitnexus).toMatch(new RegExp(`^${canonicalSemver}$`, 'u'));
    expect(trustedDependencies).toEqual(expect.arrayContaining([
      '@ladybugdb/core',
      'gitnexus',
      'onnxruntime-node',
      'protobufjs'
    ]));
  });

  test('retired MCP entrypoints stay absent while CLI analysis remains available', async () => {
    const { scripts } = await readCompilerPackageJson();
    const mcpConfig = new URL('../../.mcp.json', import.meta.url);

    expect(await Bun.file(mcpConfig).exists()).toBe(false);
    expect(scripts['gitnexus:mcp']).toBeUndefined();
    expect(scripts['gitnexus:analyze']).toBeDefined();
    expect(scripts['gitnexus:status']).toBeDefined();
    expect(scripts.graphify).toBeDefined();
  });

});

describe('developer contract entrypoints', () => {
  test('contract scripts bypass dev-runner', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['test:budget']).not.toContain('dev-runner');
    expect(scripts['test:benchmark-contract']).not.toContain('dev-runner');
    expect(scripts['reference:check']).not.toContain('reference-clean');
  });
});
