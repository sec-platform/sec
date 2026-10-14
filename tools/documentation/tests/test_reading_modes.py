#!/usr/bin/env python3
"""Small documentation-tool tests. No browser installation or product execution."""
from __future__ import annotations
import argparse,base64,contextlib,hashlib,io,json,sys,tempfile,unittest,zlib
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
import build_html as b
from .test_check_documentation_identity import declaration
import check_design as d

class Modes(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.home=Path(self.tmp.name);self.root=self.home/'SEC';(self.root/'docs').mkdir(parents=True);(self.root/'.documentation').mkdir();self.out=self.home/'out.html'
  (self.root/'.documentation/baseline.json').write_text(json.dumps({**declaration(['README.md','docs','.documentation']), 'entry':'../README.md'}),encoding='utf-8')
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
 def test_cache_root_requires_object(self):
  for value in (None, [], 'cache', 7, False):
   with self.subTest(value=value):
    (self.root/'.documentation/figures.json').write_text(json.dumps(value));self.bad()
 def test_cache_entry_requires_object(self):
  for value in ([], 'entry', 7, False):
   with self.subTest(value=value):
    cache=self.cache();cache['entries'][b.sha(self.source.encode())]=value
    (self.root/'.documentation/figures.json').write_text(json.dumps(cache));self.bad()
 def test_repeated_diagrams_keep_occurrence_identity_and_source(self):
  self.cache()
  (self.root/'docs/second.md').write_text('# Second\n\n## Repeated\n\n## Repeated\n\n'+('\x60\x60\x60mermaid\n'+self.source+'\x60\x60\x60\n')*3)
  result=self.run_();self.assertEqual((result['diagrams'],result['rendered']),(4,4))
  audit=b.AuditHTML();audit.feed(self.out.read_text())
  self.assertEqual(len(audit.ids),len(set(audit.ids)))
  self.assertEqual(len([identity for identity in audit.ids if identity.startswith('fig-')]),4)
 def test_public_attribution_sources_are_readable_and_embedded_exactly(self):
  self.cache()
  baseline=self.root/'.documentation/baseline.json';declaration=json.loads(baseline.read_text())
  names=('README.zh-CN.md','LICENSE','NOTICE','CITATION.cff')
  declaration['source_roots'].extend(names);baseline.write_text(json.dumps(declaration))
  (self.root/'README.md').write_text('# Fixture\n'+''.join(f'[{name}]({name})\n\n'for name in names))
  for name in names:(self.root/name).write_text('# Localized\n'if name.endswith('.md')else 'fixture attribution & exact bytes\n')
  result=self.run_();output=self.out.read_text();self.assertEqual(result['rendered'],1)
  self.assertIn('fixture attribution &amp; exact bytes',output)
  for name in names:
   self.assertIn('data-source-path="'+name+'"',output)
   self.assertIn(base64.b64encode((self.root/name).read_bytes()).decode(),output)
 def test_no_diagrams_does_not_need_cache(self):
  (self.root/'docs/page.md').write_text('# Empty\n');r=self.run_();self.assertEqual(r['rendered'],0)
 def test_browser_page_without_engine(self):
  r=self.run_('--diagrams','browser');self.assertEqual(r['pending'],1);s=self.out.read_text();self.assertIn('等待本地浏览器渲染',s);a=b.AuditHTML();a.feed(s);self.assertEqual(len(a.scripts),1);self.assertFalse(a.handlers or a.remote)
 def test_browser_embeds_only_selected_engine(self):
  f=self.home/'engine.js';f.write_text('/* fixture not a real renderer */');self.run_('--diagrams','browser','--mermaid-js',str(f));self.assertIn(base64.b64encode(f.read_bytes()).decode(),self.out.read_text())
 def test_browser_missing_selected_engine(self):self.bad('--diagrams','browser','--mermaid-js',str(self.home/'no.js'))
 def test_browser_no_source_script_execution(self):
  (self.root/'docs/page.md').write_text('# Diagram\n<script>alert(1)</script>\n');self.run_('--diagrams','browser');s=self.out.read_text();self.assertIn('&lt;script&gt;',s)
 def test_cache_change_changes_reading_input_not_source_identity(self):
  self.cache();first=self.run_()
  self.cache(b'<svg xmlns="http://www.w3.org/2000/svg"><text>A B changed presentation</text></svg>')
  second=self.run_('--replace')
  self.assertEqual(first['source_set_sha256'],second['source_set_sha256'])
  self.assertNotEqual(first['input_set_sha256'],second['input_set_sha256'])
 def test_source_mode_does_not_read_broken_cache(self):
  (self.root/'.documentation/figures.json').write_bytes(b'\xffinvalid cache')
  self.assertEqual(self.run_('--diagrams','source')['rendered'],0)
 def test_cache_mode_reproducible(self):self.cache();self.run_();x=self.out.read_bytes();self.run_('--replace');self.assertEqual(x,self.out.read_bytes())
 def test_diagram_callback_rejected_before_cache(self):
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\nflowchart LR\n click A callback\n```\n');self.bad('--diagrams','browser')
 def test_required_failure_preserves_successful_cache_and_resumes_only_missing_sources(self):
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\n'+self.source+'```\n```mermaid\nflowchart LR\n B-->C\n```\n')
  cache=self.home/'progress.json';engine_file=self.home/'engine.js';engine_file.write_text('fixture only')
  calls=[];outer=self
  class Engine:
   def __init__(self,args):self.info={'engine_sha256':'fixture'};self.process=type('Process',(),{'is_alive':lambda self:True})()
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def render(self,source,ident):
    calls.append(source)
    if 'B-->C'in source:raise b.DiagramError('independent fixture syntax failure')
    return outer.svg
  args=('--diagrams','required','--mermaid-js',str(engine_file),'--diagram-cache',str(cache))
  self.out.write_bytes(b'old')
  environment={'cross_run_reuse':True,'fixture_environment':'fixed'}
  with patch.object(b,'IsolatedRenderer',Engine),patch.object(b,'renderer_environment',return_value=environment):
   with self.assertRaises(b.BuildError):self.run_('--replace',*args)
  self.assertEqual(self.out.read_bytes(),b'old');self.assertEqual(len(json.loads(cache.read_bytes())['entries']),1)
  calls.clear()
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\n'+self.source+'```\n```mermaid\nflowchart LR\n B-->D\n```\n')
  with patch.object(b,'IsolatedRenderer',Engine),patch.object(b,'renderer_environment',return_value=environment):result=self.run_('--replace',*args)
  self.assertEqual(len(calls),1);self.assertIn('B-->D',calls[0])
  self.assertEqual((result['cached'],result['rendered_this_build'],result['pending']),(1,1,0))
 def test_worker_close_error_is_consumed_and_combined_with_primary(self):
  primary=b.BuildError('render failed');worker=b.IsolatedRenderer(argparse.Namespace(timeout=1))
  worker.process=unittest.mock.Mock();worker.process.is_alive.return_value=True
  worker.pipe=unittest.mock.Mock();worker.pipe.poll.return_value=True
  worker.pipe.recv.return_value=('error','browser close failed')
  with patch.object(worker,'_stop_tree') as stop:
   with self.assertRaises(b.BuildError)as caught:worker.__exit__(type(primary),primary,None)
  self.assertIn('render failed',str(caught.exception));self.assertIn('browser close failed',str(caught.exception))
  self.assertTrue(stop.called);worker.pipe.close.assert_called_once()
 def test_node_startup_and_close_errors_both_survive(self):
  args=argparse.Namespace(node='fixture',playwright_module='fixture',mermaid_js='fixture',browser=None,
                          allow_no_sandbox=False,timeout=1,font_family='fixture',engine_label='fixture')
  renderer=b.NodeMermaidRenderer(args);process=unittest.mock.Mock();process.poll.return_value=None
  with patch.object(b.subprocess,'Popen',return_value=process),patch.object(renderer,'exchange',side_effect=[b.BuildError('startup failed'),b.BuildError('close failed')]):
   with self.assertRaises(b.BuildError)as caught:renderer.__enter__()
  self.assertIn('startup failed',str(caught.exception));self.assertIn('close failed',str(caught.exception))
  process.stdin.close.assert_called_once();process.stdout.close.assert_called_once()
 def test_fatal_renderer_failure_stops_before_next_diagram_and_preserves_html(self):
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\n'+self.source+'```\n```mermaid\nflowchart LR\n B-->C\n```\n')
  calls=[]
  class Engine:
   def __init__(self,args):self.info={}
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def render(self,source,ident):calls.append(source);raise b.BuildError('timeout remains in flight')
  with patch.object(b,'IsolatedRenderer',Engine),patch.object(b,'renderer_environment',return_value={'cross_run_reuse':False}):
   self.bad('--diagrams','required','--mermaid-js','fixture')
  self.assertEqual(len(calls),1)
 def test_required_cache_rejects_entry_renderer_identity_mismatch(self):
  cache=self.cache();cache['renderer']['cross_run_reuse']=True
  path=self.root/'.documentation/figures.json';path.write_text(json.dumps(cache))
  book=argparse.Namespace(diagrams=[{'sha256':b.sha(self.source.encode()),'id':'figure','path':'fixture'}],svg={})
  args=argparse.Namespace(diagram_cache=str(path))
  with self.assertRaisesRegex(b.BuildError,'renderer identity mismatch'):
   b.read_diagram_cache(self.root,{},args,book,expected_renderer=cache['renderer'])


if __name__=='__main__':unittest.main(verbosity=2)
