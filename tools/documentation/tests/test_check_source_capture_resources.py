"""Regression contracts for bounded documentation capture and resource settlement."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
import stat
import tempfile
import unittest

from .test_check_documentation_identity import declaration
from source_inventory import (
    MAX_FILE_BYTES,
    ProjectionSettlementError,
    _replace_json,
    documentation_files,
    read_ordinary,
    source_files,
)


class CaptureResources(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sec-capture-resources-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / '.documentation').mkdir()
        (self.root / 'docs').mkdir()
        (self.root / 'docs/main.md').write_bytes(b'captured')
        self.declare(['.documentation', 'docs'])

    def declare(self, roots):
        (self.root / '.documentation/baseline.json').write_text(
            json.dumps(declaration(roots)), encoding='utf-8')

    def test_ordinary_and_empty_files_keep_their_bytes(self):
        for data in (b'captured', b''):
            with self.subTest(data=data):
                (self.root / 'docs/main.md').write_bytes(data)
                self.assertEqual(read_ordinary(self.root, 'docs/main.md'), data)

    def test_rejects_nonregular_and_oversized_opened_handles_before_read(self):
        for mode, size in ((stat.S_IFIFO, 0), (stat.S_IFREG, MAX_FILE_BYTES + 1)):
            with self.subTest(mode=mode, size=size):
                native_close = os.close
                with patch('source_inventory.os.fstat', return_value=SimpleNamespace(
                    st_mode=mode, st_size=size
                )), patch('source_inventory.os.read') as read, patch(
                    'source_inventory.os.close', wraps=native_close
                ) as close:
                    with self.assertRaisesRegex(ValueError, 'non-ordinary or oversized'):
                        read_ordinary(self.root, 'docs/main.md')
                    read.assert_not_called()
                    close.assert_called_once()

    def test_rejects_same_byte_different_opened_object(self):
        other = self.root / 'other.md'
        other.write_bytes(b'captured')
        native_open = os.open
        with patch('source_inventory.os.open', side_effect=lambda _, flags: native_open(other, flags)):
            with self.assertRaisesRegex(ValueError, 'changed before capture'):
                read_ordinary(self.root, 'docs/main.md')

    def test_capture_preserves_primary_and_close_failures(self):
        primary = OSError('capture stat failed')
        cleanup = OSError('capture close failed')
        native_close = os.close
        def close(fd):
            native_close(fd)
            raise cleanup
        with patch('source_inventory.os.fstat', side_effect=primary), patch(
            'source_inventory.os.close', side_effect=close
        ):
            with self.assertRaises(ProjectionSettlementError) as result:
                read_ordinary(self.root, 'docs/main.md')
        self.assertIs(result.exception.primary, primary)
        self.assertIs(result.exception.settlement, cleanup)

    def test_empty_directory_depth_consumes_traversal_budget(self):
        current = self.root / 'docs'
        for _ in range(10):
            current = current / 'empty'
            current.mkdir()
        with patch('source_inventory.MAX_MEMBERS', 8):
            with self.assertRaisesRegex(ValueError, 'traversal budget exceeded'):
                source_files(self.root)

    def test_fanout_is_bounded_while_streaming_and_closes(self):
        class Directory:
            reads = 0
            closes = 0
            def __iter__(self):
                return self
            def __next__(self):
                self.reads += 1
                if self.reads > 8:
                    raise AssertionError('directory was read beyond admission')
                return SimpleNamespace(name=f'{self.reads}.md')
            def close(self):
                self.closes += 1
        stream = Directory()
        with patch('source_inventory.MAX_MEMBERS', 8), patch('source_inventory.os.scandir', return_value=stream):
            with self.assertRaisesRegex(ValueError, 'traversal budget exceeded'):
                source_files(self.root)
        self.assertLessEqual(stream.reads, 8)
        self.assertEqual(stream.closes, 1)

    def test_directory_iteration_and_close_failures_are_both_retained(self):
        primary = OSError('directory read failed')
        cleanup = OSError('directory close failed')
        class Directory:
            def __iter__(self):
                raise primary
            def close(self):
                raise cleanup
        with patch('source_inventory.os.scandir', return_value=Directory()):
            with self.assertRaises(ProjectionSettlementError) as result:
                source_files(self.root)
        self.assertIs(result.exception.primary, primary)
        self.assertIs(result.exception.settlement, cleanup)

    def test_component_sorted_roots_do_not_miss_overlap_behind_similar_prefix(self):
        (self.root / 'docs-other').mkdir()
        (self.root / 'docs/x').mkdir()
        self.declare(['.documentation', 'docs', 'docs-other', 'docs/x'])
        with self.assertRaisesRegex(ValueError, 'source roots overlap'):
            source_files(self.root)

    def test_root_budget_precedes_source_root_expansion(self):
        self.declare([f'absent-{i}' for i in range(9)])
        native_lstat = Path.lstat
        expanded = []
        def observe(path, *args, **kwargs):
            if path.name.startswith('absent-'):
                expanded.append(path)
            return native_lstat(path, *args, **kwargs)
        with patch('source_inventory.MAX_MEMBERS', 8), patch.object(Path, 'lstat', observe):
            with self.assertRaisesRegex(ValueError, 'source root budget exceeded'):
                source_files(self.root)
        self.assertEqual(expanded, [], 'Rejected roots must not reach filesystem observation')

    def test_all_boundary_lists_are_admitted_before_any_declared_path_is_observed(self):
        from source_inventory import baseline
        for key in ('audited_namespaces', 'non_documentation_roots', 'excluded_from_source_hash'):
            with self.subTest(key=key):
                value = declaration(['absent-source'])
                value[key] = [f'absent-{i}' for i in range(9)]
                (self.root / '.documentation/baseline.json').write_text(
                    json.dumps(value), encoding='utf-8')
                native_lstat = Path.lstat
                expanded = []
                def observe(path, *args, **kwargs):
                    if path.name.startswith('absent-'):
                        expanded.append(path)
                    return native_lstat(path, *args, **kwargs)
                with patch('source_inventory.MAX_MEMBERS', 8), patch.object(Path, 'lstat', observe):
                    with self.assertRaisesRegex(ValueError, 'budget exceeded'):
                        baseline(self.root)
                self.assertEqual(expanded, [], 'No declaration can be expanded before admission')

    def test_root_count_limit_is_inclusive(self):
        from source_inventory import baseline
        roots = [f'absent-{i}' for i in range(8)]
        self.declare(roots)
        with patch('source_inventory.MAX_MEMBERS', 8):
            self.assertEqual(baseline(self.root)['source_roots'], roots)

    def test_projection_write_and_close_failures_keep_both_causes_and_remove_temp(self):
        primary = OSError('projection write failed')
        cleanup = OSError('projection close failed')
        native_close = os.close
        failed_descriptor = None
        def write(fd, data):
            nonlocal failed_descriptor
            failed_descriptor = fd
            raise primary
        def close(fd):
            native_close(fd)
            if fd == failed_descriptor:
                raise cleanup
        with patch('source_inventory.os.write', side_effect=write), patch(
            'source_inventory.os.close', side_effect=close
        ):
            with self.assertRaises(ProjectionSettlementError) as result:
                _replace_json(self.root / '.documentation/requirements.json', {'items': []})
        self.assertIs(result.exception.primary, primary)
        self.assertIs(result.exception.settlement, cleanup)
        self.assertFalse((self.root / '.documentation/requirements.json').exists())
        self.assertEqual(list((self.root / '.tmp').glob('doc-projection-*.tmp')), [])

    def test_projection_short_writes_are_completed_before_publication(self):
        native_write = os.write
        with patch('source_inventory.os.write', side_effect=lambda fd, data: native_write(fd, data[:2])):
            _replace_json(self.root / '.documentation/requirements.json', {'items': []})
        self.assertEqual(json.loads((self.root / '.documentation/requirements.json').read_text()), {'items': []})

    def test_optional_leaf_absence_cannot_hide_a_lost_parent(self):
        native_lstat = Path.lstat
        missing = FileNotFoundError('metadata parent disappeared')
        parent_missing = False
        def lstat(path, *args, **kwargs):
            nonlocal parent_missing
            if path == self.root / '.documentation/figures.json':
                parent_missing = True
                raise FileNotFoundError('optional leaf lookup failed')
            if parent_missing and path == self.root / '.documentation':
                raise missing
            return native_lstat(path, *args, **kwargs)
        with patch.object(Path, 'lstat', lstat):
            with self.assertRaises(FileNotFoundError) as result:
                documentation_files(self.root)
        self.assertIs(result.exception, missing)


if __name__ == '__main__':
    unittest.main()
