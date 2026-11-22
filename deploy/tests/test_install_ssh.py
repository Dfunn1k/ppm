from pathlib import Path
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from install_ssh import install


class InstallTests(unittest.TestCase):
    def test_reinstallation_preserves_other_keys_and_restricts_only_its_own(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            ssh = home / ".ssh"
            ssh.mkdir()
            other = "ssh-ed25519 AAAAother user-existing-key"
            (ssh / "authorized_keys").write_text(other + "\n")
            source = Path(__file__).resolve().parents[1]
            key = install(home, source)
            first_private = key.read_bytes()
            install(home, source)
            self.assertEqual(key.read_bytes(), first_private)
            lines = (ssh / "authorized_keys").read_text().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(lines[0], other)
            self.assertTrue(lines[1].startswith('restrict,command="/usr/bin/python3 '))
            self.assertIn("/ssh_entrypoint.py\" ssh-ed25519 ", lines[1])
            for path in (key, ssh / "authorized_keys"):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
