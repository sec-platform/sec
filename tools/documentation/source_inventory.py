"""Documentation authority, projections and delivery bytes; no product execution."""
from __future__ import annotations

from pathlib import Path
from contextlib import contextmanager
import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import unicodedata

BASELINE_PATH = '.documentation/baseline.json'
MANIFEST_PATH = '.documentation/source-manifest.json'
REQUIREMENTS_PATH = '.documentation/requirements.json'
CACHE_PATH = '.documentation/figures.json'
BASELINE_SCHEMA = 'sec.documentation-baseline/2'
MANIFEST_SCHEMA = 'sec.documentation-source-manifest/2'
# These are registered producer outputs, not an open-ended exclusion mechanism.
PROJECTION_PATHS = frozenset({MANIFEST_PATH, REQUIREMENTS_PATH})
CACHE_PATHS = frozenset({CACHE_PATH})
AUTHORED_METADATA = frozenset({BASELINE_PATH, '.documentation/README.md',
    '.documentation/documents.json', '.documentation/known-regressions.json'})
EXCLUDED_FROM_SOURCE_HASH = PROJECTION_PATHS | CACHE_PATHS
BASELINE_KEYS = frozenset({
    'schema', 'source_root', 'source_roots', 'source_manifest',
    'audited_namespaces', 'non_documentation_roots', 'excluded_from_source_hash',
    'entry', 'delivery_number', 'archive_name', 'scope', 'authority_limit',
})
MAX_FILE_BYTES = 16_000_000
MAX_TOTAL_BYTES = 80_000_000
MAX_MEMBERS = 100_000


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode(data: bytes, label: str):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key {key!r}: {label}')
            result[key] = value
        return result
    def nonfinite(value):
        raise ValueError(f'non-finite JSON number {value}: {label}')
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=nonfinite)


def load(path: Path):
    return decode(path.read_bytes(), str(path))


def _linked(metadata) -> bool:
    return stat.S_ISLNK(metadata.st_mode) or bool(
        getattr(metadata, 'st_file_attributes', 0) & 0x400)


def local_path(root: Path, name: str) -> Path:
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in name)):
        raise ValueError(f'unsafe relative path: {name!r}')
    parts = name.split('/')
    if unicodedata.normalize('NFC', name) != name:
        raise ValueError(f'noncanonical Unicode documentation path: {name!r}')
    if any(re.search(r'[<>"|?*]', part) or re.fullmatch(r'(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])(?:\..*)?', part, re.I) for part in parts):
        raise ValueError(f'unsafe portable path: {name!r}')
    if any(part in ('', '.', '..') or part.endswith((' ', '.')) for part in parts):
        raise ValueError(f'unsafe relative path: {name!r}')
    current = root
    for part in parts:
        current = current / part
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            continue
        if _linked(metadata):
            raise ValueError(f'linked documentation path: {name}')
    return current


def _root(root: Path) -> Path:
    absolute = root.absolute()
    for component in (absolute, *absolute.parents):
        if _linked(component.lstat()):
            raise ValueError('linked documentation root')
    if not absolute.is_dir():
        raise ValueError('documentation root must be a directory')
    return absolute


@contextmanager
def _closing(close):
    """One settlement owner for captured files, directory streams and writer locks."""
    primary = None
    try:
        yield
    except BaseException as error:
        primary = error
        raise
    finally:
        try:
            close()
        except BaseException as error:
            if primary is not None:
                raise ProjectionSettlementError(primary, error) from primary
            raise


