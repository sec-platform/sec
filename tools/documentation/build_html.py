#!/usr/bin/env python3
"""Build a self-contained, source-backed SEC reading edition. Never edits its input.

Default: current working tree, exact current diagram cache, no headless browser.
Use --diagrams browser to refresh in a normal local browser; --diagrams required
is the optional automated static publisher. This command never downloads.
Use --diagrams source for an explicitly labelled text-only reading edition.
"""
from __future__ import annotations
import argparse, base64, collections, hashlib, html, importlib.metadata, json, os
from pathlib import Path
import re, sys, tempfile, time, multiprocessing, signal, subprocess, zlib
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote, quote
sys.dont_write_bytecode = True
import check_docs
from source_inventory import documentation_files, source_identity_from_capture, EXCLUDED_FROM_SOURCE_HASH

TEXT_SUFFIXES = {'.md','.json','.sec','.ts','.tsx','.py','.txt','.toml','.yaml','.yml','.js','.mjs','.cjs','.css','.sh','.ps1','.cff'}
TEXT_BASENAMES = {'LICENSE','NOTICE'}
BINARY_SUFFIXES = {'.png','.jpg','.jpeg','.webp','.gif','.svg','.pdf','.zip'}
VERSION = 'sec-reading/3'
CSS = r'''
:root{font-family:system-ui,"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#202a36;background:#f4f6f8;line-height:1.8;scroll-behavior:auto}*{box-sizing:border-box}body{margin:0}a{color:#165485;overflow-wrap:anywhere}a:hover{text-decoration:underline}header{padding:2.5rem max(2rem,5vw);background:#183047;color:#fff}header a{color:#dbeeff}header p{max-width:75rem}.layout{display:grid;grid-template-columns:21rem minmax(0,1fr);gap:2rem;max-width:1600px;margin:auto;padding:2rem}aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;background:#fff;border:1px solid #dce2e8;padding:1rem}aside input{width:100%;padding:.65rem;font:inherit}aside li{margin:.4rem 0}aside ul{padding-left:1.3rem}main{min-width:0}.doc{background:white;padding:2rem;margin:0 0 2rem;border:1px solid #dde3e9;border-radius:.4rem;min-width:0}.doc h1{font-size:1.9rem;line-height:1.45}.doc h2{font-size:1.45rem;border-bottom:1px solid #dde3e9;padding-bottom:.35rem;margin-top:2.5rem}.doc h3{font-size:1.17rem;margin-top:2rem}h1,h2,h3,h4,h5,h6{overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6,[id]{scroll-margin-top:1rem}.meta{font-size:.82rem;color:#596778;overflow-wrap:anywhere}.back{font-size:.85rem}p,li,td{overflow-wrap:anywhere}pre{white-space:pre;overflow:auto;background:#f4f6f8;padding:1rem;border:1px solid #dce2e8;border-radius:.3rem;font-size:.88rem;line-height:1.65;tab-size:4}code{font-family:ui-monospace,Consolas,"Noto Sans Mono CJK SC",monospace}p code,li code{white-space:normal;overflow-wrap:anywhere}.table-wrap{overflow:auto;max-width:100%;margin:1.2rem 0}table{border-collapse:collapse;min-width:34rem;width:100%;font-size:.9rem}td,th{border:1px solid #cdd6df;padding:.55rem .7rem;vertical-align:top;text-align:left}th{background:#edf2f6}blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:.25rem solid #718a9e;background:#f5f8fa}details{margin:.8rem 0}summary{cursor:pointer;font-weight:600}.diagram{margin:1.8rem 0;padding:1rem;border:1px solid #dce2e8;border-radius:.4rem}.image-scroll{overflow:auto;max-width:100%;padding:.6rem;background:#fff}.image-scroll img{display:block;max-width:none;height:auto;margin:0 auto}.diagram figcaption{overflow-wrap:anywhere;font-size:.85rem;color:#45576a;margin-top:.6rem}.notice{padding:1rem;border-left:.3rem solid #b88b1d;background:#fff8df}.blocked-markup{white-space:pre-wrap}.binary-preview{max-width:100%;height:auto}.source-data{font-size:.8rem}hr{border:0;border-top:1px solid #dde3e9;margin:2rem 0}@media(max-width:1000px){.layout{display:block;padding:1rem}aside{position:static;max-height:24rem;margin-bottom:1rem}.doc{padding:1.2rem}header{padding:1.6rem}}@media print{aside,.back,.source-data{display:none}.layout{display:block;padding:0}.doc{border:0;break-before:page;padding:0}header{background:none;color:#000}pre{white-space:pre-wrap}.image-scroll{overflow:visible}.image-scroll img{max-width:100%}table{min-width:0}h1,h2,h3,figure{break-after:avoid}}
'''
JS = """(()=>{const x=document.getElementById('sec-nav-filter');if(!x)return;x.addEventListener('input',()=>{const q=x.value.trim().toLocaleLowerCase();for(const n of document.querySelectorAll('[data-nav-item]'))n.hidden=q&&!n.textContent.toLocaleLowerCase().includes(q);});})();"""

class BuildError(Exception): pass

