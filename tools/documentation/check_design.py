#!/usr/bin/env python3
"""Check current design joins; does not inspect or certify a product implementation."""
from __future__ import annotations
import argparse, collections, hashlib, html, json, re, sys
from pathlib import Path
sys.dont_write_bytecode=True

MODULES=frozenset('contracts workspace semantics compiler assurance application execution adapters entry bootstrap'.split())
TABLE_PATH='docs/架构/装配/模块与运行实例.md'
class DesignError(ValueError):pass

def dependency_model(data: bytes):
    text=data.decode('utf-8');rows={}
    for line in text.splitlines():
        if not line.startswith('|'):continue
        cells=[c.strip() for c in line.split('|')[1:-1]]
        if len(cells)!=4 or cells[0] not in MODULES:continue
        name=cells[0]
        if name in rows:raise DesignError('Repeated module row: '+name)
        deps=[]if cells[1]=='无'else[c.strip()for c in cells[1].split(',')]
        if len(deps)!=len(set(deps))or set(deps)-MODULES or name in deps:raise DesignError('Invalid direct dependency: '+name)
        rows[name]=deps
    if set(rows)!=MODULES:raise DesignError('Missing module rows: '+repr(MODULES-set(rows)))
    if rows['contracts']or set(rows['semantics'])-{'contracts'}or set(rows['execution'])-{'contracts'}:
        raise DesignError('Pure semantic/execution boundary dependency violated')
    if 'execution'in rows['compiler']or 'adapters'in rows['compiler']or 'assurance'in rows['compiler']:
        raise DesignError('Compiler cannot statically import effects or assurance implementation')
    levels={};visiting=set()
    def level(n):
        if n in levels:return levels[n]
        if n in visiting:raise DesignError('Static dependency cycle: '+n)
        visiting.add(n);levels[n]=max((level(d)+1 for d in rows[n]),default=0);visiting.remove(n);return levels[n]
    for n in sorted(rows):level(n)
    return {'source':TABLE_PATH,'source_sha256':hashlib.sha256(data).hexdigest(),'dependencies':rows,'levels':levels,'edge_role':'static direct module dependency, not runtime order or deployment'}

def dependency_svg(model):
    """Exact adjacency matrix; each marked row imports the corresponding column.

    A matrix keeps all direct edges visible without hiding long edges behind
    intermediate nodes. It is a projection of the sole module table.
    """
    deps=model['dependencies']; levels=model['levels']
    names=sorted(deps, key=lambda n:(-levels[n],n))
    left,top,cell=165,160,52
    width,height=left+len(names)*cell+28,top+len(names)*cell+25
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Static dependency matrix: row imports column">']
    for j,n in enumerate(names):
        x=left+j*cell+cell/2
        parts.append(f'<text x="{x}" y="{top-14}" transform="rotate(-50 {x} {top-14})" text-anchor="start" font-family="sans-serif" font-size="15">{html.escape(n)}</text>')
    for i,n in enumerate(names):
        y=top+i*cell
        parts.append(f'<text x="{left-13}" y="{y+cell/2+5}" text-anchor="end" font-family="sans-serif" font-size="15">{html.escape(n)}</text>')
        for j,d in enumerate(names):
            x=left+j*cell;fill='#e7e9ed'if n==d else'#fff'
            parts.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="{fill}" stroke="#b4bdc9" stroke-width="1"/>')
            if d in deps[n]:parts.append(f'<circle cx="{x+cell/2}" cy="{y+cell/2}" r="7" fill="#274b72"><title>{html.escape(n+" imports "+d)}</title></circle>')
    parts.append('</svg>');return ''.join(parts).encode()

