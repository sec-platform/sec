#!/usr/bin/env python3
"""Verify current documentation source using the Python standard library.
Read-only: no network, subprocess, writes, SEC execution or permission changes.
Ordinary edits consume source only; explicitly sealed packages also verify projections.
This detects drift and a finite known-regression list, not signatures or all semantics.
"""
from __future__ import annotations
from pathlib import Path
import argparse, json, re, sys
sys.dont_write_bytecode = True
import collections, html
from source_inventory import (load, decode, local_path, capture_source_bytes, source_bytes,
    source_manifest_from_capture, assert_source_capture_current, EXCLUDED_FROM_SOURCE_HASH,
    requirement_projection, MANIFEST_PATH, REQUIREMENTS_PATH, baseline)

def plain_heading(text: str) -> str:
    # Only presentation markup is removed; no Unicode normalization/case-fold
    # is performed beyond the existing bundle's lowercase heading convention.
    text = re.sub(r'!?(\[([^\]]*)\])\([^\n]*?\)', lambda m: m[2], text)
    text = re.sub(r'\[([^\]]+)\]\[[^\]]*\]', lambda m: m[1], text)
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'\\([\\`*_{}\[\]()#+.!<>~-])', r'\1', text)
    text = text.replace('`', '').replace('*', '').replace('~', '')
    return html.unescape(text)

def markdown_visible_lines(text: str):
    """Yield line-preserving text outside fenced examples and HTML comments."""
    fence = None
    comment = False
    for line_number, original in enumerate(text.splitlines(), 1):
        line = original
        # A comment-looking string inside a fenced example is only data.
        if fence:
            closing = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
            if closing and closing[1][0] == fence[0] and len(closing[1]) >= fence[1] and not closing[2].strip():
                fence = None
            yield line_number, ''
            continue
        if comment:
            if '-->' not in line:
                yield line_number, ''
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
            fence = (marker[1][0], len(marker[1]))
            yield line_number, ''
            continue
        yield line_number, line
    if fence:
        raise ValueError('unclosed fenced code block in documentation')


def heading_anchor_locations(headings) -> dict[str, list[int]]:
    found: dict[str, list[int]] = collections.defaultdict(list)
    counts: collections.Counter = collections.Counter()
    for line_number,title in headings:
        slug = re.sub(r'[^\w\s-]', '', plain_heading(title).lower())
        slug = re.sub(r'\s', '-', slug)
        n = counts[slug]; counts[slug] += 1
        fragment = slug + (f'-{n}' if n else '')
        found[fragment].append(line_number)
    return dict(found)


def anchor_locations(text: str, *, headings=None) -> dict[str, list[int]]:
    """Map fragments to lines; a renderer may supply its parsed (line, title) headings.

    The standalone standard-library check keeps its finite ATX source profile.
    Parser-backed readers supply actual CommonMark heading boundaries/content,
    including setext and empty headings, but share slug and duplicate rules here.
    """
    found: dict[str, list[int]] = collections.defaultdict(list)
    parsed_headings=[] if headings is None else list(headings)
    for line_number, line in markdown_visible_lines(text):
        h = re.match(r'^ {0,3}(#{1,6})[ \t]+(.+?)\s*$', line)
        if h and headings is None:
            title = re.sub(r'[ \t]+#+[ \t]*$', '', h[2])
            parsed_headings.append((line_number,title))
        # Code examples are not real HTML anchors.
        without_code = re.sub(r'(`+).*?\1', '', line)
        for m in re.finditer(r'<[A-Za-z][^>]*?\bid\s*=\s*([\"\x27])([^\"\x27]+)\1[^>]*>', without_code):
            found[html.unescape(m[2])].append(line_number)
    for fragment,locations in heading_anchor_locations(parsed_headings).items():
        found[fragment].extend(locations)
    return {fragment:sorted(locations) for fragment,locations in found.items()}


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
def checked_identity_registry(value, source_paths, audited_namespaces):
    if (not isinstance(value, dict) or set(value) != {'schema', 'scope', 'documents'}
            or value['schema'] != 'sec.documentation-identity/1'
            or not isinstance(value['scope'], str) or not value['scope']
            or not isinstance(value['documents'], list) or not value['documents']):
        raise ValueError('invalid documentation identity registry')
    ids, paths = set(), set()
    for item in value['documents']:
        if not isinstance(item, dict) or set(item) != {'document_id', 'path'}:
            raise ValueError('document identity fields must be exact')
        identity, name = item['document_id'], item['path']
        if (not isinstance(identity, str) or not re.fullmatch(
                r'urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', identity)
                or not isinstance(name, str) or not name.endswith('.md') or name not in source_paths):
            raise ValueError('document identity must bind a source Markdown member')
        logical = name.upper().lower()
        if identity in ids or logical in paths:
            raise ValueError('duplicate document identity/path')
        ids.add(identity); paths.add(logical)
    required = {name for name in source_paths if name.endswith('.md') and any(
        name == namespace or name.startswith(namespace + '/') for namespace in audited_namespaces)}
    missing = required - {item['path'] for item in value['documents']}
    if missing:
        raise ValueError('source Markdown in audited documentation namespace lacks identity: ' + ', '.join(sorted(missing)))
    return value['documents']