def sha(data: bytes) -> str: return hashlib.sha256(data).hexdigest()
def canon(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def b64(data): return base64.b64encode(data).decode('ascii')
def opaque(name): return 's-'+name.encode('utf-8').hex()
def fragment_id(name,fragment): return opaque(name)+'--'+quote(fragment,safe='-_.~')
def esc(value): return html.escape(str(value),quote=True)

def safe_files(root: Path, args=None) -> list[Path]:
    if not (root/'README.md').is_file() or not (root/'docs').is_dir(): raise BuildError('Expected SEC root with README.md and docs/')
    return list(documentation_files(root, include_cache=args is None or (args.diagrams in ('cached', 'browser') and not args.diagram_cache)))

def capture(root,args):
    paths=safe_files(root,args); captured={}; total=0
    for p in paths:
        name=p.relative_to(root).as_posix()
        if p.suffix.lower() not in TEXT_SUFFIXES|BINARY_SUFFIXES and p.name not in TEXT_BASENAMES: raise BuildError('Unclassified source file (no silent omission): '+name)
        if p.stat().st_size>args.max_file_bytes: raise BuildError('File budget exceeded: '+name)
        data=p.read_bytes();total+=len(data)
        if len(data)>args.max_file_bytes or total>args.max_total_bytes: raise BuildError('Source byte budget exceeded')
        if p.suffix.lower() in TEXT_SUFFIXES or p.name in TEXT_BASENAMES:
            try: data.decode('utf-8')
            except UnicodeDecodeError as e: raise BuildError('Expected UTF-8; original retained: '+name) from e
        captured[name]=data
    return captured

def unchanged(root,captured,args=None):
    paths=safe_files(root,args)
    if {p.relative_to(root).as_posix() for p in paths} != set(captured): raise BuildError('Input membership changed during build; output not replaced')
    for p in paths:
        name=p.relative_to(root).as_posix()
        if p.read_bytes()!=captured[name]: raise BuildError('Input changed during build: '+name)

class AuditHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.ids=[];self.links=[];self.images=[];self.scripts=[];self.remote=[];self.handlers=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id'in a:self.ids.append(a['id'])
        if tag=='a' and 'href'in a:self.links.append(a['href'])
        if tag=='img':self.images.append(a.get('src',''))
        if tag=='script':self.scripts.append(a)
        for k,v in attrs:
            if k.lower().startswith('on'):self.handlers.append(k)
            if k in ('src','srcset','poster') and v and not v.startswith(('data:','#')):self.remote.append(v)
    handle_startendtag=handle_starttag

class RawMarkup(HTMLParser):
    TAGS={'a','details','summary','br','hr','span','div','p','strong','em','b','i','s','del','sub','sup','kbd','pre','code','ul','ol','li','table','thead','tbody','tfoot','tr','th','td','dl','dt','dd','blockquote'}
    VOID={'br','hr'}
    def __init__(self,book,name):super().__init__(convert_charrefs=False);self.book=book;self.name=name;self.out=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag not in self.TAGS:
            self.book.markup_warnings.add((self.name,tag));self.out.append(esc(self.get_starttag_text()));return
        out=[]
        for k,v in attrs:
            if k=='id':out.append('id="'+esc(fragment_id(self.name,html.unescape(v or '')))+'"')
            elif tag=='a' and k=='href':out.append('href="'+esc(self.book.href(self.name,html.unescape(v or '')))+'"')
            elif k=='title':out.append('title="'+esc(v or '')+'"')
            elif k=='open' and tag=='details':out.append('open')
            elif k in ('colspan','rowspan') and tag in ('td','th') and v and v.isdigit() and 0<int(v)<1000:out.append(k+'="'+v+'"')
            elif k=='start' and tag=='ol' and v and re.fullmatch(r'-?\d+',v):out.append('start="'+v+'"')
            else:
                if k not in ('class',):self.book.markup_warnings.add((self.name,tag+'@'+k))
        self.out.append('<'+tag+(' '+' '.join(out) if out else '')+'>')
    def handle_endtag(self,tag):self.out.append('</'+tag+'>' if tag in self.TAGS else esc('</'+tag+'>'))
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in self.VOID:self.handle_endtag(tag)
    def handle_data(self,data):self.out.append(esc(data))
    def handle_entityref(self,name):self.out.append('&'+name+';')
    def handle_charref(self,name):self.out.append('&#'+name+';')
    def handle_comment(self,data):pass  # Exact original remains in the source attachment.


def checked_svg(data: bytes, name: str) -> bytes:
    """Safe image payload only. A digest is not permission to run SVG scripts."""
    from xml.etree import ElementTree as ET
    if len(data)>10_000_000: raise BuildError('SVG size budget: '+name)
    try: r=ET.fromstring(data)
    except ET.ParseError as e: raise BuildError('Invalid SVG: '+name) from e
    if r.tag.split('}')[-1]!='svg': raise BuildError('Non-SVG cache value: '+name)
    for e in r.iter():
        tag=e.tag.split('}')[-1].lower()
        if tag in {'script','iframe','object','embed','image','a','use','animate','set'}:raise BuildError('Active SVG element: '+tag)
        for k,v in e.attrib.items():
            k=k.split('}')[-1].lower()
            if k.startswith('on') or (k in ('href','src') and not v.startswith('#')):raise BuildError('Active SVG attribute: '+k)
            if k=='style' and (re.search(r'url\(\s*["\x27]?(?!#)',v,re.I) or '@import'in v):raise BuildError('External SVG style')
        if tag=='style' and ('@import'in(e.text or '') or re.search(r'url\(\s*["\x27]?(?:https?:|data:|//)',e.text or '',re.I)):
            raise BuildError('External SVG stylesheet')
    return data

def read_diagram_cache(root: Path, captured, args, book):
    """No old HTML required. Missing/stale entries never count as rendered."""
    name='.documentation/figures.json'
    if args.diagram_cache:
        f=Path(args.diagram_cache).expanduser()
        if f.is_symlink() or not f.is_file() or f.stat().st_size>40_000_000:raise BuildError('Invalid diagram cache file')
        raw=f.read_bytes()
    else:raw=captured.get(name)
    if raw is None:return {'state':'cache-missing','rendered':0}
    def unique(pairs):
        d={}
        for k,v in pairs:
            if k in d:raise BuildError('Duplicate cache key: '+k)
            d[k]=v
        return d
    try:cache=json.loads(raw,object_pairs_hook=unique)
    except (ValueError,UnicodeError) as e:raise BuildError('Invalid diagram cache JSON')from e
    if not isinstance(cache,dict) or cache.get('schema')!='sec.diagram-cache/1' or not isinstance(cache.get('entries'),dict) or not isinstance(cache.get('renderer'),dict):raise BuildError('Unknown diagram cache contract')
    for job in book.diagrams:
        entry=cache['entries'].get(job['sha256'])
        if entry is None:continue
        if not isinstance(entry,dict):raise BuildError('Invalid diagram cache entry: '+job['sha256'])
        if entry.get('source_sha256')!=job['sha256']:raise BuildError('Cache source hash mismatch')
        if not isinstance(entry.get('data'),str) or len(entry['data'])>20_000_000:raise BuildError('Cache encoding budget')
        try:
            data=base64.b64decode(entry['data'],validate=True)
            if entry.get('encoding')=='zlib+base64':
                decoder=zlib.decompressobj();data=decoder.decompress(data,10_000_001)
                if len(data)>10_000_000 or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:raise BuildError('Compressed cache exceeds limit or has trailing data')
            elif entry.get('encoding')!='base64':raise BuildError('Unsupported cache encoding')
        except (ValueError,zlib.error)as e:raise BuildError('Invalid encoded diagram')from e
        if len(data)!=entry.get('svg_bytes') or sha(data)!=entry.get('svg_sha256'):raise BuildError('Cache SVG byte mismatch')
        book.svg[job['id']]=checked_svg(data,job['path'])
    return {'state':'exact-source-cache','cache_sha256':sha(raw),'rendered':len(book.svg),'original_renderer':cache['renderer'],'boundary':'source and SVG bytes checked; cache is a derived display, not independent proof of diagram semantics'}

class MermaidRenderer:
    def __init__(self,args):
        self.args=args;self.pw=None;self.browser=None;self.page=None;self.blocked=[];self.info={};self.loaded=False
    def __enter__(self):
        from playwright.sync_api import sync_playwright
        engine=Path(self.args.mermaid_js).expanduser().resolve()
        if not engine.is_file():raise BuildError('Mermaid script missing. Supply --mermaid-js; no automatic download.')
        if engine.stat().st_size>30_000_000:raise BuildError('Mermaid script exceeds renderer budget')
        data=engine.read_bytes();self.engine=data
        self.pw=sync_playwright().start()
        try:
            kw={'headless':True,'chromium_sandbox':not self.args.allow_no_sandbox}
            if self.args.browser:kw['executable_path']=self.args.browser
            self.browser=self.pw.chromium.launch(**kw)
            self.context=self.browser.new_context(viewport={'width':1800,'height':1200},service_workers='block')
            def block(route):self.blocked.append(route.request.url);route.abort()
            self.context.route('**/*',block)
            self.page=self.context.new_page();self.page.set_default_timeout(self.args.timeout*1000)
            self.page.set_content('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
            self.page.add_script_tag(content=data.decode('utf-8'))
            if not self.page.evaluate("!!window.mermaid && typeof mermaid.render==='function' && typeof mermaid.initialize==='function'"):
                raise BuildError('Supply a standalone Mermaid UMD/IIFE script exposing window.mermaid, not an ESM entry')
            self.info={'engine_sha256':sha(data),'browser':self.browser.version,'playwright':importlib.metadata.version('playwright'),'font_family':self.args.font_family,'browser_sandbox':not self.args.allow_no_sandbox,'engine_label':self.args.engine_label}
            self.loaded=True;return self
        except Exception:
            self.__exit__(None,None,None);raise
    def __exit__(self,*unused):
        if self.browser:self.browser.close()
        if self.pw:self.pw.stop()
    def render(self,source,ident):
        # Diagram-local configuration/clicks are intentionally not executable input.
        if re.search(r'(?m)^\s*(?:%%\{\s*(?:init|config)|click\b|---\s*$)',source):
            raise BuildError('Diagram-local configuration/callback is outside the safe reading profile: '+ident)
        cfg={'startOnLoad':False,'securityLevel':'strict','suppressErrorRendering':True,'deterministicIds':True,'deterministicIDSeed':ident,'handDrawnSeed':(int(sha(ident.encode())[:8],16)&0x7fffffff) or 1,'fontFamily':self.args.font_family,'maxTextSize':100000,'maxEdges':2000,'theme':'default','flowchart':{'htmlLabels':True},'sequence':{'useMaxWidth':False},'secure':['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','themeCSS','fontFamily','handDrawnSeed','deterministicIds','deterministicIDSeed']}
        try:
            value=self.page.evaluate('''async x=>{mermaid.initialize(x.config);const rendered=mermaid.render(x.id,x.source);const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('diagram timeout')),x.ms));const r=await Promise.race([rendered,timeout]);const parsed=new DOMParser().parseFromString(r.svg,'text/html');const svg=parsed.querySelector('svg');if(!svg)throw new Error('missing SVG');return new XMLSerializer().serializeToString(svg);}''',{'id':ident,'source':source,'config':cfg,'ms':self.args.timeout*1000})
        except Exception as e:raise BuildError('Mermaid failed at '+ident+': '+str(e)[:1200]) from e
        if len(value)>10_000_000:raise BuildError('Rendered SVG exceeds 10 MB budget: '+ident)
        from xml.etree import ElementTree as ET
        try:r=ET.fromstring(value)
        except ET.ParseError as e:raise BuildError('Invalid SVG: '+ident) from e
        if r.tag.split('}')[-1]!='svg':raise BuildError('Renderer returned non-SVG')
        for e in r.iter():
            tag=e.tag.split('}')[-1].lower()
            if tag in {'script','iframe','object','embed','image','a','use','animate','set'}:raise BuildError('Active/external SVG element: '+tag)
            for k,v in e.attrib.items():
                k=k.split('}')[-1].lower()
                if k.startswith('on') or (k in ('href','src') and not v.startswith('#')):raise BuildError('Active SVG attribute: '+k)
                if k=='style' and (re.search(r'url\(\s*[\"\x27]?(?!#)',v,re.I) or '@import'in v):raise BuildError('External SVG style')
            if tag=='style':
                text=e.text or ''
                if '@import'in text or re.search(r'url\(\s*[\"\x27]?(?:https?:|data:|//)',text,re.I):raise BuildError('External SVG stylesheet')
        if self.blocked:raise BuildError('Renderer attempted network access: '+repr(self.blocked[:3]))
        return value.encode('utf-8')


def _render_worker(connection, settings):
    """One isolated browser owner; never executes source code or visits source links."""
    if os.name == 'posix':
        os.setsid()
    args = argparse.Namespace(**settings)
    try:
        with MermaidRenderer(args) as engine:
            connection.send(('ready', engine.info))
            while True:
                command = connection.recv()
                if command[0] == 'close':
                    break
                _, source, ident = command
                result = engine.render(source, ident)
                connection.send(('svg', result))
    except BaseException as exc:
        try:
            connection.send(('error', type(exc).__name__ + ': ' + str(exc)[:1800]))
        except (OSError, EOFError):
            pass
    finally:
        connection.close()


class IsolatedRenderer:
    """Parent-side wall deadline also covers a synchronously stuck JS parser."""
    def __init__(self, args):
        self.args = args
        self.process = None
        self.pipe = None
        self.info = {}

    def _stop_tree(self):
        if self.process is None:
            return
        # This is only our isolated rendering worker and descendants, never a user target.
        try:
            if os.name == 'posix':
                os.killpg(self.process.pid, signal.SIGKILL)
            elif os.name == 'nt' and self.process.is_alive():
                subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'],
                               check=False, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10)
        except (ProcessLookupError, PermissionError, OSError, subprocess.TimeoutExpired):
            if self.process.is_alive():
                self.process.kill()
        self.process.join(timeout=5)

    def _receive(self):
        if not self.pipe.poll(self.args.timeout):
            self._stop_tree()
            raise BuildError('Renderer exceeded wall deadline; previous HTML not replaced')
        try:
            kind, value = self.pipe.recv()
        except (EOFError, OSError) as exc:
            raise BuildError('Renderer exited without a complete result') from exc
        if kind == 'error':
            raise BuildError(value)
        return kind, value

    def __enter__(self):
        context = multiprocessing.get_context('spawn')
        parent, child = context.Pipe()
        self.pipe = parent
        self.process = context.Process(target=_render_worker, args=(child, vars(self.args)))
        self.process.start()
        child.close()
        try:
            kind, self.info = self._receive()
            if kind != 'ready':
                raise BuildError('Invalid renderer startup result')
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def render(self, source, ident):
        try:
            self.pipe.send(('render', source, ident))
        except (BrokenPipeError, OSError) as exc:
            raise BuildError('Renderer unavailable') from exc
        kind, data = self._receive()
        if kind != 'svg' or not isinstance(data, bytes):
            raise BuildError('Invalid renderer result')
        return data

    def __exit__(self, *unused):
        if self.process and self.process.is_alive():
            try:
                self.pipe.send(('close',))
                self.process.join(timeout=min(self.args.timeout, 10))
            except (BrokenPipeError, OSError):
                pass
        if self.process and self.process.is_alive():
            self._stop_tree()
        if self.pipe:
            self.pipe.close()


class Book:
    def __init__(self,root,captured,args):
        from markdown_it import MarkdownIt
        self.root=root;self.data=captured;self.args=args;self.anchors={};self.tokens={};self.diagrams=[];self.svg={};self.links=0;self.markup_warnings=set();self.images=0
        self.md=MarkdownIt('commonmark',{'html':True}).enable('table').enable('strikethrough')
        for name,data in captured.items():
            if name.endswith('.md'):
                text=data.decode('utf-8');lines=text.splitlines();self.anchors[name]=check_docs.anchor_locations(text)
                dup=[k for k,v in self.anchors[name].items() if len(v)!=1]
                if dup:raise BuildError('Ambiguous source anchors: '+name+' '+repr(dup))
                tokens=self.md.parse(text);self.tokens[name]=tokens
                counts=collections.Counter()
                for t in tokens:
                    if t.type=='heading_open':
                        line=t.map[0]+1
                        title=re.sub(r'^ {0,3}#{1,6}[ \t]+','',lines[line-1]);title=re.sub(r'[ \t]+#+[ \t]*$','',title).strip()
                        slug=re.sub(r'\s','-',re.sub(r'[^\w\s-]','',check_docs.plain_heading(title).lower()))
                        n=counts[slug];counts[slug]+=1;frag=slug+(f'-{n}'if n else '')
                        if self.anchors[name].get(frag)!=[line]:raise BuildError('Anchor rule disagreement: '+name+':'+str(line))
                        t.attrSet('id',fragment_id(name,frag))
                    if t.type=='fence' and t.info.strip().split()[0:1]==['mermaid']:
                        did='fig-'+sha((name+'\0'+str(t.map[0])).encode())[:20]
                        record={'id':did,'path':name,'line':t.map[0]+1,'source':t.content,'sha256':sha(t.content.encode())}
                        t.meta['diagram']=record;self.diagrams.append(record)
                        if len(t.content)>100000 or re.search(r'(?m)^\s*(?:%%\{\s*(?:init|config)|click\b|---\s*$)',t.content):raise BuildError('Diagram-local configuration/callback or budget outside safe profile: '+name)
        def link_open(tokens,i,options,env):
            t=tokens[i]; t.attrSet('href',self.href(env['path'],t.attrGet('href') or ''))
            return self.md.renderer.renderToken(tokens,i,options,env)
        def image(tokens,i,options,env):
            t=tokens[i];url=t.attrGet('src') or '';name=self.resolve(env['path'],url)[0]
            if name not in self.data or Path(name).suffix.lower() not in BINARY_SUFFIXES:raise BuildError('Missing/nonlocal image: '+env['path']+' -> '+url)
            mime=self.mime(name);self.images+=1
            # SVG authorship is distinct; raw SVG is not trusted as active DOM.
            if mime=='image/svg+xml':self.check_svg_asset(self.data[name],name)
            alt=self.md.renderer.renderInlineAsText(t.children or [],options,env)
            return '<img class="binary-preview" loading="lazy" alt="'+esc(alt)+'" src="data:'+mime+';base64,'+b64(self.data[name])+'">'
        old_fence=self.md.renderer.rules.get('fence')
        def fence(tokens,i,options,env):
            t=tokens[i]
            if 'diagram' not in t.meta:return old_fence(tokens,i,options,env)
            record=t.meta['diagram'];did=record['id']
            source='<details><summary>准确图源</summary><pre><code class="language-mermaid">'+esc(t.content)+'</code></pre></details>'
            if self.args.diagrams=='source':return '<figure class="diagram"><figcaption>图源保留；本阅读版明确未渲染。</figcaption><pre><code>'+esc(t.content)+'</code></pre></figure>'
            if did not in self.svg:
                if self.args.diagrams=='browser':return '<figure class="diagram" id="'+did+'" data-rendered="false"><div class="image-scroll"><p class="notice">图源完整保留；等待本地浏览器渲染，不计为已成图。</p></div><figcaption>'+esc(env['path'])+'</figcaption>'+source+'</figure>'
                raise BuildError('Missing current-source diagram: '+did+'; use --diagrams browser to refresh with a local engine')
            return '<figure class="diagram" id="'+did+'"><div class="image-scroll"><img loading="lazy" alt="'+esc(env['path']+' 图源第'+str(record['line'])+'行')+'" src="data:image/svg+xml;base64,'+b64(self.svg[did])+'"></div><figcaption>'+esc(env['path'])+' · 图源第'+str(record['line'])+'行 · SHA-256 '+record['sha256']+'</figcaption>'+source+'</figure>'
        def raw(tokens,i,options,env):
            parser=RawMarkup(self,env['path']);parser.feed(tokens[i].content);parser.close();return ''.join(parser.out)
        self.md.renderer.rules.update(link_open=link_open,image=image,fence=fence,html_block=raw,html_inline=raw)
        self.md.renderer.rules['table_open']=lambda *unused:'<div class="table-wrap"><table>\n'
        self.md.renderer.rules['table_close']=lambda *unused:'</table></div>\n'
    @staticmethod
    def mime(name):
        return {'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.zip':'application/zip'}.get(Path(name).suffix.lower(),'text/plain;charset=utf-8')
    @staticmethod
    def check_svg_asset(data,name):
        from xml.etree import ElementTree as ET
        try:r=ET.fromstring(data)
        except ET.ParseError as e:raise BuildError('Invalid source SVG: '+name)from e
        for n in r.iter():
            if n.tag.split('}')[-1] in ('script','iframe','object','embed','image','foreignObject'):raise BuildError('Unsupported active source SVG: '+name)
            for k,v in n.attrib.items():
                if k.lower().startswith('on') or k.split('}')[-1] in ('href','src') and not v.startswith('#'):raise BuildError('External source SVG: '+name)
    def resolve(self,current,url):
        parts=urlsplit(url)
        if parts.scheme or parts.netloc:raise BuildError('Expected local reference: '+url)
        if parts.query:raise BuildError('Local reference queries need a defined consumer: '+url)
        path=unquote(parts.path);frag=unquote(parts.fragment)
        if '\\'in path or '\0'in path or path.startswith('/'):raise BuildError('Unsafe local reference: '+url)
        if not path:name=current
        else:
            stack=current.split('/')[:-1]
            for part in path.split('/'):
                if part in ('','.'):continue
                if part=='..':
                    if not stack:raise BuildError('Link escapes source root: '+current+' -> '+url)
                    stack.pop()
                else:stack.append(part)
            name='/'.join(stack)
            if name not in self.data and name.rstrip('/')+'/README.md'in self.data:name=name.rstrip('/')+'/README.md'
        if name not in self.data:raise BuildError('Missing local target: '+current+' -> '+url)
        if frag and (name not in self.anchors or frag not in self.anchors[name]):raise BuildError('Missing local fragment: '+current+' -> '+url)
        return name,frag
    def href(self,current,url):
        self.links+=1;p=urlsplit(url)
        if p.scheme.lower() in ('http','https','mailto'):
            if any(ord(c)<32 for c in url):raise BuildError('Control in URL')
            return url
        if p.scheme or p.netloc:raise BuildError('Unsupported/active URI: '+url)
        name,frag=self.resolve(current,url)
        return '#'+(fragment_id(name,frag)if frag else opaque(name))
    def build(self,renderer_info):
        entries=[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in sorted(self.data.items())];digest=source_identity_from_capture(self.data)
        meta={'schema':VERSION,'source_set_sha256':digest,'source_mode':'sealed'if self.args.sealed else 'working-tree-capture','source_consistency':'captured byte vector; same membership and bytes rechecked before publish, not a filesystem-wide atomic snapshot','builder_sha256':sha(Path(__file__).read_bytes()),'markdown_it_py':importlib.metadata.version('markdown-it-py'),'renderer':renderer_info,'input_set_sha256':sha(canon(entries)),'input_files':entries,'source_files':[e for e in entries if e['path'] not in EXCLUDED_FROM_SOURCE_HASH],'markdown_count':len(self.tokens),'diagram_mode':self.args.diagrams,'diagrams':[ {k:v for k,v in x.items()if k!='source'} for x in self.diagrams]}
        def sortkey(name):return (0 if name=='README.md' else 1 if name.startswith('docs/') else 2 if name.startswith('examples/') else 3 if name.startswith('alternatives/') else 4,name)
        names=sorted(self.data,key=sortkey);nav=[];articles=[]
        for name in names:
            data=self.data[name];sid=opaque(name)
            if name.endswith('.md'):
                content=self.md.renderer.render(self.tokens[name],self.md.options,{'path':name})
            elif Path(name).suffix.lower() in TEXT_SUFFIXES or Path(name).name in TEXT_BASENAMES:
                content='<h1>'+esc(name)+'</h1><pre><code>'+esc(data.decode('utf-8'))+'</code></pre>'
            else:
                content='<h1>'+esc(name)+'</h1><p>独立二进制原件；不推断其正文已纳入文本阅读。</p>'
                if Path(name).suffix.lower() in {'.png','.jpg','.jpeg','.webp','.gif'}:content+='<img class="binary-preview" src="data:'+self.mime(name)+';base64,'+b64(data)+'" alt="'+esc(name)+'">'
            if name=='docs/架构/装配/模块与运行实例.md':
                import check_design
                model=check_design.dependency_model(data)
                image=check_design.dependency_svg(model);self.images+=1
                content+='<figure class="diagram"><div class="image-scroll"><img loading="lazy" alt="从本页唯一模块表派生的静态依赖" src="data:image/svg+xml;base64,'+b64(image)+'"></div><figcaption>由本页模块表直接派生；行依赖列，圆点表示一条直接静态依赖，灰格为自身。不是运行先后或进程。源SHA-256 '+sha(data)+'</figcaption></figure>'
            # All bytes are embedded losslessly, including JSON and optional calculation sources.
            download='<details class="source-data"><summary>来源与准确原文件</summary><p>SHA-256 '+sha(data)+'；'+str(len(data))+' 字节。<a download="'+esc(Path(name).name)+'" href="data:application/octet-stream;base64,'+b64(data)+'">保存准确原文件</a></p></details>'
            articles.append('<article class="doc" id="'+sid+'" data-source-path="'+esc(name)+'" data-source-sha256="'+sha(data)+'"><p class="meta">'+esc(name)+'</p>'+download+content+'<p class="back"><a href="#sec-contents">返回导航</a></p></article>')
            nav.append('<li data-nav-item><a href="#'+sid+'">'+esc(name)+'</a></li>')
        meta['links_rewritten']=self.links;meta['raw_html_review']=[{'path':p,'tag_or_attribute':t} for p,t in sorted(self.markup_warnings)];meta['embedded_images']=len(self.svg)+self.images
        script=JS;extra='';nonce='sec-'+digest[:32];engine=b''
        if self.args.diagrams=='browser':
            script+='\n'+(Path(__file__).with_name('browser_diagrams.js')).read_text(encoding='utf-8')
            engine=b''
            if self.args.mermaid_js:
                f=Path(self.args.mermaid_js).expanduser()
                if f.is_symlink() or not f.is_file() or f.stat().st_size>30_000_000:raise BuildError('Invalid local Mermaid standalone script')
                engine=f.read_bytes();engine.decode('utf-8')
            extra='<section class="doc" id="sec-diagram-tools" data-nonce="'+nonce+'"><h2>可选：在当前浏览器重新渲染图</h2><p>选择的是可信工具，不是任意第三方脚本。不会下载引擎、上传源码或执行工程。</p><input id="sec-engine-file" type="file" accept=".js,.mjs"><button id="sec-render-start" type="button">开始本地渲染</button><button id="sec-save-diagram-cache" type="button" disabled>保存当前图缓存</button><p id="sec-diagram-status" aria-live="polite"></p><pre id="sec-engine-data" hidden>'+b64(engine)+'</pre><pre id="sec-diagram-jobs" hidden>'+esc(json.dumps(self.diagrams,ensure_ascii=False))+'</pre></section>'
            csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; frame-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'"
        else:
            csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-"+b64(hashlib.sha256(script.encode()).digest())+"'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'none'"
        if re.search(r'</script',script,re.I):raise BuildError('Unsafe script serialization')

        meta['captured_files_sha256']=sha(canon(entries))
        meta['input_set_sha256']=sha(canon({'files':entries,'recipe':{
            'builder_sha256':meta['builder_sha256'],'markdown_it_py':meta['markdown_it_py'],
            'diagram_mode':self.args.diagrams,'renderer':renderer_info,
            'script_sha256':sha(script.encode()),'style_sha256':sha(CSS.encode()),
            'browser_engine_sha256':sha(engine) if engine else None}}))

        title='SEC 工程设计'
        note={'required':'完整当前源阅读版；图已按本次固定工具渲染。','cached':'完整当前源阅读版；图由逐源核对的渲染缓存取得，不要求无头浏览器。','browser':'完整正文与原件；未命中准确缓存的图等待本地浏览器渲染，页面明确显示完成数。','source':'完整正文与原件；本版明确只显示图源，未渲染图。'}[self.args.diagrams]
        output='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+esc(csp)+'"><meta name="referrer" content="no-referrer"><title>'+title+'</title><style>'+CSS+'</style></head><body><header><h1>'+title+'</h1><p>'+note+' 作者源、实现范本与可选方案按原位置保留，不是同等采用状态。</p><details><summary>本版来源与范围</summary><p>输入摘要：'+digest+' · '+str(len(self.tokens))+'份Markdown · '+str(len(self.diagrams))+'幅图源。原文件不会因阅读构建而改写。</p></details><p><a href="#'+opaque('README.md')+'">进入正文</a></p></header><div class="layout"><aside id="sec-contents"><details open><summary>当前源导航</summary><p><label for="sec-nav-filter">按文件名筛选</label><input id="sec-nav-filter" type="search" placeholder="浏览器 Ctrl+F 可查全文"></p><ul>'+''.join(nav)+'</ul></details></aside><main>'+extra+''.join(articles)+'<section class="doc" id="sec-build-info"><h1>本阅读版的实际输入与生成范围</h1><p>内容可核对、格式可读取和画面可读，与设计正确、软件已实现及跨平台完全一致分别判断。外部引用保留链接，生成过程不访问它们。</p><details><summary>构建清单</summary><pre id="sec-build-manifest">'+esc(json.dumps(meta,ensure_ascii=False,indent=2))+'</pre></details></section></main></div><script'+(' nonce="'+nonce+'"'if self.args.diagrams=='browser' else '')+'>'+script+'</script></body></html>'
        audit=AuditHTML();audit.feed(output)
        ids=set(audit.ids)
        if len(ids)!=len(audit.ids):raise BuildError('Duplicate output id')
        missing=[x for x in audit.links if x.startswith('#') and x[1:]not in ids]
        if missing:raise BuildError('Broken output fragments: '+repr(missing[:10]))
        if audit.remote or audit.handlers or any('src'in x for x in audit.scripts):raise BuildError('Output has active/external assets')
        if len(audit.scripts)!=1:raise BuildError('Unexpected output script')
        for name,anchors in self.anchors.items():
            for frag in anchors:
                if fragment_id(name,frag)not in ids:raise BuildError('Source anchor was not rendered: '+name+'#'+frag)
        if len(self.svg)!=len(self.diagrams) and self.args.diagrams in ('required','cached'):raise BuildError('Diagram coverage incomplete')
        return output.encode(),meta

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output',type=Path,default=None)
    parser.add_argument('--replace',action='store_true',help='Replace the chosen output only after a successful full build')
    parser.add_argument('--sealed',action='store_true',help='Require the source package to match its frozen baseline')
    parser.add_argument('--diagrams',choices=('cached','browser','required','source'),default='cached')
    parser.add_argument('--diagram-cache',default=None,help='Exact-current-source cache; default .documentation/figures.json')
    parser.add_argument('--mermaid-js',default=os.environ.get('SEC_MERMAID_JS'))
    parser.add_argument('--engine-label',default='operator-supplied Mermaid; exact bytes recorded')
    parser.add_argument('--browser',default=None,help='Existing Chromium/Chrome executable; omit for installed Playwright browser')
    parser.add_argument('--allow-no-sandbox',action='store_true',help='Explicitly allow no Chromium sandbox in an already isolated container; not default')
    parser.add_argument('--font-family',default='Arial, Microsoft YaHei, Noto Sans CJK SC, sans-serif')
    parser.add_argument('--timeout',type=int,default=45)
    parser.add_argument('--max-file-bytes',type=int,default=16_000_000)
    parser.add_argument('--max-total-bytes',type=int,default=80_000_000)
    args=parser.parse_args(argv)
    if args.root.is_symlink() or any(p.is_symlink() for p in args.root.absolute().parents):
        raise BuildError('Source root symlink is not supported')
    root=args.root.resolve();out=(args.output or root.parent/'SEC.html').absolute()
    if out.is_symlink() or any(p.is_symlink()for p in out.parents):raise BuildError('Output symlink is not supported')
    out=out.resolve()
    if out==root or root in out.parents:raise BuildError('Output must be outside the source tree')
    if args.timeout<=0 or args.max_file_bytes<=0 or args.max_total_bytes<=0:raise BuildError('Budgets must be positive')
    if out.exists() and not out.is_file():raise BuildError('Output must be a regular file')
    if out.exists() and not args.replace:raise BuildError('Output exists; use --replace explicitly')
    if args.diagrams=='required' and not args.mermaid_js:raise BuildError('All diagrams are required. Set --mermaid-js to local mermaid.min.js; or explicitly choose --diagrams source')
    if args.sealed:
        if not (root/'.documentation/source-manifest.json').is_file():raise BuildError('Sealed reading requires a source snapshot; run docs:refresh')
        check_docs.verify(root)
    before=out.read_bytes()if out.is_file()else None
    captured=capture(root,args);book=Book(root,captured,args)
    renderer_info={'state':'not-rendered'}
    if args.diagrams in ('cached','browser'):
        renderer_info=read_diagram_cache(root,captured,args,book)
        if args.diagrams=='cached' and len(book.svg)!=len(book.diagrams):
            missing=[j['path']+':'+str(j['line'])for j in book.diagrams if j['id']not in book.svg]
            raise BuildError('Current diagram cache incomplete: '+repr(missing[:8])+'; use --diagrams browser to refresh; old output retained')
    if args.diagrams=='required' and book.diagrams:
        with IsolatedRenderer(args)as engine:
            for i,job in enumerate(book.diagrams):
                print(f'[{i+1}/{len(book.diagrams)}] {job["path"]}:{job["line"]}',file=sys.stderr)
                try:book.svg[job['id']]=engine.render(job['source'],job['id'])
                except BuildError as e:raise BuildError(job['path']+':'+str(job['line'])+' — '+str(e)) from e
            renderer_info=engine.info
    content,meta=book.build(renderer_info)
    unchanged(root,captured,args)
    if args.sealed:
        if not (root/'.documentation/source-manifest.json').is_file():raise BuildError('Sealed reading requires a source snapshot; run docs:refresh')
        check_docs.verify(root)
    out.parent.mkdir(parents=True,exist_ok=True)
    lock=out.with_name(out.name+'.lock');temp=None;fd=None
    try:
        fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.write(fd,str(os.getpid()).encode());os.close(fd);fd=None
    except FileExistsError as e:raise BuildError('Another publisher or unremoved lock exists: '+str(lock))from e
    try:
        now=out.read_bytes()if out.is_file()else None
        if before!=now:raise BuildError('Output changed during build; not overwritten')
        fd,temp=tempfile.mkstemp(prefix='.'+out.name+'.',suffix='.tmp',dir=out.parent)
        with os.fdopen(fd,'wb')as f:fd=None;f.write(content);f.flush();os.fsync(f.fileno())
        unchanged(root,captured,args)
        os.replace(temp,out);temp=None
    finally:
        if fd is not None:os.close(fd)
        if temp is not None:Path(temp).unlink(missing_ok=True)
        lock.unlink(missing_ok=True)
    print(json.dumps({'output':str(out),'html_sha256':sha(content),'bytes':len(content),'source_files':len(meta['source_files']),'input_files':len(captured),'markdown':len(book.tokens),'diagram_mode':args.diagrams,'diagrams':len(book.diagrams),'rendered':len(book.svg),'cached':len(book.svg) if args.diagrams in ('cached','browser') else 0,'rendered_this_build':len(book.svg) if args.diagrams=='required' else 0,'derived_table_views':1 if 'docs/架构/装配/模块与运行实例.md' in captured else 0,'pending':len(book.diagrams)-len(book.svg),'source_set_sha256':meta['source_set_sha256'],'input_set_sha256':meta['input_set_sha256'],'external_asset_requests':0,'raw_html_review':meta['raw_html_review']},ensure_ascii=False,indent=2))
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except KeyboardInterrupt:
        print('HTML BUILD CANCELLED: previous output retained',file=sys.stderr);sys.exit(130)
    except (BuildError,ValueError,OSError,KeyError,ImportError,RuntimeError)as e:
        print('HTML BUILD FAILED: '+str(e),file=sys.stderr);sys.exit(1)
