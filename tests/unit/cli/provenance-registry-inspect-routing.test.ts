import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceProvenancePath } from '../../../src/adapters/workspace-context.ts';
import { projectProvenanceRegistryInspect } from '../../../src/application/provenance-registry-inspect.ts';
import { formatProvenanceRegistry } from '../../../src/entry/cli/provenance-registry-inspect.ts';
import { expectCliJson, expectCliSuccess, runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('provenance inspection routes text through application and entry while preserving raw JSON', async () => {
  // Source attribution, verification gaps and snapshot isolation are independent obligations.
  {
    const source = {
      artifacts: [
        {
          path: 'src/block-a.ts',
          originType: 'block',
          originId: 'block-a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/block-b.ts',
          originType: 'block',
          originId: 'block-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/override.ts',
          originType: 'override',
          originId: 'override-a',
          verifiedBy: ['verify:o'],
          overrideStatus: 'project'
        },
        {
          path: 'src/generated-a.ts',
          originType: 'generated',
          originId: 'generated-a',
          generatedByPass: 'emit',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          generatedByPass: 'compose',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        }
      ]
    };
    const view = projectProvenanceRegistryInspect(source);
    source.artifacts[0]!.verifiedBy.push('later');

    expect(view).toEqual({
      artifactCount: 5,
      registryArtifactCount: 1,
      overrideArtifactCount: 1,
      unverifiedArtifactCount: 3,
      originTypeCounts: [
        { id: 'block', count: 2 },
        { id: 'generated', count: 2 },
        { id: 'override', count: 1 }
      ],
      registrySourceCounts: [{ id: 'official', count: 1 }],
      generatedPasses: ['compose', 'emit'],
      samples: [
        {
          path: 'src/block-a.ts',
          originType: 'block',
          originId: 'block-a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/block-b.ts',
          originType: 'block',
          originId: 'block-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/override.ts',
          originType: 'override',
          originId: 'override-a',
          verifiedBy: ['verify:o'],
          overrideStatus: 'project'
        },
        {
          path: 'src/generated-a.ts',
          originType: 'generated',
          originId: 'generated-a',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated-b.ts',
          originType: 'generated',
          originId: 'generated-b',
          verifiedBy: [] as string[],
          overrideStatus: 'none'
        }
      ]
    });

    const text = formatProvenanceRegistry(view);
    // A generated artifact without a declared producing pass is not an
    // empty-string pass. Retain this absence boundary next to the real CLI
    // consumer instead of a separate projection-only registration.
    const unboundPass = projectProvenanceRegistryInspect({ artifacts: [{
      path: 'src/no-pass.ts', originType: 'generated', originId: 'unbound',
      verifiedBy: [], overrideStatus: 'none'
    }] });
    expect(unboundPass.generatedPasses).toEqual([]);
    const absentPasses = formatProvenanceRegistry(unboundPass).split('\n')
      .find(line => line.startsWith('Generated passes:'));
    expect(absentPasses).toContain('none');
    for (const count of [/\bartifacts=5(?=$|[\s;,()])/u, /\bregistry=1(?=$|[\s;,()])/u, /\boverrides=1(?=$|[\s;,()])/u, /\bunverified=3(?=$|[\s;,()])/u]) {
      expect(text).toMatch(count);
    }
    const origins = text.split('\n').find((line) => /^Origins\b/u.test(line));
    for (const count of [/\bblock=2(?=$|[\s;,()])/u, /\bgenerated=2(?=$|[\s;,()])/u, /\boverride=1(?=$|[\s;,()])/u]) {
      expect(origins).toMatch(count);
    }
    expect(text).toMatch(/Registry sources[^\n]*\bofficial=1(?=$|[\s;,()])/u);
    const passes = text.split('\n').find((line) => /^Generated passes\b/u.test(line));
    expect(passes).toMatch(/\bcompose(?=$|[\s;,()])/u);
    expect(passes).toMatch(/\bemit(?=$|[\s;,()])/u);
    // Check each risk against its artifact; a correct word on the wrong row is insufficient.
    for (const [path, fields] of [
      ['src/block-a.ts', ['origin=block:block-a', 'registry=official', 'verifiedBy=verify:a', 'override=none']],
      ['src/block-b.ts', ['origin=block:block-b', 'registry=none', 'verifiedBy=none', 'override=none']],
      ['src/override.ts', ['origin=override:override-a', 'registry=none', 'verifiedBy=verify:o', 'override=project']],
      ['src/generated-a.ts', ['origin=generated:generated-a', 'registry=none', 'verifiedBy=none', 'override=none']],
      ['src/generated-b.ts', ['origin=generated:generated-b', 'registry=none', 'verifiedBy=none', 'override=none']]
    ] as const) {
      const row = text.split('\n').find((line) => new RegExp(`${path.replaceAll('.', '\\.')}(?=$|[\\s;,()])`, 'u').test(line));
      for (const field of fields) expect(row).toMatch(new RegExp(`${field}(?=$|[\\s;,()])`, 'u'));
    }
    expect(text).not.toContain('later');
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const missing = await runCliInProcess(workspaceRoot, ['provenance']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');
    expect(missing.stderr).not.toContain('commander.');

    const provenance = {
      formatVersion: '1',
      artifacts: [
        {
          path: 'src/block.ts',
          originType: 'block',
          originId: 'block:a',
          registrySourceId: 'official',
          verifiedBy: ['verify:a'],
          overrideStatus: 'none'
        },
        {
          path: 'src/generated.ts',
          originType: 'generated',
          originId: 'generated:a',
          generatedByPass: 'emit',
          verifiedBy: [],
          overrideStatus: 'none'
        }
      ]
    };
    const provenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

    const { stdout } = await expectCliSuccess(workspaceRoot, ['provenance']);
    expect(stdout).toMatch(/\bartifacts=2(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bregistry=1(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bunverified=1(?=$|[\s;,()])/u);
    const block = stdout.split('\n').find((line) => /src\/block\.ts(?=$|[\s;,()])/u.test(line));
    expect(block).toMatch(/origin=block:block:a(?=$|[\s;,()])/u);
    expect(block).toMatch(/registry=official(?=$|[\s;,()])/u);
    expect(block).toMatch(/verifiedBy=verify:a(?=$|[\s;,()])/u);
    const generated = stdout.split('\n').find((line) => /src\/generated\.ts(?=$|[\s;,()])/u.test(line));
    expect(generated).toMatch(/origin=generated:generated:a(?=$|[\s;,()])/u);
    expect(generated).toMatch(/verifiedBy=none(?=$|[\s;,()])/u);

    const rawJson = await expectCliJson<typeof provenance>(workspaceRoot, ['provenance', 'registry', '--json']);
    expect(rawJson).toEqual(provenance);
  });
});
