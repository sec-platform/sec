"""Standard-library checks for declared design contracts."""
from pathlib import Path
import tempfile
import unittest
import check_design as d

class Architecture(unittest.TestCase):
 def source(self):return(Path(d.__file__).resolve().parents[2]/d.TABLE_PATH).read_bytes()
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
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp)/'SEC';shutil.copytree(root/'docs/状态',r/'docs/状态');(r/Path(d.TABLE_PATH).parent).mkdir(parents=True);(r/d.TABLE_PATH).write_bytes(self.source())
   p=r/'docs/状态/作者与接口.md';text=p.read_text();text=text.replace('**'+field+'：**','**无效字段：**',1);p.write_text(text)
   with self.assertRaisesRegex(d.DesignError,'missing substantive field '+field):d.decision_model(r)
 def test_missing_adoption(self):self.missing_field('采用决定')
 def test_missing_enforcement(self):self.missing_field('结构与执行落点')
 def test_owner_joins_do_not_require_duplicate_status_fields(self):
  root=Path(d.__file__).resolve().parents[2]
  rows=d.decision_model(root)
  self.assertEqual(len(rows),66)
  self.assertEqual({row['id']for row in rows},{f'U{n:03d}'for n in range(1,67)})
  text=(root/'docs/状态/编译与目标.md').read_text(encoding='utf-8')
  u013=text.split('### U013｜',1)[1].split('### U014｜',1)[0]
  self.assertIn('**采用与责任位置：**',u013)
  self.assertIn('**剩余义务：**',u013)
  self.assertNotIn('**采用决定：**',u013)
 def test_joined_owner_and_remaining_obligations_cannot_be_omitted(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  for field,expected in (('采用与责任位置','采用决定'),('剩余义务','实施与验证工作'),
                         ('关闭条件','关闭条件'),('重开或调整条件','重开或调整条件')):
   with self.subTest(field=field),tempfile.TemporaryDirectory()as temp:
    r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
    p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
    start=text.index('### U013｜');end=text.index('### U014｜',start)
    section=text[start:end].replace('**'+field+'：**','**无效字段：**',1)
    p.write_text(text[:start]+section+text[end:],encoding='utf-8')
    with self.assertRaisesRegex(d.DesignError,'U013 missing substantive field '+expected):d.decision_model(r)
 def test_empty_join_is_not_supplied_by_the_next_field(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
   p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
   start=text.index('**采用与责任位置：**');end=text.index('**规划属性：**',start)
   p.write_text(text[:start]+'**采用与责任位置：**\n\n'+text[end:],encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'U013 missing substantive field 采用决定'):d.decision_model(r)
 def test_owner_join_does_not_allow_losing_an_independent_u(self):
  import shutil
  root=Path(d.__file__).resolve().parents[2]
  with tempfile.TemporaryDirectory()as temp:
   r=Path(temp);shutil.copytree(root/'docs/状态',r/'docs/状态')
   p=r/'docs/状态/编译与目标.md';text=p.read_text(encoding='utf-8')
   start=text.index('### U013｜');end=text.index('### U014｜',start)
   p.write_text(text[:start]+text[end:],encoding='utf-8')
   with self.assertRaisesRegex(d.DesignError,'exactly 66 independent entries'):d.decision_model(r)
 def test_all_decisions_and_graphs(self):
  root=Path(d.__file__).resolve().parents[2]
  v=d.review(root);self.assertEqual(len(v['decisions']),66)
  graph_keys=[(g['path'],g['line']) for g in v['mermaid_sources']]
  self.assertTrue(graph_keys);self.assertEqual(len(set(graph_keys)),len(graph_keys))
  for graph in v['mermaid_sources']:
   self.assertTrue(graph['heading']);self.assertEqual(len(graph['sha256']),64)


if __name__ == "__main__": unittest.main()
