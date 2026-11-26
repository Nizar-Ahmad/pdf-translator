#!/usr/bin/env python3
"""
PDF Translator - tiny local server.

* Serves the web app from ./static
* Exposes POST /api/translate which forwards text to a free public translation
  endpoint (Google's, with MyMemory as fallback). Your PDF itself never leaves
  your computer - only the text you select / the text of the page you ask to
  translate is sent.

Run:  python app.py
Needs only the Python standard library (3.8+).
"""
import argparse
import json
import os
import re
import socket
import sys
import threading
import time
import webbrowser
from collections import OrderedDict
from concurrent.futures import FIRST_COMPLETED, Future, wait
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

MAX_BODY_BYTES = 1024 * 1024
MAX_PENDING = 256
MAX_TEXTS = 200
MAX_TEXT_LEN = 20000
GOOGLE_CHUNK = 3500
MYMEMORY_CHUNK = 450

_cache = OrderedDict()
_cache_lock = threading.Lock()
CACHE_MAX = 5000
_inflight = {}
_provider_context = threading.local()
class TranslationScheduler:
    """Share work before scheduling; prioritize selections and bound queued work."""
    def __init__(self, workers=4, capacity=MAX_PENDING):
        self.capacity = capacity
        self.condition = threading.Condition()
        self.jobs = {}
        self.queue = []
        self.sequence = 0
        for _ in range(workers):
            threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, text, sl, tl, priority=1):
        key = (text.strip(), sl, tl)
        with _cache_lock:
            cached = _cache.get(key)
            if cached is not None:
                _cache.move_to_end(key)
                future = Future()
                future.set_result(cached)
                return future
        with self.condition:
            if key in self.jobs:
                job = self.jobs[key]
                job["refs"] += 1
                job["priority"] = min(job["priority"], priority)
                return job["future"]
            if len(self.queue) >= self.capacity:
                raise RuntimeError("Translation queue is full. Please retry shortly.")
            future = Future()
            job = dict(key=key, future=future, refs=1, priority=priority, sequence=self.sequence)
            self.sequence += 1
            self.jobs[key] = job
            self.queue.append(job)
            self.condition.notify()
            return future

    def release(self, future):
        with self.condition:
            for key, job in list(self.jobs.items()):
                if job["future"] is future:
                    job["refs"] -= 1
                    if job["refs"] == 0 and future.cancel():
                        self.queue.remove(job)
                        del self.jobs[key]
                    break

    def _worker(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: bool(self.queue))
                job = min(self.queue, key=lambda j: (j["priority"], j["sequence"]))
                self.queue.remove(job)
                if not job["future"].set_running_or_notify_cancel():
                    continue
            try:
                job["future"].set_result(translate_text(*job["key"]))
            except Exception as exc:
                job["future"].set_exception(exc)
            finally:
                with self.condition:
                    if self.jobs.get(job["key"]) is job:
                        del self.jobs[job["key"]]


_translation_pool = TranslationScheduler()


# --------------------------------------------------------------------------
# Translation back-ends
# --------------------------------------------------------------------------
def split_chunks(text, limit):
    """Split text into pieces <= limit chars, preferring sentence boundaries."""
    if len(text) <= limit:
        return [text]
    sentences = re.split(r"(?<=[.!?。！？؟\n])\s*", text)
    chunks, cur = [], ""
    for s in sentences:
        if not s:
            continue
        while len(s) > limit:  # a single monster sentence: hard split
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(s[:limit])
            s = s[limit:]
        if cur and len(cur) + len(s) + 1 > limit:
            chunks.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}" if cur else s
    if cur:
        chunks.append(cur)
    return chunks