def read_ordinary(root: Path, name: str) -> bytes:
    path = local_path(root, name)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
                         | getattr(os, 'O_NONBLOCK', 0)
                         | getattr(os, 'O_BINARY', 0))
    with _closing(lambda: os.close(descriptor)):
        opened = os.fstat(descriptor)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_size < 0
                or opened.st_size > MAX_FILE_BYTES):
            raise ValueError(f'non-ordinary or oversized documentation file: {name}')
        def identity(s):
            common = s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns
            # Windows handle and pathname stat expose the same file identity
            # but may round creation/change time differently. Device+inode,
            # size and mtime remain the stable comparison; POSIX keeps ctime
            # to fence same-size rewrites between the two observations.
            return common if os.name == 'nt' else (*common, s.st_ctime_ns)
        before = local_path(root, name).lstat()
        if identity(before) != identity(opened):
            raise ValueError(f'documentation file changed before capture: {name}')
        data = bytearray()
        while len(data) < opened.st_size:
            block = os.read(descriptor, min(65_536, opened.st_size - len(data)))
            if not block:
                raise ValueError(f'short documentation read: {name}')
            data.extend(block)
        after = os.fstat(descriptor)
        path_after = local_path(root, name).lstat()
        if identity(opened) != identity(after) or identity(after) != identity(path_after):
            raise ValueError(f'documentation file changed during capture: {name}')
        return bytes(data)


def _enqueue_directory(entry: Path, pending: list[Path], visited: int, limit: int) -> None:
    # Check admission during streaming, before retaining each child. A post-read
    # bound cannot prevent an unbounded iterdir/list expansion or allocation.
    directory = os.scandir(entry)
    with _closing(directory.close):
        for child in directory:
            if visited + len(pending) >= limit:
                raise ValueError('documentation traversal budget exceeded')
            pending.append(entry / child.name)


def baseline(root: Path) -> dict:
    value = decode(read_ordinary(root, BASELINE_PATH), BASELINE_PATH)
    if not isinstance(value, dict) or set(value) != BASELINE_KEYS:
        raise ValueError('baseline must contain exactly the source-boundary fields')
    if value['schema'] != BASELINE_SCHEMA or value['source_root'] != '..':
        raise ValueError('unsupported baseline schema; migrate the boundary, not the digest')
    if value['source_manifest'] != 'source-manifest.json':
        raise ValueError('unsupported source_manifest location')
    path_keys = ('source_roots', 'audited_namespaces', 'non_documentation_roots',
                 'excluded_from_source_hash')
    # Admit every list before retaining normalized sets or observing any
    # declared path. An oversized later list must not expand earlier roots.
    for key in path_keys:
        items = value[key]
        if not isinstance(items, list):
            raise ValueError(f'{key} must contain unique relative paths')
        if len(items) > MAX_MEMBERS:
            label = 'source root' if key == 'source_roots' else key
            raise ValueError(f'documentation {label} budget exceeded')
    for key in path_keys:
        items = value[key]
        if (any(not isinstance(x, str) for x in items)
                or len({x.upper().lower() for x in items}) != len(items)):
            raise ValueError(f'{key} must contain unique relative paths')
    if not value['source_roots'] or not value['audited_namespaces']:
        raise ValueError('source_roots and audited_namespaces must be nonempty')
    if set(value['excluded_from_source_hash']) != EXCLUDED_FROM_SOURCE_HASH:
        raise ValueError('excluded_from_source_hash differs from registered derived/cache paths')
    for key in ('entry', 'delivery_number', 'archive_name', 'scope', 'authority_limit'):
        if (not isinstance(value[key], str) or not value[key] or '\0' in value[key]
                or any(0xD800 <= ord(c) <= 0xDFFF for c in value[key])):
            raise ValueError(f'invalid baseline {key}')
    if not value['entry'].startswith('../'):
        raise ValueError('baseline entry must be root-relative through ../')
    for key in path_keys:
        for name in value[key]:
            # Source-only callers never inspect excluded projection/cache payloads.
            if name not in EXCLUDED_FROM_SOURCE_HASH:
                local_path(root, name)
    local_path(root, value['entry'][3:])
    return value


def _source_root_index(roots):
    """Admit component-disjoint roots using their native pathlib comparison rules."""
    root_set = set(roots)
    ancestors = {parent for source in roots for parent in source.parents}
    if len(root_set) != len(roots) or not root_set.isdisjoint(ancestors):
        raise ValueError('documentation source roots overlap')
    return root_set, ancestors


