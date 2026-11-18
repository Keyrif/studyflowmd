"""Tests for project-wide protections: security headers, asset versions, and the admin login."""
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings


class PageTests(TestCase):
    def test_page_sends_a_content_security_policy(self):
        policy = self.client.get('/')['Content-Security-Policy']
        self.assertIn("script-src 'self'", policy)
        self.assertIn("object-src 'none'", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertNotIn("'unsafe-eval'", policy)

    def test_assets_are_linked_with_a_content_fingerprint(self):
        response = self.client.get('/')
        self.assertIn('no-cache', response['Cache-Control'])
        self.assertRegex(response.content.decode(), r'src="assets/app\.js\?v=[0-9a-f]{10}"')
        self.assertRegex(response.content.decode(), r'href="assets/styles\.css\?v=[0-9a-f]{10}"')

    def test_fingerprint_changes_when_a_file_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'assets').mkdir()
            (root / 'index.html').write_text('<script src="assets/app.js"></script>', encoding='utf-8')
            script = root / 'assets' / 'app.js'
            with override_settings(BASE_DIR=root):
                script.write_text('version one')
                first = self.client.get('/').content
                script.write_text('version two, a different length')
                second = self.client.get('/').content
                third = self.client.get('/').content
        self.assertNotEqual(first, second)  # new contents, new address
        self.assertEqual(second, third)     # unchanged contents keep the same address

    def test_api_answers_in_json_only(self):
        response = self.client.get('/api/auth/me/', HTTP_ACCEPT='text/html')
        self.assertEqual(response['Content-Type'], 'application/json')


class AdminLoginTests(TestCase):
    def setUp(self):
        cache.clear()
        get_user_model().objects.create_superuser('boss', 'boss@uni.ro', 'a-strong-admin-pass-1')

    def login(self, password):
        return self.client.post('/admin/login/', {'username': 'boss', 'password': password})

    def test_admin_login_still_works(self):
        self.assertEqual(self.login('a-strong-admin-pass-1').status_code, 302)  # redirect = signed in

    def test_admin_password_guessing_is_rate_limited(self):
        for _ in range(5):
            self.assertEqual(self.login('wrong-guess').status_code, 200)  # form shown again
        self.assertEqual(self.login('a-strong-admin-pass-1').status_code, 429)
