import { expect, test } from 'bun:test';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceProvenancePath } from '../../../src/adapters/workspace-context.ts';
import { expectCliJson, expectCliSuccess, runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('provenance inspection routes text through application and entry while preserving raw JSON', async () => {
  const source = {
    artifacts: [
      {
        path: 'src/block-a.ts',
        originType: 'block',
        originId: 'block-a',
        registrySourceId: 'official',
        generatedByPass: 'compose',
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
        verifiedBy: [] as string[],
        overrideStatus: 'none'
      }
    ]
  };
  const provenance = { formatVersion: '1', artifacts: source.artifacts };

  await withTempWorkspace(async (workspaceRoot) => {
    const missing = await runCliInProcess(workspaceRoot, ['provenance']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');
    expect(missing.stderr).not.toContain('commander.');

    const provenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
    await writeJson(provenancePath, provenance);

    const { stdout: text } = await expectCliSuccess(workspaceRoot, ['provenance']);
    for (const count of [/\bartifacts=5(?=$|[\s;,()])/u, /\bregistry=1(?=$|[\s;,()])/u, /\boverrides=1(?=$|[\s;,()])/u, /\bunverified=3(?=$|[\s;,()])/u]) {
      expect(text).toMatch(count);
    }
    const origins = text.split('\n').find((line) => /^Origins\b/u.test(line));
    for (const count of [/\bblock=2(?=$|[\s;,()])/u, /\bgenerated=2(?=$|[\s;,()])/u, /\boverride=1(?=$|[\s;,()])/u]) {
      expect(origins).toMatch(count);
    }
    expect(text).toMatch(/Registry sources[^\n]*\bofficial=1(?=$|[\s;,()])/u);
    const passes = text.split('\n').find((line) => /^Generated passes\b/u.test(line));
    expect(passes?.slice('Generated passes:'.length).split(',').map(value => value.trim()))
      .toEqual(['compose', 'emit']);
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

    const rawJson = await expectCliJson<typeof provenance>(workspaceRoot, ['provenance', 'registry', '--json']);
    expect(rawJson).toEqual(provenance);
  });
});
