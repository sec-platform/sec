"""Link resolution regressions. Pure local bytes; no SEC execution or network."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main

import check_docs


class MarkdownLinkResolution(TestCase):
    def fixture(self, root: Path, files):
        for name, text in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')

    def errors(self, root: Path, documents):
        texts = {name: (root / name).read_text(encoding='utf-8') for name in documents}
        anchors = {name: check_docs.anchor_locations(text) for name, text in texts.items()}
        return check_docs.markdown_link_errors(root, texts, anchors)

    def test_existing_file_and_heading_resolve(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root, {
                'a.md': '# A\n\n[other](b.md#二目标)\n',
                'b.md': '# B\n\n## 二、目标\n',
            })
            self.assertEqual(self.errors(root, ['a.md']), [])

    def test_missing_file_is_reported(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root, {'a.md': '# A\n\n[gone](missing.md)\n'})
            self.assertEqual(self.errors(root, ['a.md']),
                             ['link target missing: a.md -> missing.md'])

    def test_missing_heading_is_reported(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root, {
                'a.md': '# A\n\n[other](b.md#不存在)\n',
                'b.md': '# B\n\n## 存在的\n',
            })
            self.assertEqual(self.errors(root, ['a.md']),
                             ['link anchor missing: a.md -> b.md#不存在'])

    def test_percent_encoded_target_resolves(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root, {
                'a.md': '# A\n\n[研究](notes/%E7%A0%94%E7%A9%B6.md#%E4%B8%BB%E9%A2%98)\n',
                'notes/研究.md': '# 研究\n\n## 主题\n',
            })
            self.assertEqual(self.errors(root, ['a.md']), [])

    def test_code_span_link_is_data_not_a_claim(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root, {'a.md': '# A\n\n`[x](F<s>)` 是类型占位。\n'})
            self.assertEqual(self.errors(root, ['a.md']), [])

    def test_link_escaping_source_root_is_reported(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'root'
            root.mkdir()
            (root.parent / 'outside.md').write_text('# Outside\n', encoding='utf-8')
            self.fixture(root, {'a.md': '# A\n\n[out](../outside.md)\n'})
            self.assertEqual(self.errors(root, ['a.md']),
                             ['link escapes source root: a.md -> ../outside.md'])


if __name__ == '__main__':
    main()
