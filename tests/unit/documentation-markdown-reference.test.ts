import { describe, expect, test } from 'bun:test';

import {
  extractCanonicalDocumentationReferences,
  markdownFragmentExists,
  markdownFragmentIds,
  splitMarkdownReference
} from '../../src/control/documentation/markdown-reference.ts';

describe('documentation Markdown reference contract', () => {
  test('keeps path and fragment as separate identities', () => {
    expect(splitMarkdownReference('./docs/a.md#section-one')).toEqual({
      path: 'docs/a.md',
      fragment: 'section-one'
    });
    expect(splitMarkdownReference('<docs/a.md?view=full#中文-标题>')).toEqual({
      path: 'docs/a.md',
      fragment: '中文-标题'
    });
  });

  test('derives GitHub-style heading fragments without reading fenced examples as headings', () => {
    const source = `# Root\n\n## Hello, World!\n\n## Hello, World!\n\n## 中文 标题\n\n\`\`\`md\n## Not Real\n\`\`\`\n<div id="explicit-anchor"></div>\n`;
    expect([...markdownFragmentIds(source)].sort()).toEqual([
      'explicit-anchor',
      'hello-world',
      'hello-world-1',
      'root',
      '中文-标题'
    ]);
    expect(markdownFragmentExists(source, 'hello-world-1')).toBe(true);
    expect(markdownFragmentExists(source, 'not-real')).toBe(false);
  });

  test('extracts public canonical locators outside Markdown-link metadata', () => {
    const source = `Owner: \`docs/semantic-model.md\`.\nSee docs/system-architecture.md#架构核.\nREADME.md remains navigation.\n`;
    expect(extractCanonicalDocumentationReferences(source)).toEqual([
      'README.md',
      'docs/semantic-model.md',
      'docs/system-architecture.md#架构核'
    ]);
  });
});