def checked_regressions(value, source_paths):
    if (not isinstance(value, dict) or set(value) != {'scope', 'checks'}
            or not isinstance(value['scope'], str) or not value['scope']
            or not isinstance(value['checks'], list)):
        raise ValueError('invalid finite regression contract')
    ids = set()
    for item in value['checks']:
        if not isinstance(item, dict) or set(item) != {'id', 'path', 'mode', 'text'}:
            raise ValueError('regression fields must be exact')
        if any(not isinstance(item[k], str) or not item[k] for k in item):
            raise ValueError('regression fields must be nonempty strings')
        if item['mode'] not in {'must_contain', 'must_not_contain'}:
            raise ValueError('unsupported regression mode')
        if item['id'] in ids or item['path'] not in source_paths:
            raise ValueError('duplicate regression identity or non-source target')
        ids.add(item['id'])
    return value['checks']


def verify(root: Path, *, sealed: bool = False, captured=None) -> dict:
    root = root.resolve()
    errors = []
    def local(name: str) -> Path:
        return local_path(root, name)
    input_capture=captured;owns_capture=captured is None
    captured=(capture_source_bytes(root) if owns_capture else
              {name:data for name,data in captured.items() if name not in EXCLUDED_FROM_SOURCE_HASH})
    def read(path):return source_bytes(root,path,captured)
    def source_json(path):return decode(read(path),str(path))
    def projection_matches(name,value):
        if input_capture is not None:
            return name in input_capture and canonical(decode(input_capture[name],name))==canonical(value)
        path=local(name)
        return path.is_file() and canonical(load(path))==canonical(value)
    manifest=source_manifest_from_capture(root,captured)
    if sealed:
        if not projection_matches(MANIFEST_PATH,manifest):
            errors.append('sealed source projection is missing, stale or has an unsupported identity domain')
    entries = manifest['members']
    files = [root/name for name in captured]
    current = manifest['source_set_sha256']
    source_paths = {x['path'] for x in entries}
    docs = checked_identity_registry(source_json('.documentation/documents.json'), source_paths,
                                     baseline(root,captured)['audited_namespaces'])
    for x in docs:
        if x['path']not in captured: errors.append('document missing: ' + x['path'])
    projection = requirement_projection(root,captured)
    if sealed:
        if not projection_matches(REQUIREMENTS_PATH,projection):
            errors.append('sealed requirement projection is missing or stale')
    requirements = projection['items']
    for x in checked_regressions(source_json('.documentation/known-regressions.json'), source_paths):
        exists = x['text'] in read(x['path']).decode('utf-8')
        if (x['mode'] == 'must_contain' and not exists) or (x['mode'] == 'must_not_contain' and exists):
            errors.append('known route regression: ' + x['id'])
    # Check actual authored module membership and semantic source locations.
    # Examples are finite design inputs; byte snapshots belong to sealed packages.
    def inside(p: Path) -> bool:
        return p.is_relative_to(root) and p.relative_to(root).as_posix()in captured
    example_projects = 0
    for project_path in (p for p in files if p.name == 'gift.project.json' and p.relative_to(root).parts[0] == 'examples'):
        sample = project_path.parent
        example_projects += 1
        project = source_json(project_path)
        if project.get('schema') != 'gift.project/1':
            errors.append('example project schema unsupported: ' + str(project_path.relative_to(root)))
            continue
        for module_id, location in sorted(project['modules'].items()):
            p = (sample / location).resolve()
            if not inside(p):
                errors.append('example module missing/outside: ' + str(project_path.relative_to(root)) + ':' + module_id)
                continue
            module = source_json(p)
            if module.get('moduleId') != module_id:
                errors.append('example module identity mismatch: ' + str(project_path.relative_to(root)) + ':' + module_id)
            if module.get('schema') != 'gift.author-module/1':
                errors.append('example module schema unsupported: ' + str(project_path.relative_to(root)) + ':' + module_id)
    # Complete author modules also work without a project. Interpret the module's
    # actual requirement dialect alias, rather than assuming the spelling "req".
    for p in (p for p in files if p.suffix == '.json' and p.relative_to(root).parts[0] == 'examples'):
        module = source_json(p)
        if not isinstance(module, dict) or module.get('schema') != 'gift.author-module/1':
            continue
        kinds = {alias + ':rule' for alias, dialect in module.get('dialects', {}).items()
                 if dialect.get('languageId') == 'gift.requirement-structure'}
        for definition in module.get('definitions', {}).values():
            if definition.get('kind') not in kinds:
                continue
            semantics = definition.get('body', {}).get('semantics', {})
            source, section = semantics.get('source'), semantics.get('section')
            if not isinstance(source, str) or not isinstance(section, str) or not source or not section:
                errors.append('example rule source/section missing: ' + str(p.relative_to(root)))
                continue
            q = (p.parent / source).resolve()
            if not inside(q):
                errors.append('example rule source missing/outside: ' + str(p.relative_to(root)))
            elif not re.search(r'^#{1,6}\s+' + re.escape(section) + r'\s*$', read(q).decode('utf-8'), re.M):
                errors.append('example rule section missing: ' + str(p.relative_to(root)) + ':' + section)
    # Check only the current text. There is no historical path resolver.
    anchors = {}
    for p in (p for p in files if p.suffix == '.md'):
        name = p.relative_to(root).as_posix()
        try:
            anchors[name] = anchor_locations(read(p).decode('utf-8'))
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
        d = check_design.review(root,captured=captured)
        design = {'declared_modules': d['modules'], 'declared_static_edges': d['static_edges'],
                  'decisions_with_adoption_and_enforcement': len(d['decisions']), 'diagram_sources': len(d['mermaid_sources']),
                  'concrete_deliverables_with_author_and_semantic_references': d['deliverables']['count'],
                  'target_semantic_validation': d['deliverables']['target_semantic_validation']}
    except (OSError, ValueError) as exc:
        errors.append('design joins: ' + str(exc))
    if owns_capture:assert_source_capture_current(root,captured)
    if errors: raise ValueError('\n'.join(errors))
    return {**design, 'source_set_sha256':current,'verified_source_members':len(entries),'document_ids':len(docs),'requirements':len(requirements),
            'current_markdown_files':len(anchors),'example_projects':example_projects,
            'scope':'Current frozen source bytes, module membership, semantic source locations, identities, requirement references, anchors and finite known regressions. Not a signature, production lock check or product/semantic validation.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--sealed', action='store_true', help='Require exact source and requirement projections in an explicitly sealed package')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.root, sealed=args.sealed), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError, IndexError, RecursionError) as exc:
        print('FAIL: '+str(exc), file=sys.stderr)
        sys.exit(1)
