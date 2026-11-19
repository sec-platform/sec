"""Fixture regressions for the research-family inheritance contract. No network or product execution."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
import json

import check_research_inheritance as c


CODES = ['NAV', 'ID', 'EXP', 'REL', 'MATH', 'LOG', 'TYP', 'CMP', 'BEH', 'TIME',
         'REV', 'KNW', 'EVAL', 'METRIC', 'PROB', 'STAT', 'MEAS', 'NORM', 'DEC', 'DATA',
         'RES', 'CONC', 'SEC', 'COMP', 'EDIT', 'ENG', 'FILE', 'UX', 'MEDIA', 'PHYS',
         'ML', 'QUAL']


def row(code, path='docs/信息/承接.md', anchor=None, evidence=None, status='承接'):
    anchor = anchor or '承接段' + code
    evidence = ('证据句' + code,) if evidence is None else evidence
    item = {'family': code, 'name': code, 'contracts': 1, 'status': status,
            'position': None if status == '缺口' else {'path': path, 'anchor': anchor},
            'distinction': '这是一个足够长的区别说明句。', 'evidence': list(evidence)}
    if status == '部分承接':
        item['difference'] = '尚有差额需要说明。'
    if status == '缺口':
        item['gap'] = {'entry': 'U068', 'trigger': '当出现真实需求时建立位置。'}
    return item


class Fixture:
    def __init__(self, root: Path):
        (root / 'tools/documentation').mkdir(parents=True)
        (root / 'docs/信息').mkdir(parents=True)
        (root / 'docs/状态').mkdir(parents=True)
        (root / 'src').mkdir()
        sections = ['# 文档\n']
        for code in CODES:
            sections.append('<a id="承接段' + code + '"></a>\n## 承接段' + code + '\n\n证据句' + code + '。\n')
        sections.append('## 另一段\n\n无关内容。\n')
        (root / 'docs/信息/承接.md').write_text('\n'.join(sections), encoding='utf-8')
        (root / 'docs/状态/语义.md').write_text(
            '<a id="u068"></a>\n\n### U068｜承接边界\n\n正文。\n', encoding='utf-8')
        rows = [row(code) for code in CODES]
        rows[0]['contracts'] = 537
        contract = {'schema': 'sec.research-family-inheritance/1', 'scope': 'fixture',
                    'source': {'profiles': 'docs/信息/profiles.psv', 'contracts': 'docs/信息/contracts.psv',
                               'model': 'docs/信息/model.json.gz', 'contract_total': 568},
                    'families': rows}
        (root / 'docs/信息/profiles.psv').write_text(
            '# family|base\n' + ''.join(code + '|x\n' for code in CODES), encoding='utf-8')
        (root / 'docs/信息/contracts.psv').write_text('# id|x\n1|y\n', encoding='utf-8')
        (root / 'docs/信息/model.json.gz').write_bytes(b'x')
        self.contract = root / 'tools/documentation/research-families.json'
        self.write(contract)

    def write(self, value):
        self.contract.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

    def load(self):
        return json.loads(self.contract.read_text(encoding='utf-8'))


class ResearchFamilyInheritance(TestCase):
    def test_complete_fixture_passes_and_reports_counts(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            Fixture(root)
            result = c.verify(root, Path('tools/documentation/research-families.json'))
            self.assertEqual(result['families'], 32)
            self.assertEqual(result['contracts'], 568)

    def test_evidence_outside_the_declared_section_is_rejected(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = Fixture(root)
            value = fixture.load()
            value['families'][1]['evidence'] = ['无关内容']
            fixture.write(value)
            with self.assertRaisesRegex(ValueError, 'evidence not in section'):
                c.verify(root, Path('tools/documentation/research-families.json'))

    def test_missing_family_and_wrong_total_are_rejected(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = Fixture(root)
            value = fixture.load()
            value['families'].pop()
            fixture.write(value)
            with self.assertRaisesRegex(ValueError, 'exactly 32|family set differs'):
                c.verify(root, Path('tools/documentation/research-families.json'))

    def test_gap_must_resolve_a_registered_entry(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = Fixture(root)
            value = fixture.load()
            value['families'][2] = row('EXP', status='缺口')
            value['families'][2]['gap']['entry'] = 'U999'
            fixture.write(value)
            with self.assertRaisesRegex(ValueError, 'gap entry does not resolve'):
                c.verify(root, Path('tools/documentation/research-families.json'))

    def test_product_source_cannot_reference_read_only_research_data(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            Fixture(root)
            (root / 'src/consumer.ts').write_text('const p = "docs/信息/研究数据/x";\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'read-only research data'):
                c.verify(root, Path('tools/documentation/research-families.json'))

    def test_partial_row_requires_a_stated_difference(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = Fixture(root)
            value = fixture.load()
            value['families'][3]['status'] = '部分承接'
            fixture.write(value)
            with self.assertRaisesRegex(ValueError, 'remaining difference'):
                c.verify(root, Path('tools/documentation/research-families.json'))


if __name__ == '__main__':
    main()
