#!/usr/bin/env python3
"""Small documentation-tool tests. No browser installation or product execution."""
from __future__ import annotations
import base64,contextlib,hashlib,io,json,sys,tempfile,unittest,zlib
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
import build_html as b
from .test_check_documentation_identity import declaration
import check_design as d

class Modes(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name);self.root=self.home/'SEC';(self.root/'docs').mkdir(parents=True);(self.root/'.documentation').mkdir();self.out=self.home/'out.html'
  (self.root/'.documentation/baseline.json').write_text(json.dumps({**declaration(['README.md','docs','.documentation']), 'entry':'../README.md'}),encoding='utf-8')
  (self.root/'README.md').write_text('# Fixture\n[Doc](docs/page.md)\n');self.source='flowchart LR\n A-->B\n';(self.root/'docs/page.md').write_text('# Diagram\n```mermaid\n'+self.source+'```\n')
  self.svg=b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="4" y="24">A B</text></svg>'
 def cache(self,svg=None,encoding='zlib+base64'):
  svg=self.svg if svg is None else svg;key=b.sha(self.source.encode());payload=zlib.compress(svg)if encoding=='zlib+base64'else svg
  v={'schema':'sec.diagram-cache/1','renderer':{'engine_sha256':'fixture-only'},'entries':{key:{'source_sha256':key,'svg_sha256':b.sha(svg),'svg_bytes':len(svg),'encoding':encoding,'data':base64.b64encode(payload).decode(),'renderer_id':'fixture'}}}
  (self.root/'.documentation/figures.json').write_text(json.dumps(v));return v
 def run_(self,*args):
  with contextlib.redirect_stdout(io.StringIO())as o,contextlib.redirect_stderr(io.StringIO()):b.main(['--root',str(self.root),'--output',str(self.out),*args])
  return json.loads(o.getvalue())
 def assert_rejected(self,reason,*args,expected=b.BuildError):
  self.out.write_bytes(b'old')
  with self.assertRaisesRegex(expected,reason):self.run_('--replace',*args)
  self.assertEqual(self.out.read_bytes(),b'old')
 def test_default_cache_without_browser(self):
  self.cache()
  with patch.object(b,'IsolatedRenderer',side_effect=AssertionError('No headless renderer on default path')):r=self.run_()
  self.assertEqual((r['rendered'],r['pending']),(1,0))
 def test_plain_base64_cache(self):self.cache(encoding='base64');self.assertEqual(self.run_()['rendered'],1)
 def test_missing_cache_rejects(self):self.assert_rejected('Current diagram cache incomplete')
 def test_stale_graph_rejects(self):self.cache();(self.root/'docs/page.md').write_text('# Diagram\n```mermaid\nflowchart LR\n A-->C\n```\n');self.assert_rejected('Current diagram cache incomplete')
 def test_cache_hash_rejects(self):
  c=self.cache();next(iter(c['entries'].values()))['svg_sha256']='0'*64;(self.root/'.documentation/figures.json').write_text(json.dumps(c));self.assert_rejected('Cache SVG byte mismatch')
 def test_active_svg_even_with_valid_hash(self):self.cache(b'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>');self.assert_rejected('Active SVG element: script')
 def test_external_svg(self):self.cache(b'<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://x.invalid";</style></svg>');self.assert_rejected('External SVG stylesheet')
 def test_decompression_limit(self):self.cache(b'x'*10_000_001);self.assert_rejected('Compressed cache exceeds limit')
 def test_duplicate_keys(self):(self.root/'.documentation/figures.json').write_text('{"schema":1,"schema":2}');self.assert_rejected('Duplicate cache key: schema')
 def test_cache_root_requires_object(self):
  for value in (None, [], 'cache', 7, False):
   with self.subTest(value=value):
    (self.root/'.documentation/figures.json').write_text(json.dumps(value));self.assert_rejected('Unknown diagram cache contract')
 def test_cache_entry_requires_object(self):
  for value in ([], 'entry', 7, False):
   with self.subTest(value=value):
    cache=self.cache();cache['entries'][b.sha(self.source.encode())]=value
    (self.root/'.documentation/figures.json').write_text(json.dumps(cache));self.assert_rejected('Invalid diagram cache entry')
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
 def test_browser_missing_selected_engine(self):self.assert_rejected('Invalid local Mermaid standalone script', '--diagrams','browser','--mermaid-js',str(self.home/'no.js'))
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
  (self.root/'docs/page.md').write_text('# Diagram\n```mermaid\nflowchart LR\n click A callback\n```\n');self.assert_rejected('Diagram-local configuration/callback or budget outside safe profile', '--diagrams','browser')


class RejectionOracleTests(unittest.TestCase):
 def test_fixture_is_released_even_when_setup_fails(self):
  case=Modes('test_default_cache_without_browser');result=unittest.TestResult()
  with patch.object(Path,'mkdir',side_effect=OSError('fixture setup failure')):case.run(result)
  self.assertEqual(result.testsRun,1);self.assertEqual(len(result.errors),1)
  self.assertIn('fixture setup failure',result.errors[0][1])
  self.assertFalse(Path(case.tmp.name).exists())

 def test_wrong_failure_cannot_satisfy_cache_rejection(self):
  case=Modes();case.setUp();self.addCleanup(case.doCleanups)
  for error in (KeyError('internal lookup failure'), OSError('unexpected IO failure'),
                b.BuildError('different validation failure')):
   with self.subTest(error=type(error).__name__):
    with patch.object(case,'run_',side_effect=error):
     expected=case.failureException if isinstance(error,b.BuildError) else type(error)
     with self.assertRaises(expected):case.assert_rejected('Current diagram cache incomplete')


if __name__=='__main__':unittest.main(verbosity=2)
