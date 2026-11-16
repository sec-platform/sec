import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';

export const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

export function sourceInput(sources: Readonly<Record<string, string>>) {
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  return Object.freeze({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
}

