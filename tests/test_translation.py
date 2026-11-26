import io
import json
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class SpeechTests(unittest.TestCase):
    def setUp(self):
        app._speech_cache.clear()

    def handler(self, payload, origin='http://localhost:8765'):
        handler = object.__new__(app.Handler)
        body = json.dumps(payload).encode()
        handler.path = '/api/translate'; handler.headers = {'Content-Length': str(len(body)), 'Origin': origin, 'Host': 'localhost:8765'}
        handler.rfile = io.BytesIO(body); handler.wfile = io.BytesIO()
        handler.connection = type('Connection', (), {'settimeout': lambda *_: None})()
        handler.send_response = lambda code: setattr(handler, 'code', code)
        handler.send_header = lambda *args: None; handler.end_headers = lambda: None
        return handler

    def test_speech_validation_and_origin(self):
        for payload in ({'text': 'x' * 201, 'language': 'en'}, {'text': '', 'language': 'en'}, {'text': 'x', 'language': 'auto'}, {'text': 'x', 'language': 'https://evil.example'}):
            handler = self.handler(dict(payload, operation='speech'))
            with patch.object(app, 'speech_clip') as provider:
                handler.do_POST(); provider.assert_not_called()
            self.assertEqual(handler.code, 400)
        handler = self.handler({'operation': 'speech', 'text': 'hello', 'language': 'en'}, 'https://evil.example')
        with patch.object(app, 'speech_clip') as provider:
            handler.do_POST(); provider.assert_not_called()
        self.assertEqual(handler.code, 403)

    def test_speech_cache_and_response_validation(self):
        class Response:
            headers = {'Content-Type': 'audio/mpeg'}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return b'ID3-audio'
        with patch.object(app, 'urlopen', return_value=Response()) as provider:
            self.assertEqual(app.speech_clip('hello', 'en'), b'ID3-audio')
            self.assertEqual(app.speech_clip('hello', 'en'), b'ID3-audio')
            self.assertEqual(provider.call_count, 1)
            self.assertTrue(provider.call_args.args[0].full_url.startswith('https://translate.google.com/translate_tts?'))
        Response.headers = {'Content-Type': 'text/html'}
        with patch.object(app, 'urlopen', return_value=Response()):
            with self.assertRaises(RuntimeError): app.speech_clip('different', 'en')
        handler = self.handler({'operation': 'speech', 'text': 'hello', 'language': 'en'})
        with patch.object(app, 'speech_clip', side_effect=TimeoutError()): handler.do_POST()
        self.assertEqual(handler.code, 502)