def source_files(root: Path) -> tuple[Path, ...]:
    """All authoritative inputs, including the boundary itself; never cached output."""
    root = _root(root)
    declaration = baseline(root)
    names = declaration['source_roots']
    roots = [local_path(root, name) for name in names]
    root_set, source_ancestors = _source_root_index(roots)
    files = []
    pending = list(roots)
    collisions = {}
    visited = 0
    while pending:
        visited += 1
        if visited > MAX_MEMBERS:
            raise ValueError('documentation traversal budget exceeded')
        entry = pending.pop()
        name = entry.relative_to(root).as_posix()
        if name in EXCLUDED_FROM_SOURCE_HASH:
            continue  # Never inspect/dereference excluded payloads in a source-only operation.
        entry = local_path(root, name)
        try:
            metadata = entry.lstat()
        except FileNotFoundError as error:
            raise ValueError(f'missing documentation source: {name}') from error
        if stat.S_ISREG(metadata.st_mode):
            if name.startswith('.documentation/') and name not in AUTHORED_METADATA:
                raise ValueError(f'unknown documentation metadata role: {name}')
            key = unicodedata.normalize('NFC', name.upper().lower())
            if key in collisions:
                raise ValueError(f'portable source path collision: {name}, {collisions[key]}')
            collisions[key] = name
            files.append(entry)
        elif stat.S_ISDIR(metadata.st_mode):
            _enqueue_directory(entry, pending, visited, MAX_MEMBERS)
        else:
            raise ValueError(f'non-ordinary documentation source: {name}')
        if len(files) + len(pending) > MAX_MEMBERS:
            raise ValueError('documentation member budget exceeded')
    namespaces = [local_path(root, name) for name in declaration['audited_namespaces']]
    exemptions = [local_path(root, name) for name in declaration['non_documentation_roots']]
    # Index declared boundaries once. Membership follows pathlib's component
    # and platform case rules; textual prefixes do not establish ancestry.
    # Queries now visit a path's parents, not every unrelated declared root.
    namespace_set, exemption_set = set(namespaces), set(exemptions)
    for exemption in exemptions:
        if not any(parent in namespace_set for parent in exemption.parents):
            raise ValueError('non-documentation root must be inside an audited namespace')
        if (exemption in root_set or exemption in source_ancestors
                or any(parent in root_set for parent in exemption.parents)):
            raise ValueError('non-documentation root overlaps a documentation source root')
    members = set(files)
    if root / BASELINE_PATH not in members:
        raise ValueError('baseline boundary must be included in the authoritative source domain')
    pending = list(namespaces)
    while pending:
        visited += 1
        if visited > MAX_MEMBERS * 2:
            raise ValueError('documentation namespace traversal budget exceeded')
        entry = pending.pop()
        name = entry.relative_to(root).as_posix()
        if name in EXCLUDED_FROM_SOURCE_HASH:
            continue
        if entry in exemption_set or any(parent in exemption_set for parent in entry.parents):
            continue
        entry = local_path(root, name)
        metadata = entry.lstat()  # Missing audited namespaces fail instead of silently disappearing.
        if stat.S_ISDIR(metadata.st_mode):
            _enqueue_directory(entry, pending, visited, MAX_MEMBERS * 2)
        elif not stat.S_ISREG(metadata.st_mode) or entry not in members:
            raise ValueError(f'unexpected file in documentation namespace: {name}')
    return tuple(sorted(files, key=lambda entry: entry.relative_to(root).as_posix()))


