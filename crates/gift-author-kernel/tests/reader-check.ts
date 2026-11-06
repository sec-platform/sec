// Native transport and the real repository author CLI, without target generation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compileAuthorModule } from '../../../src/adapters/compilation/author-kernel.ts';
import { runCommand } from '../../../src/adapters/runtime-state/physical/runtime/process.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const kernel = process.argv[2];
assert.ok(kernel, 'Pass the workspace-relative built Rust executable');
const work = mkdtempSync(path.join(root, '.tmp', 'gift-author-reader-'));
const moduleBytes = Buffer.from('{"schema":"gift.author-module/design-converged","moduleId":"module:reader-check","definitions":{"":{"req:enum-value":{},"name":"名称"}},"exports":[""],"annotations":{"number":1.2300E+02}}\r\n');
const input = path.join(work, 'module.json');
writeFileSync(input, moduleBytes, { flag: 'wx' });
const relative = path.relative(root, input);
const result = await compileAuthorModule(root, relative, kernel, true);
assert.equal(result.stage, 'structural');
assert.equal(result.source_revision, `sha256:${createHash('sha256').update(moduleBytes).digest('hex')}`);
assert.deepEqual(readFileSync(input), moduleBytes);
assert.ok(result.nodes.some(node => node.kind === 'number' && node.value === '1.2300E+02'));
assert.equal('artifacts' in result, false);
const cli = await runCommand('bun', ['run', 'sec', '--', 'author', '--read', '--input', relative, '--kernel', kernel, '--json'], {
  cwd: root, timeoutMs: 30_000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024
});
assert.equal(cli.code, 0, cli.stderr);
assert.deepEqual(JSON.parse(cli.stdout), result);
const project = path.join(work, 'project.json');
writeFileSync(project, JSON.stringify({ schema: 'gift.project/design-converged', projectId: 'project:reader', sourceScopes: [] }), { flag: 'wx' });
const projectResult = await compileAuthorModule(root, path.relative(root, project), kernel, true);
assert.equal(projectResult.source_format, 'gift.project/design-converged');
const invalid = path.join(work, 'invalid.json');
writeFileSync(invalid, '{"schema":"gift.author-module/design-converged","definitions":{},"definitions":{}}', { flag: 'wx' });
await assert.rejects(compileAuthorModule(root, path.relative(root, invalid), kernel, true), /InvalidAuthorSource/);
const legacy = await compileAuthorModule(root, 'crates/gift-author-kernel/fixtures/shared-views.module.json', kernel);
assert.equal(legacy.artifacts.length, 4);
await assert.rejects(compileAuthorModule(root, 'crates/gift-author-kernel/fixtures/shared-views.module.json', kernel, true), /UnsupportedAuthorSchema/);
writeFileSync(path.join(work, 'evidence.json'), JSON.stringify({ sourceRevision: result.source_revision, grammarRevision: result.grammar_revision,
  cases: ['exact-source-and-number-lexeme', 'actual-cli', 'project', 'duplicate-key', 'historical-compile', 'no-reader-fallback'], result: 'PASS' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', evidence: path.join(work, 'evidence.json') }));
