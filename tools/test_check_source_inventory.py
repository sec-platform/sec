"""Standard-library boundary checks for the canonical documentation gate."""
from pathlib import Path
import json
import tempfile
import unittest
from source_inventory import source_files, local_path, load


class SourceBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sec-doc-source-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / '.documentation').mkdir()
        (self.root / 'docs').mkdir()
        (self.root / 'docs/规则.md').write_text('# 规则\n', encoding='utf-8')
        self.declare(['.documentation', 'docs'])

    def declare(self, roots, exemptions=()):
        (self.root / '.documentation/baseline.json').write_text(
            json.dumps({'source_roots': roots, 'audited_namespaces': ['docs'],
                        'non_documentation_roots': list(exemptions)}), encoding='utf-8')

    def names(self):
        return {p.relative_to(self.root).as_posix() for p in source_files(self.root)}

    def test_detects_new_member_without_reading_unrelated_repository_files(self):
        (self.root / 'src').mkdir()
        (self.root / 'src/product.ts').write_bytes(b'\xff')
        before = self.names()
        (self.root / 'docs/new.md').write_text('# New\n', encoding='utf-8')
        self.assertEqual(self.names() - before, {'docs/new.md'})
        self.assertNotIn('src/product.ts', self.names())

    def test_no_silent_cache_directory_omission_inside_declared_source(self):
        (self.root / 'docs/node_modules').mkdir()
        (self.root / 'docs/node_modules/unexpected.txt').write_text('unexpected')
        self.assertIn('docs/node_modules/unexpected.txt', self.names())

    def test_missing_and_overlapping_roots_reject(self):
        for roots in (['absent'], ['docs', 'docs/规则.md'], ['docs', 'docs'], [{}], []):
            with self.subTest(roots=roots):
                self.declare(roots)
                with self.assertRaises(ValueError):
                    source_files(self.root)

    def test_unsafe_root_and_member_names_reject(self):
        for name in ('../outside', '/absolute', 'docs//bad', 'C:/outside', 'docs\\bad', ''):
            with self.subTest(name=name), self.assertRaises(ValueError):
                local_path(self.root, name)

    def test_duplicate_metadata_keys_reject(self):
        metadata = self.root / '.documentation/baseline.json'
        metadata.write_text('{"source_roots":[],"source_roots":["docs"]}')
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            load(metadata)

    def test_retired_authority_cannot_hide_outside_declared_source_roots(self):
        self.declare(['.documentation', 'docs/规则.md'])
        (self.root / 'docs/authority.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'unexpected file in documentation namespace'):
            self.names()

    def test_explicit_machine_history_is_separate_but_cannot_exempt_source(self):
        (self.root / 'docs/work').mkdir()
        (self.root / 'docs/work/history.md').write_text('published machine record')
        self.declare(['.documentation', 'docs/规则.md'], ['docs/work'])
        self.assertNotIn('docs/work/history.md', self.names())
        self.declare(['.documentation', 'docs/规则.md'], ['docs/规则.md'])
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            self.names()

    def test_machine_exemption_cannot_cover_entire_namespace(self):
        self.declare(['.documentation'], ['docs'])
        with self.assertRaisesRegex(ValueError, 'inside an audited namespace'):
            self.names()

    def test_symlink_to_external_content_rejects(self):
        outside = self.root / 'outside.txt'
        outside.write_text('private')
        link = self.root / 'docs/link.txt'
        try:
            link.symlink_to(outside)
        except OSError as error:
            self.skipTest(str(error))
        with self.assertRaisesRegex(ValueError, 'linked documentation path'):
            source_files(self.root)


if __name__ == '__main__':
    unittest.main()