def documentation_files(root: Path, include_cache: bool = True) -> tuple[Path, ...]:
    """Reading/delivery envelope: source plus whichever registered outputs are present."""
    root = _root(root)
    files = set(source_files(root))
    selected = EXCLUDED_FROM_SOURCE_HASH if include_cache else PROJECTION_PATHS
    for name in selected:
        path = local_path(root, name)
        parent = local_path(root, path.parent.relative_to(root).as_posix())
        if not stat.S_ISDIR(parent.lstat().st_mode):
            raise ValueError('documentation output parent is not a directory')
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            # A missing output is optional; a lost ancestor is not.
            parent = local_path(root, path.parent.relative_to(root).as_posix())
            if not stat.S_ISDIR(parent.lstat().st_mode):
                raise ValueError('documentation output parent is not a directory')
            continue
        if not stat.S_ISREG(metadata.st_mode) or _linked(metadata):
            raise ValueError(f'non-ordinary documentation output: {name}')
        files.add(path)
    return tuple(sorted(files, key=lambda p: p.relative_to(root).as_posix()))


def source_manifest_members(root: Path) -> list[dict[str, object]]:
    root = _root(root)
    members = []
    total = 0
    for path in source_files(root):
        name = path.relative_to(root).as_posix()
        data = read_ordinary(root, name)
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise ValueError('documentation source byte budget exceeded')
        members.append({'path': name, 'bytes': len(data), 'sha256': _sha256(data)})
    return members


def source_set_digest(members: list[dict[str, object]]) -> str:
    return _sha256(canonical(members))


def source_identity_from_capture(captured: dict[str, bytes]) -> str:
    return source_set_digest([
        {'path': name, 'bytes': len(data), 'sha256': _sha256(data)}
        for name, data in sorted(captured.items()) if name not in EXCLUDED_FROM_SOURCE_HASH
    ])


def capture_source_manifest(root: Path) -> dict:
    first = source_manifest_members(root)
    # A stable byte vector, not a filesystem-wide atomic snapshot or adversarial write fence.
    if first != source_manifest_members(root):
        raise ValueError('documentation source changed during capture')
    return {'schema': MANIFEST_SCHEMA, 'source_set_sha256': source_set_digest(first), 'members': first}


def validate_source_manifest(value: object, root: Path) -> dict:
    expected = capture_source_manifest(root)
    if canonical(value) != canonical(expected):
        raise ValueError('documentation source manifest is stale, malformed or has a different domain')
    return expected


def requirement_projection(root: Path) -> dict:
    """Rebuild the locator; stable requirement identities remain authored in Markdown."""
    from check_docs import anchor_locations
    name = 'docs/产品/产品要求与工作约束.md'
    path = local_path(root, name)
    if not path.exists():
        raise ValueError('requirement authority is missing')
    text = read_ordinary(root, name).decode('utf-8')
    anchors = anchor_locations(text)
    visible_lines = {n for lines in anchors.values() for n in lines}
    matches = [m for m in re.finditer(r'^### (REQ\d{3})[^\n]*', text, re.M)
               if text[:m.start()].count('\n') + 1 in visible_lines]
    ids = [match[1] for match in matches]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('requirement authority identities are empty or ambiguous')
    items = []
    for index, match in enumerate(matches):
        line = text[:match.start()].count('\n') + 1
        fragments = [fragment for fragment, lines in anchors.items() if lines == [line]]
        stable = anchors.get(match[1].lower(), [])
        previous_line = text[:matches[index - 1].start()].count('\n') + 1 if index else 0
        if len(stable) == 1 and previous_line < stable[0] < line:
            fragments = [match[1].lower()]
        elif re.search(r'[<>`&\[\]*~\\]', match[0]):
            raise ValueError('rich requirement heading needs its stable explicit identity anchor')
        if len(fragments) != 1:
            raise ValueError(f'ambiguous requirement heading: {match[1]}')
        body = text[match.start():matches[index + 1].start() if index + 1 < len(matches) else len(text)].strip()
        items.append({'id': match[1], 'path': name, 'fragment': fragments[0],
                      'body_sha256': _sha256(body.encode('utf-8'))})
    return {'schema': 'sec.docs-requirement-bindings/1',
            'scope': '当前位置和内容校验，不是全部已审证明', 'items': items}


