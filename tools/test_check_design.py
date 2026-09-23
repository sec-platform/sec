"""Input-local regressions for the design checker, independent of the live corpus.

The current corpus is checked by check_docs/review, not copied into unit fixtures.
These tests exercise parser behavior and observable output, not source spelling.
"""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET

import check_design as d


DEPENDENCIES = {
    'contracts': [],
    'workspace': ['contracts'],
    'semantics': ['contracts'],
    'compiler': ['contracts', 'semantics'],
    'assurance': ['contracts'],
    'application': ['compiler', 'assurance', 'workspace'],
    'execution': ['contracts'],
    'adapters': ['contracts'],
    'entry': ['application'],
    'bootstrap': ['entry', 'adapters', 'execution'],
}
FIELD_NAMES = ('采用决定', '结构与执行落点', '实施与验证工作',
               '还需要什么', '关闭条件', '重开或调整条件')


def table(rows=None):
    rows = DEPENDENCIES if rows is None else rows
    return ('\n'.join('| ' + name + ' | ' + (', '.join(deps) or '无')
                      + ' | owns a fixture value | no external effects |'
                      for name, deps in rows.items()) + '\n').encode()


def decision(identifier='U001', *, missing=None, empty=None, alias=False):
    fields = []
    for field in FIELD_NAMES:
        if field == missing:
            continue
        label = '重开条件' if alias and field == '重开或调整条件' else field
        fields.append('**' + label + '：**' + ('' if field == empty else ' fixture body'))
    return '### ' + identifier + '｜Independent fixture\n\n' + '\n\n'.join(fields) + '\n'


class Dependencies(unittest.TestCase):
    def test_exact_model_and_source_binding(self):
        model = d.dependency_model(table())
        self.assertEqual(model['dependencies'], DEPENDENCIES)
        self.assertEqual(model['source_sha256'], hashlib.sha256(table()).hexdigest())
        self.assertEqual(model['levels'], {
            'contracts': 0, 'workspace': 1, 'semantics': 1, 'compiler': 2,
            'assurance': 1, 'application': 3, 'execution': 1, 'adapters': 1,
            'entry': 4, 'bootstrap': 5,
        })

    def test_row_order_does_not_change_dependencies(self):
        reversed_rows = dict(reversed(list(DEPENDENCIES.items())))
        self.assertEqual(d.dependency_model(table(reversed_rows))['dependencies'], DEPENDENCIES)

    def test_missing_module(self):
        rows = {name: deps for name, deps in DEPENDENCIES.items() if name != 'contracts'}
        with self.assertRaisesRegex(d.DesignError, 'Missing module rows:.*contracts'):
            d.dependency_model(table(rows))

    def test_duplicate_module(self):
        with self.assertRaisesRegex(d.DesignError, 'Repeated module row: contracts'):
            d.dependency_model(table() + table({'contracts': []}))

    def test_invalid_dependency_values(self):
        for deps in (['unknown'], ['workspace'], ['contracts', 'contracts']):
            with self.subTest(deps=deps):
                rows = {**DEPENDENCIES, 'workspace': deps}
                with self.assertRaisesRegex(d.DesignError, 'Invalid direct dependency: workspace'):
                    d.dependency_model(table(rows))

    def test_pure_role_boundaries(self):
        for name, dependency in (('contracts', 'workspace'), ('semantics', 'compiler'),
                                 ('execution', 'adapters')):
            with self.subTest(name=name):
                with self.assertRaisesRegex(d.DesignError, 'Pure semantic/execution boundary'):
                    d.dependency_model(table({**DEPENDENCIES, name: [dependency]}))

    def test_compiler_role_boundaries(self):
        for dependency in ('execution', 'adapters', 'assurance'):
            with self.subTest(dependency=dependency):
                with self.assertRaisesRegex(d.DesignError, 'Compiler cannot statically import'):
                    d.dependency_model(table({**DEPENDENCIES, 'compiler': [dependency]}))

    def test_cycle(self):
        with self.assertRaisesRegex(d.DesignError, 'Static dependency cycle:'):
            d.dependency_model(table({**DEPENDENCIES, 'workspace': ['bootstrap']}))

    def test_svg_has_exact_direct_edges_not_transitive_closure(self):
        svg = d.dependency_svg(d.dependency_model(table()))
        root = ET.fromstring(svg)
        titles = [node.text for node in root.iter() if node.tag.endswith('}title')]
        expected = [name + ' imports ' + target
                    for name, targets in DEPENDENCIES.items() for target in targets]
        self.assertCountEqual(titles, expected)
        labels = [node.text for node in root.iter() if node.tag.endswith('}text')]
        self.assertCountEqual(labels, list(DEPENDENCIES) * 2)
        self.assertEqual(svg, d.dependency_svg(d.dependency_model(table())))


