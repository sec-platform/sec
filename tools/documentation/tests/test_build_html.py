#!/usr/bin/env python3
"""Isolated tests for documentation tooling; no SEC product or renderer download."""
from __future__ import annotations
import argparse
import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from html.parser import HTMLParser
sys.dont_write_bytecode = True
import build_html as b
from .test_check_documentation_identity import declaration

class Originals(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.current=None; self.files={}
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='article':self.current=a.get('data-source-path')
        if tag=='a' and 'download' in a and self.current:
            self.files[self.current]=base64.b64decode(a['href'].split(',',1)[1],validate=True)

class ReadingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='sec-reading-test-')
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name);self.root=self.home/'SEC';self.root.mkdir()
        (self.root/'docs').mkdir();(self.root/'examples').mkdir()
        (self.root/'.documentation').mkdir()
        (self.root/'.documentation/baseline.json').write_text(json.dumps({**declaration(['README.md','docs','examples','.documentation']), 'entry':'../README.md'}),encoding='utf-8')
        (self.root/'README.md').write_text('# Fixture\n\n[主题](docs/主题.md#字段)\n',encoding='utf-8')
        (self.root/'docs/主题.md').write_text('# 主题\n\n## 字段\n\n完整文字。\n',encoding='utf-8')
        self.out=self.home/'reading.html'
    def write(self,name,text):
        p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
    def run_build(self,*extra):
        with contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()):
            result=b.main(['--root',str(self.root),'--output',str(self.out),'--diagrams','source',*extra])
        self.assertEqual(result,0)
        return json.loads(output.getvalue())
    def assert_rejected(self,reason,*extra,expected=b.BuildError):
        self.out.write_bytes(b'previous edition')
        with self.assertRaisesRegex(expected,reason):
            self.run_build('--replace',*extra)
        self.assertEqual(self.out.read_bytes(),b'previous edition')
        self.assertFalse(self.out.with_name(self.out.name+'.lock').exists())
    def test_original_bytes_all_members(self):
        self.write('examples/value.json','{ "名字": "😀", "n": "9007199254740993" }\n')
        self.write('examples/value.sec','export fn identity(x: Int) = x;\n')
        self.run_build();p=Originals();p.feed(self.out.read_text())
        actual={q.relative_to(self.root).as_posix():q.read_bytes() for q in self.root.rglob('*') if q.is_file()}
        self.assertEqual(p.files,actual)
    def test_typescript_raw_sources(self):
        self.write('examples/public.d.ts', 'export declare function normalize(x: bigint): bigint;\n')
        self.write('examples/fixture.ts', 'export const value = "<script>never_execute()</script>";\n')
        self.run_build(); p=Originals(); p.feed(self.out.read_text())
        for name in ('examples/public.d.ts', 'examples/fixture.ts'):
            self.assertEqual(p.files[name], (self.root/name).read_bytes())
        audit=b.AuditHTML(); audit.feed(self.out.read_text())
        self.assertFalse(audit.handlers)
        self.assertFalse(audit.remote)
        self.assertNotIn('<script>never_execute()</script>', self.out.read_text())
    def test_no_source_writes(self):
        before={str(q):q.read_bytes()for q in self.root.rglob('*')if q.is_file()}
        self.run_build()
        self.assertEqual(before,{str(q):q.read_bytes()for q in self.root.rglob('*')if q.is_file()})
    def test_source_mode_explicitly_unrendered(self):
        self.write('docs/graph.md','# Graph\n\n```mermaid\nflowchart LR\n A-->B\n```\n')
        data=self.run_build();self.assertEqual(data['diagrams'],1);self.assertEqual(data['rendered'],0)
        self.assertIn('未渲染',self.out.read_text())
    def test_missing_mermaid_does_not_publish(self):self.assert_rejected('All diagrams are required', '--diagrams','required')
    def test_missing_file(self):
        self.write('docs/主题.md','# 主题\n\n## 字段\n[x](not-here.md)\n');self.assert_rejected('Missing local target:.*not-here')
    def test_missing_fragment(self):
        self.write('README.md','# Fixture\n[x](docs/主题.md#不存在)\n');self.assert_rejected('Missing local fragment')
    def test_duplicate_explicit_anchor(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a id="same"></a>\n<a id="same"></a>\n');self.assert_rejected('Ambiguous source anchors:.*same')
    def test_explicit_heading_collision(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a id="字段"></a>\n');self.assert_rejected('Ambiguous source anchors:.*字段')
    def test_duplicate_headings_have_unique_ids(self):
        self.write('docs/主题.md','# 主题\n## 字段\n## 字段\n[第二](#字段-1)\n');self.run_build()
        self.assertIn(b.fragment_id('docs/主题.md','字段-1'),self.out.read_text())
    def test_duplicate_headings_across_docs_are_scoped(self):
        self.write('docs/other.md','# 主题\n## 字段\n');self.run_build()
        audit=b.AuditHTML();audit.feed(self.out.read_text());self.assertEqual(len(audit.ids),len(set(audit.ids)))
    def test_chinese_encoded_links_and_directory(self):
        self.write('docs/group/README.md','# Group\n')
        self.write('README.md','# Fixture\n[x](docs/%E4%B8%BB%E9%A2%98.md#%E5%AD%97%E6%AE%B5)\n[y](docs/group/)\n')
        self.run_build()
    def test_reference_style_table_and_details(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<details>\n<summary>详细</summary>\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n</details>\n[返回][r]\n\n[r]: ../README.md\n')
        self.run_build();s=self.out.read_text();self.assertIn('<details>',s);self.assertIn('<table>',s)
    def test_unclosed_fence(self):
        self.write('docs/主题.md','# 主题\n## 字段\n```text\nunclosed\n');self.assert_rejected('unclosed fenced code block', expected=ValueError)
    def test_unsafe_scheme(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a href="javascript:alert(1)">x</a>\n');self.assert_rejected('Unsupported/active URI:.*javascript')
    def test_raw_script_is_inert(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<script>alert("bad")</script>\n');self.run_build()
        s=self.out.read_text();self.assertIn('&lt;script&gt;',s)
        audit=b.AuditHTML();audit.feed(s);self.assertEqual(len(audit.scripts),1);self.assertFalse(audit.handlers)
    def test_events_are_not_executed(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<span onclick="alert(1)">label</span>\n');r=self.run_build()
        self.assertTrue(r['raw_html_review']);a=b.AuditHTML();a.feed(self.out.read_text());self.assertFalse(a.handlers)
    def test_unquoted_type_is_not_lost(self):
        self.write('docs/主题.md','# 主题\n## 字段\nType<T>\n');self.run_build()
        self.assertIn('Type&lt;T&gt;',self.out.read_text())
    def test_remote_image_rejected(self):
        self.write('docs/主题.md','# 主题\n## 字段\n![x](https://example.invalid/image.png)\n');self.assert_rejected('Expected local reference:.*https')
    def test_remote_link_not_fetched(self):
        self.write('docs/主题.md','# 主题\n## 字段\n[x](https://example.invalid/no-network)\n');r=self.run_build()
        self.assertEqual(r['external_asset_requests'],0)
    def test_root_escape(self):
        self.write('README.md','# Fixture\n[x](../secret.txt)\n');self.assert_rejected('Link escapes source root')
    def test_encoded_root_escape(self):
        self.write('README.md','# Fixture\n[x](%2e%2e/secret.txt)\n');self.assert_rejected('Link escapes source root')
    def test_unknown_suffix_not_silently_dropped(self):
        self.write('examples/input.unknown','independent content');self.assert_rejected('Unclassified source file.*input.unknown')
    def test_non_utf8_not_lossily_decoded(self):
        (self.root/'docs/bad.md').write_bytes(b'\xff');self.assert_rejected('Expected UTF-8; original retained:.*bad.md')
    def test_small_budget(self):self.assert_rejected('File budget exceeded', '--max-file-bytes','2')
    def test_output_inside_source_refused(self):
        with self.assertRaises(b.BuildError):self.run_build('--output',str(self.root/'reading.html'))
        self.assertFalse((self.root/'reading.html').exists())
    def test_existing_output_requires_explicit_replace(self):
        self.out.write_bytes(b'previous edition')
        with self.assertRaises(b.BuildError):self.run_build()
        self.assertEqual(self.out.read_bytes(),b'previous edition')
    def test_lock_collision_does_not_remove_other_lock(self):
        lock=self.out.with_name(self.out.name+'.lock');lock.write_text('another owner')
        with self.assertRaises(b.BuildError):self.run_build()
        self.assertEqual(lock.read_text(),'another owner');self.assertFalse(self.out.exists())
    def test_output_failure_preserves_old_file(self):
        self.out.write_bytes(b'previous edition')
        with patch.object(b.os,'replace',side_effect=OSError('simulated write failure')):
            self.assert_rejected('simulated write failure', expected=OSError)
        self.assertFalse(list(self.home.glob('.*.tmp')))
    def test_source_changes_before_publication(self):
        original=b.Book.build
        def change(book,*args):
            result=original(book,*args);(self.root/'docs/主题.md').write_text('# changed\n');return result
        with patch.object(b.Book,'build',change):self.assert_rejected('Input changed during build')
    def test_output_changed_by_other_writer(self):
        original=b.Book.build;self.out.write_bytes(b'previous edition')
        def change(book,*args):
            result=original(book,*args);self.out.write_bytes(b'other writer');return result
        with patch.object(b.Book,'build',change):
            with self.assertRaises(b.BuildError):self.run_build('--replace')
        self.assertEqual(self.out.read_bytes(),b'other writer')
    @unittest.skipIf(os.name=='nt','Symlink privilege depends on Windows configuration')
    def test_symlink_file_refused(self):
        (self.root/'docs/link.md').symlink_to(self.root/'README.md');self.assert_rejected('linked documentation path:.*link.md', expected=ValueError)
    @unittest.skipIf(os.name=='nt','Symlink privilege depends on Windows configuration')
    def test_symlink_root_refused(self):
        alias=self.home/'alias';alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(b.BuildError):self.run_build('--root',str(alias))
    def test_identical_source_output_reproducible(self):
        self.run_build();a=self.out.read_bytes();self.run_build('--replace');self.assertEqual(a,self.out.read_bytes())
    def test_cli_help(self):
        r=subprocess.run([sys.executable,'-B',str(Path(b.__file__)),'--help'],capture_output=True,text=True)
        self.assertEqual(r.returncode,0);self.assertIn('--diagrams',r.stdout)

class AssertionProtocolTests(unittest.TestCase):
    def test_fixture_is_released_even_when_setup_fails(self):
        case = ReadingTests('test_original_bytes_all_members')
        result = unittest.TestResult()
        with patch.object(Path, 'mkdir', side_effect=OSError('fixture setup failure')):
            case.run(result)
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(len(result.errors), 1)
        self.assertIn('fixture setup failure', result.errors[0][1])
        self.assertFalse(Path(case.temp.name).exists())

    def test_failure_uses_unittest_diagnostic_without_export_side_effects(self):
        case = ReadingTests()
        with patch.object(case, 'run_build') as export:
            with self.assertRaisesRegex(case.failureException, "'observed' != 'expected'"):
                case.assertEqual('observed', 'expected')
            export.assert_not_called()

    def test_rejection_checks_do_not_accept_unrelated_failures(self):
        case = ReadingTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        for error in (KeyError('internal lookup failure'),
                      OSError('unrelated IO failure'),
                      b.BuildError('different validation failure')):
            with self.subTest(error=type(error).__name__):
                with patch.object(case, 'run_build', side_effect=error):
                    expected = case.failureException if isinstance(error,b.BuildError) else type(error)
                    with self.assertRaises(expected):
                        case.assert_rejected('Missing local target')



if __name__=='__main__':unittest.main(verbosity=2)
