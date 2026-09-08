import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'bun:test';
import {
  parseRepositoryAuditCliOptions as parse,
  repositoryAuditShouldFail as shouldFail,
  repositoryModuleTopologyShouldFail as topologyFails,
  type RepositoryAuditSeverity
} from '../../src/brownfield/repository-audit/cli-contract.ts';

// Independent command vectors. These checks use the native argument parser and
// pure decisions, not a mock Git/worker/scan result promoted into authority.
test('repository defaults preserve high-severity enforcement and no output effect', () => {
  assert.deepEqual(parse([]), {
    mode: 'repository', diagnostic: false, enforce: false, full: false,
    includeCandidates: false, failOn: 'high', defaultRef: undefined,
    outputPath: null, query: null, reductionMode: 'none', supersessionBaseline: 'HEAD'
  });
});

test('the topology and Source Program command modes are selected explicitly', () => {
  assert.equal(parse(['--worktree-module-topology', '--enforce']).mode, 'module-topology');
  assert.equal(parse(['--worktree-source-program', '--enforce']).mode, 'source-program');
  assert.equal(parse(['--enforce'], 'source-program').mode, 'source-program');
});

test('all ambiguous or misspelled enforcement switches reject instead of becoming a successful report', () => {
  for (const args of [['--enfroce'], ['--enforce=true'], ['--enforce=false'], ['--no-enforce'], ['--unknown'], ['unexpected']]) {
    assert.throws(() => parse(args));
    assert.throws(() => parse(args, 'source-program'));
  }
});

test('both mode selectors reject in either order rather than selecting the first branch', () => {
  for (const args of [
    ['--worktree-module-topology', '--worktree-source-program'],
    ['--worktree-source-program', '--worktree-module-topology']
  ]) assert.throws(() => parse(args), /exactly one repository audit mode/);
});

test('all string-valued switches reject missing, empty and NUL values', () => {
  for (const name of ['output', 'query', 'fail-on', 'default-ref', 'supersession-baseline']) {
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
    ['--fail-on=high', '--fail-on=none'], ['--output=a', '--output=b'],
    ['--default-ref=HEAD', '--default-ref=main']
  ]) assert.throws(() => parse(args), /exactly once/);
  assert.throws(() => parse(['--supersession-baseline=HEAD', '--supersession-baseline=main'], 'source-program'), /exactly once/);
});

test('repeated idempotent boolean switches retain their previous meaning', () => {
  assert.equal(parse(['--full', '--full']).full, true);
  assert.equal(parse(['--enforce', '--enforce'], 'source-program').enforce, true);
});

test('an equals-form query value spelling a switch stays data and does not choose a mode or policy', () => {
  for (const query of ['--enforce', '--diagnostic', '--worktree-module-topology', '--worktree-source-program']) {
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
  const selected = parse(['--output=--worktree-source-program']);
  assert.equal(selected.mode, 'repository');
  assert.equal(selected.outputPath, path.resolve('--worktree-source-program'));
});

test('explicit enforcement cannot be combined with diagnostic softening or a none threshold', () => {
  for (const args of [['--enforce', '--diagnostic'], ['--diagnostic', '--enforce'],
    ['--enforce', '--fail-on=none']]) assert.throws(() => parse(args));
  assert.equal(parse(['--diagnostic', '--fail-on=none']).diagnostic, true);
});

test('non-repository modes reject ignored repository-only options', () => {
  for (const mode of ['--worktree-module-topology', '--worktree-source-program']) {
    for (const option of ['--diagnostic', '--fail-on=high', '--default-ref=HEAD']) {
      assert.throws(() => parse([mode, option]), /only supported/);
    }
  }
});

test('source-only reduction, candidate and baseline options cannot silently run another mode', () => {
  for (const option of ['--candidates', '--graph-cuts', '--version-reductions',
    '--aggregate-import-reductions', '--supersession-baseline=HEAD']) {
    assert.throws(() => parse([option]), /only supported/);
    assert.throws(() => parse(['--worktree-module-topology', option]), /only supported/);
  }
});

test('each reduction works alone and conflicting reductions reject', () => {
  for (const [flag, mode] of [['--aggregate-import-reductions', 'aggregate-import'],
    ['--graph-cuts', 'graph-cut'], ['--version-reductions', 'version']]) {
    const result = parse([flag!, '--output=changes.patch'], 'source-program');
    assert.equal(result.reductionMode, mode); assert.equal(result.outputPath, path.resolve('changes.patch'));
  }
  for (const flags of [['--graph-cuts', '--version-reductions'],
    ['--version-reductions', '--aggregate-import-reductions']]) {
    assert.throws(() => parse(flags, 'source-program'), /one reduction mode/);
  }
});

test('a source output without a reduction is refused before the producer can be called', () => {
  assert.throws(() => parse(['--output=report.json'], 'source-program'), /requires one reduction mode/);
});

test('topology queries reject rather than paying for an ignored query', () => {
  assert.throws(() => parse(['--worktree-module-topology', '--query=symbol']), /not supported/);
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

test('json is a compatible presentation switch, not an enforcement bypass', () => {
  assert.deepEqual(parse(['--json']), parse([]));
  assert.deepEqual(parse(['--json', '--worktree-module-topology', '--enforce']),
    parse(['--worktree-module-topology', '--enforce']));
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