class Decisions(unittest.TestCase):
    def test_valid_entry_keeps_input_location(self):
        text = '# Scope\n\n' + decision()
        self.assertEqual(d.decision_entries(text, 'items.md'),
                         [{'id': 'U001', 'path': 'items.md', 'line': 3}])

    def test_last_entry_without_final_newline(self):
        self.assertEqual(d.decision_entries(decision().rstrip(), 'items.md')[0]['id'], 'U001')

    def test_all_required_fields_are_independent(self):
        for field in FIELD_NAMES:
            for mode in ('missing', 'empty'):
                with self.subTest(field=field, mode=mode):
                    with self.assertRaisesRegex(d.DesignError, 'U001 missing substantive field ' + field):
                        d.decision_entries(decision(**{mode: field}), 'items.md')

    def test_comment_or_anchor_is_not_a_value(self):
        for value in ('<!-- hidden -->', '<a id="navigation"></a>', '&nbsp;', '```\n```'):
            with self.subTest(value=value):
                text = decision(empty='采用决定').replace('**采用决定：**', '**采用决定：**\n' + value, 1)
                with self.assertRaisesRegex(d.DesignError, 'U001 missing substantive field 采用决定'):
                    d.decision_entries(text, 'items.md')

    def test_code_can_be_a_value_but_not_declare_an_entry(self):
        text = decision(empty='采用决定').replace('**采用决定：**',
                 '**采用决定：**\n```text\n### U999｜not a declaration\nchosen = true\n```', 1)
        self.assertEqual(d.decision_entries(text, 'items.md'),
                         [{'id': 'U001', 'path': 'items.md', 'line': 1}])

    def test_fenced_or_commented_fields_do_not_satisfy_obligations(self):
        for hidden in ('```text\n**采用决定：** fake\n```', '<!-- **采用决定：** fake -->'):
            with self.subTest(hidden=hidden):
                with self.assertRaisesRegex(d.DesignError, 'U001 missing substantive field 采用决定'):
                    d.decision_entries(decision(missing='采用决定') + '\n' + hidden, 'items.md')

    def test_reopen_alias_is_preserved(self):
        self.assertEqual(len(d.decision_entries(decision(alias=True), 'items.md')), 1)

    def test_duplicate_field_and_alias_are_ambiguous(self):
        for label in ('采用决定', '重开条件'):
            with self.subTest(label=label):
                with self.assertRaisesRegex(d.DesignError, 'U001 duplicate field'):
                    d.decision_entries(decision() + '\n**' + label + '：** another value', 'items.md')

    def test_entry_cannot_borrow_from_the_next_section_or_entry(self):
        for heading in ('### Unrelated section', '## Unrelated section', '### U002｜Another'):
            with self.subTest(heading=heading):
                text = decision(missing='关闭条件') + '\n' + heading + '\n**关闭条件：** unrelated value'
                with self.assertRaisesRegex(d.DesignError, 'U001 missing substantive field 关闭条件'):
                    d.decision_entries(text, 'items.md')

    def test_inline_next_label_does_not_fill_empty_field(self):
        text = decision(empty='采用决定').replace('**采用决定：**', '**采用决定：** **提示：** body', 1)
        with self.assertRaisesRegex(d.DesignError, 'U001 missing substantive field 采用决定'):
            d.decision_entries(text, 'items.md')

    def test_code_and_comments_do_not_create_decisions(self):
        text = '```markdown\n' + decision() + '```\n<!--\n' + decision('U002') + '-->\n'
        self.assertEqual(d.decision_entries(text, 'items.md'), [])


