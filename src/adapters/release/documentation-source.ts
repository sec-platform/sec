import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rawSha256Hex, sha256 } from '../../contracts/canonical.ts';
import {
  DOCUMENTATION_AUTHORED_METADATA,
  DOCUMENTATION_BASELINE,
  DOCUMENTATION_FIGURES, DOCUMENTATION_LIMITS,
  DOCUMENTATION_NON_SOURCE,
  DOCUMENTATION_REQUIREMENTS,
  DOCUMENTATION_SOURCE_MANIFEST,
  compareDocumentationPaths, decodeDocumentationJson, documentationIsNonSource,
  documentationPath, documentationPathWithin, documentationSourceDigest, parseDocumentationBoundary,
  parseDocumentationSourceContract, type DocumentationBoundary, type DocumentationSourceContract
} from '../../contracts/documentation-source.ts';
import { portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import { settleResourcesAsync, withAcquiredResource } from '../../execution/resource-settlement.ts';
import {
  createNoFollowOrdinaryDirectoryChain,
  inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';

// A source-only observation skips cache bytes. A delivery explicitly elects and binds them.
// These checks assume the frozen/quiet tree owned by the caller; lstat is not an adversarial OS snapshot.
async function ordinaryPath(root: string, relative: string): Promise<string> {
  if (!documentationPath(relative)) throw new Error(`Unsafe documentation path: ${relative}`);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const s = await fs.lstat(current);
    if (s.isSymbolicLink()) throw new Error(`Linked documentation member: ${relative}`);
  }
  return current;
}
async function checkedRoot(root: string): Promise<string> {
  root = path.resolve(root);
  for (let current = root; ; current = path.dirname(current)) {
    const s = await fs.lstat(current);
    if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Documentation root/ancestor is not an ordinary directory');
    if (path.dirname(current) === current) break;
  }
  return root;
}
function signature(s: Awaited<ReturnType<typeof fs.lstat>>): string {
  return [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(':');
}
async function readOrdinary(root: string, relative: string): Promise<Buffer> {
  const file = await ordinaryPath(root, relative);
  // Bind type and size to the opened object, not a pathname checked before open.
  // Nonblocking open prevents a substituted FIFO from waiting for a writer on
  // hosts that support this flag. This does not fence hostile ancestor changes.
  const handle = await fs.open(file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let primary: { error: unknown } | undefined;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !Number.isSafeInteger(opened.size) || opened.size < 0
        || opened.size > DOCUMENTATION_LIMITS.fileBytes) {
      throw new Error(`Invalid documentation file: ${relative}`);
    }
    // Recheck the locator before reading, including on hosts without O_NOFOLLOW.
    const capturedPath = await fs.lstat(await ordinaryPath(root, relative));
    if (signature(capturedPath) !== signature(opened)) throw new Error(`Documentation input changed before capture: ${relative}`);
    const data = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < data.length) {
      const r = await handle.read(data, offset, data.length - offset, offset);
      if (r.bytesRead === 0) throw new Error(`Short documentation read: ${relative}`);
      offset += r.bytesRead;
    }
    const after = await handle.stat();
    const current = await fs.lstat(await ordinaryPath(root, relative));
    if (signature(opened) !== signature(after) || signature(after) !== signature(current)) {
      throw new Error(`Documentation input changed during capture: ${relative}`);
    }
    return data;
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    await settleResourcesAsync({
      ...(primary === undefined ? {} : { primary: { label: 'documentation file capture', error: primary.error } }),
      cleanup: [{ label: 'documentation file descriptor', settle: () => handle.close() }]
    });
  }
}
async function optionalBytes(root: string, relative: string): Promise<Buffer | null> {
  // Only the registered output's own absence is optional, never a missing source ancestor.
  const parent = relative.slice(0, relative.lastIndexOf('/'));
  await ordinaryPath(root, parent);
  try { await fs.lstat(path.join(root, relative)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // ENOENT also describes a missing ancestor; only leaf absence is optional.
    await ordinaryPath(root, parent);
    return null;
  }
  return readOrdinary(root, relative);
}
/** Consume a bounded native directory stream; body and close failures retain
 * the existing resource owner's settlement semantics. Never materialize an
 * unbounded readdir array merely to inspect or reject a directory. */
async function visitDirectory(absolute: string, consume: (name: string) => void): Promise<void> {
  await withAcquiredResource({
    operationLabel: 'documentation directory traversal',
    resourceLabel: 'documentation directory handle',
    acquire: () => fs.opendir(absolute),
    use: async directory => {
      for (;;) {
        const entry = await directory.read();
        if (entry === null) return;
        consume(entry.name);
      }
    },
    release: directory => directory.close()
  });
}
async function enumerateSource(root: string, boundary: DocumentationBoundary): Promise<readonly string[]> {
  const files: string[] = [];
  const pending = [...boundary.sourceRoots];
  const names = new Set<string>();
  let visited = 0;
  while (pending.length) {
    if (++visited > DOCUMENTATION_LIMITS.members) throw new Error('Documentation traversal budget exceeded');
    const relative = pending.pop()!;
    if (documentationIsNonSource(relative)) continue;
    const absolute = await ordinaryPath(root, relative);
    const metadata = await fs.lstat(absolute);
    if (metadata.isDirectory()) {
      await visitDirectory(absolute, name => {
        if (visited + pending.length >= DOCUMENTATION_LIMITS.members) {
          throw new Error('Documentation traversal budget exceeded');
        }
        pending.push(`${relative}/${name}`);
      });
    } else if (metadata.isFile()) {
      if (relative.startsWith('.documentation/') && !(DOCUMENTATION_AUTHORED_METADATA as readonly string[]).includes(relative)) {
        throw new Error(`Unknown documentation metadata role: ${relative}`);
      }
      const key = portableLogicalPathCollisionKey(relative);
      if (names.has(key)) throw new Error(`Documentation path collision: ${relative}`);
      names.add(key); files.push(relative);
    } else throw new Error(`Non-ordinary documentation source: ${relative}`);
  }
  const members = new Set(files);
  const audit = [...boundary.auditedNamespaces];
  while (audit.length) {
    if (++visited > DOCUMENTATION_LIMITS.members * 2) throw new Error('Documentation namespace audit budget exceeded');
    const relative = audit.pop()!;
    if (documentationIsNonSource(relative) || boundary.nonDocumentationRoots.some(exemption => documentationPathWithin(relative, exemption))) continue;
    const absolute = await ordinaryPath(root, relative);
    const metadata = await fs.lstat(absolute);
    if (metadata.isDirectory()) await visitDirectory(absolute, name => {
      if (visited + audit.length >= DOCUMENTATION_LIMITS.members * 2) {
        throw new Error('Documentation namespace audit budget exceeded');
      }
      audit.push(`${relative}/${name}`);
    });
    else if (!metadata.isFile() || !members.has(relative)) throw new Error(`Undeclared documentation namespace member: ${relative}`);
  }
  return Object.freeze(files.sort(compareDocumentationPaths));
}

function sourceManifestBytes(contract: DocumentationSourceContract): Buffer {
  return Buffer.from(`${JSON.stringify({
    schema: 'sec.documentation-source-manifest/2',
    source_set_sha256: contract.sourceSetSha256,
    members: contract.members
  }, null, 2)}\n`, 'utf8');
}

/** Capture the authoritative documentation source directly from the declared
 * baseline and ordinary source bytes. Generated projections are deliberately
 * not inputs: release/source identity must remain reproducible after those
 * projections are removed from Git or are absent from a clean checkout. */
export async function captureDocumentationSource(root: string): Promise<DocumentationSourceContract> {
  root = await checkedRoot(root);
  const baselineBytes = await readOrdinary(root, DOCUMENTATION_BASELINE);
  const boundary = parseDocumentationBoundary(baselineBytes);
  const names = await enumerateSource(root, boundary);
  const members = [] as { path: string; bytes: number; sha256: string }[];
  let totalBytes = 0;
  for (const relative of names) {
    const bytes = await readOrdinary(root, relative);
    totalBytes += bytes.byteLength;
    if (totalBytes > DOCUMENTATION_LIMITS.totalBytes) {
      throw new Error('Documentation source byte budget exceeded');
    }
    members.push({ path: relative, bytes: bytes.byteLength, sha256: rawSha256Hex(bytes) });
  }
  const material = Object.freeze({
    boundary,
    sourceSetSha256: documentationSourceDigest(members),
    entrypoint: boundary.entrypoint,
    members: Object.freeze(members.map(member => Object.freeze(member)))
  });
  const contract = parseDocumentationSourceContract(baselineBytes, sourceManifestBytes(material));

  if (!baselineBytes.equals(await readOrdinary(root, DOCUMENTATION_BASELINE))
      || JSON.stringify(names) !== JSON.stringify(await enumerateSource(root, boundary))) {
    throw new Error('Documentation source changed across capture');
  }
  for (const member of contract.members) {
    const bytes = await readOrdinary(root, member.path);
    if (bytes.byteLength !== member.bytes || rawSha256Hex(bytes) !== member.sha256) {
      throw new Error(`Documentation source changed across capture: ${member.path}`);
    }
  }
  return contract;
}

export async function readDocumentationSource(root: string): Promise<DocumentationSourceContract> {
  root = await checkedRoot(root);
  const manifestBytes = await readOrdinary(root, DOCUMENTATION_SOURCE_MANIFEST);
  const baselineBytes = await readOrdinary(root, DOCUMENTATION_BASELINE);
  const sealed = parseDocumentationSourceContract(baselineBytes, manifestBytes);
  const captured = await captureDocumentationSource(root);
  if (JSON.stringify(sealed.members.map(member => member.path))
      !== JSON.stringify(captured.members.map(member => member.path))) {
    throw new Error('Source manifest hides, adds or reorders authoritative files');
  }
  for (let index = 0; index < sealed.members.length; index++) {
    const expected = sealed.members[index]!, actual = captured.members[index]!;
    if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      throw new Error(`Documentation source member differs from its manifest: ${expected.path}`);
    }
  }
  if (sealed.sourceSetSha256 !== captured.sourceSetSha256) {
    throw new Error('Source manifest differs from the authoritative documentation source');
  }
  if (!manifestBytes.equals(await readOrdinary(root, DOCUMENTATION_SOURCE_MANIFEST))) {
    throw new Error('Documentation source manifest changed across capture');
  }
  return sealed;
}

