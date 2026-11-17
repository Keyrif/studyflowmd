"""Tests for tasks, notes, subjects, and who is allowed to see or change what.

Run them with:  python manage.py test
Each test builds a tiny world (a few users, subjects, tasks, notes), makes requests
to the API as one of those users, and checks the answer. Django uses a temporary
test database, so your real data is never touched.
"""
from datetime import date, datetime, timezone

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import Note, Subject, Task

User = get_user_model()


class PlannerTestCase(APITestCase):
    """Shared setup: an owner with a shared subject, a member of it, and an outsider."""

    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user('owner', 'owner@uni.ro', 'pw-owner-12345')
        self.member = User.objects.create_user('member', 'member@uni.ro', 'pw-member-12345')
        self.outsider = User.objects.create_user('outsider', 'out@uni.ro', 'pw-outsider-12345')
        self.subject = Subject.objects.create(owner=self.owner, name='Math', public=True)
        self.subject.members.add(self.member)

    def as_user(self, user):
        self.client.force_authenticate(user)

    def task(self, user, subject=None, title='Homework'):
        return Task.objects.create(user=user, subject=subject, title=title, date=date(2026, 12, 1),
                                   kind='assignment', color='sage')


class AnonymousAccessTests(PlannerTestCase):
    def test_everything_requires_sign_in(self):
        for url in ['/api/tasks/', '/api/notes/', '/api/subjects/']:
            self.assertEqual(self.client.get(url).status_code, 403, url)