def deliverable_model(root: Path):
    """Verify that every concrete deliverable has author source, semantics and a target-facing contract.

    This is a structural closure gate only. It does not type-check or execute the
    product contracts.
    """
    sample=root/'examples/开发成品'
    def load_json(path: Path):
        def unique(pairs):
            out={}
            for k,v in pairs:
                if k in out: raise DesignError('Duplicate JSON key in '+str(path.relative_to(root))+': '+k)
                out[k]=v
            return out
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
    defs=load_json(sample/'definitions.json')
    spec=load_json(sample/'contracts/spec.json')
    project=load_json(sample/'sec.project.json')
    dts=(sample/'公开边界.d.ts').read_text(encoding='utf-8')
    names=list(defs.get('exports',{}))
    if len(names)!=36 or len(set(names))!=36:
        raise DesignError('Concrete deliverable export set must contain 36 unique roots')
    module_paths=set(project.get('modules',{}).values())
    checked=[]
    for name in names:
        model_rel='model/'+name.lower()+'.json'
        model_path=sample/model_rel
        if not model_path.is_file(): raise DesignError(name+' missing author root '+model_rel)
        if model_rel not in module_paths: raise DesignError(name+' author root is absent from sec.project.json')
        model=load_json(model_path)
        app=model.get('definitions',{}).get('d:App')
        if not app or app.get('kind')!='req:composite': raise DesignError(name+' root must be req:composite d:App')
        if model.get('exports',{}).get('App')!={'definitionId':'d:App'}: raise DesignError(name+' must export d:App as App')
        uses=[]
        for term in app.get('body',{}).get('terms',[]):
            use=term.get('use') if isinstance(term,dict) else None
            if use and use.get('import')=='forms': uses.append(use.get('export'))
        if name not in uses: raise DesignError(name+' root does not use its complete form definition')
        rule=spec.get('definitions',{}).get('r:'+name)
        if not rule or rule.get('kind')!='req:rule': raise DesignError(name+' missing derived rule contract')
        composite_ref=defs['exports'][name]
        comp=defs.get('definitions',{}).get(composite_ref.get('definitionId'))
        if not comp or comp.get('kind')!='req:composite': raise DesignError(name+' export does not resolve to a composite')
        own_require=[]
        for term in comp.get('body',{}).get('terms',[]):
            req=term.get('require') if isinstance(term,dict) else None
            if req and req.get('import')=='spec' and req.get('export')==name:
                own_require.append(set((term.get('fields') or {}).keys()))
        if len(own_require)!=1:
            raise DesignError(name+' must contain exactly one concrete rule application')
        fields=set(rule.get('body',{}).get('fields',{}))
        if own_require[0]!=fields:
            raise DesignError(name+' rule application/contract-field mismatch: '+repr(sorted(own_require[0]^fields)))
        sem=rule.get('body',{}).get('semantics',{})
        source=sem.get('source'); section=sem.get('section')
        if not source or not section: raise DesignError(name+' rule lacks semantics source/section')
        doc=(sample/'contracts'/source).resolve()
        if not doc.is_relative_to(root) or not doc.is_file(): raise DesignError(name+' semantics source is missing/outside')
        text=doc.read_text(encoding='utf-8')
        if not re.search(r'^#{1,6}\s+'+re.escape(section)+r'\s*$',text,re.M):
            raise DesignError(name+' semantics section not found: '+section)
        m=re.search(r'export namespace '+re.escape(name)+r'\s*\{',dts)
        if not m: raise DesignError(name+' missing target-facing namespace')
        # Find the matching top-level namespace closing brace. Nested interface braces are balanced.
        i=m.end(); depth=1
        while i<len(dts) and depth:
            if dts[i]=='{': depth+=1
            elif dts[i]=='}': depth-=1
            i+=1
        body=dts[m.end():i-1]
        if not re.search(r'\bfunction\s+\w+\s*\(',body):
            raise DesignError(name+' has no callable target boundary')
        checked.append({'name':name,'model':model_rel,'semantics':doc.relative_to(root).as_posix(),'namespace':name})
    return {'count':len(checked),'items':checked,'scope':'Author root + semantic rule + callable target contract closure; not implementation correctness'}

# The corpus contract remains in review(); these readers are input-local and do
# not read the live repository, invoke another checker, or certify semantics.
DECISION_FIELDS = ('采用决定', '结构与执行落点', '实施与验证工作',
                   '还需要什么', '关闭条件', '重开或调整条件')
_FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})(.*)$')
_FIELD = re.compile(r'^ {0,3}\*\*([^*\n]+?)：\*\*', re.M)
_HEADING = re.compile(r'^ {0,3}(#{1,3})[ \t]+([^\n]*)$', re.M)


def _markdown_lines(text: str, path: str):
    """Read the top-level fences/comments used by the design source format.

    Code and comments cannot declare decisions or responsible headings. This is
    a structural reader, not a general Markdown renderer or semantic proof.
    """
    fence = None
    in_comment = False
    for number, line in enumerate(text.splitlines(), 1):
        if fence is not None:
            match = _FENCE.match(line)
            if (match and match[1][0] == fence[0]
                    and len(match[1]) >= len(fence)
                    and not match[2].strip(' \t')):
                yield number, 'close', line
                fence = None
            else:
                yield number, 'code', line
            continue
        # Mask comments rather than deleting them: offsets and line numbers
        # must continue to refer to the original normalized document.
        cursor = 0
        visible = []
        while cursor < len(line):
            if in_comment:
                end = line.find('-->', cursor)
                stop = len(line) if end < 0 else end + 3
                visible.append(' ' * (stop - cursor))
                cursor = stop
                in_comment = end < 0
            else:
                start = line.find('<!--', cursor)
                if start < 0:
                    visible.append(line[cursor:])
                    break
                visible.append(line[cursor:start])
                cursor = start
                in_comment = True
        line = ''.join(visible)
        match = _FENCE.match(line)
        if match and not (match[1][0] == '`' and '`' in match[2]):
            fence = match[1]
            yield number, 'open', line
        else:
            yield number, 'text', line
    if fence is not None:
        raise DesignError('Unclosed fence: ' + path)