class Diagrams(unittest.TestCase):
    def test_source_digest_heading_and_line(self):
        self.assertEqual(d.diagram_sources('# Responsible heading\n\n```mermaid\nA --> B\n```\n', 'graph.md'), [{
            'path': 'graph.md', 'line': 3, 'heading': 'Responsible heading',
            'sha256': hashlib.sha256(b'A --> B\n').hexdigest(),
        }])

    def test_closing_fence_cannot_have_trailing_text(self):
        body = 'A\n``` trailing text\nB\n'
        result = d.diagram_sources('# Owner\n```mermaid\n' + body + '```\n', 'graph.md')
        self.assertEqual(result[0]['sha256'], hashlib.sha256(body.encode()).hexdigest())

    def test_only_same_kind_at_least_opening_length_closes(self):
        body = 'A\n```\n~~~~\nB\n'
        result = d.diagram_sources('# Owner\n````mermaid\n' + body + '`````\t\n', 'graph.md')
        self.assertEqual(result[0]['sha256'], hashlib.sha256(body.encode()).hexdigest())

    def test_mermaid_info_and_heading_closing_marks(self):
        result = d.diagram_sources('  ## Owner ##\n   ~~~mermaid title=fixture\nA\n  ~~~\n', 'graph.md')
        self.assertEqual(result[0]['heading'], 'Owner')
        self.assertEqual(result[0]['line'], 2)

    def test_four_space_fence_is_body(self):
        body = '    ```\nA\n'
        result = d.diagram_sources('# Owner\n```mermaid\n' + body + '```\n', 'graph.md')
        self.assertEqual(result[0]['sha256'], hashlib.sha256(body.encode()).hexdigest())

    def test_diagram_needs_a_real_preceding_heading(self):
        for prefix in ('', '<!-- # Fake -->\n', '```text\n# Fake\n```\n'):
            with self.subTest(prefix=prefix):
                with self.assertRaisesRegex(d.DesignError, 'Diagram without responsible heading: graph.md'):
                    d.diagram_sources(prefix + '```mermaid\nA\n```\n', 'graph.md')

    def test_no_diagrams_in_comments_or_other_code_blocks(self):
        text = '<!--\n```mermaid\nA\n```\n-->\n````text\n```mermaid\nB\n```\n````\n'
        self.assertEqual(d.diagram_sources(text, 'graph.md'), [])

    def test_unclosed_fence_is_reported_with_its_source(self):
        for text in ('# Owner\n```mermaid\nA\n', '# Owner\n```mermaid\nA\n``` trailing'):
            with self.subTest(text=text):
                with self.assertRaisesRegex(d.DesignError, 'Unclosed fence: graph.md'):
                    d.diagram_sources(text, 'graph.md')

    def test_adjacent_diagrams_keep_distinct_source_positions(self):
        text = '# One\n```mermaid\nA\n```\n# Two\n~~~mermaid\nB\n~~~\n'
        self.assertEqual([(x['line'], x['heading']) for x in d.diagram_sources(text, 'graph.md')],
                         [(2, 'One'), (6, 'Two')])


class CorpusComposition(unittest.TestCase):
    """Exercise the retained corpus census without copying the current corpus.

    The deliverable gate and source inventory are separate owners. Their stubs
    here isolate coordinator wiring; they do not assert those gates passed.
    """
    def test_census_rejects_equal_count_with_duplicate_or_missing_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            module_table = root / d.TABLE_PATH
            module_table.parent.mkdir(parents=True)
            module_table.write_bytes(table())
            items = root / 'docs/状态/items.md'
            items.parent.mkdir(parents=True)
            for ids in (list(range(1, 67)), list(range(1, 66)) + [1], list(range(1, 66))):
                with self.subTest(ids=ids[-2:]):
                    items.write_text('\n'.join(decision(f'U{i:03d}') for i in ids), encoding='utf-8')
                    with patch('source_inventory.source_files', return_value=[items]), \
                            patch.object(d, 'deliverable_model', return_value={'count': 36}) as deliverables:
                        if ids == list(range(1, 67)):
                            result = d.review(root)
                            self.assertEqual([row['id'] for row in result['decisions']],
                                             [f'U{i:03d}' for i in range(1, 67)])
                            deliverables.assert_called_once_with(root)
                        else:
                            with self.assertRaisesRegex(d.DesignError, 'U identifiers are not exactly 66'):
                                d.review(root)
                            deliverables.assert_not_called()


if __name__ == '__main__':
    unittest.main()
