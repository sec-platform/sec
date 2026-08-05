import { describe, expect, test } from 'bun:test';

import { GENERATED_STATE_RULES } from '../../platform/shared/generated-state-contract.ts';
import {
  GENERATED_STATE_WRITER_CENSUS,
  assertGeneratedStateWriterCensus,
  auditGeneratedStateWriterCensus,
  extractGeneratedStateWriterReferences,
  type GeneratedStateWriterCensusEntry
} from '../../platform/shared/generated-state-writer-census.ts';

const TEST_ENTRY: GeneratedStateWriterCensusEntry = Object.freeze({
  ruleId: 'test-workspace-run',
  family: 'test-workspaces',
  match: 'exact',
  producers: ['platform/dev-runner/generated-state.ts'],
  consumers: ['tests/unit/generated-state.test.ts'],
  note: 'test'
});

describe('generated-state writer census', () => {
  test('census is closed over registered rules and has unique families', () => {
    expect(() => assertGeneratedStateWriterCensus()).not.toThrow();
    const ruleIds = new Set(GENERATED_STATE_RULES.map((rule) => rule.id));
    const families = new Set<string>();
    for (const entry of GENERATED_STATE_WRITER_CENSUS) {
      expect(families.has(entry.family)).toBe(false);
      families.add(entry.family);
      if (entry.family === 'root') continue;
      expect(ruleIds.has(entry.ruleId)).toBe(true);
      if (entry.legacyOnly !== true) expect(entry.producers.length).toBeGreaterThan(0);
    }
  });

  test('literal, join and root references are extracted with bounded dynamic normalization', () => {
    const TMP = '.tmp';
    const source = `
const a = '${TMP}/ci-risk-batch-evidence.json';
const b = path.join(compilerRoot, '${TMP}', 'test-workspaces', 'fast-1');
const c = path.join(path.resolve(repositoryRoot), '${TMP}');
const d = path.join(repoRoot, '${TMP}', \`synthetic-\${stage}-protected-record.json\`);
const e = '${TMP}/**';
const f = '${TMP}/';
`;
    const references = extractGeneratedStateWriterReferences('fixtures/writer.ts', source);
    expect(references.map(({ family, kind }) => ({ family, kind }))).toEqual([
      { family: 'ci-risk-batch-evidence.json', kind: 'literal' },
      { family: 'root', kind: 'literal' },
      { family: 'test-workspaces', kind: 'join' },
      { family: 'synthetic', kind: 'join' },
      { family: 'root', kind: 'root' }
    ]);
  });

  test('bare workflow and shell references are extracted from yml/sh sources', () => {
    const TMP = '.tmp';
    const references = [
      ...extractGeneratedStateWriterReferences(
        '.github/workflows/sec-merge-gate.yml',
        `path: ${TMP}/codex/candidate\n--input ${TMP}/codex/merge-gate-input.json\n`
      ),
      ...extractGeneratedStateWriterReferences(
        'scripts/probe.sh',
        `echo hello > ${TMP}/ci-risk-batch-evidence.json\nmkdir -p ${TMP}/synthetic-stage\n`
      ),
      ...extractGeneratedStateWriterReferences(
        'scripts/probe.ps1',
        `Set-Content -Path ${TMP}/new-unregistered-output -Value x\n`
      )
    ];
    expect(references.map(({ family, kind }) => ({ family, kind }))).toEqual([
      { family: 'codex', kind: 'literal' },
      { family: 'codex', kind: 'literal' },
      { family: 'ci-risk-batch-evidence.json', kind: 'literal' },
      { family: 'synthetic-stage', kind: 'literal' },
      { family: 'new-unregistered-output', kind: 'literal' }
    ]);
  });

  test('comment-only bare references and quoted workflow writes are not double-counted', () => {
    const TMP = '.tmp';
    const references = extractGeneratedStateWriterReferences(
      '.github/workflows/example.yml',
      `# path: ${TMP}/new-unregistered-output\nrun: node -e "fs.writeFileSync('${TMP}/codex/input.json','x')"\n`
    );
    expect(references.map(({ family }) => family)).toEqual(['codex']);
  });

  test('an unregistered literal writer fails the closure', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([{
      path: 'fixtures/new-writer.ts',
      text: `fs.writeFile('${TMP}/new-unregistered-output', 'x');`
    }]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generated-state-writer-unregistered',
        family: 'new-unregistered-output'
      })
    ]));
  });

  test('an unregistered bare workflow or shell writer fails the closure', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([
      {
        path: '.github/workflows/new.yml',
        text: `path: ${TMP}/new-unregistered-output`
      },
      {
        path: 'scripts/new.sh',
        text: `echo hello > ${TMP}/new-unregistered-output`
      }
    ]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generated-state-writer-unregistered',
        file: '.github/workflows/new.yml',
        family: 'new-unregistered-output'
      }),
      expect.objectContaining({
        code: 'generated-state-writer-unregistered',
        file: 'scripts/new.sh',
        family: 'new-unregistered-output'
      })
    ]));
  });

  test('a declared workflow producer satisfies a bare reference without a duplicate owner', () => {
    const WORKFLOW_ENTRY: GeneratedStateWriterCensusEntry = Object.freeze({
      ruleId: 'codex-merge-gate-scratch',
      family: 'codex',
      match: 'exact',
      producers: ['.github/workflows/sec-merge-gate.yml'],
      consumers: [],
      note: 'test'
    });
    const findings = auditGeneratedStateWriterCensus([
      {
        path: '.github/workflows/sec-merge-gate.yml',
        text: 'path: .tmp/codex/candidate\npath: .tmp/codex/attestation\n'
      }
    ], [WORKFLOW_ENTRY]);
    expect(findings).toEqual([]);
  });

  test('a reference from an undeclared file fails ownership', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([{
      path: 'platform/shared/unknown-owner.ts',
      text: `path.join(compilerRoot, '${TMP}', 'test-workspaces')`
    }], [TEST_ENTRY]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'generated-state-writer-ownership',
        family: 'test-workspaces'
      })
    ]));
  });

  test('a deleted producer makes the declaration stale', () => {
    const TMP = '.tmp';
    const findings = auditGeneratedStateWriterCensus([{
      path: 'tests/unit/generated-state.test.ts',
      text: `path.join(process.cwd(), '${TMP}', 'test-workspaces', 'x')`
    }], [TEST_ENTRY]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'generated-state-writer-stale-producer' })
    ]));
  });

  test('a live producer without a matching anchor makes the declaration stale', () => {
    const findings = auditGeneratedStateWriterCensus([
      {
        path: 'platform/dev-runner/generated-state.ts',
        text: 'export const unrelated = true;'
      }
    ], [TEST_ENTRY]);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'generated-state-writer-stale-anchor' })
    ]));
  });
});
