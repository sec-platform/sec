#!/usr/bin/env python3
"""Check the research-family inheritance contract against current documentation.

Read-only: no network, no writes, no product execution. It verifies that every
professional family of the read-only research model has a declared current
position, that the position still resolves, and that the quoted evidence still
exists in that exact section. It does not judge whether the research content is
true, adopted, implemented or complete.
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

sys.dont_write_bytecode = True

CONTRACT = Path('tools/documentation/research-families.json')
STATUSES = frozenset({'承接', '部分承接', '缺口', '取代'})
FIELDS = frozenset({'family', 'name', 'contracts', 'status', 'position',
                    'distinction', 'evidence', 'difference', 'gap'})
RESEARCH_MARKERS = ('研究数据', 'research_model.original')


def plain_heading(text: str) -> str:
    text = re.sub(r'!?(\[([^\]]*)\])\([^\n]*?\)', lambda m: m[2], text)
    text = re.sub(r'\[([^\]]+)\]\[[^\]]*\]', lambda m: m[1], text)
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'\\([\\`*_{}\[\]()#+.!<>~-])', r'\1', text)
    return text.replace('`', '').replace('*', '').replace('~', '').replace('、', '')


def slug(title: str) -> str:
    value = re.sub(r'[^\w\s-]', '', plain_heading(title).lower())
    return re.sub(r'\s', '-', value)


def headings(lines):
    """Yield (line_index, level, fragment) for every heading, with pending anchors."""
    pending = None
    for index, line in enumerate(lines):
        explicit = re.match(r'^<a id="([^"]+)"></a>\s*$', line.strip())
        if explicit:
            pending = explicit.group(1)
            continue
        match = re.match(r'^(#{1,6}) (.+)$', line)
        if match:
            yield index, len(match.group(1)), pending or slug(match.group(2))
            pending = None


def section_body(text: str, anchor: str):
    lines = text.splitlines()
    marks = list(headings(lines))
    for position, (index, level, fragment) in enumerate(marks):
        if fragment != anchor:
            continue
        end = len(lines)
        for later, later_level, _ in marks[position + 1:]:
            if later_level <= level:
                end = later
                break
        return '\n'.join(lines[index + 1:end])
    return None


def anchor_count(text: str, anchor: str) -> int:
    return sum(1 for _, _, fragment in headings(text.splitlines()) if fragment == anchor)


def load_contract(root: Path, contract: Path = CONTRACT):
    path = root / contract
    return json.loads(path.read_text(encoding='utf-8'))


def profile_families(root: Path, relative: str):
    path = root / relative
    rows = path.read_text(encoding='utf-8').splitlines()
    return [line.split('|', 1)[0].strip() for line in rows
            if line and not line.startswith('#') and '|' in line]


def known_u_entries(root: Path):
    entries = set()
    for path in sorted((root / 'docs/状态').glob('*.md')):
        text = path.read_text(encoding='utf-8')
        for match in re.finditer(r'^### (U\d{3})｜', text, re.MULTILINE):
            entries.add(match.group(1))
        for match in re.finditer(r'^<a id="(u\d{3})"></a>$', text, re.MULTILINE):
            entries.add(match.group(1).upper())
    return entries


def verify(root: Path, contract_path: Path = CONTRACT) -> dict:
    root = root.resolve()
    errors = []
    contract = load_contract(root, contract_path)

    if set(contract) != {'schema', 'scope', 'source', 'families'}:
        raise ValueError('inheritance contract fields must be exact')
    if contract['schema'] != 'sec.research-family-inheritance/1':
        raise ValueError('unsupported inheritance contract schema')
    if not isinstance(contract['scope'], str) or not contract['scope']:
        raise ValueError('inheritance contract scope must be nonempty')

    source = contract['source']
    if set(source) != {'profiles', 'contracts', 'model', 'contract_total'}:
        raise ValueError('source fields must be exact')
    for key in ('profiles', 'contracts', 'model'):
        if not (root / source[key]).is_file():
            errors.append('research source missing: ' + source[key])
    expected_families = profile_families(root, source['profiles'])
    if len(expected_families) != 32 or len(set(expected_families)) != 32:
        errors.append('research profile table does not hold 32 unique families')

    families = contract['families']
    if not isinstance(families, list) or len(families) != 32:
        raise ValueError('inheritance contract must list exactly 32 families')

    declared, positions, total = [], set(), 0
    for row in families:
        if not isinstance(row, dict) or not set(row) <= FIELDS or not {'family', 'name', 'contracts', 'status', 'position', 'distinction', 'evidence'} <= set(row):
            raise ValueError('family row fields are invalid: ' + repr(row)[:80])
        code = row['family']
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z]{2,8}', code):
            raise ValueError('invalid family code: ' + repr(code))
        declared.append(code)
        if not isinstance(row['name'], str) or not row['name']:
            errors.append(code + ': name is empty')
        if not isinstance(row['contracts'], int) or row['contracts'] <= 0:
            errors.append(code + ': contract count must be a positive integer')
        else:
            total += row['contracts']
        if row['status'] not in STATUSES:
            errors.append(code + ': unsupported status ' + repr(row['status']))
        if not isinstance(row['distinction'], str) or len(row['distinction']) < 12:
            errors.append(code + ': distinction is not a usable sentence')
        evidence = row['evidence']
        if not isinstance(evidence, list) or any(not isinstance(x, str) or not x for x in evidence):
            errors.append(code + ': evidence must be a list of nonempty strings')
            evidence = []

        position = row['position']
        if row['status'] == '缺口':
            if position is not None:
                errors.append(code + ': gap row must not declare a position')
            gap = row.get('gap')
            if not isinstance(gap, dict) or set(gap) != {'entry', 'trigger'}:
                errors.append(code + ': gap row must declare entry and trigger')
            else:
                entries = known_u_entries(root)
                if gap['entry'] not in entries:
                    errors.append(code + ': gap entry does not resolve: ' + str(gap['entry']))
                if not isinstance(gap['trigger'], str) or len(gap['trigger']) < 12:
                    errors.append(code + ': gap trigger is not a usable condition')
            if evidence:
                errors.append(code + ': gap row must not quote evidence')
            continue

        if not isinstance(position, dict) or set(position) != {'path', 'anchor'}:
            errors.append(code + ': adopted row requires path and anchor')
            continue
        path, anchor = position['path'], position['anchor']
        if not isinstance(path, str) or not isinstance(anchor, str) or not path.endswith('.md'):
            errors.append(code + ': invalid position declaration')
            continue
        if '研究数据' in path or not path.startswith('docs/'):
            errors.append(code + ': position must be a current document outside the read-only research area')
        key = (path, anchor)
        if key in positions:
            errors.append(code + ': duplicate position ' + path + '#' + anchor)
        positions.add(key)
        target = root / path
        if not target.is_file():
            errors.append(code + ': position document missing: ' + path)
            continue
        text = target.read_text(encoding='utf-8')
        count = anchor_count(text, anchor)
        if count == 0:
            errors.append(code + ': position anchor missing: ' + path + '#' + anchor)
            continue
        if count > 1:
            errors.append(code + ': position anchor is ambiguous: ' + path + '#' + anchor)
            continue
        body = section_body(text, anchor)
        if body is None:
            errors.append(code + ': position section unreadable: ' + path + '#' + anchor)
            continue
        if not evidence:
            errors.append(code + ': adopted row must quote at least one evidence sentence')
        for quote in evidence:
            if quote not in body:
                errors.append(code + ': evidence not in section: ' + quote)
        if row['status'] == '部分承接':
            difference = row.get('difference')
            if not isinstance(difference, str) or len(difference) < 8:
                errors.append(code + ': partial row must state the remaining difference')
        elif 'difference' in row:
            errors.append(code + ': only partial rows carry a difference')

    if sorted(declared) != sorted(expected_families):
        missing = sorted(set(expected_families) - set(declared))
        extra = sorted(set(declared) - set(expected_families))
        errors.append('family set differs from research profiles; missing=' + ','.join(missing) + ' extra=' + ','.join(extra))
    if len(set(declared)) != len(declared):
        errors.append('duplicate family declarations')
    if total != source['contract_total']:
        errors.append('declared contract counts sum to ' + str(total) + ', expected ' + str(source['contract_total']))

    for path in sorted((root / 'src').rglob('*')):
        if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.js', '.json', '.mjs', '.cjs'}:
            continue
        text = path.read_text(encoding='utf-8', errors='ignore')
        for marker in RESEARCH_MARKERS:
            if marker in text:
                errors.append('product source references read-only research data: ' + path.relative_to(root).as_posix())
                break

    if errors:
        raise ValueError('\n'.join(errors))
    counts = {status: sum(1 for row in families if row['status'] == status) for status in sorted(STATUSES)}
    return {'families': len(families), 'contracts': total, 'statuses': counts,
            'positions': len(positions),
            'scope': 'Declared family ownership, resolving positions, quoted evidence and gap registration. '
                     'Not a proof of semantic completeness, adoption or implementation.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.root), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print('FAIL: ' + str(exc), file=sys.stderr)
        sys.exit(1)
