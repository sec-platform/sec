#!/usr/bin/env python3
"""Check current design joins; does not inspect or certify a product implementation."""
from __future__ import annotations
import argparse, collections, hashlib, html, json, re, sys
from pathlib import Path
from source_inventory import local_path, source_bytes, capture_source_bytes, assert_source_capture_current
sys.dont_write_bytecode=True

MODULES=frozenset('contracts workspace semantics compiler assurance application execution adapters entry bootstrap'.split())
TABLE_PATH='docs/架构/装配/模块与运行实例.md'
class DesignError(ValueError):pass


def _scope_pattern_matches(path: str, pattern: str) -> bool:
    """The declared sourceScopes grammar, anchored and independent of host glob rules."""
    if (not isinstance(pattern,str) or not pattern or '\x00' in pattern
            or any(0xD800<=ord(c)<=0xDFFF for c in pattern)
            or any(p in ('','.','..') for p in pattern.split('/'))):
        raise DesignError('Invalid source scope pattern')
    parts=path.split('/')
    def segment(value, expression):
        # Only * and ? are special within one segment; brackets/backslashes are literal.
        previous=[True]+[False]*len(value)
        for token in expression:
            current=[token=='*' and previous[0]]
            for i,character in enumerate(value,1):
                current.append((previous[i] or current[i-1]) if token=='*'
                               else previous[i-1] and (token=='?' or token==character))
            previous=current
        return previous[-1]
    positions={0}
    for expression in pattern.split('/'):
        if not positions:return False
        positions=(set(range(min(positions),len(parts)+1)) if expression=='**'
                   else {i+1 for i in positions if i<len(parts) and segment(parts[i],expression)})
    return len(parts) in positions

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

