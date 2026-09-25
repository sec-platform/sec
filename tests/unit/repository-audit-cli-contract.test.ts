import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  parseRepositoryAuditCliOptions as parse,
  repositoryAuditShouldFail as shouldFail,
  repositoryModuleTopologyShouldFail as topologyFails,
  type RepositoryAuditSeverity
} from '../../src/adapters/repository/repository-audit/cli-contract.ts';

// Independent command vectors. These checks use the native argument parser and
// pure decisions, not a mock Git/worker/scan result promoted into authority.
test('repository defaults preserve high-severity enforcement and no output effect', () => {
  assert.deepEqual(parse([]), {
    mode: 'repository', diagnostic: false, enforce: false, full: false,
    findings: false,
    blockingDetails: false, blockingDetailsDomain: 'priority', blockingDetailsPage: 0, includeCandidates: false,
    failOn: 'high', defaultRef: undefined,
    outputPath: null, query: null, reductionMode: 'none', supersessionBaseline: 'HEAD'
  });
});

test('the topology and Source Program command modes are selected explicitly', () => {
  assert.equal(parse(['--scope', 'module-topology', '--enforce']).mode, 'module-topology');
  assert.equal(parse(['--scope', 'source-program', '--enforce']).mode, 'source-program');
  assert.equal(parse(['--scope', 'repository']).mode, 'repository');
  assert.equal(parse(['--enforce'], 'source-program').mode, 'source-program');
});

test('all ambiguous or misspelled enforcement switches reject instead of becoming a successful report', () => {
  for (const args of [['--enfroce'], ['--enforce=true'], ['--enforce=false'], ['--no-enforce'], ['--json'], ['--unknown'], ['unexpected']]) {
    assert.throws(() => parse(args));
    assert.throws(() => parse(args, 'source-program'));
  }
});

test('audit scope is one explicit finite value', () => {
  for (const value of ['everything', 'source', 'topology', '']) {
    assert.throws(() => parse(['--scope', value]), /Unsupported --scope value/);
  }
  assert.throws(() => parse(['--scope', 'source-program', '--scope', 'repository']), /exactly once/);
  assert.throws(() => parse(['--worktree-module-topology']), /Unknown option/);
  assert.throws(() => parse(['--worktree-source-program']), /Unknown option/);
});

test('all string-valued switches reject missing, empty and NUL values', () => {
  for (const name of ['scope', 'output', 'query', 'fail-on', 'default-ref', 'supersession-baseline',
    'blocking-details-domain', 'blocking-details-page']) {
    for (const value of [undefined, '', 'x\0y']) {
      const args = value === undefined ? [`--${name}`] : [`--${name}`, value];
      assert.throws(() => parse(args));
      assert.throws(() => parse(args, 'source-program'));
    }
  }
});

test('a following switch is not silently swallowed as an output, query or revision value', () => {
  for (const name of ['output', 'query', 'default-ref', 'supersession-baseline']) {
    assert.throws(() => parse([`--${name}`, '--enforce']));
  }
});

test('duplicate value options reject both separate and equals forms', () => {
  for (const args of [
    ['--query', 'a', '--query', 'b'], ['--query=a', '--query=b'],
    ['--scope=repository', '--scope=source-program'],
    ['--fail-on=high', '--fail-on=none'], ['--output=a', '--output=b'],
    ['--default-ref=HEAD', '--default-ref=main']
  ]) assert.throws(() => parse(args), /exactly once/);
  assert.throws(() => parse(['--supersession-baseline=HEAD', '--supersession-baseline=main'], 'source-program'), /exactly once/);
});

test('repeated idempotent boolean switches retain their previous meaning', () => {
  assert.equal(parse(['--full', '--full']).full, true);
  assert.equal(parse(['--findings', '--findings']).findings, true);
  assert.equal(parse(['--enforce', '--enforce'], 'source-program').enforce, true);
});

test('findings selects the bounded exact-report ledger without colliding with full or query projections', () => {
  assert.equal(parse(['--findings']).findings, true);
  assert.equal(parse(['--findings', '--output=findings.json']).outputPath, path.resolve('findings.json'));
  assert.throws(() => parse(['--findings', '--full']), /cannot be combined/);
  assert.throws(() => parse(['--findings', '--query=symbol']), /cannot be combined/);
  for (const mode of ['module-topology', 'source-program']) {
    assert.throws(() => parse(['--scope', mode, '--findings']), /only supported/);
  }
});