class TaskTests(PlannerTestCase):
    def test_users_only_see_their_own_tasks(self):
        self.task(self.owner, title='Owner task')
        self.task(self.outsider, title='Outsider task')
        self.as_user(self.owner)
        titles = [t['title'] for t in self.client.get('/api/tasks/').data]
        self.assertEqual(titles, ['Owner task'])

    def test_cannot_change_or_delete_someone_elses_task(self):
        other = self.task(self.outsider)
        self.as_user(self.owner)
        self.assertEqual(self.client.patch(f'/api/tasks/{other.id}/', {'done': True}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/tasks/{other.id}/').status_code, 404)
        self.assertTrue(Task.objects.filter(pk=other.pk).exists())

    def test_cannot_attach_task_to_a_subject_you_have_no_access_to(self):
        self.as_user(self.outsider)
        response = self.client.post('/api/tasks/', {
            'title': 'Sneaky', 'subject': self.subject.id, 'date': '2026-12-01',
            'kind': 'exam', 'color': 'sage'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_task_owner_cannot_be_forged(self):
        self.as_user(self.owner)
        response = self.client.post('/api/tasks/', {
            'title': 'Mine', 'date': '2026-12-01', 'kind': 'exam', 'color': 'sage',
            'user': self.outsider.id}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Task.objects.get(pk=response.data['id']).user, self.owner)

    def test_task_color_must_be_a_real_color(self):
        self.as_user(self.owner)
        response = self.client.post('/api/tasks/', {
            'title': 'X', 'date': '2026-12-01', 'kind': 'exam', 'color': '"><b>'}, format='json')
        self.assertEqual(response.status_code, 400)


class NoteTests(PlannerTestCase):
    def setUp(self):
        super().setUp()
        self.shared_note = Note.objects.create(user=self.owner, subject=self.subject, title='Shared', body='x')
        self.private_note = Note.objects.create(user=self.owner, title='Private', body='secret')

    def titles(self):
        return {n['title'] for n in self.client.get('/api/notes/').data['results']}

    def test_members_see_shared_notes_but_not_private_ones(self):
        self.as_user(self.member)
        self.assertEqual(self.titles(), {'Shared'})

    def test_outsiders_see_nothing(self):
        self.as_user(self.outsider)
        self.assertEqual(self.titles(), set())

    def test_members_cannot_edit_or_delete_shared_notes(self):
        self.as_user(self.member)
        url = f'/api/notes/{self.shared_note.id}/'
        self.assertEqual(self.client.patch(url, {'body': 'hacked'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.shared_note.refresh_from_db()
        self.assertEqual(self.shared_note.body, 'x')

    def test_members_cannot_add_notes_to_someone_elses_subject(self):
        self.as_user(self.member)
        response = self.client.post('/api/notes/', {'title': 'Spam', 'subject': self.subject.id}, format='json')
        self.assertEqual(response.status_code, 400)


class NotePaginationTests(PlannerTestCase):
    """The notes list arrives in pages of 30, light enough to scale to thousands of notes."""

    def setUp(self):
        super().setUp()
        for number in range(35):
            Note.objects.create(user=self.owner, subject=self.subject, title=f'Note {number:02}',
                                body=f'Lesson {number}\n' + 'x' * 500)
        self.as_user(self.owner)

    def test_notes_come_in_pages(self):
        first = self.client.get('/api/notes/').data
        self.assertEqual(first['count'], 35)
        self.assertEqual(len(first['results']), 30)
        self.assertIsNotNone(first['next'])
        second = self.client.get('/api/notes/?page=2').data
        self.assertEqual(len(second['results']), 5)
        self.assertIsNone(second['next'])

    def test_pages_never_repeat_or_skip_notes_even_with_equal_timestamps(self):
        # Same "updated" time for every note: only the id tie-breaker keeps the order stable.
        Note.objects.update(updated=datetime(2026, 1, 1, tzinfo=timezone.utc))
        ids = [n['id'] for page in (1, 2) for n in self.client.get(f'/api/notes/?page={page}').data['results']]
        self.assertEqual(len(ids), 35)
        self.assertEqual(len(set(ids)), 35)

    def test_page_size_is_capped(self):
        self.assertEqual(len(self.client.get('/api/notes/?page_size=1000').data['results']), 35)
        for _ in range(70):
            Note.objects.create(user=self.owner, title='More')
        self.assertEqual(len(self.client.get('/api/notes/?page_size=1000').data['results']), 100)

    def test_list_sends_a_preview_not_the_whole_text(self):
        item = self.client.get('/api/notes/').data['results'][0]
        self.assertNotIn('body', item)
        self.assertLessEqual(len(item['preview']), 240)
        self.assertEqual(item['size'], len(Note.objects.get(pk=item['id']).body.encode()))
        full = self.client.get(f"/api/notes/{item['id']}/").data
        self.assertEqual(len(full['body']), item['size'])

    def test_search_and_subject_filters_run_on_the_server(self):
        Note.objects.create(user=self.owner, title='Other', body='eigenvalues and eigenvectors')
        found = self.client.get('/api/notes/?search=eigenvector').data
        self.assertEqual([n['title'] for n in found['results']], ['Other'])
        in_subject = self.client.get(f'/api/notes/?subject={self.subject.id}').data
        self.assertEqual(in_subject['count'], 35)
        self.assertEqual(self.client.get('/api/notes/?subject=abc').status_code, 400)

    def test_subjects_report_their_file_count(self):
        subject = self.client.get(f'/api/subjects/{self.subject.id}/').data
        self.assertEqual(subject['note_count'], 35)
        listed = self.client.get('/api/subjects/').data
        self.assertEqual(listed[0]['note_count'], 35)

    def test_export_returns_every_full_note_of_one_subject(self):
        notes = self.client.get(f'/api/notes/export/?subject={self.subject.id}').data
        self.assertEqual(len(notes), 35)
        self.assertTrue(all('body' in n for n in notes))
        self.assertEqual(self.client.get('/api/notes/export/').status_code, 400)

    def test_export_only_includes_notes_you_can_see(self):
        self.as_user(self.outsider)
        self.assertEqual(self.client.get(f'/api/notes/export/?subject={self.subject.id}').data, [])
        self.as_user(self.member)
        self.assertEqual(len(self.client.get(f'/api/notes/export/?subject={self.subject.id}').data), 35)


class SubjectTests(PlannerTestCase):
    def url(self, suffix=''):
        return f'/api/subjects/{self.subject.id}/{suffix}'

    def test_only_owner_can_rename_rotate_or_delete(self):
        self.as_user(self.member)
        self.assertEqual(self.client.patch(self.url(), {'name': 'Mine now'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(self.url('rotate-code/')).status_code, 403)
        self.assertEqual(self.client.delete(self.url()).status_code, 403)
        self.assertTrue(Subject.objects.filter(pk=self.subject.pk, name='Math').exists())

    def test_invite_code_and_member_list_are_hidden_from_members(self):
        self.as_user(self.member)
        data = self.client.get(self.url()).data
        self.assertEqual(data['invite_code'], '')
        self.assertEqual(data['members'], [])

    def test_subject_color_must_be_hex(self):
        self.as_user(self.owner)
        bad = self.client.patch(self.url(), {'color': 'red;x'}, format='json')
        good = self.client.patch(self.url(), {'color': '#123abc'}, format='json')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(good.status_code, 200)

    def test_join_needs_a_valid_code_for_an_open_subject(self):
        self.as_user(self.outsider)
        self.assertEqual(self.client.post('/api/subjects/join/', {'code': 'WRONG123'}, format='json').status_code, 400)
        self.subject.public = False
        self.subject.save()
        closed = self.client.post('/api/subjects/join/', {'code': self.subject.invite_code}, format='json')
        self.assertEqual(closed.status_code, 400)
        self.subject.public = True
        self.subject.save()
        opened = self.client.post('/api/subjects/join/', {'code': self.subject.invite_code.lower()}, format='json')
        self.assertEqual(opened.status_code, 201)
        self.assertTrue(self.subject.members.filter(pk=self.outsider.pk).exists())

    def test_guessing_invite_codes_is_rate_limited(self):
        self.as_user(self.outsider)
        for _ in range(10):
            self.client.post('/api/subjects/join/', {'code': 'GUESS000'}, format='json')
        self.assertEqual(self.client.post('/api/subjects/join/', {'code': 'GUESS001'}, format='json').status_code, 429)

    def test_removing_a_member_revokes_access_and_keeps_their_tasks(self):
        member_task = self.task(self.member, subject=self.subject)
        self.as_user(self.owner)
        response = self.client.post(self.url('remove-member/'), {'user_id': self.member.id}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.subject.members.filter(pk=self.member.pk).exists())
        member_task.refresh_from_db()
        self.assertIsNone(member_task.subject)

    def test_remove_member_with_garbage_id_does_not_crash(self):
        self.as_user(self.owner)
        response = self.client.post(self.url('remove-member/'), {'user_id': 'abc'}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_leaving_keeps_your_tasks_unfiled(self):
        member_task = self.task(self.member, subject=self.subject)
        self.as_user(self.member)
        self.assertEqual(self.client.post(self.url('leave/')).status_code, 204)
        member_task.refresh_from_db()
        self.assertIsNone(member_task.subject)

    def test_deleting_a_subject_does_not_delete_other_peoples_tasks(self):
        owner_task = self.task(self.owner, subject=self.subject)
        member_task = self.task(self.member, subject=self.subject)
        note = Note.objects.create(user=self.owner, subject=self.subject, title='Keep me')
        self.as_user(self.owner)
        self.assertEqual(self.client.delete(self.url()).status_code, 204)
        self.assertFalse(Task.objects.filter(pk=owner_task.pk).exists())
        member_task.refresh_from_db()
        self.assertIsNone(member_task.subject)
        note.refresh_from_db()
        self.assertIsNone(note.subject)
