"""Serve the single-page app with fingerprinted asset links.

Browsers keep copies of .js and .css files and may reuse them after an update, running old
code against a new server. To prevent that, every <script src="assets/..."> and
<link href="assets/..."> in index.html gets a short fingerprint of the file's contents:

    assets/app.js  ->  assets/app.js?v=3f9a2c81d0

When a file changes, its fingerprint (and so its address) changes, and the browser has to
fetch the new one. Unchanged files keep their address and can still come from the cache.
The page itself is marked "no-cache", so the browser always asks for the current links.

index.html stays a plain HTML file (no template tags), so it still works when opened directly
or through preview.mjs.
"""
import hashlib
import re

from django.conf import settings
from django.http import HttpResponse
from django.utils.cache import patch_cache_control
from django.views.decorators.csrf import ensure_csrf_cookie

ASSET_LINK = re.compile(r'(?P<attr>(?:src|href)=")(?P<path>assets/[^"?#]+\.(?:js|css))"')
_cache = {}  # path -> (modification time and size, value), so files are only re-read when they change


def _cached(path, build):
    info = path.stat()
    stamp = (info.st_mtime_ns, info.st_size)
    hit = _cache.get(path)
    if hit and hit[0] == stamp:
        return hit[1]
    value = build(path)
    _cache[path] = (stamp, value)
    return value


def fingerprint(relative_path):
    path = settings.BASE_DIR / relative_path
    if not path.is_file():
        return None
    return _cached(path, lambda p: hashlib.sha256(p.read_bytes()).hexdigest()[:10])


def versioned(match):
    version = fingerprint(match['path'])
    suffix = f'?v={version}' if version else ''
    return f'{match["attr"]}{match["path"]}{suffix}"'


@ensure_csrf_cookie
def index(request):
    html = _cached(settings.BASE_DIR / 'index.html', lambda p: p.read_text(encoding='utf-8'))
    response = HttpResponse(ASSET_LINK.sub(versioned, html), content_type='text/html; charset=utf-8')
    patch_cache_control(response, no_cache=True)
    return response
