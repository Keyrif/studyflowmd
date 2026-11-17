"""Tests for signing up, signing in, and the protections around them.

Run them with:  python manage.py test
Django creates a separate, empty test database, runs every test, then deletes it,
so your real data is never touched.
"""
import base64

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

User = get_user_model()
STRONG_PASSWORD = 'correct-horse-battery-42'


class AuthTestCase(APITestCase):
    def setUp(self):
        # Rate-limit counters live in the cache; clear them so tests don't affect each other.
        cache.clear()


class RegisterTests(AuthTestCase):
    def register(self, **overrides):
        data = {'username': 'ana', 'email': 'ana@uni.ro', 'password': STRONG_PASSWORD, **overrides}
        return self.client.post('/api/auth/register/', data, format='json')

    def test_register_creates_account_and_signs_in(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(username='ana').exists())
        # The new user is signed in straight away.
        self.assertEqual(self.client.get('/api/auth/me/').data['user']['username'], 'ana')

    def test_password_is_stored_hashed(self):
        self.register()
        user = User.objects.get(username='ana')
        self.assertNotEqual(user.password, STRONG_PASSWORD)
        self.assertTrue(user.check_password(STRONG_PASSWORD))

    def test_weak_password_is_rejected(self):
        self.assertEqual(self.register(password='12345678').status_code, 400)

    def test_invalid_email_is_rejected(self):
        self.assertEqual(self.register(email='not-an-email').status_code, 400)

    def test_invalid_username_is_rejected(self):
        self.assertEqual(self.register(username='ana <script>').status_code, 400)
        self.assertEqual(self.register(username='a' * 200).status_code, 400)

    def test_duplicate_username_and_email_are_rejected(self):
        self.register()
        self.assertEqual(self.register(email='other@uni.ro').status_code, 400)
        self.assertEqual(self.register(username='other').status_code, 400)


class LoginTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        User.objects.create_user('ana', 'ana@uni.ro', STRONG_PASSWORD)

    def login(self, identifier, password=STRONG_PASSWORD):
        return self.client.post('/api/auth/login/', {'login': identifier, 'password': password}, format='json')

    def test_login_with_username_or_email(self):
        self.assertEqual(self.login('ana').status_code, 200)
        self.client.post('/api/auth/logout/')
        self.assertEqual(self.login('ANA@uni.ro').status_code, 200)

    def test_wrong_password_fails_with_generic_message(self):
        wrong_password = self.login('ana', 'nope-nope-nope')
        unknown_user = self.login('nobody')
        self.assertEqual(wrong_password.status_code, 400)
        # Same message either way, so attackers can't learn which usernames exist.
        self.assertEqual(wrong_password.data, unknown_user.data)

    def test_logout_ends_the_session(self):
        self.login('ana')
        self.client.post('/api/auth/logout/')
        self.assertIsNone(self.client.get('/api/auth/me/').data['user'])

    def test_password_guessing_is_rate_limited(self):
        for _ in range(5):
            self.login('ana', 'guess-guess-guess')
        # Even the correct password is refused once the limit is hit.
        self.assertEqual(self.login('ana').status_code, 429)

    def test_http_basic_auth_is_not_accepted(self):
        # Basic auth would bypass the rate-limited login view, so the API must ignore it.
        token = base64.b64encode(f'ana:{STRONG_PASSWORD}'.encode()).decode()
        self.client.credentials(HTTP_AUTHORIZATION=f'Basic {token}')
        self.assertEqual(self.client.get('/api/tasks/').status_code, 403)