class TranslationTests(unittest.TestCase):
    def setUp(self):
        app._cache.clear()
        app._inflight.clear()

    def test_simultaneous_duplicates_share_provider_call(self):
        entered, release = threading.Event(), threading.Event()
        def provider(*args):
            entered.set()
            self.assertTrue(release.wait(2))
            return ('translated', 'en', 'test')
        with patch.object(app, '_translate_uncached', side_effect=provider) as mock:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(app.translate_text, 'hello', 'en', 'ar')
                self.assertTrue(entered.wait(2))
                second = pool.submit(app.translate_text, 'hello', 'en', 'ar')
                release.set()
                self.assertEqual(first.result(), second.result())
            self.assertEqual(mock.call_count, 1)
            app.translate_text('hello', 'en', 'ar')
            self.assertEqual(mock.call_count, 1)

    def test_chunks_never_include_empty_requests(self):
        self.assertEqual(app.split_chunks('abcdefghij', 5), ['abcde', 'fghij'])
        for length in range(1, 40):
            chunks = app.split_chunks('x' * length, 5)
            self.assertTrue(all(0 < len(chunk) <= 5 for chunk in chunks))
            self.assertEqual(''.join(chunks), 'x' * length)

    def test_scheduler_shares_jobs_and_cancels_only_last_reader(self):
        scheduler = app.TranslationScheduler(workers=0, capacity=2)
        first = scheduler.submit('hello', 'en', 'ar')
        second = scheduler.submit('hello', 'en', 'ar', 0)
        self.assertIs(first, second)
        self.assertEqual(len(scheduler.queue), 1)
        self.assertEqual(scheduler.queue[0]['priority'], 0)
        scheduler.release(first)
        self.assertFalse(first.cancelled())
        scheduler.release(second)
        self.assertTrue(first.cancelled())
        self.assertEqual(scheduler.queue, [])

    def test_scheduler_prioritizes_selection(self):
        scheduler = app.TranslationScheduler(workers=1)
        entered, release = threading.Event(), threading.Event()
        order = []
        def provider(text, *_):
            order.append(text)
            if text == 'running':
                entered.set()
                if not release.wait(2):
                    raise RuntimeError('test timed out')
            return text, 'en', 'test'
        with patch.object(app, '_translate_uncached', side_effect=provider):
            first = scheduler.submit('running', 'en', 'ar')
            self.assertTrue(entered.wait(1))
            page = scheduler.submit('page', 'en', 'ar')
            selection = scheduler.submit('selection', 'en', 'ar', 0)
            release.set()
            for future in (first, page, selection):
                future.result(timeout=2)
        self.assertEqual(order, ['running', 'selection', 'page'])

    def test_disconnected_stream_releases_queued_work(self):
        scheduler = app.TranslationScheduler(workers=0)
        handler = object.__new__(app.Handler)
        body = json.dumps({'texts': ['obsolete'], 'stream': True}).encode()
        handler.path = '/api/translate'
        handler.headers = {'Content-Length': str(len(body))}
        handler.connection = type('Connection', (), {'settimeout': lambda *_: None})()
        handler.rfile = io.BytesIO(body)
        handler.wfile = type('Disconnected', (), {'write': lambda *_: (_ for _ in ()).throw(BrokenPipeError())})()
        handler.send_response = lambda *_: None
        handler.send_header = lambda *_: None
        handler.end_headers = lambda: None
        with patch.object(app, '_translation_pool', scheduler):
            handler.do_POST()
        self.assertFalse(scheduler.queue)
        self.assertFalse(scheduler.jobs)

    def test_health_endpoint(self):
        handler = object.__new__(app.Handler)
        handler.path = '/api/health'
        handler._json = lambda code, body: (code, body)
        code, health = handler.do_GET()
        self.assertEqual(code, 200)
        self.assertEqual(health['app'], 'pdf-translator')
        self.assertEqual(health['pid'], app.os.getpid())

    def test_strict_port_never_falls_back(self):
        with patch.object(app.sys, 'argv', ['app.py', '--strict-port', '--no-browser', '--port', '8765']), \
                patch.object(app, 'free_port') as fallback, \
                patch.object(app, 'ThreadingHTTPServer', side_effect=OSError('port occupied')):
            with self.assertRaisesRegex(SystemExit, 'Cannot listen'):
                app.main()
            fallback.assert_not_called()

    def test_body_limits_reject_before_reading(self):
        for length, expected in [(-1, 400), (app.MAX_BODY_BYTES + 1, 413)]:
            handler = object.__new__(app.Handler)
            handler.path = '/api/translate'
            handler.headers = {'Content-Length': str(length)}
            handler.rfile = None  # Reading would fail this check.
            handler._json = lambda code, obj: code
            self.assertEqual(handler.do_POST(), expected)

    def test_scheduler_capacity(self):
        scheduler = app.TranslationScheduler(workers=0, capacity=1)
        future = scheduler.submit('one', 'en', 'ar')
        with self.assertRaises(RuntimeError):
            scheduler.submit('two', 'en', 'ar')
        scheduler.release(future)
        scheduler.submit('two', 'en', 'ar')

    def test_duplicate_stream_keeps_all_input_indices(self):
        with patch.object(app, '_translate_uncached', return_value=('ok', 'en', 'test')):
            _, body = self.request({'texts': ['same', 'same'], 'stream': True})
        events = [json.loads(line) for line in body.splitlines() if line.strip()]
        self.assertEqual(sorted(e['index'] for e in events[:-1]), [0, 1])

    def test_failure_can_be_retried(self):
        with patch.object(app, '_translate_uncached', side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError):
                app.translate_text('hello', 'en', 'ar')
        self.assertFalse(app._inflight)
        with patch.object(app, '_translate_uncached', return_value=('ok', 'en', 'test')):
            self.assertEqual(app.translate_text('hello', 'en', 'ar')[0], 'ok')

    def request(self, payload):
        handler = object.__new__(app.Handler)
        body = json.dumps(payload).encode()
        handler.connection = type('Connection', (), {'settimeout': lambda *_: None})()
        handler.path = '/api/translate'
        handler.headers = {'Content-Length': str(len(body))}
        handler.rfile, handler.wfile = io.BytesIO(body), io.BytesIO()
        handler.send_response = lambda code: setattr(handler, 'code', code)
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        handler.do_POST()
        return handler.code, handler.wfile.getvalue()

    def test_stream_reports_fast_result_before_slow_and_preserves_indices(self):
        def provider(text, *args):
            time.sleep(0.08 if text == 'slow' else 0.005)
            return (text.upper(), 'en', 'test')
        with patch.object(app, '_translate_uncached', side_effect=provider):
            code, body = self.request({'texts': ['slow', 'fast'], 'stream': True})
        events = [json.loads(line) for line in body.splitlines()]
        self.assertEqual(code, 200)
        self.assertEqual([e['index'] for e in events[:-1]], [1, 0])
        self.assertEqual(events[-1], {'done': True})

    def test_stream_error_does_not_hide_successes(self):
        def provider(text, *args):
            if text == 'bad':
                raise RuntimeError('offline')
            return ('ok', 'en', 'test')
        with patch.object(app, '_translate_uncached', side_effect=provider):
            _, body = self.request({'texts': ['bad', 'good'], 'stream': True})
        events = [json.loads(line) for line in body.splitlines()]
        self.assertTrue(any(e.get('error') == 'offline' for e in events))
        self.assertTrue(any(e.get('translation') == 'ok' for e in events))
        self.assertEqual(events[-1], {'done': True})

    def test_legacy_response_keeps_input_order(self):
        with patch.object(app, '_translate_uncached', side_effect=lambda t, *_: (t.upper(), 'en', 'test')):
            code, body = self.request({'texts': ['a', 'b']})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)['translations'], ['A', 'B'])


if __name__ == '__main__':
    unittest.main()
