#!/usr/bin/env python3
"""Isolated tests for documentation tooling; no SEC product or renderer download."""
from __future__ import annotations
import argparse
import base64
import contextlib
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
from .fixtures import declaration

class Originals(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.current=None; self.files={}; self.links=[]; self.link=None
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='article':self.current=a.get('data-source-path')
        if tag=='a':self.link=[a.get('href'), '']
        if tag=='a' and 'download' in a and self.current:
            self.files[self.current]=base64.b64decode(a['href'].split(',',1)[1],validate=True)
    def handle_data(self,data):
        if self.link is not None:self.link[1]+=data
    def handle_endtag(self,tag):
        if tag=='a' and self.link is not None:
            self.links.append(tuple(self.link));self.link=None

class PublicationSettlement(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='gift-publish-settlement-')
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name);self.out=self.home/'reading.html'
        self.out.write_bytes(b'previous')
        self.lock=self.out.with_name(self.out.name+'.lock')
    def publish(self):
        b.publish_output(self.out,b'next',b'previous',lambda:None)
    def test_lock_metadata_failure_settles_owned_descriptor_and_lock(self):
        primary=OSError('PID write failed')
        native_close=b.os.close
        with patch.object(b.os,'write',side_effect=primary),patch.object(b.os,'close',wraps=native_close) as close:
            with self.assertRaises(OSError) as result:self.publish()
        self.assertIs(result.exception,primary);close.assert_called_once()
        self.assertFalse(self.lock.exists());self.assertEqual(self.out.read_bytes(),b'previous')
    def test_primary_and_multiple_cleanup_errors_remain_independent(self):
        primary=OSError('replace failed');temporary=PermissionError('temporary unlink failed');lock_error=PermissionError('lock unlink failed')
        native_unlink=Path.unlink
        def unlink(path,*args,**kwargs):
            if path==self.lock:raise lock_error
            if path.suffix=='.tmp':raise temporary
            return native_unlink(path,*args,**kwargs)
        with patch.object(b.os,'replace',side_effect=primary),patch.object(Path,'unlink',unlink):
            with self.assertRaises(b.PublicationSettlementError) as result:self.publish()
        error=result.exception
        self.assertIs(error.primary,primary);self.assertFalse(error.committed)
        self.assertEqual([cause for _,cause in error.settlement],[temporary,lock_error])
        self.assertEqual(self.out.read_bytes(),b'previous')
        self.assertTrue(self.lock.exists());self.assertEqual(len(list(self.home.glob('.*.tmp'))),1)
        self.assertIn('replace failed',str(error));self.assertIn('temporary unlink failed',str(error))
    def test_post_replace_cleanup_failure_reports_published_output(self):
        native_unlink=Path.unlink
        def unlink(path,*args,**kwargs):
            if path==self.lock:raise PermissionError('lock cleanup failed')
            return native_unlink(path,*args,**kwargs)
        with patch.object(Path,'unlink',unlink):
            with self.assertRaises(b.PublicationSettlementError) as result:self.publish()
        self.assertTrue(result.exception.committed);self.assertIsNone(result.exception.primary)
        self.assertIn('output published',str(result.exception));self.assertEqual(self.out.read_bytes(),b'next')
    def test_descriptor_cleanup_failure_still_attempts_lock_unlink(self):
        primary=OSError('PID write failed');cleanup=OSError('close failed')
        native_close=b.os.close
        def close(fd):
            native_close(fd);raise cleanup
        with patch.object(b.os,'write',side_effect=primary),patch.object(b.os,'close',side_effect=close):
            with self.assertRaises(b.PublicationSettlementError) as result:self.publish()
        self.assertIs(result.exception.primary,primary)
        self.assertIs(result.exception.settlement[0][1],cleanup)
        self.assertFalse(self.lock.exists());self.assertFalse(result.exception.committed)
    def test_stream_write_and_close_failures_are_both_retained(self):
        primary=OSError('stream write failed');cleanup=OSError('stream close failed')
        native_fdopen=b.os.fdopen
        class Stream:
            def __init__(self,fd,mode):self.stream=native_fdopen(fd,mode)
            @property
            def closed(self):return self.stream.closed
            def write(self,data):raise primary
            def close(self):self.stream.close();raise cleanup
        with patch.object(b.os,'fdopen',side_effect=Stream):
            with self.assertRaises(b.PublicationSettlementError) as result:self.publish()
        self.assertIs(result.exception.primary,primary)
        self.assertIs(result.exception.settlement[0][1],cleanup)
        self.assertFalse(result.exception.committed);self.assertFalse(self.lock.exists())
        self.assertEqual(list(self.home.glob('.*.tmp')),[])
        self.assertEqual(self.out.read_bytes(),b'previous')
    def test_successful_write_then_first_close_failure_retains_uncertain_stream_without_retry(self):
        cleanup=OSError('first close failed before releasing handle')
        native_fdopen=b.os.fdopen;streams=[]
        class Stream:
            def __init__(self,fd,mode):
                self.stream=native_fdopen(fd,mode);self.closes=0;streams.append(self)
            @property
            def closed(self):return self.stream.closed
            def write(self,data):return self.stream.write(data)
            def flush(self):return self.stream.flush()
            def fileno(self):return self.stream.fileno()
            def close(self):self.closes+=1;raise cleanup
        try:
            with patch.object(b.os,'fdopen',side_effect=Stream),patch.object(b.os,'replace') as replace:
                with self.assertRaises(b.PublicationSettlementError) as result:self.publish()
            error=result.exception
            self.assertIsNone(error.primary);self.assertIs(error.settlement[0][1],cleanup)
            self.assertIs(error.unsettled_stream,streams[0]);self.assertTrue(error.residuals)
            self.assertIn('unsettled resource',str(error));self.assertFalse(error.committed)
            self.assertEqual(streams[0].closes,1);self.assertFalse(streams[0].closed)
            replace.assert_not_called();self.assertFalse(self.lock.exists())
            self.assertEqual(self.out.read_bytes(),b'previous')
        finally:
            # Fixture recovery owns its deliberately retained native handle.
            for stream in streams:stream.stream.close()

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
    def assert_publication_preserves_previous(self,message,*extra,error=b.BuildError):
        self.out.write_bytes(b'previous edition')
        with self.assertRaisesRegex(error,message):
            self.run_build('--replace',*extra)
        self.assertEqual(self.out.read_bytes(),b'previous edition')
        self.assertFalse(self.out.with_name(self.out.name+'.lock').exists())
    def reference_book(self,sealed=False,**budgets):
        args=argparse.Namespace(diagrams='source',diagram_cache=None,sealed=sealed,
            max_file_bytes=budgets.get('max_file_bytes',16_000_000),max_total_bytes=budgets.get('max_total_bytes',80_000_000))
        captured=b.capture(self.root,args)
        return b.Book(self.root,captured,args),captured
    def track_references(self,*names):
        subprocess.run(['git','init','-q',str(self.root)],check=True,capture_output=True)
        subprocess.run(['git','-C',str(self.root),'add','--',*names],check=True,capture_output=True)
    def test_repository_reference_closure_builds_real_articles_without_changing_source_identity(self):
        self.write('README.md','# Fixture\n[contract](config/work.json)\n[skill](.agents/guide.md#use)\n')
        self.write('config/work.json','{"work":"real"}\n')
        self.write('.agents/guide.md','# Guide\n## Use\n[source](../src/value.ts)\n[cycle](../README.md)\n')
        self.write('src/value.ts','export const value = 1;\n')
        self.track_references('config/work.json','.agents/guide.md','src/value.ts')
        book,captured=self.reference_book();output,meta=book.build({'state':'not-rendered'})
        repeated,repeated_meta=book.build({'state':'not-rendered'})
        self.assertEqual(repeated,output);self.assertEqual(repeated_meta,meta)
        self.assertEqual(meta['source_set_sha256'],b.source_identity_from_capture(captured))
        self.assertEqual({x['path'] for x in meta['reading_attachments']},{'config/work.json','.agents/guide.md','src/value.ts'})
        self.assertEqual({x['path'] for x in meta['source_files']},set(captured))
        originals=Originals();originals.feed(output.decode())
        for name in book.attachments:self.assertEqual(originals.files[name],(self.root/name).read_bytes())
        self.assertIn(b.fragment_id('.agents/guide.md','use').encode(),output)
        book.unchanged();self.write('src/value.ts','export const value = 2;\n')
        with self.assertRaisesRegex(b.BuildError,'attachment changed'):book.unchanged()
        changed,_=self.reference_book();_,changed_meta=changed.build({'state':'not-rendered'})
        self.assertEqual(changed_meta['source_set_sha256'],meta['source_set_sha256'])
        self.assertNotEqual(changed_meta['reading_attachments_sha256'],meta['reading_attachments_sha256'])
        self.assertNotEqual(changed_meta['input_set_sha256'],meta['input_set_sha256'])
    def test_sealed_missing_repository_reference_is_explicit_and_never_calls_git(self):
        self.write('README.md','# Fixture\n[contract](config/absent.json)\n<a href="src/absent.ts">source</a>\n')
        with patch.object(b.subprocess,'run',side_effect=AssertionError('Git forbidden')),patch.object(b.subprocess,'check_output',side_effect=AssertionError('Git forbidden')):
            book,_=self.reference_book(sealed=True);output,meta=book.build({'state':'not-rendered'});book.unchanged()
            repeated,repeated_meta=book.build({'state':'not-rendered'})
            self.assertEqual(repeated,output);self.assertEqual(repeated_meta,meta)
        self.assertEqual({x['path'] for x in meta['unavailable_repository_references']},{'config/absent.json','src/absent.ts'})
        self.assertIn('本包未携带仓库引用'.encode(),output)
        audit=b.AuditHTML();audit.feed(output.decode())
        self.assertNotIn('#'+b.opaque('config/absent.json'),audit.links)
    def test_repository_attachment_untracked_fragment_and_budget_reject(self):
        self.write('README.md','# Fixture\n[skill](.agents/guide.md#missing)\n')
        self.write('.agents/guide.md','# Guide\n')
        self.track_references('README.md')
        with self.assertRaisesRegex(b.BuildError,'not tracked'):self.reference_book()
        self.track_references('.agents/guide.md')
        book,_=self.reference_book()
        for _ in range(2):
            with self.assertRaisesRegex(b.BuildError,'Missing local fragment'):book.build({'state':'not-rendered'})
        self.write('README.md','# Fixture\n[data](config/large.json)\n');self.write('config/large.json','x'*20_000)
        self.track_references('config/large.json')
        with self.assertRaisesRegex(b.BuildError,'attachment budget'):self.reference_book(max_file_bytes=10_000)
    def test_sealed_source_missing_still_rejects_and_carried_attachment_is_real(self):
        self.write('README.md','# Fixture\n[missing](docs/not-present.md)\n')
        with self.assertRaisesRegex(b.BuildError,'Missing local target'):self.reference_book(sealed=True)
        self.write('README.md','# Fixture\n[carried](config/work.json)\n');self.write('config/work.json','{}')
        with patch.object(b.subprocess,'run',side_effect=AssertionError('Git forbidden')):
            book,_=self.reference_book(sealed=True);output,meta=book.build({'state':'not-rendered'})
        self.assertEqual([x['path'] for x in meta['reading_attachments']],['config/work.json'])
        self.assertIn(b.opaque('config/work.json').encode(),output)
    def test_commonmark_setext_multiline_empty_and_inline_heading_anchors(self):
        self.write('README.md','# Fixture\n[attachment](config/guide.md#title-next)\n')
        self.write('config/guide.md','Title\nNext\n----\n\n#\n\n# **Rich** `code`\n\n# <a id="custom"></a> Inline\n')
        self.track_references('config/guide.md')
        book,_=self.reference_book();output,_=book.build({'state':'not-rendered'})
        for fragment in ('title-next','','rich-code','-inline','custom'):
            self.assertIn(('id="'+b.fragment_id('config/guide.md',fragment)+'"').encode(),output)
    def test_all_source_bytes_are_preserved_and_code_is_inert(self):
        self.write('examples/value.json','{ "名字": "😀", "n": "9007199254740993" }\n')
        self.write('examples/value.gift','export fn identity(x: Int) = x;\n')
        self.write('examples/public.d.ts', 'export declare function normalize(x: bigint): bigint;\n')
        self.write('examples/fixture.ts', 'export const value = "<script>never_execute()</script>";\n')
        self.write('docs/design/control.sql','CREATE TABLE operation(id TEXT PRIMARY KEY);\n-- <script>unsafe()</script>\n')
        self.write('README.md','# Fixture\n[SQL design](docs/design/control.sql)\n')
        before={q.relative_to(self.root).as_posix():q.read_bytes() for q in self.root.rglob('*') if q.is_file()}
        self.run_build();text=self.out.read_text();originals=Originals();originals.feed(text)
        self.assertEqual(before,{q.relative_to(self.root).as_posix():q.read_bytes() for q in self.root.rglob('*') if q.is_file()})
        self.assertEqual(originals.files,before)
        audit=b.AuditHTML();audit.feed(text)
        self.assertFalse(audit.handlers)
        self.assertFalse(audit.remote)
        self.assertNotIn('<script>never_execute()</script>',text)
        self.assertIn('CREATE TABLE operation(id TEXT PRIMARY KEY);',text)
        self.assertNotIn('<script>unsafe()</script>',text)
    def test_ordinary_reading_does_not_open_or_embed_local_projections(self):
        first=self.run_build();first_output=self.out.read_bytes()
        for name in ('.documentation/source-manifest.json','.documentation/requirements.json'):
            (self.root/name).write_bytes(b'\xffstale local output')
        second=self.run_build('--replace')
        self.assertEqual(first['source_set_sha256'],second['source_set_sha256'])
        self.assertEqual(first['input_set_sha256'],second['input_set_sha256'])
        self.assertEqual(self.out.read_bytes(),first_output)
        self.assertNotIn('stale local output',self.out.read_text())
    def test_sealed_reading_verifies_the_same_capture_once(self):
        self.write('.documentation/source-manifest.json','{}')
        with patch.object(b.check_docs,'verify',return_value={})as verify:
            self.run_build('--sealed')
        verify.assert_called_once()
        self.assertTrue(verify.call_args.kwargs['sealed'])
        self.assertEqual(verify.call_args.kwargs['captured']['README.md'],(self.root/'README.md').read_bytes())
    def test_sealed_source_drift_after_verification_still_preserves_output(self):
        self.write('.documentation/source-manifest.json','{}')
        def changed(*args,**kwargs):self.write('README.md','# Changed after verification\n');return {}
        with patch.object(b.check_docs,'verify',side_effect=changed):
            self.assert_publication_preserves_previous('Input changed during build: README.md','--sealed')
    def test_sealed_reading_without_snapshot_does_not_publish(self):
        self.assert_publication_preserves_previous('Sealed reading requires a source snapshot','--sealed')
    def test_default_output_and_title_use_the_design_name(self):
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            b.main(['--root',str(self.root),'--diagrams','source'])
        self.assertIn('<title>Gift 工程设计</title>',(self.home/'Gift.html').read_text())
    def test_source_mode_explicitly_unrendered(self):
        (self.root/'.documentation/figures.json').write_bytes(b'\xffinvalid cache')
        self.write('docs/graph.md','# Graph\n\n```mermaid\nflowchart LR\n A-->B\n```\n')
        data=self.run_build();self.assertEqual(data['diagrams'],1);self.assertEqual(data['rendered'],0)
        self.assertIn('未渲染',self.out.read_text())
    def test_missing_mermaid_does_not_publish(self):
        self.assert_publication_preserves_previous('All diagrams are required','--diagrams','required','--mermaid-js','')
    def test_missing_file(self):
        self.write('docs/主题.md','# 主题\n\n## 字段\n[x](not-here.md)\n');self.assert_publication_preserves_previous('Missing local target')
    def test_missing_fragment(self):
        self.write('README.md','# Fixture\n[x](docs/主题.md#不存在)\n');self.assert_publication_preserves_previous('Missing local fragment')
    def test_duplicate_explicit_anchor(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a id="same"></a>\n<a id="same"></a>\n');self.assert_publication_preserves_previous('Ambiguous source anchors')
    def test_explicit_heading_collision(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a id="字段"></a>\n');self.assert_publication_preserves_previous('Ambiguous source anchors')
    def test_outline_uses_real_commonmark_headings_and_scoped_targets(self):
        self.write('README.md','# Fixture\n')
        self.write('docs/主题.md','# 主题\n\n### 只有三级\n\n二级\n----\n\n## 重复\n## 重复\n[第二](#重复-1)\n\n<a id="alias"></a>\n#### **字段** `<unsafe>`\n\n```md\n## 围栏假标题\n```\n')
        self.write('docs/other.md','# 主题\n## 字段\n')
        self.run_build();text=self.out.read_text()
        class Outline(HTMLParser):
            def __init__(self):super().__init__(convert_charrefs=True);self.inside=False;self.links=[];self.labels=[]
            def handle_starttag(self,tag,attrs):
                attrs=dict(attrs)
                if tag=='nav' and attrs.get('aria-label')=='本页内容':self.inside=True
                if self.inside and tag=='a':self.links.append(attrs['href'])
            def handle_endtag(self,tag):
                if tag=='nav':self.inside=False
            def handle_data(self,data):
                if self.inside:self.labels.append(data)
        outline=Outline();outline.feed(text)
        expected=['只有三级','二级','重复','重复-1','字段-']
        scoped_prefix='#'+b.opaque('docs/主题.md')+'--'
        self.assertEqual([link for link in outline.links if link.startswith(scoped_prefix)],
                         ['#'+b.fragment_id('docs/主题.md',f) for f in expected])
        self.assertEqual(outline.links.count('#'+b.fragment_id('docs/other.md','字段')),1)
        self.assertCountEqual(outline.links,['#'+b.fragment_id('docs/主题.md',f) for f in expected]+
                              ['#'+b.fragment_id('docs/other.md','字段')])
        audit=b.AuditHTML();audit.feed(text)
        self.assertTrue(all(link[1:] in audit.ids for link in outline.links))
        self.assertEqual(len(audit.ids),len(set(audit.ids)))
        originals=Originals();originals.feed(text)
        self.assertIn(('#'+b.fragment_id('docs/主题.md','重复-1'),'第二'),originals.links)
        self.assertNotIn('围栏假标题',''.join(outline.labels))
        self.assertIn('字段 <unsafe>',''.join(outline.labels))
        self.assertNotIn('<unsafe>',text)
    def test_outline_regenerates_from_changed_source_and_preserves_original(self):
        self.run_build()
        source='# 主题\n\n## 字段\n\n#### 后来新增\n'
        self.write('docs/主题.md',source);self.run_build('--replace')
        text=self.out.read_text()
        self.assertIn('href="#'+b.fragment_id('docs/主题.md','后来新增')+'"',text)
        originals=Originals();originals.feed(text)
        self.assertEqual(originals.files['docs/主题.md'],(self.root/'docs/主题.md').read_bytes())
        self.write('README.md','# Fixture\n')
        self.write('docs/主题.md','# 短页\n\n正文。\n');self.run_build('--replace')
        self.assertNotIn('class="page-contents"',self.out.read_text())
    def test_chinese_encoded_links_and_directory(self):
        self.write('docs/group/README.md','# Group\n')
        self.write('README.md','# Fixture\n[x](docs/%E4%B8%BB%E9%A2%98.md#%E5%AD%97%E6%AE%B5)\n[y](docs/group/)\n')
        self.run_build();reader=Originals();reader.feed(self.out.read_text())
        self.assertIn(('#'+b.fragment_id('docs/主题.md','字段'),'x'),reader.links)
        self.assertIn(('#'+b.opaque('docs/group/README.md'),'y'),reader.links)
    def test_reference_style_table_and_details(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<details>\n<summary>详细</summary>\n\n| 项 | 值 |\n|---|---|\n| a | b |\n\n</details>\n[返回][r]\n\n[r]: ../README.md\n')
        self.run_build();s=self.out.read_text();self.assertIn('<details>',s);self.assertIn('<table>',s)
        reader=Originals();reader.feed(s);self.assertIn(('#'+b.opaque('README.md'),'返回'),reader.links)
    def test_unclosed_fence(self):
        self.write('docs/主题.md','# 主题\n## 字段\n```text\nunclosed\n');self.assert_publication_preserves_previous('unclosed fenced code block',error=ValueError)
    def test_unsafe_scheme(self):
        self.write('docs/主题.md','# 主题\n## 字段\n<a href="javascript:alert(1)">x</a>\n');self.assert_publication_preserves_previous('Unsupported/active URI')
    def test_untrusted_markup_is_inert_and_remote_links_are_passive(self):
        url='https://example.invalid/no-network'
        self.write('docs/主题.md','# 主题\n## 字段\n<script>alert("bad")</script>\n\nType<T>\n\n<span onclick="alert(1)">label</span>\n\n[x]('+url+')\n')
        with patch('socket.socket.connect',side_effect=AssertionError('Reading links must not open a network connection')):
            result=self.run_build()
        s=self.out.read_text();self.assertIn('&lt;script&gt;',s)
        self.assertIn('Type&lt;T&gt;',s)
        self.assertIn({'path':'docs/主题.md','tag_or_attribute':'span@onclick'},result['raw_html_review'])
        audit=b.AuditHTML();audit.feed(s);self.assertEqual(len(audit.scripts),1);self.assertFalse(audit.handlers)
        self.assertIn(url,audit.links);self.assertFalse(audit.remote)
    def test_remote_image_rejected(self):
        self.write('docs/主题.md','# 主题\n## 字段\n![x](https://example.invalid/image.png)\n');self.assert_publication_preserves_previous('Expected local reference')
    def test_encoded_root_escape(self):
        self.write('README.md','# Fixture\n[x](%2e%2e/secret.txt)\n');self.assert_publication_preserves_previous('Link escapes source root')
    def test_unknown_suffix_not_silently_dropped(self):
        self.write('examples/input.unknown','independent content');self.assert_publication_preserves_previous('Unclassified source file')
    def test_non_utf8_not_lossily_decoded(self):
        (self.root/'docs/bad.md').write_bytes(b'\xff');self.assert_publication_preserves_previous('Expected UTF-8')
    def test_small_budget(self):self.assert_publication_preserves_previous('File budget exceeded','--max-file-bytes','2')
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
            self.assert_publication_preserves_previous('simulated write failure',error=OSError)
        self.assertFalse(list(self.home.glob('.*.tmp')))
    def test_source_changes_before_publication(self):
        original=b.Book.build
        def change(book,*args):
            result=original(book,*args);(self.root/'docs/主题.md').write_text('# changed\n');return result
        with patch.object(b.Book,'build',change):self.assert_publication_preserves_previous('Input changed during build')
    def test_output_changed_by_other_writer(self):
        original=b.Book.build;self.out.write_bytes(b'previous edition')
        def change(book,*args):
            result=original(book,*args);self.out.write_bytes(b'other writer');return result
        with patch.object(b.Book,'build',change):
            with self.assertRaises(b.BuildError):self.run_build('--replace')
        self.assertEqual(self.out.read_bytes(),b'other writer')
    @unittest.skipIf(os.name=='nt','Symlink privilege depends on Windows configuration')
    def test_symlink_file_refused(self):
        (self.root/'docs/link.md').symlink_to(self.root/'README.md');self.assert_publication_preserves_previous('linked documentation path',error=ValueError)
    @unittest.skipIf(os.name=='nt','Symlink privilege depends on Windows configuration')
    def test_symlink_root_refused(self):
        alias=self.home/'alias';alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(b.BuildError):self.run_build('--root',str(alias))

class CommandHelp(unittest.TestCase):
    def test_cli_help(self):
        r=subprocess.run([sys.executable,'-B',str(Path(b.__file__)),'--help'],capture_output=True,text=True)
        self.assertEqual(r.returncode,0);self.assertIn('--diagrams',r.stdout)

if __name__=='__main__':unittest.main(verbosity=2)
