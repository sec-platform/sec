const MARKDOWN_HEADING = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
const MARKDOWN_FENCE = /^\s{0,3}(`{3,}|~{3,})/u;
const EXPLICIT_HTML_ID = /\bid\s*=\s*["']([^"']+)["']/giu;

export interface MarkdownReferenceParts {
  readonly path: string;
  readonly fragment: string | null;
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function splitMarkdownReference(rawReference: string): MarkdownReferenceParts {
  const unwrapped = rawReference.trim().replace(/^<|>$/gu, '');
  const hash = unwrapped.indexOf('#');
  const beforeFragment = hash < 0 ? unwrapped : unwrapped.slice(0, hash);
  const query = beforeFragment.indexOf('?');
  const referencePath = (query < 0 ? beforeFragment : beforeFragment.slice(0, query))
    .replace(/^\.\/+/u, '');
  return Object.freeze({
    path: referencePath,
    fragment: hash < 0 ? null : decodeFragment(unwrapped.slice(hash + 1))
  });
}

function headingTextForSlug(source: string): string {
  return source
    .replace(/<[^>]*>/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .trim();
}

function baseMarkdownHeadingSlug(source: string): string {
  return headingTextForSlug(source)
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-');
}

export function markdownFragmentIds(source: string): ReadonlySet<string> {
  const ids = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  let fence: { character: '`' | '~'; length: number } | null = null;
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const fenceMatch = MARKDOWN_FENCE.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]!;
      const character = marker[0] as '`' | '~';
      if (fence === null) fence = { character, length: marker.length };
      else if (fence.character === character && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = MARKDOWN_HEADING.exec(line);
    if (heading !== null) {
      const base = baseMarkdownHeadingSlug(heading[2]!);
      if (base.length > 0) {
        const duplicate = duplicateCounts.get(base) ?? 0;
        const id = duplicate === 0 ? base : `${base}-${duplicate}`;
        duplicateCounts.set(base, duplicate + 1);
        ids.add(id);
      }
    }
    for (const match of line.matchAll(EXPLICIT_HTML_ID)) ids.add(match[1]!);
  }
  return ids;
}

export function markdownFragmentExists(source: string, fragment: string | null): boolean {
  if (fragment === null || fragment.length === 0) return true;
  return markdownFragmentIds(source).has(fragment);
}

export function extractCanonicalDocumentationReferences(source: string): readonly string[] {
  const references = new Set<string>();
  const pattern = /(?<![A-Za-z0-9_.\/-])((?:docs\/[A-Za-z0-9._\/-]+\.(?:md|json|ya?ml)|README\.md|AGENTS\.md)(?:#[^\s`)'"<>]+)?)/gu;
  for (const match of source.matchAll(pattern)) references.add(match[1]!);
  return Object.freeze([...references].sort());
}
