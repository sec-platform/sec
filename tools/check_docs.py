#!/usr/bin/env python3
"""Verify this frozen documentation package using the Python standard library.
Read-only: no network, subprocess, writes, SEC execution or permission changes.
An edited working tree is allowed to exist; it correctly fails the old snapshot.
This detects drift and a finite known-regression list, not signatures or all semantics.
"""
from __future__ import annotations
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, re, sys
sys.dont_write_bytecode = True
import collections, html
from source_inventory import load, local_path, source_files

def plain_heading(text: str) -> str:
    # Only presentation markup is removed; no Unicode normalization/case-fold
    # is performed beyond the existing bundle's lowercase heading convention.
    text = re.sub(r'!?(\[([^\]]*)\])\([^\n]*?\)', lambda m: m[2], text)
    text = re.sub(r'\[([^\]]+)\]\[[^\]]*\]', lambda m: m[1], text)
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'\\([\\`*_{}\[\]()#+.!<>~-])', r'\1', text)
    text = text.replace('`', '').replace('*', '').replace('~', '')
    return html.unescape(text)

def anchor_locations(text: str) -> dict[str, list[int]]:
    """Map fragment to all observed 1-based lines (ambiguity is preserved)."""
    found: dict[str, list[int]] = collections.defaultdict(list)
    counts: collections.Counter = collections.Counter()
    fence = None
    comment = False
    for line_number, original in enumerate(text.splitlines(), 1):
        line = original
        # A comment-looking string inside a fenced example is only data.
        if fence:
            closing = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
            if closing and closing[1][0] == fence[0] and len(closing[1]) >= fence[1] and not closing[2].strip():
                fence = None
            continue
        if comment:
            if '-->' not in line:
                continue
            line = line.split('-->', 1)[1]; comment = False
        while '<!--' in line:
            before, tail = line.split('<!--', 1)
            if '-->' in tail:
                line = before + tail.split('-->', 1)[1]
            else:
                line = before; comment = True; break
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if marker:
            fence = (marker[1][0], len(marker[1])); continue
        h = re.match(r'^ {0,3}(#{1,6})[ \t]+(.+?)\s*$', line)
        if h:
            title = re.sub(r'[ \t]+#+[ \t]*$', '', h[2])
            slug = re.sub(r'[^\w\s-]', '', plain_heading(title).lower())
            slug = re.sub(r'\s', '-', slug)
            n = counts[slug]; counts[slug] += 1
            fragment = slug + (f'-{n}' if n else '')
            found[fragment].append(line_number)
        # Code examples are not real HTML anchors.
        without_code = re.sub(r'(`+).*?\1', '', line)
        for m in re.finditer(r'<[A-Za-z][^>]*?\bid\s*=\s*([\"\x27])([^\"\x27]+)\1[^>]*>', without_code):
            found[html.unescape(m[2])].append(line_number)
    if fence:
        raise ValueError('unclosed fenced code block in documentation')
    return dict(found)