class ProjectionSettlementError(RuntimeError):
    """Retain independent operation and settlement causes on Python 3.10 as well."""
    def __init__(self, primary: BaseException, settlement: BaseException):
        super().__init__('documentation projection operation and settlement both failed')
        self.primary = primary
        self.settlement = settlement


def _staging_root(root: Path) -> Path:
    directory = local_path(root, '.tmp')
    declaration = baseline(root)
    if any(name == '.tmp' or name.startswith('.tmp/') or '.tmp'.startswith(name + '/')
           for name in (*declaration['source_roots'], *declaration['audited_namespaces'])):
        raise ValueError('projection staging must be outside the authoritative source boundary')
    directory.mkdir(exist_ok=True)
    if not directory.is_dir():
        raise ValueError('projection staging is not a directory')
    return directory


@contextmanager
def projection_writer(root: Path):
    """Nonblocking OS lock for cooperating writers; process death releases the lock.

    The tiny coordination file is retained: unlinking it while another process
    has it open would split the lock identity. Its existence is not ownership.
    """
    lock = _staging_root(root) / 'documentation-projection.lock'
    local_path(root, lock.relative_to(root).as_posix())
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with _closing(lambda: os.close(fd)):
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('projection coordination handle is not an ordinary file')
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        elif os.name == 'posix':
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            raise ValueError('nonblocking projection writer locking is unsupported')
        opened, current = os.fstat(fd), local_path(root, lock.relative_to(root).as_posix()).lstat()
        if (opened.st_dev, opened.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError('projection writer identity changed')
        yield


def _replace_json(path: Path, value: object) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')
    root = path.parent.parent
    if path.exists() and read_ordinary(root, path.relative_to(root).as_posix()) == payload:
        return
    descriptor, temporary_name = tempfile.mkstemp(
        dir=_staging_root(root), prefix='doc-projection-', suffix='.tmp')
    temporary = Path(temporary_name)
    try:
        with _closing(lambda: os.close(descriptor)):
            view = memoryview(payload)
            offset = 0
            while offset < len(view):
                written = os.write(descriptor, view[offset:])
                if written <= 0:
                    raise OSError('short documentation projection write')
                offset += written
            os.fsync(descriptor)
        temporary.replace(path)
    except BaseException as primary:
        try:
            temporary.unlink(missing_ok=True)
        except BaseException as cleanup:
            raise ProjectionSettlementError(primary, cleanup) from primary
        raise


def _refresh_source_manifest(root: Path) -> dict[str, object]:
    """Only replace generated projections. Never rewrite a source or boundary declaration."""
    root = _root(root)
    # Source editors still need a quiet/frozen checkout; this lock serializes projection writers only.
    manifest = capture_source_manifest(root)
    requirements = requirement_projection(root)
    if manifest != capture_source_manifest(root):
        raise ValueError('documentation source changed before projection publication')
    _replace_json(local_path(root, REQUIREMENTS_PATH), requirements)
    _replace_json(local_path(root, MANIFEST_PATH), manifest)
    if manifest != capture_source_manifest(root):
        raise ValueError('documentation source changed during projection publication; refresh required')
    return {'source_set_sha256': manifest['source_set_sha256'],
            'source_members': len(manifest['members']), 'manifest': MANIFEST_PATH,
            'requirements': REQUIREMENTS_PATH, 'boundary_written': False}


def refresh_source_manifest(root: Path) -> dict[str, object]:
    root = _root(root)
    with projection_writer(root):
        return _refresh_source_manifest(root)


def repository_root() -> Path:
    """The writer is repository-local; callers cannot redirect it to another tree."""
    return _root(Path(__file__).absolute().parents[2])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='refresh this repository projections, never authority')
    args = parser.parse_args()
    if not args.write:
        parser.error('--write is required; ordinary verification uses tools/documentation/check_docs.py')
    print(json.dumps(refresh_source_manifest(repository_root()), ensure_ascii=False, indent=2))