def deliverable_model(root: Path, captured=None):
    """Verify author roots, semantic references and the target declaration source.

    This is a structural closure gate only. It does not type-check or execute the
    product contracts or establish that a TypeScript declaration is callable.
    """
    sample=root/'examples/开发成品'
    def load_json(path: Path):
        def unique(pairs):
            out={}
            for k,v in pairs:
                if k in out: raise DesignError('Duplicate JSON key in '+str(path.relative_to(root))+': '+k)
                out[k]=v
            return out
        return json.loads(source_bytes(root,path,captured).decode('utf-8'), object_pairs_hook=unique)
    def present(path):return path.is_file() if captured is None else path.relative_to(root).as_posix()in captured
    defs=load_json(sample/'definitions.json')
    spec=load_json(sample/'contracts/spec.json')
    project=load_json(sample/'gift.project.json')
    target_source=sample/'公开边界.d.ts'
    if not source_bytes(root,target_source,captured).decode('utf-8').strip():
        raise DesignError('Target declaration source is empty')
    names=list(defs.get('exports',{}))
    if not names:
        raise DesignError('Concrete deliverable export set is empty')
    scopes=project.get('sourceScopes')
    modules=project.get('modules')
    if not isinstance(scopes,list) or not isinstance(modules,dict):
        raise DesignError('Project sourceScopes/modules must be declared')
    semantic_scopes=[]
    def located(relative):
        try:return local_path(sample,relative).resolve()
        except (ValueError,OSError) as error:raise DesignError('Invalid source location: '+str(relative)) from error
    for scope in scopes:
        if (not isinstance(scope,dict) or not {'root','kind','editSource'}<=set(scope)
                or scope['kind'] not in ('semantic','native','asset','design','generated')
                or not isinstance(scope['editSource'],dict)
                or scope['editSource'].get('mode') not in ('file','projection','derived')):
            raise DesignError('Invalid source scope declaration')
        scope_root=sample.resolve() if scope['root']=='.' else located(scope['root'])
        includes=scope.get('include',['**']); excludes=scope.get('exclude',[])
        if not isinstance(includes,list) or not isinstance(excludes,list):
            raise DesignError('Source scope patterns must be arrays')
        for pattern in includes+excludes:_scope_pattern_matches('validation',pattern)
        if scope['kind']=='semantic':semantic_scopes.append((scope_root,includes,excludes))
    def semantic_source(path):
        matches=0
        for scope_root,includes,excludes in semantic_scopes:
            if not path.is_relative_to(scope_root):continue
            relative=path.relative_to(scope_root).as_posix()
            if (any(_scope_pattern_matches(relative,p) for p in includes)
                    and not any(_scope_pattern_matches(relative,p) for p in excludes)):matches+=1
        if matches>1:raise DesignError('Overlapping semantic source owners: '+str(path.relative_to(sample)))
        return matches==1
    roots={}
    for module_id, model_rel in modules.items():
        model_path=located(model_rel)
        if not model_path.is_relative_to(sample.resolve()):
            raise DesignError('Author module is missing/outside sample: '+model_rel)
        if module_id==defs.get('moduleId') or not semantic_source(model_path): continue
        if not present(model_path): raise DesignError('Author module is missing: '+model_rel)
        model=load_json(model_path)
        if model.get('moduleId')!=module_id:
            raise DesignError('Author module identity mismatch: '+model_rel)
        exports=model.get('exports')
        if (not isinstance(exports,dict) or not isinstance(model.get('definitions'),dict)
                or not isinstance(model.get('imports'),dict)):
            raise DesignError('Author exports/definitions must be objects: '+model_rel)
        for export, ref in exports.items():
            if export not in names: continue
            if not isinstance(ref,dict) or set(ref)!={'definitionId'} or not isinstance(ref['definitionId'],str):
                raise DesignError('Invalid public author root reference: '+export)
            if export in roots: raise DesignError('Repeated author root export: '+export)
            app=model.get('definitions',{}).get(ref.get('definitionId'))
            if not isinstance(app,dict) or app.get('kind')!='req:composite':
                raise DesignError(export+' author root must resolve to req:composite')
            roots[export]=(model_rel,app,model.get('imports',{}))
    checked=[]
    def imported_module(imports,alias,label):
        binding=imports.get(alias) if isinstance(imports,dict) and isinstance(alias,str) else None
        if not isinstance(binding,dict) or not isinstance(binding.get('moduleId'),str):
            raise DesignError(label+' import binding is invalid')
        return binding['moduleId']
    for name in names:
        if name not in roots: raise DesignError(name+' missing registered public author root')
        model_rel,app,imports=roots[name]
        uses=[]
        body=app.get('body')
        if not isinstance(body,dict) or not isinstance(body.get('terms'),list):
            raise DesignError(name+' author root body/terms are invalid')
        for term in body['terms']:
            use=term.get('use') if isinstance(term,dict) else None
            if use is None:continue
            if not isinstance(use,dict) or not isinstance(use.get('import'),str):
                raise DesignError(name+' author form use must have an actual import binding')
            if imported_module(imports,use['import'],name+' author form')==defs.get('moduleId'):
                uses.append(use.get('export'))
        if name not in uses: raise DesignError(name+' root does not use its complete form definition')
        rule_ref=spec.get('exports',{}).get(name)
        if not isinstance(rule_ref,dict) or set(rule_ref)!={'definitionId'} or not isinstance(rule_ref['definitionId'],str):
            raise DesignError(name+' missing public rule reference')
        rule=spec.get('definitions',{}).get(rule_ref['definitionId'])
        if not rule or rule.get('kind')!='req:rule': raise DesignError(name+' missing rule contract')
        composite_ref=defs['exports'][name]
        comp=defs.get('definitions',{}).get(composite_ref.get('definitionId'))
        if not comp or comp.get('kind')!='req:composite': raise DesignError(name+' export does not resolve to a composite')
        own_require=[]
        for term in comp.get('body',{}).get('terms',[]):
            req=term.get('require') if isinstance(term,dict) else None
            if (isinstance(req,dict) and 'import' in req
                    and imported_module(defs.get('imports'),req['import'],name+' semantic rule')==spec.get('moduleId')
                    and req.get('export')==name):
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
        if not doc.is_relative_to(root) or not present(doc): raise DesignError(name+' semantics source is missing/outside')
        text=source_bytes(root,doc,captured).decode('utf-8')
        if not re.search(r'^#{1,6}\s+'+re.escape(section)+r'\s*$',text,re.M):
            raise DesignError(name+' semantics section not found: '+section)
        checked.append({'name':name,'model':model_rel,'semantics':doc.relative_to(root).as_posix()})
    return {'count':len(checked),'items':checked,'target_source':target_source.relative_to(root).as_posix(),
            'target_semantic_validation':'not-performed',
            'scope':'Author root and semantic reference structure; target source available, callability and implementation correctness not checked'}