test('an equals-form query value spelling a switch stays data and does not choose a mode or policy', () => {
  for (const query of ['--enforce', '--diagnostic', '--scope=module-topology', '--scope=source-program']) {
    const result = parse([`--query=${query}`]);
    assert.equal(result.query, query); assert.equal(result.mode, 'repository');
    assert.equal(result.enforce, false); assert.equal(result.diagnostic, false);
  }
});

test('equals syntax and separate arguments select the same valid input', () => {
  assert.deepEqual(parse(['--query', 'model', '--fail-on', 'medium', '--output', 'audit.json']),
    parse(['--query=model', '--fail-on=medium', '--output=audit.json']));
});

test('an output filename spelling a selector cannot route another operation', () => {
  const selected = parse(['--output=--scope=source-program']);
  assert.equal(selected.mode, 'repository');
  assert.equal(selected.outputPath, path.resolve('--scope=source-program'));
});

test('explicit enforcement cannot be combined with diagnostic softening or a none threshold', () => {
  for (const args of [['--enforce', '--diagnostic'], ['--diagnostic', '--enforce'],
    ['--enforce', '--fail-on=none']]) assert.throws(() => parse(args));
  assert.equal(parse(['--diagnostic', '--fail-on=none']).diagnostic, true);
});

test('non-repository modes reject ignored repository-only options', () => {
  for (const mode of ['module-topology', 'source-program']) {
    for (const option of ['--diagnostic', '--fail-on=high', '--default-ref=HEAD']) {
      assert.throws(() => parse(['--scope', mode, option]), /only supported/);
    }
  }
});

test('source-only reduction, detail, candidate and baseline options cannot silently run another mode', () => {
  for (const option of ['--blocking-details', '--blocking-details-domain=priority', '--blocking-details-page=0', '--candidates', '--graph-cuts', '--version-reductions',
    '--aggregate-import-reductions', '--supersession-baseline=HEAD']) {
    assert.throws(() => parse([option]), /only supported/);
    assert.throws(() => parse(['--scope', 'module-topology', option]), /only supported/);
  }
});

test('blocking details select the bounded source-program diagnostic projection', () => {
  const parsed = parse([
    '--blocking-details', '--blocking-details-domain=test-retirement', '--blocking-details-page=2'
  ], 'source-program');
  assert.equal(parsed.blockingDetails, true);
  assert.equal(parsed.blockingDetailsDomain, 'test-retirement');
  assert.equal(parsed.blockingDetailsPage, 2);
  assert.equal(parsed.full, false);
  assert.equal(parsed.includeCandidates, false);
});

test('blocking detail pages require the bounded projection and reject invalid indices', () => {
  assert.throws(() => parse(['--blocking-details-page=1'], 'source-program'), /requires --blocking-details/);
  assert.throws(() => parse(['--blocking-details-domain=priority'], 'source-program'), /requires --blocking-details/);
  assert.throws(() => parse([
    '--blocking-details', '--blocking-details-domain=everything'
  ], 'source-program'), /Unsupported --blocking-details-domain/);
  for (const value of ['-1', '1.5', '9007199254740992']) {
    assert.throws(() => parse([
      '--blocking-details', `--blocking-details-page=${value}`
    ], 'source-program'), /Unsupported --blocking-details-page/);
  }
  assert.throws(() => parse(['--blocking-details', '--full'], 'source-program'), /cannot be combined/);
});

test('each reduction works alone and conflicting reductions reject', () => {
  for (const [flag, mode] of [['--aggregate-import-reductions', 'aggregate-import'],
    ['--version-reductions', 'version']]) {
    const result = parse([flag!, '--output=changes.patch'], 'source-program');
    assert.equal(result.reductionMode, mode); assert.equal(result.outputPath, path.resolve('changes.patch'));
  }
  for (const flags of [['--graph-cuts', '--version-reductions'],
    ['--version-reductions', '--aggregate-import-reductions']]) {
    assert.throws(() => parse(flags, 'source-program'), /one reduction mode/);
  }
});

