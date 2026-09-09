import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { markdownFacts } from '../../src/control/documentation/doctor/markdown-syntax.ts';
import {
  extractBacktickFilePaths,
  extractFileLinks,
  extractH1Headings,
  extractMarkdownLinks,
  repositoryPathForLink
} from '../../src/control/documentation/doctor/shared.ts';

// Use the actual installed Prettier Markdown parser, not a replacement AST
// producer. All expected facts are authored independently of the parser.
test('top-level ATX and Setext titles use provider syntax and retain authored inline text', () => {
  const source = 'Setext *title*\n===\n\n   # ATX title ###\n\n# [Linked](docs/title.md) title\n';
  assert.deepEqual(extractH1Headings(source), ['Setext *title*', 'ATX title', '[Linked](docs/title.md) title']);
});

test('quotes, list examples and empty headings do not become document titles', () => {
  assert.deepEqual(extractH1Headings('> # Quoted\n\n- # Listed\n\n#\n\n# Actual\n'), ['Actual']);
});

test('fenced and indented examples contribute no Markdown links, titles or inline paths', () => {
  const source = '```md\n# Hidden\n[x](docs/absent.md)\n`docs/absent.ts`\n```\n\n'
    + '    # Also hidden\n    [y](docs/also-absent.md)\n\n# Actual\n';
  assert.deepEqual(markdownFacts(source), { headings: ['Actual'], links: [], inlineCode: [] });
});

test('a shorter fence or a closing fence with trailing text does not end a code example', () => {
  const source = '````md\n```\n# Hidden\n```` trailing\n[x](fake.md)\n````\n\n# Actual\n';
  assert.deepEqual(extractH1Headings(source), ['Actual']);
  assert.deepEqual(extractMarkdownLinks(source), []);
});

test('reference, collapsed, shortcut and image references resolve definitions after their uses', () => {
  const source = '[full][target] [target][] [target] ![image][picture]\n\n'
    + '[target]: docs/target.md\n[picture]: images/picture.png\n';
  assert.deepEqual(extractMarkdownLinks(source), ['docs/target.md', 'docs/target.md', 'docs/target.md', 'images/picture.png']);
});

test('reference normalization and first-definition selection belong to the parser', () => {
  const source = '[first][SOME\t LABEL] [second][some label]\n\n'
    + '[some label]: docs/first.md\n[SOME LABEL]: docs/not-selected.md\n';
  assert.deepEqual(extractMarkdownLinks(source), ['docs/first.md', 'docs/first.md']);
});

test('nested and escaped destinations, entities and angle destinations are decoded as syntax', () => {
  const source = '[a](docs/a(b).md) [b](docs/a\\(b\\).md) '
    + '[space](<docs/with space.md>) [entity](docs/a&#x2e;md)';
  assert.deepEqual(extractMarkdownLinks(source), ['docs/a(b).md', 'docs/a(b).md', 'docs/with space.md', 'docs/a.md']);
});

test('escaped openers and link-looking inline code remain data rather than references', () => {
  assert.deepEqual(extractMarkdownLinks('\\[escaped](fake.md) `[example](also-fake.md)`'), []);
});

test('unresolved references and unused definitions are not rendered links', () => {
  assert.deepEqual(extractMarkdownLinks('[missing][undefined]\n\n[unused]: docs/not-used.md\n'), []);
});

test('quoted links and links nested in emphasis remain real references', () => {
  assert.deepEqual(extractMarkdownLinks('> [quoted](docs/quote.md)\n\n**[strong](docs/strong.md)**'),
    ['docs/quote.md', 'docs/strong.md']);
});

test('code spans use Markdown delimiter rules, not a single-backtick expression', () => {
  assert.deepEqual(markdownFacts('Use ``docs/a`b.md`` and `docs/c.md`.').inlineCode, ['docs/a`b.md', 'docs/c.md']);
  assert.deepEqual(extractBacktickFilePaths('Use ``docs/a`b.md`` and `docs/c.md`.'), ['docs/a`b.md', 'docs/c.md']);
});

test('frontmatter scalar examples are excluded without taking over YAML value validation', () => {
  const source = '---\ntitle: Fixture\nexample: |\n  # Hidden\n  [fake](docs/fake.md)\n---\n'
    + '# Actual\n[real](docs/real.md)\n';
  assert.deepEqual(extractH1Headings(source), ['Actual']);
  assert.deepEqual(extractMarkdownLinks(source), ['docs/real.md']);
});

test('raw HTML blocks are not reparsed as Markdown examples', () => {
  const source = '<div>\n# Hidden\n[fake](docs/fake.md)\n</div>\n\n# Actual\n';
  assert.deepEqual(extractH1Headings(source), ['Actual']);
  assert.deepEqual(extractMarkdownLinks(source), []);
});

test('file-URI policy still scans raw document text including code examples', () => {
  assert.deepEqual(extractFileLinks('```\nfile:///private/example.md\n```'), ['file:///private/example.md']);
});

test('one exact source shares an immutable projection and edits invalidate it', () => {
  const source = '# Cache identity\n[x](docs/a.md)\n';
  const first = markdownFacts(source);
  assert.equal(markdownFacts(source), first);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.links) && Object.isFrozen(first.headings));
  assert.throws(() => (first.links as string[]).push('injected.md'), TypeError);
  assert.deepEqual(markdownFacts(source.replace('a.md', 'b.md')).links, ['docs/b.md']);
  // Retain one source, not a growing map over the document corpus.
  assert.notEqual(markdownFacts(source), first);
});

test('legacy helper results remain mutable copies without corrupting the shared facts', () => {
  const source = '# Copies\n[x](docs/a.md) `docs/a.ts`';
  const headings = extractH1Headings(source), links = extractMarkdownLinks(source), paths = extractBacktickFilePaths(source);
  headings.push('fake'); links[0] = 'fake'; paths.length = 0;
  assert.deepEqual(extractH1Headings(source), ['Copies']);
  assert.deepEqual(extractMarkdownLinks(source), ['docs/a.md']);
  assert.deepEqual(extractBacktickFilePaths(source), ['docs/a.ts']);
});

test('parsed destinations still pass through the original repository containment policy', () => {
  const root = path.resolve('fixture-repository'), file = path.join(root, 'README.md');
  const [inside, outside] = extractMarkdownLinks('[in](docs/a.md) [out](../outside.md)');
  assert.equal(repositoryPathForLink(root, file, inside!).repositoryPath, 'docs/a.md');
  assert.equal(repositoryPathForLink(root, file, outside!).invalid, 'outside-repository');
});

test('non-string requests fail before invoking the Markdown provider', () => {
  for (const value of [null, undefined, 7, false, { toString() { assert.fail('coercion'); } }]) {
    assert.throws(() => markdownFacts(value as never), TypeError);
  }
});
