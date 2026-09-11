import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  documentationRecordByPath,
  parseDocumentationAuthorityRegistry
} from './authority.ts';
import { extractBacktickFilePaths, extractH1Headings, repositoryPathForInline } from './doctor/shared.ts';

export const PUBLIC_DOCUMENTATION_PROJECTION_SCHEMA =
  'sec-public-documentation-projection-v1' as const;

const logicalPath = z.string()
  .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u)
  .refine((value) => !value.split('/').some((part) => part === '.' || part === '..'));
const uniqueStrings = z.array(z.string().min(1).max(256))
  .min(1)
  .refine((values) => new Set(values).size === values.length);
const manifestSchema = z.object({
  schema: z.literal(PUBLIC_DOCUMENTATION_PROJECTION_SCHEMA),
  locale: z.literal('zh-CN'),
  pages: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
    path: logicalPath.refine((value) => value.startsWith('public-docs/') && value.endsWith('.md')),
    kind: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
    audiences: uniqueStrings,
    canonicalRefs: uniqueStrings
  }).strict()).min(1)
}).strict();

export type PublicDocumentationProjection = Readonly<{
  readonly schema: typeof PUBLIC_DOCUMENTATION_PROJECTION_SCHEMA;
  readonly locale: 'zh-CN';
  readonly pages: readonly Readonly<{
    readonly id: string;
    readonly path: string;
    readonly kind: string;
    readonly audiences: readonly string[];
    readonly canonicalRefs: readonly string[];
    readonly h1Count: number;
    readonly internalMarkdownTargets: readonly string[];
  }>[];
  readonly principleIds: readonly string[];
  readonly brokenLinks: readonly string[];
  readonly unregisteredCanonicalRefs: readonly string[];
  readonly revisionLiterals: readonly string[];
  readonly pullRequestUrls: readonly string[];
}>;

function markdownTargets(source: string): readonly string[] {
  return [...source.matchAll(/\[[^\]]+\]\(([^)#?]+\.md)(?:#[^)]+)?\)/gu)]
    .map((match) => match[1]!);
}

function principleIds(source: string): readonly string[] {
  return [...source.matchAll(/^#{2,3}\s+([MRP]\d{1,2})\s+—/gmu)].map((match) => match[1]!);
}

export async function readPublicDocumentationProjectionV1(
  repositoryRoot: string
): Promise<PublicDocumentationProjection> {
  const root = path.resolve(repositoryRoot);
  const [manifestSource, registrySource] = await Promise.all([
    readFile(path.join(root, 'public-docs/manifest.json'), 'utf8'),
    readFile(path.join(root, 'docs/authority.json'), 'utf8')
  ]);
  const manifest = manifestSchema.parse(JSON.parse(manifestSource) as unknown);
  const registry = parseDocumentationAuthorityRegistry(registrySource);
  const pageIds = manifest.pages.map(({ id }) => id);
  const pagePaths = manifest.pages.map(({ path: pagePath }) => pagePath);
  if (new Set(pageIds).size !== pageIds.length || new Set(pagePaths).size !== pagePaths.length) {
    throw new Error('public documentation manifest contains duplicate page identity');
  }

  const brokenLinks: string[] = [];
  const unregisteredCanonicalRefs: string[] = [];
  const revisionLiterals: string[] = [];
  const pullRequestUrls: string[] = [];
  const pages = await Promise.all(manifest.pages.map(async (page) => {
    const pageAbsolute = path.resolve(root, page.path);
    const publicRoot = path.resolve(root, 'public-docs');
    if (pageAbsolute !== publicRoot && !pageAbsolute.startsWith(`${publicRoot}${path.sep}`)) {
      throw new Error(`public documentation page escapes its root: ${page.path}`);
    }
    const source = await readFile(pageAbsolute, 'utf8');
    const targets = markdownTargets(source);
    for (const target of targets) {
      const resolved = path.resolve(path.dirname(pageAbsolute), target);
      if (!resolved.startsWith(`${publicRoot}${path.sep}`)) {
        brokenLinks.push(`${page.path} -> ${target}`);
        continue;
      }
      try { await readFile(resolved, 'utf8'); } catch { brokenLinks.push(`${page.path} -> ${target}`); }
    }
    const inlineCanonicalRefs = extractBacktickFilePaths(source)
      .map(repositoryPathForInline)
      .filter((reference): reference is string => reference?.startsWith('docs/') === true);
    for (const canonicalRef of new Set([...page.canonicalRefs, ...inlineCanonicalRefs])) {
      if (documentationRecordByPath(registry, canonicalRef) === undefined) {
        unregisteredCanonicalRefs.push(`${page.path} -> ${canonicalRef}`);
      }
    }
    revisionLiterals.push(...source.match(/\b[0-9a-f]{40}\b/gu) ?? []);
    pullRequestUrls.push(...source.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/gu) ?? []);
    return Object.freeze({
      ...page,
      h1Count: extractH1Headings(source).length,
      internalMarkdownTargets: Object.freeze([...targets])
    });
  }));
  const principles = pages.find(({ id }) => id === 'principles');
  const principleSource = principles === undefined
    ? ''
    : await readFile(path.join(root, principles.path), 'utf8');
  const ids = principleIds(principleSource);
  if (new Set(ids).size !== ids.length) throw new Error('public principle projection contains duplicate IDs');
  return Object.freeze({
    schema: PUBLIC_DOCUMENTATION_PROJECTION_SCHEMA,
    locale: manifest.locale,
    pages: Object.freeze(pages),
    principleIds: Object.freeze([...ids]),
    brokenLinks: Object.freeze(brokenLinks.sort()),
    unregisteredCanonicalRefs: Object.freeze(unregisteredCanonicalRefs.sort()),
    revisionLiterals: Object.freeze(revisionLiterals.sort()),
    pullRequestUrls: Object.freeze(pullRequestUrls.sort())
  });
}