test('graph-cut output is admitted only for the exact-snapshot provider path', () => {
  assert.equal(parse(['--graph-cuts'], 'source-program').reductionMode, 'graph-cut');
  assert.equal(parse(['--graph-cuts', '--output=changes.patch'], 'source-program').outputPath,
    path.resolve('changes.patch'));
});

test('a source output without a reduction is refused before the producer can be called', () => {
  assert.throws(() => parse(['--output=report.json'], 'source-program'), /requires one reduction mode/);
});

test('topology queries reject rather than paying for an ignored query', () => {
  assert.throws(() => parse(['--scope', 'module-topology', '--query=symbol']), /not supported/);
});

test('revision operands beginning with a switch are refused even in explicit equals form', () => {
  assert.throws(() => parse(['--default-ref=--enforce']), /Git revision/);
  assert.throws(() => parse(['--supersession-baseline=-other'], 'source-program'), /Git revision/);
});

test('captured options are immutable and later argv edits do not retarget output', () => {
  const args = ['--output', 'result with spaces.json', '--query', '中文'];
  const selected = parse(args); args[1] = 'changed.json';
  assert.ok(Object.isFrozen(selected));
  assert.equal(selected.outputPath, path.resolve('result with spaces.json'));
  assert.equal(selected.query, '中文');
});

test('json is not a fake presentation mode because every audit projection is JSON', () => {
  assert.throws(() => parse(['--json']), /Unknown option/);
  assert.throws(() => parse(['--json', '--scope', 'module-topology', '--enforce']), /Unknown option/);
});

test('all original severity thresholds select the same independent ordered findings', () => {
  const severities: RepositoryAuditSeverity[] = ['critical', 'high', 'medium', 'low'];
  for (let threshold = 0; threshold < severities.length; threshold++) {
    for (let found = 0; found < severities.length; found++) {
      assert.equal(shouldFail({ findings: [{ severity: severities[found]! }], unknowns: [] },
        { failOn: severities[threshold]! }), found <= threshold);
    }
  }
});

test('unknown observations still fail without diagnostic even when findings are disabled', () => {
  assert.equal(shouldFail({ findings: [], unknowns: ['unresolved input'] }), true);
  assert.equal(shouldFail({ findings: [], unknowns: ['unresolved input'] }, { failOn: 'none' }), true);
  assert.equal(shouldFail({ findings: [], unknowns: ['unresolved input'] }, { diagnostic: true }), false);
});

test('diagnostic does not disable findings and none does not disable unknowns', () => {
  const report = { findings: [{ severity: 'high' as const }], unknowns: ['missing source'] };
  assert.equal(shouldFail(report, { diagnostic: true }), true);
  assert.equal(shouldFail(report, { failOn: 'none' }), true);
  assert.equal(shouldFail(report, { diagnostic: true, failOn: 'none' }), false);
});

test('invalid diagnostic and severity policy cannot silently soften programmatic enforcement', () => {
  for (const diagnostic of ['false', 'true', 1, null]) {
    assert.throws(() => shouldFail({ findings: [], unknowns: ['missing'] }, { diagnostic: diagnostic as never }), TypeError);
  }
  for (const failOn of ['HIGH', 'typo', 'constructor', '__proto__', null]) {
    assert.throws(() => shouldFail({ findings: [{ severity: 'critical' }], unknowns: [] }, { failOn: failOn as never }), TypeError);
  }
});

test('malformed report severity is rejected rather than compared with undefined rank', () => {
  for (const severity of ['unknown', 'constructor', '', null]) {
    assert.throws(() => shouldFail({ findings: [{ severity: severity as never }], unknowns: [] }), TypeError);
  }
});

test('topology enforcement refuses unresolved files even when there are no known violations', () => {
  const input = { unresolvedFiles: [{ path: 'src/unparsed.ts' }], topology: { violations: [] } };
  assert.equal(topologyFails(input, true), true);
  assert.equal(topologyFails(input, false), false);
});

test('topology enforcement preserves clean and violated outcomes', () => {
  assert.equal(topologyFails({ unresolvedFiles: [], topology: { violations: [] } }, true), false);
  assert.equal(topologyFails({ unresolvedFiles: [], topology: { violations: [{ code: 'boundary' }] } }, true), true);
  assert.equal(topologyFails({ unresolvedFiles: [], topology: { violations: [{ code: 'boundary' }] } }, false), false);
});

