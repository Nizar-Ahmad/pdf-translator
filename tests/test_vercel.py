import io
import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app
from api.translate import handler as TranslationHandler
from api.health import handler as HealthHandler


class VercelTests(unittest.TestCase):
    def handler(self, cls, headers=None):
        handler = object.__new__(cls)
        handler.headers = headers or {}
        handler.wfile = io.BytesIO()
        handler.send_response = lambda code: setattr(handler, 'code', code)
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        return handler

    def test_origin_accepts_preview_and_custom_https_hosts(self):
        for host in ('my-book.vercel.app', 'reading.example.org'):
            handler = self.handler(TranslationHandler, {'Host': host, 'Origin': 'https://' + host})
            self.assertTrue(handler._same_origin())
        for origin in ('https://evil.example', 'http://reading.example.org', 'null',
                       'https://reading.example.org@evil.example', 'https://reading.example.org/path'):
            handler = self.handler(TranslationHandler, {'Host': 'reading.example.org', 'Origin': origin})
            self.assertFalse(handler._same_origin())
        self.assertTrue(self.handler(TranslationHandler, {'Host': 'localhost:3000', 'Origin': 'http://localhost:3000'})._same_origin())

    def test_streaming_and_long_selections_use_shared_backend(self):
        handler = self.handler(TranslationHandler, {'Host': 'reading.example.org', 'Origin': 'https://reading.example.org'})
        body = json.dumps({'texts': ['hello' * 1000], 'source': 'en', 'target': 'ar', 'stream': True}).encode()
        handler.headers['Content-Length'] = str(len(body))
        handler.path = '/api/translate'
        handler.rfile = io.BytesIO(body)
        handler.connection = type('Connection', (), {'settimeout': lambda *_: None})()
        with patch.object(app, '_translate_uncached', return_value=('مرحبا', 'en', 'test')):
            handler.do_POST()
        events = [json.loads(line) for line in handler.wfile.getvalue().splitlines() if line.strip()]
        self.assertEqual(handler.code, 200)
        self.assertEqual(events[0]['translation'], 'مرحبا')
        self.assertEqual(events[-1], {'done': True})

    def test_online_speech_uses_the_shared_endpoint(self):
        handler = self.handler(TranslationHandler, {'Host': 'reading.example.org', 'Origin': 'https://reading.example.org'})
        body = json.dumps({'operation': 'speech', 'text': 'مرحبا', 'language': 'ar'}).encode()
        handler.headers['Content-Length'] = str(len(body)); handler.path = '/api/translate'
        handler.rfile = io.BytesIO(body)
        handler.connection = type('Connection', (), {'settimeout': lambda *_: None})()
        with patch.object(app, 'speech_clip', return_value=b'ID3-audio') as provider:
            handler.do_POST()
        provider.assert_called_once_with('مرحبا', 'ar')
        self.assertEqual(handler.code, 200); self.assertEqual(handler.wfile.getvalue(), b'ID3-audio')

    def test_api_get_never_serves_repository_files(self):
        handler = self.handler(TranslationHandler)
        handler.path = '/api/translate'
        handler.do_GET()
        self.assertEqual(handler.code, 405)

    def test_health_hides_process_information(self):
        handler = self.handler(HealthHandler)
        handler.do_GET()
        self.assertEqual(json.loads(handler.wfile.getvalue()), {'app': 'pdf-translator', 'status': 'ok'})

    def test_hosted_provider_deadline_is_enforced_and_cleared(self):
        with patch.dict(app.os.environ, {'VERCEL': '1'}), patch.object(app, '_translate_with_fallback') as translate:
            translate.side_effect = lambda *_: app._http(None)
            with patch.object(app.time, 'monotonic', side_effect=[0, 41]), patch.object(app, 'urlopen') as network:
                with self.assertRaises(TimeoutError):
                    app._translate_uncached('test', 'en', 'ar')
                network.assert_not_called()
        self.assertFalse(hasattr(app._provider_context, 'deadline'))

    def test_frontend_module_dependencies_are_in_static_output(self):
        static = ROOT / 'static'
        for module in static.glob('*.js'):
            imports = re.findall(r"(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]", module.read_text())
            for dependency in imports:
                with self.subTest(module=module.name, dependency=dependency):
                    asset = (module.parent / dependency).resolve()
                    asset.relative_to(static.resolve())
                    self.assertTrue(asset.is_file(), f'Missing deployed module: {dependency} imported by {module.name}')

    def test_deployment_serves_only_static_output(self):
        config = json.loads((ROOT / 'vercel.json').read_text())
        self.assertEqual(config['outputDirectory'], 'static')
        self.assertIsNone(config['framework'])
        self.assertIn('static/**', config['functions']['api/*.py']['excludeFiles'])
        self.assertTrue((ROOT / 'static/vendor/pdf.worker.min.mjs').is_file())
        self.assertTrue((ROOT / 'static/vendor/PDFJS-LICENSE.txt').is_file())


if __name__ == '__main__':
    unittest.main()