def _http(req, timeout=None):
    if timeout is None:
        timeout = 8 if os.environ.get("VERCEL") == "1" else 15
    deadline = getattr(_provider_context, 'deadline', None)
    if deadline is not None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Translation deadline exceeded. Please retry this paragraph.')
        timeout = min(timeout, remaining)
    with urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def google_one(text, sl, tl):
    url = "https://translate.googleapis.com/translate_a/single?" + urlencode(
        {"client": "gtx", "sl": sl, "tl": tl, "dt": "t", "ie": "UTF-8", "oe": "UTF-8"}
    )
    body = urlencode({"q": text}).encode()
    req = Request(url, data=body, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    data = json.loads(_http(req))
    out = "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])
    detected = data[2] if len(data) > 2 and isinstance(data[2], str) else sl
    return out, detected


def mymemory_one(text, sl, tl):
    pair = f"{'Autodetect' if sl == 'auto' else sl}|{tl}"
    url = "https://api.mymemory.translated.net/get?" + urlencode({"q": text, "langpair": pair})
    data = json.loads(_http(Request(url, headers={"User-Agent": UA})))
    if data.get("responseStatus") not in (200, "200"):
        raise RuntimeError(data.get("responseDetails") or "MyMemory error")
    out = data["responseData"]["translatedText"]
    return out, sl


def translate_chunked(text, sl, tl, backend, limit):
    parts, detected = [], sl
    for chunk in split_chunks(text, limit):
        out, det = backend(chunk, sl, tl)
        parts.append(out)
        if det and det != "auto":
            detected = det
    return " ".join(parts) if limit == MYMEMORY_CHUNK else "".join(
        p if p.endswith((" ", "\n")) else p + " " for p in parts
    ).rstrip(), detected


def translate_text(text, sl, tl):
    """Translate one string. Returns (translation, detected_language, provider)."""
    text = text.strip()
    if not text:
        return "", sl, "none"
    key = (text, sl, tl)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        pending = _inflight.get(key)
        owner = pending is None
        if owner:
            pending = Future()
            _inflight[key] = pending
    if not owner:
        return pending.result()
    try:
        result = _translate_uncached(text, sl, tl)
        with _cache_lock:
            _cache[key] = result
            while len(_cache) > CACHE_MAX:
                _cache.popitem(last=False)
        pending.set_result(result)
        return result
    except Exception as exc:
        pending.set_exception(exc)
        raise
    finally:
        with _cache_lock:
            _inflight.pop(key, None)


def _translate_uncached(text, sl, tl):
    # Hosted calls have a per-text budget, including retries and fallback chunks.
    if os.environ.get('VERCEL') != '1':
        return _translate_with_fallback(text, sl, tl)
    _provider_context.deadline = time.monotonic() + 40
    try:
        return _translate_with_fallback(text, sl, tl)
    finally:
        del _provider_context.deadline


def _translate_with_fallback(text, sl, tl):
    last_err = None
    result = None
    for attempt in range(2):
        try:
            out, det = translate_chunked(text, sl, tl, google_one, GOOGLE_CHUNK)
            result = (out, det, "google")
            break
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError, IndexError, OSError) as e:
            last_err = e
    if result is None:
        try:
            out, det = translate_chunked(text, sl, tl, mymemory_one, MYMEMORY_CHUNK)
            result = (out, det, "mymemory")
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"Translation services unreachable ({last_err or e}). Are you online?") from e
    return result


# Free online speech uses the same app endpoint, with bounded in-memory clips.
_speech_cache = OrderedDict()
_speech_cache_lock = threading.Lock()
_speech_slots = threading.BoundedSemaphore(4)
SPEECH_CLIP_BYTES = 256 * 1024


