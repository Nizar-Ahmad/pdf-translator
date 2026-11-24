import contextlib
import importlib.machinery
import importlib.util
import io
import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader('pdftr_cli', str(ROOT / 'pdftr'))
spec = importlib.util.spec_from_loader(loader.name, loader)
pdftr = importlib.util.module_from_spec(spec)
loader.exec_module(pdftr)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.unit = root / 'config/systemd/user/pdftr.service'
        self.env = root / 'state/service.env'
        self.bin = root / 'bin/pdftr'
        self.patchers = [patch.object(pdftr, 'UNIT', self.unit), patch.object(pdftr, 'ENV', self.env),
                         patch.object(pdftr, 'COMMAND_FILE', root / 'state/command-path'), patch.object(pdftr, 'BIN', self.bin)]
        for patcher in self.patchers:
            patcher.start()
        self.commands = []
        def control(*args, **kwargs):
            self.commands.append(args)
            return subprocess.CompletedProcess([], 0, stdout='active\n', stderr='')
        self.control = patch.object(pdftr, 'control', side_effect=control)
        self.control.start()
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
        self.output.__exit__(None, None, None)
        self.control.stop()
        for patcher in self.patchers:
            patcher.stop()
        self.temp.cleanup()

    def install(self, *options):
        self.assertEqual(pdftr.main(['install', '--bin-dir', str(self.bin.parent), *options]), 0)

    def test_install_creates_link_unit_and_default_config(self):
        self.install()
        self.assertEqual(self.bin.resolve(), ROOT / 'pdftr')
        self.assertIn('--strict-port', self.unit.read_text())
        self.assertIn('--no-browser', self.unit.read_text())
        self.assertEqual(pdftr.configured_port(), 8765)
        self.assertIn(('daemon-reload',), self.commands)

    def test_scalar_paths_are_not_quoted(self):
        contents = pdftr.unit_contents()
        self.assertNotIn('WorkingDirectory=', contents)
        self.assertIn('EnvironmentFile=-' + str(self.env) + '\n', contents)
        self.assertNotIn('EnvironmentFile="', contents)
        self.assertEqual(pdftr.systemd_path('/tmp/a b % c'), '/tmp/a b %% c')
        with self.assertRaises(RuntimeError):
            pdftr.systemd_path('/tmp/new\nline')

    def test_reinstall_repairs_legacy_quoted_unit(self):
        self.unit.parent.mkdir(parents=True)
        old = pdftr.unit_contents().replace('[Service]\n', '[Service]\nWorkingDirectory=' + pdftr.systemd_quote(ROOT) + '\n')
        old = old.replace('EnvironmentFile=-' + str(self.env), 'EnvironmentFile=' + pdftr.systemd_quote('-' + str(self.env)))
        self.unit.write_text(old)
        self.install()
        self.assertNotIn('WorkingDirectory=', self.unit.read_text())
        self.assertIn('EnvironmentFile=-' + str(self.env), self.unit.read_text())
        self.assertTrue(pdftr.owns_unit())

    def test_installer_preserves_unrelated_service(self):
        self.unit.parent.mkdir(parents=True)
        self.unit.write_text('[Service]\nExecStart=/usr/bin/other\n')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(pdftr.main(['install', '--bin-dir', str(self.bin.parent)]), 1)
        self.assertIn('ExecStart=/usr/bin/other', self.unit.read_text())

    def test_install_preserves_other_commands(self):
        self.bin.parent.mkdir()
        self.bin.write_text('unrelated command')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(pdftr.main(['install', '--bin-dir', str(self.bin.parent)]), 1)
        self.assertEqual(self.bin.read_text(), 'unrelated command')
        self.assertFalse(self.unit.exists())

    def test_install_is_repeatable_and_preserves_port(self):
        self.install('--port', '9000')
        self.install()
        self.assertEqual(pdftr.configured_port(), 9000)

    def test_default_start_checks_readiness_and_opens_browser(self):
        self.install()
        with patch.object(pdftr, 'wait_ready') as ready, patch.object(pdftr.webbrowser, 'open') as browser:
            self.assertEqual(pdftr.main([]), 0)
        self.assertIn(('start', 'pdftr.service'), self.commands)
        ready.assert_called_once_with('http://127.0.0.1:8765/')
        browser.assert_called_once()

    def test_on_no_browser_and_off(self):
        self.install()
        with patch.object(pdftr, 'wait_ready'), patch.object(pdftr.webbrowser, 'open') as browser:
            self.assertEqual(pdftr.main(['on', '--no-browser']), 0)
            browser.assert_not_called()
        self.assertEqual(pdftr.main(['off']), 0)
        self.assertIn(('stop', 'pdftr.service'), self.commands)

    def test_restart_updates_port(self):
        self.install()
        with patch.object(pdftr, 'wait_ready') as ready:
            self.assertEqual(pdftr.main(['restart', '--port', '9001', '--no-browser']), 0)
        self.assertEqual(pdftr.configured_port(), 9001)
        ready.assert_called_once_with('http://127.0.0.1:9001/')
        self.assertIn(('restart', 'pdftr.service'), self.commands)

    def test_running_port_change_requires_restart(self):
        self.install()
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(pdftr.main(['start', '--port', '9000']), 1)
        self.assertEqual(pdftr.configured_port(), 8765)

    def test_uninstall_preserves_config_and_removes_custom_command(self):
        self.install()
        self.assertEqual(pdftr.main(['uninstall']), 0)
        self.assertFalse(self.unit.exists())
        self.assertFalse(self.bin.is_symlink())
        self.assertTrue(self.env.exists())
        self.assertIn(('disable', '--now', 'pdftr.service'), self.commands)

    def test_enable_disable_and_logs(self):
        self.install()
        self.assertEqual(pdftr.main(['enable']), 0)
        self.assertEqual(pdftr.main(['disable']), 0)
        with patch.object(pdftr.subprocess, 'call', return_value=0) as call:
            self.assertEqual(pdftr.main(['logs', '--follow', '--lines', '25']), 0)
            self.assertIn('--follow', call.call_args.args[0])
            self.assertIn('25', call.call_args.args[0])

    def test_help_and_invalid_port(self):
        for command in (['--help'], ['start', '--help'], ['install', '--help']):
            with self.assertRaises(SystemExit) as result:
                pdftr.main(command)
            self.assertEqual(result.exception.code, 0)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            pdftr.main(['start', '--port', '70000'])

    def test_readiness_checks_service_pid(self):
        health = io.BytesIO(b'{"app":"pdf-translator","pid":42}')
        with patch.object(pdftr, 'service_active', return_value=True), \
                patch.object(pdftr, 'control', return_value=subprocess.CompletedProcess([], 0, '42\n', '')), \
                patch.object(pdftr, 'urlopen', return_value=health):
            pdftr.wait_ready('http://127.0.0.1:8765/')

    def test_failed_service_does_not_report_success(self):
        with patch.object(pdftr, 'service_active', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'did not stay running'):
                pdftr.wait_ready('http://127.0.0.1:8765/')

    def test_unit_escapes_percent_and_spaces(self):
        self.assertEqual(pdftr.systemd_quote('/tmp/a % b'), '"/tmp/a %% b"')


class ForegroundTests(unittest.TestCase):
    def test_run_serves_health_and_honors_strict_port(self):
        try:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
        except PermissionError:
            self.skipTest('Sandbox does not permit local sockets')
        process = subprocess.Popen([str(ROOT / 'pdftr'), 'run', '--no-browser', '--port', str(port)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    with urlopen('http://127.0.0.1:' + str(port) + '/api/health', timeout=0.2) as response:
                        health = json.load(response)
                    break
                except OSError:
                    if process.poll() is not None:
                        self.fail(process.communicate()[1].decode())
                    time.sleep(0.05)
            else:
                self.fail('Foreground reader did not become ready')
            self.assertEqual(health['app'], 'pdf-translator')
            conflict = subprocess.run([sys.executable, str(ROOT / 'app.py'), '--no-browser', '--strict-port', '--port', str(port)],
                                      capture_output=True, text=True, timeout=5)
            self.assertNotEqual(conflict.returncode, 0)
            self.assertIn('Cannot listen', conflict.stderr)
        finally:
            # run is a foreground wrapper; stop its server child using the health PID.
            if 'health' in locals():
                import os
                import signal
                try:
                    os.kill(health['pid'], signal.SIGTERM)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
