"""Standard-library checks for declared design contracts."""
from pathlib import Path
import tempfile
import unittest
import check_design as d

class Architecture(unittest.TestCase):
 def source(self):return(Path(d.__file__).resolve().parent.parent/d.TABLE_PATH).read_bytes()
 def test_current_table(self):m=d.dependency_model(self.source());self.assertEqual(len(m['dependencies']),10);self.assertEqual(sum(map(len,m['dependencies'].values())),33)
 def test_missing_module(self):
  s=self.source();s=b'\n'.join(l for l in s.splitlines()if not l.startswith(b'| contracts |'))
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_invalid_reverse_dependency(self):
  s=self.source().replace(b'| semantics | contracts |',b'| semantics | contracts, compiler |')
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_static_cycle(self):
  s=self.source().replace(b'| workspace | contracts |',b'| workspace | contracts, bootstrap |')
  with self.assertRaises(d.DesignError):d.dependency_model(s)
 def test_single_source_svg(self):
  from xml.etree import ElementTree as ET
  m=d.dependency_model(self.source());svg=d.dependency_svg(m);r=ET.fromstring(svg);labels={n.text for n in r.iter()if n.tag.endswith('}text')};self.assertEqual(labels,d.MODULES);self.assertEqual(svg,d.dependency_svg(m))
 def missing_field(self,field):
  import shutil
  root=Path(d.__file__).resolve().parent.parent
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp)/'SEC';shutil.copytree(root/'docs/状态',r/'docs/状态');(r/Path(d.TABLE_PATH).parent).mkdir(parents=True);(r/d.TABLE_PATH).write_bytes(self.source())
   p=r/'docs/状态/作者与接口.md';text=p.read_text();text=text.replace('**'+field+'：**','**无效字段：**',1);p.write_text(text)
   with self.assertRaises(d.DesignError):d.review(r)
 def test_missing_adoption(self):self.missing_field('采用决定')
 def test_missing_enforcement(self):self.missing_field('结构与执行落点')
 def test_all_decisions_and_graphs(self):
  root=Path(d.__file__).resolve().parent.parent
  v=d.review(root);self.assertEqual(len(v['decisions']),66)
  graph_keys=[(g['path'],g['line']) for g in v['mermaid_sources']]
  self.assertTrue(graph_keys);self.assertEqual(len(set(graph_keys)),len(graph_keys))
  for graph in v['mermaid_sources']:
   self.assertTrue(graph['heading']);self.assertEqual(len(graph['sha256']),64)


if __name__ == "__main__": unittest.main()