EXCLUDED = {'.documentation/baseline.json', '.documentation/source-manifest.json'}
def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
def verify(root: Path) -> dict:
    root = root.resolve()
    errors = []
    def local(name: str) -> Path:
        return local_path(root, name)
    manifest = load(local('.documentation/source-manifest.json'))
    baseline = load(local('.documentation/baseline.json'))
    entries = manifest['members']
    if [x['path'] for x in entries] != sorted(x['path'] for x in entries):
        errors.append('manifest order differs from the declared canonical order')
    names = set()
    for x in entries:
        name = x['path']
        if name in names or name in EXCLUDED:
            errors.append('duplicate or excluded manifest member: ' + name)
        names.add(name)
        p = local(name)
        if not p.is_file(): errors.append('missing: ' + name)
        elif p.stat().st_size != x['bytes'] or digest(p.read_bytes()) != x['sha256']:
            errors.append('changed: ' + name)
    files = source_files(root)
    actual = {p.relative_to(root).as_posix() for p in files}
    if names - actual: errors.append('manifest members outside source roots: ' + repr(sorted(names - actual)))
    if actual - names - EXCLUDED: errors.append('extra files: ' + repr(sorted(actual - names - EXCLUDED)))
    current = digest(canonical(entries))
    if current != manifest['source_set_sha256'] or current != baseline['source_set_sha256']:
        errors.append('baseline or source manifest is stale')
    if set(baseline['excluded_from_source_hash']) != EXCLUDED:
        errors.append('unexpected excluded source domain')
    docs = load(local('.documentation/documents.json'))['documents']
    ids = [x['document_id'] for x in docs]; paths = [x['path'] for x in docs]
    if len(set(ids)) != len(ids) or len(set(paths)) != len(paths): errors.append('duplicate document identity or path')
    for x in docs:
        if not local(x['path']).is_file(): errors.append('document missing: ' + x['path'])
    requirements = load(local('.documentation/requirements.json'))['items']
    if {x['id'] for x in requirements} != {f'REQ{i:03d}' for i in range(1, 52)} or len(requirements) != 51:
        errors.append('requirement identity set changed')
    for x in requirements:
        text = local(x['path']).read_text(encoding='utf-8')
        matches = list(re.finditer(r'^### (REQ\d{3})[^\n]*', text, re.M))
        positions = [i for i, m in enumerate(matches) if m[1] == x['id']]
        if len(positions) != 1:
            errors.append('ambiguous requirement: ' + x['id']); continue
        i = positions[0]
        body = text[matches[i].start():matches[i+1].start() if i+1 < len(matches) else len(text)].strip()
        if digest(body.encode('utf-8')) != x['body_sha256']: errors.append('stale requirement reference: ' + x['id'])
    for x in load(local('.documentation/known-regressions.json'))['checks']:
        exists = x['text'] in local(x['path']).read_text(encoding='utf-8')
        if (x['mode'] == 'must_contain' and not exists) or (x['mode'] == 'must_not_contain' and exists):
            errors.append('known route regression: ' + x['id'])
    # Example material locks are design inputs, never executable plugins.
    # Resolve every actual example lock independently; no automatic install or network.
    def inside(p: Path) -> bool:
        return p.is_relative_to(root) and p.is_file()
    material_projects = 0
    for lock_path in sorted(local('examples').rglob('sec.lock.json')):
        sample = lock_path.parent
        material_projects += 1
        lock = load(lock_path)
        for key, node in lock['nodes'].items():
            p = (sample / node['locations'][0]).resolve()
            if not inside(p): errors.append('material missing/outside: ' + str(lock_path.relative_to(root)) + ':' + key)
            elif digest(p.read_bytes()) != node['content']['digest'] or p.stat().st_size != node['content']['byteLength']:
                errors.append('stale material: ' + str(lock_path.relative_to(root)) + ':' + key)
        for p in sorted((sample/'contracts').glob('*.json')):
            def walk(value):
                if isinstance(value, dict):
                    if 'source' in value and 'sha256' in value:
                        q = (p.parent/value['source']).resolve()
                        if not inside(q) or digest(q.read_bytes()) != value['sha256']:
                            errors.append('stale catalog source: ' + str(p.relative_to(root)))
                    for v in value.values(): walk(v)
                elif isinstance(value, list):
                    for v in value: walk(v)
            walk(load(p))
    # Check only the current text. There is no historical path resolver.
    anchors = {}
    for p in (p for p in files if p.suffix == '.md'):
        name = p.relative_to(root).as_posix()
        try:
            anchors[name] = anchor_locations(p.read_text(encoding='utf-8'))
            for fragment, lines in anchors[name].items():
                if len(lines) != 1:
                    errors.append(f'ambiguous current anchor: {name}#{fragment}')
        except ValueError as exc:
            errors.append(f'{name}: {exc}')
    for x in requirements:
        if x.get('fragment') not in anchors.get(x['path'], {}):
            errors.append('requirement anchor missing: ' + x['id'])
    # Declared current architecture and U decisions are checked at the actual package gate.
    # This is not a proof of arbitrary prose or an implementation's imports.
    design = {}
    try:
        import check_design
        d = check_design.review(root)
        design = {'declared_modules': d['modules'], 'declared_static_edges': d['static_edges'],
                  'decisions_with_adoption_and_enforcement': len(d['decisions']), 'diagram_sources': len(d['mermaid_sources']),
                  'concrete_deliverables_with_author_semantics_and_target_contract': d['deliverables']['count']}
    except (OSError, ValueError) as exc:
        errors.append('design joins: ' + str(exc))
    if errors: raise ValueError('\n'.join(errors))
    return {**design, 'source_set_sha256':current,'verified_source_members':len(entries),'document_ids':len(docs),'requirements':len(requirements),
            'current_markdown_files':len(anchors),'example_material_projects':material_projects,
            'scope':'Current frozen bytes, exact materials, identities, requirement references, anchors and finite known regressions. No historical navigation. Not a signature or product/semantic validation.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.root), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError, IndexError, RecursionError) as exc:
        print('FAIL: '+str(exc), file=sys.stderr)
        sys.exit(1)