test('malformed or compact topology summaries cannot impersonate the complete producer observation', () => {
  for (const input of [{ unresolvedFiles: { count: 0 }, topology: { violations: [] } },
    { unresolvedFiles: [], topology: { violations: 0 } }, { topology: { violations: [] } }]) {
    assert.throws(() => topologyFails(input as never, true), TypeError);
  }
});

test('Source Program unknowns cannot disappear behind an empty top-level report list', () => {
  const report = { findings: [], unknowns: [], sourceProgram: { unknowns: [{ code: 'unresolved-import' }] } };
  assert.equal(shouldFail(report), true);
  assert.equal(shouldFail(report, { failOn: 'none' }), true);
  assert.equal(shouldFail(report, { diagnostic: true }), false);
});

test('declaration topology unknowns retain the same diagnostic opt-out as other unknowns', () => {
  const report = { findings: [], unknowns: [], declarationTopology: { unknowns: ['unresolved-target'] } };
  assert.equal(shouldFail(report), true);
  assert.equal(shouldFail(report, { failOn: 'none' }), true);
  assert.equal(shouldFail(report, { diagnostic: true }), false);
});

test('unknown content coverage is blocking independently of other report producers', () => {
  const report = { findings: [], unknowns: [], contentCoverage: [{ status: 'unknown' as const }] };
  assert.equal(shouldFail(report), true);
  assert.equal(shouldFail(report, { diagnostic: true }), false);
});

test('scanned and explicitly excluded content are not converted into missing coverage', () => {
  const report = { findings: [], unknowns: [], sourceProgram: { unknowns: [] },
    declarationTopology: { unknowns: [] }, contentCoverage: [
      { status: 'scanned' as const }, { status: 'excluded' as const }
    ] };
  assert.equal(shouldFail(report), false);
});

test('all combinations of detailed unknown channels obey one explicit diagnostic decision', () => {
  for (let mask = 0; mask < 8; mask++) {
    const report = { findings: [], unknowns: [],
      sourceProgram: { unknowns: mask & 1 ? ['model'] : [] },
      declarationTopology: { unknowns: mask & 2 ? ['topology'] : [] },
      contentCoverage: [{ status: mask & 4 ? 'unknown' as const : 'scanned' as const }] };
    assert.equal(shouldFail(report, { failOn: 'none' }), mask !== 0);
    assert.equal(shouldFail(report, { diagnostic: true, failOn: 'none' }), false);
  }
});

test('compact count or digest substitutes cannot masquerade as detailed observation arrays', () => {
  for (const field of ['sourceProgram', 'declarationTopology'] as const) {
    for (const value of [null, {}, { unknowns: 0 }, { unknowns: { count: 0, digest: 'unknown' } }]) {
      assert.throws(() => shouldFail({ findings: [], unknowns: [], [field]: value } as never), TypeError);
      assert.throws(() => shouldFail({ findings: [], unknowns: [], [field]: value } as never,
        { diagnostic: true, failOn: 'none' }), TypeError);
    }
  }
});

test('malformed coverage is rejected rather than implicitly classified as scanned', () => {
  for (const value of [null, {}, [null], [{}], [{ status: 'SCANNED' }], [{ status: 'complete' }]]) {
    assert.throws(() => shouldFail({ findings: [], unknowns: [], contentCoverage: value } as never), TypeError);
  }
});

test('summary counters never override the original model and topology observations', () => {
  const report = { findings: [], unknowns: [], sourceProgram: { unknowns: ['unresolved'] },
    summary: { unknowns: 0, sourceProgram: { unknowns: 0 } } };
  assert.equal(shouldFail(report), true);
  const clean = { findings: [], unknowns: [], sourceProgram: { unknowns: [] }, summary: { unknowns: 99 } };
  assert.equal(shouldFail(clean), false);
});

test('diagnostic mode does not suppress an independent severe finding in a detailed report', () => {
  const report = { findings: [{ severity: 'critical' as const }], unknowns: [],
    sourceProgram: { unknowns: ['unresolved'] } };
  assert.equal(shouldFail(report, { diagnostic: true }), true);
});

test('the legacy narrowed findings/unknowns contract remains valid without detailed fields', () => {
  assert.equal(shouldFail({ findings: [], unknowns: [] }), false);
  assert.equal(shouldFail({ findings: [], unknowns: ['known-gap'] }), true);
});
