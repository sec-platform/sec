// Isolated excerpts from SEC, not a replacement for its canonical Bun test runner.
// Source: d5af1adb1fba96f274bf0b8e0e041ff70d0f19a7
// src/control/documentation/doctor/shared.ts blob f8ff166b270691332845e77582a3c7cdcdc3ad81
// Types/export keywords removed; formatting compacted without changing helper behavior.
import assert from 'node:assert/strict';
const VALID_STATUS = new Set(['stable', 'active', 'draft', 'historical', 'archive']);
function parseFrontmatter(content, validStatus = VALID_STATUS) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return {ok:false,reason:content.startsWith('---')?'unterminated frontmatter':'missing frontmatter'};
  const value = (name) => {
    const field = match[1].match(new RegExp(`^${name}:\\s*([^\\s#]+)\\s*(?:#.*)?$`, 'mu'));
    return field?.[1]?.replace(/^['"]|['"]$/gu, '');
  };
  const status = value('status');
  if (!status) return {ok:false,reason:'missing status'};
  if (!validStatus.has(status)) return {ok:false,reason:`invalid status "${status}"`};
  return {ok:true,status,domain:value('domain'),generatedFrom:value('generated-from')};
}
function extractH1Headings(content) {
  const headings = [];
  let fence;
  for (const line of content.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]; const character = marker[0];
      if (!fence) fence = {character,length:marker.length};
      else if (fence.character === character && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^#\s+(.+?)\s*$/u);
    if (heading) headings.push(heading[1].trim());
  }
  return headings;
}
function extractMarkdownLinks(content) {
  return [...content.matchAll(/!?\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^)\s\r\n]+)(?:\s+["'][^"']*["'])?\s*\)/gu)].map(match => match[1]);
}
const rows = [
  {id:'DOC-REFERENCE',input:'[guide][g]\n\n[g]: ./guide.md',actual:extractMarkdownLinks('[guide][g]\n\n[g]: ./guide.md'),observation:'Reference links are not returned by this extractor.'},
  {id:'DOC-CODE',input:'```text\n[x](not-a-real-link.md)\n```',actual:extractMarkdownLinks('```text\n[x](not-a-real-link.md)\n```'),observation:'A link-shaped example in a fence is returned.'},
  {id:'DOC-SETEXT',input:'Title\n=====',actual:extractH1Headings('Title\n====='),observation:'Setext H1 is not returned.'},
  {id:'DOC-DUPLICATE',input:'---\nstatus: stable\nstatus: draft\n---\n# T',actual:parseFrontmatter('---\nstatus: stable\nstatus: draft\n---\n# T'),observation:'The first duplicate status is accepted by this helper.'},
  {id:'DOC-CONTROL',input:'# T\n\n[x](./guide.md)',actual:{h1:extractH1Headings('# T\n\n[x](./guide.md)'),links:extractMarkdownLinks('# T\n\n[x](./guide.md)')},observation:'Ordinary ATX and inline link control succeeds.'},
  {id:'DOC-FENCE-CONTROL',input:'```text\n# not-heading\n```\n# T',actual:extractH1Headings('```text\n# not-heading\n```\n# T'),observation:'Existing H1 fenced-code protection is retained.'}
];
assert.deepEqual(rows[0].actual,[]);
assert.deepEqual(rows[1].actual,['not-a-real-link.md']);
assert.deepEqual(rows[2].actual,[]);
assert.equal(rows[3].actual.status,'stable');
assert.equal(rows[3].actual.ok,true);
assert.deepEqual(rows[4].actual,{h1:['T'],links:['./guide.md']});
assert.deepEqual(rows[5].actual,['T']);
console.log(JSON.stringify({
  schemaVersion:1,runtime:process.version,sourceCommit:'d5af1adb1fba96f274bf0b8e0e041ff70d0f19a7',
  sourceBlob:'f8ff166b270691332845e77582a3c7cdcdc3ad81',mode:'isolated-excerpts',
  scope:'Describes helper semantics, not whole-docs-doctor acceptance, a security exploit, candidate-library parity or Bun verification. Explicitly restricted Markdown profiles may deliberately reject some syntax; caller/profile policy still needs conformance.',
  results:rows
},null,2));