const REQUIREMENT_SOURCE = 'docs/产品/产品要求与工作约束.md';
// Match Python str.strip (including its additional C0 whitespace), without locale formatting.
function strip(text: string): string {
  return text.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
}
function projectDocumentationRequirements(bytes: Uint8Array): unknown {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const headings: { id: string; title: string; offset: number }[] = [];
  const anchors = new Map<string, number[]>();
  let fence: { marker: string; length: number } | undefined;
  let comment = false;
  let offset = 0;
  for (const original of source.split('\n')) {
    let line = original;
    if (fence !== undefined) {
      const closing = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (closing && closing[1]![0] === fence.marker && closing[1]!.length >= fence.length && closing[2]!.trim() === '') fence = undefined;
      offset += original.length + 1;
      continue;
    }
    if (comment) {
      const end = line.indexOf('-->');
      if (end === -1) { offset += original.length + 1; continue; }
      line = line.slice(end + 3); comment = false;
    }
    while (line.includes('<!--')) {
      const start = line.indexOf('<!--'), end = line.indexOf('-->', start + 4);
      if (end === -1) { line = line.slice(0, start); comment = true; break; }
      line = line.slice(0, start) + line.slice(end + 3);
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker) fence = { marker: marker[1]![0]!, length: marker[1]!.length };
    else {
      for (const anchor of line.replace(/(`+).*?\1/gu, '').matchAll(/<[A-Za-z][^>]*?\bid\s*=\s*(["'])((?:req)\d{3})\1[^>]*>/gu)) {
        anchors.set(anchor[2]!, [...(anchors.get(anchor[2]!) ?? []), offset]);
      }
      const match = original.startsWith('### ') && line.startsWith('### ') ? /^### (REQ\d{3})([^\n]*)/u.exec(original) : null;
      if (match) headings.push({ id: match[1]!, title: `${match[1]}${match[2]}`, offset });
    }
    offset += original.length + 1;
  }
  if (fence || headings.length === 0 || new Set(headings.map(h => h.id)).size !== headings.length) {
    throw new Error('Requirement source has an unclosed fence or ambiguous identities');
  }
  return { schema: 'sec.docs-requirement-bindings/1', scope: '当前位置和内容校验，不是全部已审证明',
    items: headings.map((heading, index) => {
      const stable = anchors.get(heading.id.toLowerCase()) ?? [];
      let fragment: string;
      if (stable.length === 1 && stable[0]! < heading.offset && stable[0]! > (headings[index - 1]?.offset ?? -1)) {
        fragment = heading.id.toLowerCase();
      } else {
        const title = heading.title.replace(/[ \t]+#+[ \t]*$/u, '').trim();
        if (/[<>`&\[\]*~\\]/u.test(title)) throw new Error('Rich requirement heading needs its stable explicit identity anchor');
        fragment = title.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/gu, '-');
      }
      return { id: heading.id, path: REQUIREMENT_SOURCE, fragment,
        body_sha256: rawSha256Hex(strip(source.slice(heading.offset, headings[index + 1]?.offset))) };
    }) };
}
async function deriveRequirementProjection(root: string, contract: DocumentationSourceContract): Promise<Buffer | null> {
  if (!contract.members.some(member => member.path === REQUIREMENT_SOURCE)) {
    return null;
  }
  const expected = projectDocumentationRequirements(await readOrdinary(root, REQUIREMENT_SOURCE));
  return Buffer.from(`${JSON.stringify(expected, null, 2)}\n`, 'utf8');
}