def speech_clip(text, language):
    key = (language, text)
    with _speech_cache_lock:
        if key in _speech_cache:
            _speech_cache.move_to_end(key)
            return _speech_cache[key]
    if not _speech_slots.acquire(blocking=False):
        raise RuntimeError('Online speech is busy. Please try again.')
    try:
        query = urlencode({'client': 'tw-ob', 'ie': 'UTF-8', 'tl': language, 'q': text})
        request = Request('https://translate.google.com/translate_tts?' + query, headers={'User-Agent': UA})
        with urlopen(request, timeout=10) as response:
            if not response.headers.get('Content-Type', '').lower().startswith('audio/'):
                raise RuntimeError('Online speech did not return audio.')
            audio = response.read(SPEECH_CLIP_BYTES + 1)
        if not audio or len(audio) > SPEECH_CLIP_BYTES:
            raise RuntimeError('Online speech returned an invalid audio clip.')
        with _speech_cache_lock:
            _speech_cache[key] = audio
            while len(_speech_cache) > 64 or sum(len(clip) for clip in _speech_cache.values()) > 8 * 1024 * 1024:
                _speech_cache.popitem(last=False)
        return audio
    finally:
        _speech_slots.release()


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    translation_max_texts = MAX_TEXTS
    translation_max_text_len = MAX_TEXT_LEN

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".bcmap": "application/octet-stream",
        ".pfb": "application/octet-stream",
        ".ttf": "font/ttf",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        if args and isinstance(args[0], str) and "/api/" in args[0]:
            sys.stderr.write("[api] " + fmt % args + "\n")

    def _json(self, code, obj):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host", "")
        return origin in (f"http://{host}",) and host.split(":")[0] in ("127.0.0.1", "localhost")

    def do_GET(self):
        if self.path == "/api/health":
            return self._json(200, {"app": "pdf-translator", "status": "ok", "pid": os.getpid()})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/translate":
            return self._json(404, {"error": "not found"})
        if not self._same_origin():
            return self._json(403, {"error": "forbidden origin"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n < 0:
                return self._json(400, {"error": "invalid content length"})
            if n > MAX_BODY_BYTES:
                return self._json(413, {"error": "request body too large"})
            self.connection.settimeout(20)
            payload = json.loads(self.rfile.read(n) or b"{}")
            if isinstance(payload, dict) and payload.get('operation') == 'speech':
                return self._speech(payload)
            texts = payload.get("texts")
            if texts is None and "text" in payload:
                texts = [payload["text"]]
            sl = str(payload.get("source") or "auto")
            tl = str(payload.get("target") or "en")
            if not isinstance(texts, list) or len(texts) > self.translation_max_texts or not all(isinstance(t, str) for t in texts):
                return self._json(400, {"error": "bad request"})
            if any(len(t) > self.translation_max_text_len for t in texts):
                return self._json(400, {"error": "text too long"})
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "bad request"})
        futures = []
        try:
            for text in texts:
                futures.append(_translation_pool.submit(text, sl, tl, 1 if payload.get("stream") else 0))
        except RuntimeError as exc:
            for future in futures:
                _translation_pool.release(future)
            return self._json(503, {"error": str(exc)})
        try:
            self._translations(futures, bool(payload.get("stream")))
        finally:
            for future in futures:
                _translation_pool.release(future)

    def _translations(self, futures, stream):
        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.end_headers()
            try:
                indices = {}
                for i, future in enumerate(futures):
                    indices.setdefault(future, []).append(i)
                pending = set(futures)
                while pending:
                    finished, pending = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
                    if not finished:
                        # Detect abandoned readers even while all providers are busy.
                        self.wfile.write(b"\n")
                        self.wfile.flush()
                    for future in finished:
                        self._stream_result(future, indices[future])
                self.wfile.write(b'{"done":true}\n')
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            return
        try:
            results = [future.result() for future in futures]
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)})
        self._json(
            200,
            {
                "translations": [r[0] for r in results],
                "detected": [r[1] for r in results],
                "provider": results[0][2] if results else "none",
            },
        )


    def _speech(self, payload):
        text, language = payload.get('text'), payload.get('language')
        if not isinstance(text, str) or not text.strip() or len(text) > 200:
            return self._json(400, {'error': 'Speech requires 1–200 characters per clip.'})
        if not isinstance(language, str) or not re.fullmatch(r'[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?', language) or language.lower() == 'auto':
            return self._json(400, {'error': 'Choose a known language for online speech.'})
        language = {'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW'}.get(language.lower(), language.split('-')[0].lower())
        try:
            audio = speech_clip(text.strip(), language)
        except HTTPError as error:
            status = 422 if error.code in (400, 404) else 502
            message = 'Online speech is not available for this language.' if status == 422 else 'The free online speech service is unavailable. Please try again later.'
            return self._json(status, {'error': message})
        except (URLError, TimeoutError, OSError, RuntimeError):
            return self._json(502, {'error': 'Free online speech is unavailable or busy. Try again, or choose a device voice.'})
        self.send_response(200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('Content-Length', str(len(audio)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            self.wfile.write(audio)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _stream_result(self, future, indices):
        try:
            out, detected, provider = future.result()
            event = {"translation": out, "detected": detected, "provider": provider}
        except Exception as exc:
            event = {"error": str(exc)}
        for index in indices:
            event["index"] = index
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()


def free_port(start):
    for p in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise SystemExit("No free port found")


def main():
    ap = argparse.ArgumentParser(description="PDF Translator local app")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PDFTR_PORT", "8765")), help="Local port (default: PDFTR_PORT or 8765)")
    ap.add_argument("--strict-port", action="store_true", help="Fail if the requested port is unavailable instead of choosing another")
    ap.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    args = ap.parse_args()
    if not 1 <= args.port <= 65535:
        ap.error("port must be between 1 and 65535")
    port = args.port if args.strict_port else free_port(args.port)
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        raise SystemExit(f"Cannot listen on 127.0.0.1:{port}: {exc}") from exc
    url = f"http://127.0.0.1:{port}/"
    print(f"PDF Translator running at {url}   (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye")


if __name__ == "__main__":
    main()