def decision_entries(text: str, path: str):
    """Validate each entry's own nonempty fields, without a corpus census."""
    structure = []
    content = []
    for _, kind, line in _markdown_lines(text, path):
        blank = ' ' * len(line)
        structure.append(line if kind == 'text' else blank)
        content.append(line if kind in ('text', 'code') else blank)
    structure = '\n'.join(structure)
    content = '\n'.join(content)
    headings = list(_HEADING.finditer(structure))
    rows = []
    for index, heading in enumerate(headings):
        entry = re.fullmatch(r'(U\d{3})｜[^\n]+', heading[2])
        if heading[1] != '###' or entry is None:
            continue
        identifier = entry[1]
        start = heading.end()
        stop = headings[index + 1].start() if index + 1 < len(headings) else len(structure)
        section = structure[start:stop]
        markers = list(_FIELD.finditer(section))
        for field in DECISION_FIELDS:
            aliases = {field, '重开条件'} if field == '重开或调整条件' else {field}
            selected = [(i, marker) for i, marker in enumerate(markers)
                        if marker[1] in aliases]
            if not selected:
                raise DesignError(identifier + ' missing substantive field ' + field)
            if len(selected) != 1:
                raise DesignError(identifier + ' duplicate field ' + field)
            i, marker = selected[0]
            end = markers[i + 1].start() if i + 1 < len(markers) else len(section)
            # An inline next label is a boundary, not a value for an empty one.
            next_label = re.search(r'(?<!\\)\*\*[^*\n]+?：\*\*', section[marker.end():end])
            if next_label:
                end = marker.end() + next_label.start()
            value = content[start + marker.end():start + end]
            value = html.unescape(re.sub(r'<[^>\n]*>', '', value)).strip()
            if not value:
                raise DesignError(identifier + ' missing substantive field ' + field)
        rows.append({'id': identifier, 'path': path,
                     'line': structure[:heading.start()].count('\n') + 1})
    return rows


def diagram_sources(text: str, path: str):
    """Return exact fenced Mermaid source identities and their owning heading."""
    heading = None
    start = None
    body = []
    graphs = []
    for number, kind, line in _markdown_lines(text, path):
        if kind == 'text':
            match = re.match(r'^ {0,3}#{1,6}[ \t]+(.+?)\s*$', line)
            if match:
                heading = re.sub(r'[ \t]+#+[ \t]*$', '', match[1]).strip()
        elif kind == 'open':
            info = _FENCE.match(line)[2].strip().split()
            start = number if info and info[0] == 'mermaid' else None
            body = []
        elif kind == 'code' and start is not None:
            body.append(line)
        elif kind == 'close' and start is not None:
            if not heading:
                raise DesignError('Diagram without responsible heading: ' + path)
            source = '\n'.join(body) + '\n'
            graphs.append({'path': path, 'line': start, 'heading': heading,
                           'sha256': hashlib.sha256(source.encode()).hexdigest()})
            start = None
    return graphs


def review(root: Path):
    model = dependency_model((root / TABLE_PATH).read_bytes())
    rows = []
    for path in sorted((root / 'docs/状态').glob('*.md')):
        rows.extend(decision_entries(path.read_text(encoding='utf-8'),
                                     path.relative_to(root).as_posix()))
    # This is the adopted corpus membership check, not a unit-test quota or a
    # claim that the decisions have been implemented or verified.
    if len(rows) != 66 or {row['id'] for row in rows} != {f'U{n:03d}' for n in range(1, 67)}:
        raise DesignError('U identifiers are not exactly 66 independent entries')
    from source_inventory import source_files
    graphs = []
    for path in source_files(root):
        if path.suffix == '.md':
            graphs.extend(diagram_sources(path.read_text(encoding='utf-8'),
                                          path.relative_to(root).as_posix()))
    products = deliverable_model(root)
    return {'modules':len(model['dependencies']),'static_edges':sum(map(len,model['dependencies'].values())),'module_model':model,'decisions':rows,'mermaid_sources':graphs,'deliverables':products,'scope':'Current document structure, declared decisions and concrete deliverable closure; not semantic proof or product enforcement'}

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]);ap.add_argument('--diagram',type=Path);a=ap.parse_args(argv)
    r=review(a.root.resolve())
    if a.diagram:
        out=a.diagram.resolve()
        if out==a.root.resolve()or a.root.resolve()in out.parents:raise DesignError('Derived diagram must be outside source tree')
        if out.exists():raise DesignError('Output exists; select a new path')
        out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(dependency_svg(r['module_model']))
    print(json.dumps({'modules':r['modules'],'static_edges':r['static_edges'],'decisions':len(r['decisions']),'mermaid_sources':len(r['mermaid_sources']),'deliverables':r['deliverables']['count'],'scope':r['scope']},ensure_ascii=False,indent=2));return 0
if __name__=='__main__':
    try:sys.exit(main())
    except(ValueError,OSError)as e:print('DESIGN CHECK FAILED:',str(e),file=sys.stderr);sys.exit(1)
