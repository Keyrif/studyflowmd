"""Rate-limit Django's admin login page.

The app's own sign-in is rate-limited by Django REST Framework, but /admin/ is a separate,
plain Django page that would otherwise accept unlimited password guesses, and admin
accounts are the most valuable ones to break into.

Each visitor (by IP address) gets a few login attempts per minute. Counts live in Django's
cache, the same place the API rate limits keep theirs.
"""
from functools import wraps

from django.core.cache import cache
from django.http import HttpResponse

ATTEMPTS_PER_MINUTE = 5


def rate_limited_login(login_view):
    @wraps(login_view)
    def guarded(request, *args, **kwargs):
        if request.method == 'POST':
            key = f"admin-login:{request.META.get('REMOTE_ADDR', '')}"
            cache.add(key, 0, timeout=60)  # start a fresh one-minute window if none exists
            if cache.incr(key) > ATTEMPTS_PER_MINUTE:
                return HttpResponse('Too many login attempts. Wait a minute and try again.',
                                    status=429, content_type='text/plain')
        return login_view(request, *args, **kwargs)

    return guarded