def decision_model(root: Path, captured=None):
    """Read each independent U owner, allowing responsibility/remaining-work joins.

    The status index does not own a duplicate adoption or implementation plan.
    A U may retain separate fields or combine adoption with its responsibility
    reference and implementation/verification work with its remaining obligations.
    """
    from check_docs import markdown_visible_lines
    rows=[];visible={}
    paths=((root/'docs/状态').glob('*.md') if captured is None else
           (root/name for name in captured if (root/name).parent==root/'docs/状态' and name.endswith('.md')))
    for p in sorted(paths):
        t='\n'.join(line for _,line in markdown_visible_lines(source_bytes(root,p,captured).decode('utf-8'))) + '\n'
        visible[p]=t
        matches=list(re.finditer(r'^### (U\d{3})｜[^\n]*\n',t,re.M))
        for i,m in enumerate(matches):
            section=t[m.end():matches[i+1].start()if i+1<len(matches)else len(t)]
            for field, alternatives in (
                ('采用决定', ('采用决定','采用与责任位置')),
                ('结构与执行落点', ('结构与执行落点','采用与责任位置')),
                ('实施与验证工作', ('实施与验证工作','剩余义务')),
                ('还需要什么', ('还需要什么','剩余义务')),
                ('关闭条件', ('关闭条件',)),
                ('重开或调整条件', ('重开或调整条件','重开条件')),
            ):
                pattern=r'\*\*(?:'+'|'.join(map(re.escape,alternatives))+r')：\*\*\s*(?!\*\*|#{1,6}\s|<a\b)\S'
                if not re.search(pattern,section):raise DesignError(m.group(1)+' missing substantive field '+field)
            rows.append({'id':m.group(1),'path':p.relative_to(root).as_posix(),'line':t[:m.start()].count('\n')+1})
    owners={}
    for row in rows:
        if row['id'] in owners:raise DesignError('Duplicate independent U identity: '+row['id'])
        owners[row['id']]=row['path']
    if not owners:raise DesignError('No independent U entries')
    # Actual navigation consumes the original owner; no second numeric inventory.
    for p,t in visible.items():
        # Inline code is data as well; retain only the existing authored link surface.
        t=re.sub(r'(`+).*?\1', '', t)
        for location,fragment in re.findall(r'\]\(([^)#]+)#(u\d{3})\)',t):
            identity=fragment.upper()
            target=(p.parent/location).resolve()
            owner=owners.get(identity)
            if not owner or target!=(root/owner).resolve():
                raise DesignError('U reference lacks its independent owner: '+identity)
    return rows

def review(root: Path, captured=None):
    owns_capture=captured is None
    if owns_capture:captured=capture_source_bytes(root)
    model=dependency_model(source_bytes(root,TABLE_PATH,captured));rows=decision_model(root,captured);graphs=[]
    files=(root/name for name in captured)
    for p in (p for p in files if p.suffix == '.md'):
        text=source_bytes(root,p,captured).decode('utf-8');heading=None;fence=None;start=None;buffer=[]
        for n,line in enumerate(text.splitlines(),1):
            m=re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$',line)
            if fence:
                if m and m[1][0]==fence[0] and len(m[1])>=len(fence):
                    if start:
                        if not heading:raise DesignError('Diagram without responsible heading: '+str(p))
                        source='\n'.join(buffer)+'\n';graphs.append({'path':p.relative_to(root).as_posix(),'line':start,'heading':heading,'sha256':hashlib.sha256(source.encode()).hexdigest()})
                    fence=None;start=None;buffer=[]
                else:buffer.append(line)
            elif m:fence=m[1];start=n if m[2].strip()=='mermaid'else None;buffer=[]
            elif re.match(r'^#{1,6} ',line):heading=line.lstrip('# ').strip()
        if fence:raise DesignError('Unclosed fence: '+str(p))
    products=deliverable_model(root,captured)
    if owns_capture:assert_source_capture_current(root,captured)
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
