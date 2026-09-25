"""Standard-library boundary checks for the canonical documentation gate."""
from pathlib import Path, PurePosixPath, PureWindowsPath
import hashlib
import json
import tempfile
import unittest
from .test_check_documentation_identity import declaration
from source_inventory import (
    _source_root_index,
    load,
    local_path,
    refresh_source_manifest,
    source_files,
)


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
            json.dumps({**declaration(roots),
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

    def test_root_overlap_respects_both_path_flavors_without_sort_adjacency(self):
        # Validate the actual pure admission algorithm, not a filename or helper
        # presence. Native filesystem capture is covered separately. relative_to
        # gives this oracle the path flavor's independent component semantics.
        choices = ('docs', 'Docs', 'docs/child', 'Docs/child', 'docs-other',
                   'docs-other/child', 'src', 'SRC/file')
        for flavor, base in ((PurePosixPath, '/repo'), (PureWindowsPath, 'C:/repo')):
            for left in choices:
                for right in choices:
                    roots = [flavor(base, left), flavor(base, right)]
                    overlap = False
                    for child, parent in ((roots[0], roots[1]), (roots[1], roots[0])):
                        try:
                            child.relative_to(parent)
                        except ValueError:
                            pass
                        else:
                            overlap = True
                    with self.subTest(flavor=flavor.__name__, left=left, right=right):
                        if overlap:
                            with self.assertRaisesRegex(ValueError, 'source roots overlap'):
                                _source_root_index(roots)
                        else:
                            admitted, ancestors = _source_root_index(roots)
                            self.assertEqual(admitted, set(roots))
                            for source in roots:
                                parent = source.parent
                                while parent != source:
                                    self.assertIn(parent, ancestors)
                                    source, parent = parent, parent.parent

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

    def test_explicit_non_documentation_root_is_separate_but_cannot_exempt_source(self):
        (self.root / 'docs/generated').mkdir()
        (self.root / 'docs/generated/index.md').write_text('machine projection')
        self.declare(['.documentation', 'docs/规则.md'], ['docs/generated'])
        self.assertNotIn('docs/generated/index.md', self.names())
        self.declare(['.documentation', 'docs/规则.md'], ['docs/规则.md'])
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            self.names()

    def test_machine_exemption_cannot_cover_entire_namespace(self):
        self.declare(['.documentation'], ['docs'])
        with self.assertRaisesRegex(ValueError, 'inside an audited namespace'):
            self.names()

    def test_component_boundary_matrix_preserves_members_and_rejection_causes(self):
        # This oracle uses explicit component prefixes and authored file names,
        # not the production traversal, pathlib parent sets, or a prior capture.
        (self.root / 'docs/kept').mkdir()
        (self.root / 'docs/规则.md').rename(self.root / 'docs/kept/source.md')
        (self.root / 'docs/cache/nested').mkdir(parents=True)
        (self.root / 'docs/cache/nested/output.bin').write_bytes(b'projection')
        (self.root / 'docs-other').mkdir()
        (self.root / 'docs-other/source.md').write_bytes(b'independent source')
        authored = {'.documentation/baseline.json', 'docs/kept/source.md',
                    'docs/cache/nested/output.bin', 'docs-other/source.md'}

        def covers(parent, child, strict=False):
            a, b = parent.split('/'), child.split('/')
            return b[:len(a)] == a and (not strict or len(b) > len(a))

        sources = ('docs', 'docs/kept', 'docs/kept/source.md', 'docs/cache/nested')
        namespaces = (('docs',), ('docs', 'docs/cache'),
                      ('docs/kept', 'docs/cache'), ('docs', 'docs-other'))
        exemptions = ((), ('docs/cache',), ('docs/cache/nested',),
                      ('docs/cache/nested/output.bin',), ('docs',), ('docs/kept',),
                      ('docs/kept/source.md',), ('docs-other',), ('docs/cach',),
                      ('docs/missing',), ('docs/cache', 'docs/cache/nested'),
                      ('docs/cache', 'docs/missing'))
        for source in sources:
            roots = ['.documentation', source, 'docs-other/source.md']
            expected_members = {name for name in authored
                                if any(covers(parent, name) for parent in roots)}
            for audited in namespaces:
                for exempted in exemptions:
                    problem = None
                    for exempt in exempted:
                        if not any(covers(ns, exempt, strict=True) for ns in audited):
                            problem = 'non-documentation root must be inside an audited namespace'
                            break
                        if any(covers(src, exempt) or covers(exempt, src) for src in roots):
                            problem = 'non-documentation root overlaps a documentation source root'
                            break
                    if problem is None and any(
                        any(covers(ns, name) for ns in audited)
                        and not any(covers(exempt, name) for exempt in exempted)
                        and name not in expected_members for name in authored
                    ):
                        problem = 'unexpected file in documentation namespace'
                    value = {**declaration(roots), 'audited_namespaces': list(audited),
                             'non_documentation_roots': list(exempted)}
                    (self.root / '.documentation/baseline.json').write_text(
                        json.dumps(value), encoding='utf-8')
                    with self.subTest(source=source, audited=audited, exempted=exempted):
                        if problem is None:
                            self.assertEqual(self.names(), expected_members)
                        else:
                            with self.assertRaisesRegex(ValueError, problem):
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

    def test_refresh_publishes_complete_canonical_members_and_matching_digest(self):
        authority = self.root / 'docs/产品/产品要求与工作约束.md'
        authority.parent.mkdir()
        authority.write_text('\n\n'.join(f'### REQ{i:03d}｜R {i}\ntext' for i in range(1,3)),
                             encoding='utf-8')
        # Fix the oracle from author bytes before invoking the projection owner.
        # Reusing its digest helper or its emitted members would also approve
        # a consistently wrong size/hash in both manifest and returned digest.
        expected_names = ['.documentation/baseline.json', 'docs/产品/产品要求与工作约束.md', 'docs/规则.md']
        expected_members = []
        for name in expected_names:
            data = (self.root / name).read_bytes()
            expected_members.append({'path': name, 'bytes': len(data),
                                     'sha256': hashlib.sha256(data).hexdigest()})
        expected_digest = hashlib.sha256(json.dumps(
            expected_members, ensure_ascii=False, sort_keys=True,
            separators=(',', ':')).encode('utf-8')).hexdigest()
        result = refresh_source_manifest(self.root)
        manifest = load(self.root / '.documentation/source-manifest.json')
        baseline = load(self.root / '.documentation/baseline.json')
        names = [member['path'] for member in manifest['members']]
        self.assertEqual(names, sorted(names))
        self.assertEqual(names, expected_names)
        self.assertEqual(manifest['members'], expected_members)
        self.assertEqual(manifest['source_set_sha256'], expected_digest)
        self.assertEqual(result['source_set_sha256'], expected_digest)
        self.assertNotIn('source_set_sha256', baseline)
        self.assertEqual(result['source_members'], 3)


if __name__ == '__main__':
    unittest.main()