async function validateRequirementProjection(root: string, contract: DocumentationSourceContract): Promise<Buffer | null> {
  const existing = await optionalBytes(root, DOCUMENTATION_REQUIREMENTS);
  const expected = await deriveRequirementProjection(root, contract);
  if (expected === null) {
    if (existing !== null) throw new Error('Requirement projection has no source authority in this documentation package');
    return null;
  }
  if (existing === null) throw new Error('Documentation package is missing its derived requirement projection');
  const parsedExpected = decodeDocumentationJson(expected, 'Expected requirement projection');
  if (sha256(decodeDocumentationJson(existing, 'Requirement projection')) !== sha256(parsedExpected)) {
    throw new Error('Requirement projection is stale or malformed');
  }
  return expected;
}

export async function materializeDocumentationPackage(sourceRoot: string, targetRoot: string): Promise<DocumentationSourceContract> {
  sourceRoot = await checkedRoot(sourceRoot);
  targetRoot = await checkedRoot(targetRoot);  // Caller supplies its own empty staging directory.
  const targetIdentity = inspectNoFollowDirectoryChain(
    path.resolve(targetRoot),
    'Documentation staging root'
  ).target;
  if (scanNoFollowDirectoryDirectMetadata(targetIdentity, {
    deadlineAtMs: Number.POSITIVE_INFINITY,
    maximumEntries: DOCUMENTATION_LIMITS.members
  }).length !== 0) {
    throw new Error('Documentation staging root must be empty');
  }
  const contract = await captureDocumentationSource(sourceRoot);
  const outputs = new Map<string, Buffer>();
  outputs.set(DOCUMENTATION_SOURCE_MANIFEST, sourceManifestBytes(contract));
  const requirements = await deriveRequirementProjection(sourceRoot, contract);
  if (requirements !== null) outputs.set(DOCUMENTATION_REQUIREMENTS, requirements);
  const figures = await optionalBytes(sourceRoot, DOCUMENTATION_FIGURES);
  if (figures !== null) outputs.set(DOCUMENTATION_FIGURES, figures);

  const ensureParent = (name: string): PhysicalDirectoryIdentity => {
    if (!documentationPath(name)) throw new Error(`Unsafe documentation output path: ${name}`);
    const segments = name.split('/').slice(0, -1);
    return segments.length === 0
      ? targetIdentity
      : createNoFollowOrdinaryDirectoryChain(
          targetIdentity,
          segments,
          undefined,
          0o755
        );
  };
  const write = async (name: string, bytes: Uint8Array): Promise<void> => {
    const parent = ensureParent(name);
    const leaf = name.split('/').at(-1)!;
    const expected = Buffer.from(bytes);
    const receipt = publishExclusiveDurableCanonicalFile({
      parent,
      name: leaf,
      bytes: expected,
      validate: (current) => {
        if (!Buffer.from(current).equals(expected)) {
          throw new Error(`Documentation output readback differs: ${name}`);
        }
      }
    });
    if (!receipt.created) {
      throw new Error(`Documentation output path already exists: ${name}`);
    }
  };

  for (const member of contract.members) {
    const bytes = await readOrdinary(sourceRoot, member.path);
    if (bytes.byteLength !== member.bytes || rawSha256Hex(bytes) !== member.sha256) throw new Error(`Source drift: ${member.path}`);
    await write(member.path, bytes);
  }
  for (const root of contract.boundary.sourceRoots) {
    if (!contract.members.some(member => member.path === root)) {
      if (!documentationPath(root)) throw new Error(`Unsafe documentation source root: ${root}`);
      createNoFollowOrdinaryDirectoryChain(
        targetIdentity,
        root.split('/'),
        undefined,
        0o755
      );
    }
  }
  for (const [name, bytes] of outputs) await write(name, bytes);
  const target = await readDocumentationSource(targetRoot);
  const finalSource = await captureDocumentationSource(sourceRoot);
  if (target.sourceSetSha256 !== contract.sourceSetSha256 || finalSource.sourceSetSha256 !== contract.sourceSetSha256) {
    throw new Error('Documentation source identity changed across materialization');
  }
  return contract;
}

export async function assertDocumentationSourceReadback(
  root: string, expectedSourceDigest: string, packageFiles: readonly { readonly path: string }[]
): Promise<void> {
  const contract = await readDocumentationSource(root);
  if (`sha256:${contract.sourceSetSha256}` !== expectedSourceDigest) throw new Error('Documentation package has a different source identity');
  await validateRequirementProjection(root, contract);
  const allowed = new Set([...contract.members.map(member => member.path), ...DOCUMENTATION_NON_SOURCE]);
  for (const file of packageFiles) if (!allowed.has(file.path)) throw new Error(`Undeclared delivery member: ${file.path}`);
  // Cache is an opaque, byte-bound attachment here; renderer trust and SVG validation belong to reading.
  await optionalBytes(root, DOCUMENTATION_FIGURES);
}
