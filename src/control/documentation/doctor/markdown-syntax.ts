import { createRequire } from 'node:module';

/** Only the mdast fields consumed by the doctor. This is a provider projection,
 * not a second Markdown grammar or a document-authority schema. */
type MarkdownNode = {
  readonly type: string;
  readonly children?: readonly MarkdownNode[];
  readonly depth?: number;
  readonly value?: string;
  readonly url?: string;
  readonly identifier?: string;
};

export interface MarkdownFacts {
  readonly headings: readonly string[];
  readonly links: readonly string[];
  readonly inlineCode: readonly string[];
}

const require = createRequire(import.meta.url);
let previous: Readonly<{ source: string; facts: MarkdownFacts }> | undefined;

/** Use the already-declared Prettier Markdown plugin's public parser export.
 * Do not load Prettier config, run a formatter, discover plugins or render HTML.
 * Loading is deferred so consumers of unrelated doctor helpers do not acquire
 * the Markdown dependency at module initialization.
 *
 * The synchronous helper contract requires a synchronous mdast root. An
 * incompatible provider fails visibly; it never falls back to regex parsing.
 * The one-entry cache retains only the last source and scalar projections, not
 * an AST or every document scanned. Exact source equality is the cache key;
 * a failed parse never publishes a partial or stale projection.
 */
export function markdownFacts(source: string): MarkdownFacts {
  if (typeof source !== 'string') throw new TypeError('Markdown source must be a string');
  if (previous?.source === source) return previous.facts;
  const { parsers } = require('prettier/plugins/markdown') as typeof import('prettier/plugins/markdown');
  const parser = parsers.markdown;
  // The built-in Markdown parser consumes text only. Its documented parse
  // callback is invoked directly; formatter options and printers are not used.
  const parsed: unknown = Reflect.apply(parser.parse, parser, [source]);
  if (parsed === null || typeof parsed !== 'object' || !('type' in parsed)
      || parsed.type !== 'root' || !('children' in parsed) || !Array.isArray(parsed.children)) {
    throw new TypeError('Markdown provider must return a synchronous mdast root');
  }
  const root = parsed as MarkdownNode;
  const headings: string[] = [];
  // Preserve the doctor's nonempty, top-level document-title policy. Quotations
  // and list examples are not document titles. Use provider locations rather
  // than reinterpreting ATX/Setext delimiters, escapes or closing hash markers.
  for (const node of root.children!) {
    if (node.type !== 'heading' || node.depth !== 1 || !node.children?.length) continue;
    const start = parser.locStart(node.children[0]);
    const end = parser.locEnd(node.children[node.children.length - 1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || end > source.length) {
      throw new TypeError('Markdown heading has invalid source offsets');
    }
    const title = source.slice(start, end).trim();
    if (title.length > 0) headings.push(title);
  }

  const definitions = new Map<string, string>();
  const references: MarkdownNode[] = [];
  const inlineCode: string[] = [];
  const pending: MarkdownNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'definition') {
      if (typeof node.identifier !== 'string' || typeof node.url !== 'string') {
        throw new TypeError('Markdown definition is missing its identity or destination');
      }
      // mdast already owns reference-label normalization. CommonMark selects
      // the first definition; do not introduce a second case/whitespace codec.
      if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    } else if (node.type === 'link' || node.type === 'image'
        || node.type === 'linkReference' || node.type === 'imageReference') {
      references.push(node);
    } else if (node.type === 'inlineCode') {
      if (typeof node.value !== 'string') throw new TypeError('Markdown code span is missing its value');
      inlineCode.push(node.value);
    }
    // Code blocks, HTML and frontmatter are leaves, not Markdown to reparse.
    // An iterative walk avoids adding another recursion limit to the provider.
    const children = node.children;
    if (children !== undefined) {
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
    }
  }
  const links: string[] = [];
  for (const reference of references) {
    if (reference.type === 'link' || reference.type === 'image') {
      if (typeof reference.url !== 'string') throw new TypeError('Markdown link is missing its destination');
      links.push(reference.url);
    } else {
      if (typeof reference.identifier !== 'string') throw new TypeError('Markdown reference is missing its identity');
      const destination = definitions.get(reference.identifier);
      if (destination === undefined) throw new TypeError('Markdown provider emitted an unresolved reference');
      links.push(destination);
    }
  }
  const facts: MarkdownFacts = Object.freeze({
    headings: Object.freeze(headings), links: Object.freeze(links), inlineCode: Object.freeze(inlineCode)
  });
  previous = Object.freeze({ source, facts });
  return facts;
}
