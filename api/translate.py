"""Vercel entry point; shares the translation implementation with the local app."""
from urllib.parse import urlsplit

from app import Handler


class handler(Handler):
    translation_max_texts = 8
    translation_max_text_len = 20000

    def _same_origin(self):
        origin = self.headers.get('Origin')
        if not origin:
            # Non-browser clients are allowed; this check is not authentication.
            return True
        try:
            parsed = urlsplit(origin)
            host = self.headers.get('Host', '').lower()
            return bool(host) and parsed.netloc.lower() == host and not parsed.username and not parsed.password and \
                parsed.path in ('', '/') and not parsed.query and not parsed.fragment and \
                (parsed.scheme == 'https' or parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1'))
        except ValueError:
            return False

    def do_GET(self):
        self.send_response(405)
        self.send_header('Allow', 'POST')
        raw = b'{"error":"Use POST /api/translate"}'
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_HEAD(self):
        self.send_response(405)
        self.send_header('Allow', 'POST')
        self.end_headers()
