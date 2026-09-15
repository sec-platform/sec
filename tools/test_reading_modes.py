#!/usr/bin/env python3
"""Small documentation-tool tests. No browser installation or product execution."""
from __future__ import annotations
import base64,contextlib,hashlib,io,json,sys,tempfile,unittest,zlib
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
import build_html as b
import check_design as d

class Modes(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.home=Path(self.tmp.name);self.root=self.home/'SEC';(self.root/'docs').mkdir(parents=True);(self.root/'.documentation').mkdir();self.out=self.home/'out.html'
  (self.root/'.documentation/baseline.json').write_text(json.dumps({'source_roots':['README.md','docs','.documentation'],'audited_namespaces':['docs'],'non_documentation_roots':[]}),encoding='utf-8')
  (self.root/'README.md').write_text('# Fixture\n[Doc](docs/page.md)\n');self.source='flowchart LR\n A-->B\n';(self.root/'docs/page.md').write_text('# Diagram\n```mermaid\n'+self.source+'```\n')
  self.svg=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="4" y="24">A B</text></svg>'
 def tearDown(self):self.tmp.cleanup()
 def cache(self,svg=None,encoding='zlib+base64'):
  svg=self.svg if svg is None else svg;key=b.sha(self.source.encode());payload=zlib.compress(svg)if encoding=='zlib+base64'else svg
  v={'schema':'sec.diagram-cache/1','renderer':{'engine_sha256':'fixture-only'},'entries':{key:{'source_sha256':key,'svg_sha256':b.sha(svg),'svg_bytes':len(svg),'encoding':encoding,'data':base64.b64encode(payload).decode(),'renderer_id':'fixture'}}}
  (self.root/'.documentation/figures.json').write_text(json.dumps(v));return v
 def run_(self,*args):
  with contextlib.redirect_stdout(io.StringIO())as o,contextlib.redirect_stderr(io.StringIO()):b.main(['--root',str(self.root),'--output',str(self.out),*args])
  return json.loads(o.getvalue())
 def bad(self,*args):
  self.out.write_bytes(b'old')
  with self.assertRaises((ValueError,b.BuildError,OSError,KeyError)):self.run_('--replace',*args)
  self.assertEqual(self.out.read_bytes(),b'old')
 def test_default_cache_without_browser(self):
  self.cache()
  with patch.object(b,'IsolatedRenderer',side_effect=AssertionError('No headless renderer on default path')):r=self.run_()
  self.assertEqual((r['rendered'],r['pending']),(1,0))
 def test_plain_base64_cache(self):self.cache(encoding='base64');self.assertEqual(self.run_()['rendered'],1)
 def test_missing_cache_rejects(self):self.bad()
 def test_stale_graph_rejects(self):self.cache();(self.root/'docs/page.md').write_text('# Diagram\n```mermaid\nflowchart LR\n A-->C\n```\n');self.bad()
 def test_cache_hash_rejects(self):
  c=self.cache();next(iter(c['entries'].values()))['svg_sha256']='0'*64;(self.root/'.documentation/figures.json').write_text(json.dumps(c));self.bad()
 def test_active_svg_even_with_valid_hash(self):self.cache(b'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>');self.bad()
 def test_external_svg(self):self.cache(b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://x.invalid";</style></svg>');self.bad()
 def test_decompression_limit(self):self.cache(b'x'*10_000_001);self.bad()
 def test_duplicate_keys(self):(self.root/'.documentation/figures.json').write_text('{"schema":1,"schema":2}');self.bad()
 def test_no_diagrams_does_not_need_cache(self):
  (self.root/'docs/page.md').write_text('# Empty\n');r=self.run_();self.assertEqual(r['rendered'],0)
 def test_browser_page_without_engine(self):
  r=self.run_('--diagrams','browser');self.assertEqual(r['pending'],1);s=self.out.read_text();self.assertIn('等待本地浏览器渲染',s);a=b.AuditHTML();a.feed(s);self.assertEqual(len(a.scripts),1);self.assertFalse(a.handlers or a.remote)
 def test_browser_embeds_only_selected_engine(self):
  f=self.home/'engine.js';f.write_text('/* fixture not a real renderer */');self.run_('--diagrams','browser','--mermaid-js',str(f));self.assertIn(base64.b64encode(f.read_bytes()).decode(),self.out.read_text())
 def test_browser_missing_selected_engine(self):self.bad('--diagrams','browser','--mermaid-js',str(self.home/'no.js'))
 def test_browser_no_source_script_execution(self):
  (self.root/'docs/page.md').write_text('# Diagram\n<script>alert(1)</script>\n');self.run_('--diagrams','browser');s=self.out.read_text();self.assertIn('&lt;script&gt;',s)
 def test_cache_mode_reproducible(self):self.cache();self.run_();x=self.out.read_bytes();self.run_('--replace');self.assertEqual(x,self.out.read_bytes())
 def test_diagram_callback_rejected_before_cache(self):
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\nflowchart LR\n click A callback\n```\n');self.bad('--diagrams','browser')


if __name__=='__main__':unittest.main(verbosity=2)
