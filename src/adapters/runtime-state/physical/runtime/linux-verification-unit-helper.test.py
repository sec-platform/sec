"""Bounded filesystem tests; these never launch a native verification unit."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_helper', Path(__file__).with_name('linux-verification-unit-helper.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RuntimeCopyPermissions(unittest.TestCase):
    def fixture(self, root):
        source, target = root / 'source', root / 'target'
        source.mkdir()
        target.mkdir()
        (source / 'usr').mkdir()
        (source / 'usr' / 'tool').write_bytes(b'accepted bytes\n')
        (source / 'usr' / 'data').write_bytes(b'readable data\n')
        os.chmod(source / 'usr', 0o755)
        os.chmod(source / 'usr' / 'tool', 0o755)
        os.chmod(source / 'usr' / 'data', 0o644)
        entries = [{'path': 'usr', 'type': 'directory', 'mode': 0o755}]
        for name in ['data', 'tool']:
            file = source / 'usr' / name
            entries.append({'path': 'usr/' + name, 'type': 'file', 'mode': stat.S_IMODE(file.stat().st_mode),
                            'size': file.stat().st_size, 'digest': helper.sha(file.read_bytes())})
        manifest = {'files': entries}
        info = source.stat()
        request = {'runtime': {'manifest': manifest, 'manifestDigest': helper.sha(helper.canonical(manifest)),
                              'root': {'path': str(source), 'device': str(info.st_dev), 'inode': str(info.st_ino)}}}
        return source, target, request

    def copy(self, request, target):
        helper.copy_runtime(request, str(target), helper.Deadline((time.time() + 5) * 1000))

    def test_copy_preserves_declared_modes_and_source_for_each_umask(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                before = {p: (p.stat(), p.read_bytes() if p.is_file() else None) for p in source.rglob('*')}
                previous = os.umask(mask)
                try:
                    self.copy(request, target)
                    parent = helper.nofollow_directory(str(target))
                    try:
                        helper.create_runtime_directory(parent, 'sec-runtime', 0o755)
                    finally:
                        os.close(parent)
                finally:
                    os.umask(previous)
                for entry in request['runtime']['manifest']['files']:
                    copied = target / entry['path']
                    self.assertEqual(stat.S_IMODE(copied.stat().st_mode), entry['mode'])
                    if entry['type'] == 'file':
                        self.assertEqual(copied.read_bytes(), (source / entry['path']).read_bytes())
                        self.assertEqual(copied.stat().st_nlink, 1)
                self.assertEqual(stat.S_IMODE((target / 'sec-runtime').stat().st_mode), 0o755)
                for file, (info, contents) in before.items():
                    after = file.stat()
                    self.assertEqual((after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                                     (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
                    if contents is not None:
                        self.assertEqual(file.read_bytes(), contents)

    def test_source_symlink_hardlink_and_wrong_digest_still_fail(self):
        for fault in ['symlink', 'hardlink', 'digest']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                file = source / 'usr' / 'tool'
                if fault == 'symlink':
                    file.unlink()
                    file.symlink_to('data')
                elif fault == 'hardlink':
                    os.link(file, source / 'duplicate')
                else:
                    request['runtime']['manifest']['files'][-1]['digest'] = 'sha256:' + '0' * 64
                    request['runtime']['manifestDigest'] = helper.sha(helper.canonical(request['runtime']['manifest']))
                with self.assertRaises((OSError, helper.Unavailable)):
                    self.copy(request, target)

    def test_new_directory_replacement_link_fails_without_changing_external_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / 'external'
            external.mkdir(mode=0o700)
            parent = helper.nofollow_directory(str(root))
            original = os.mkdir
            def replace_after_create(name, mode, *, dir_fd):
                original(name, mode, dir_fd=dir_fd)
                os.rmdir(name, dir_fd=dir_fd)
                os.symlink(str(external), name, dir_fd=dir_fd)
            try:
                with patch.object(helper.os, 'mkdir', replace_after_create):
                    with self.assertRaises(OSError):
                        helper.create_runtime_directory(parent, 'new', 0o755)
                self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o700)
            finally:
                os.close(parent)


if __name__ == '__main__':
    unittest.main()
