"""Tests for tasks, notes, subjects, and who is allowed to see or change what.

Run them with:  python manage.py test
Each test builds a tiny world (a few users, subjects, tasks, notes), makes requests
to the API as one of those users, and checks the answer. Django uses a temporary
test database, so your real data is never touched.
"""
import io
import shutil
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest import mock, skipUnless
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont
from rest_framework.test import APITestCase

from django.test import override_settings

from .models import Note, Notification, OcrJob, OcrPhoto, PushSubscription, Subject, Task
from .push import send_to_user
from .tasks import (OCR_WINDOW, advance_upload, clean_up_ocr_jobs, create_deadline_notifications, read_photo,
                    send_deadline_reminders)

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

    def test_midterm_is_a_task_type(self):
        self.as_user(self.owner)
        response = self.client.post('/api/tasks/', {
            'title': 'Algebra midterm', 'date': '2026-12-01', 'kind': 'midterm', 'color': 'orange'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Task.objects.get(pk=response.data['id']).get_kind_display(), 'Midterm')

    def test_follow_and_unfollow_a_task(self):
        task = self.task(self.owner)
        self.as_user(self.owner)
        self.assertFalse(self.client.get(f'/api/tasks/{task.id}/').data['followed'])  # off by default
        self.client.patch(f'/api/tasks/{task.id}/', {'followed': True}, format='json')
        self.assertTrue(Task.objects.get(pk=task.pk).followed)
        self.client.patch(f'/api/tasks/{task.id}/', {'followed': False}, format='json')
        self.assertFalse(Task.objects.get(pk=task.pk).followed)

    def test_cannot_follow_someone_elses_task(self):
        other = self.task(self.outsider)
        self.as_user(self.owner)
        self.assertEqual(self.client.patch(f'/api/tasks/{other.id}/', {'followed': True}, format='json').status_code, 404)
        self.assertFalse(Task.objects.get(pk=other.pk).followed)

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
        Note.objects.update(updated=datetime(2026, 1, 1, tzinfo=dt_timezone.utc))
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


def photo(name='page.png', size=(400, 300), image_format='PNG', text=None):
    """Build an image file in memory, like a browser upload, optionally with printed text."""
    image = Image.new('RGB', size, 'white')
    if text:
        ImageDraw.Draw(image).text((40, 60), text, fill='black', font=ImageFont.load_default(size=56))
    buffer = io.BytesIO()
    image.save(buffer, image_format)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f'image/{image_format.lower()}')


class UploadCounter:
    """Wraps the real size-limit handler to record how many bytes it was given."""

    def __init__(self):
        from config.uploads import UploadSizeLimitHandler
        self.real = UploadSizeLimitHandler.receive_data_chunk
        self.received = 0

    def __call__(self, handler, raw_data, start):
        self.received += len(raw_data)
        return self.real(handler, raw_data, start)


class OcrUploadTests(PlannerTestCase):
    """Photos become notes through a background job. Tesseract itself is replaced by a
    stand-in here, so these tests check our own logic (limits, permissions, the job) quickly.

    In tests, Celery runs each job immediately instead of sending it to Redis (see
    CELERY_TASK_ALWAYS_EAGER), and the job starts once the upload's database transaction
    commits, which `captureOnCommitCallbacks(execute=True)` simulates.
    """

    def setUp(self):
        super().setUp()
        self.as_user(self.owner)
        patcher = mock.patch('planner.ocr.pytesseract.image_to_string', return_value='Matrici\n\n\n\nVectori \n')
        self.fake_tesseract = patcher.start()
        self.addCleanup(patcher.stop)

    def upload(self, *files, **extra):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post('/api/notes/ocr/', {'images': list(files), **extra}, format='multipart')

    def job(self, response):
        return self.client.get(f"/api/notes/ocr/{response.data['id']}/").data

    def queue_only(self, *files):
        """Upload, but only record the tickets that would go to Redis instead of running them."""
        with mock.patch('planner.tasks.read_photo.delay') as queue:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post('/api/notes/ocr/', {'images': list(files)}, format='multipart')
        return response, [call.args[0] for call in queue.call_args_list]

    def test_upload_answers_at_once_and_queues_only_a_window_of_photos(self):
        response, tickets = self.queue_only(*[photo(f'p{i}.png') for i in range(10)])
        self.assertEqual(response.status_code, 202)
        self.assertEqual((response.data['status'], response.data['total'], response.data['done']), ('queued', 10, 0))
        self.fake_tesseract.assert_not_called()  # nothing was read during the request itself
        # One ticket per photo, but only the first OCR_WINDOW of them are in the queue for now.
        job = OcrJob.objects.get(pk=response.data['id'])
        self.assertEqual(len(tickets), OCR_WINDOW)
        self.assertEqual(sorted(tickets), list(job.photos.filter(position__lt=OCR_WINDOW).values_list('id', flat=True)))
        self.assertEqual(job.photos.filter(state=OcrPhoto.WAITING).count(), 10 - OCR_WINDOW)
        self.assertEqual(OcrPhoto.objects.filter(data__isnull=False).count(), 10)  # stored until read

    def test_each_finished_photo_queues_the_next_one(self):
        response, tickets = self.queue_only(*[photo(f'p{i}.png') for i in range(6)])
        job = OcrJob.objects.get(pk=response.data['id'])
        with mock.patch('planner.tasks.read_photo.delay') as queue:
            with self.captureOnCommitCallbacks(execute=True):
                read_photo(tickets[0])  # a worker finishes the first photo...
        fifth = job.photos.get(position=OCR_WINDOW).id
        queue.assert_called_once_with(fifth)  # ...so exactly one more photo joins the queue
        self.assertEqual(job.photos.filter(state=OcrPhoto.QUEUED).count(), OCR_WINDOW)

    def test_a_big_upload_does_not_make_others_wait_behind_it(self):
        _, ana = self.queue_only(*[photo(f'ana{i}.png') for i in range(10)])
        self.as_user(self.member)
        _, bob = self.queue_only(photo('bob.png'))
        # Bob's single photo is queued straight away, right behind Ana's first 4 tickets,
        # not behind all 10 of her photos.
        self.assertEqual(len(ana), OCR_WINDOW)
        self.assertEqual(len(bob), 1)

    def test_all_ten_photos_of_an_upload_get_read(self):
        job = self.job(self.upload(*[photo(f'p{i}.png') for i in range(10)]))
        self.assertEqual((job['status'], job['done'], job['failed'], len(job['notes'])), ('done', 10, 0, 10))

    def test_status_lists_each_photo_for_the_upload_placeholders(self):
        response, _ = self.queue_only(photo('page 1.png'), photo('page 2.png'))
        self.assertEqual(self.job(response)['photos'], [
            {'name': 'page 1.png', 'state': 'queued', 'note': None},
            {'name': 'page 2.png', 'state': 'queued', 'note': None},
        ])

    def test_each_photo_becomes_a_tidy_markdown_note(self):
        response = self.upload(photo('lecture 1.png'), photo('lecture 2.jpg', image_format='JPEG'),
                               subject=self.subject.id)
        job = self.job(response)
        self.assertEqual((job['status'], job['done'], job['total']), ('done', 2, 2))
        self.assertEqual(list(Note.objects.filter(pk__in=job['notes']).values_list('title', flat=True).order_by('title')),
                         ['lecture 1', 'lecture 2'])
        note = Note.objects.get(title='lecture 1')
        self.assertEqual((note.body, note.format, note.subject), ('Matrici\n\nVectori', 'md', self.subject))
        self.assertEqual(self.fake_tesseract.call_args.kwargs['lang'], 'ron+eng')

    def test_photos_are_deleted_once_read(self):
        self.upload(photo(), photo())
        self.assertFalse(OcrPhoto.objects.filter(data__isnull=False).exists())

    def test_photo_is_prepared_before_reading(self):
        self.upload(photo(size=(6000, 4000)))
        prepared = self.fake_tesseract.call_args.args[0]
        self.assertEqual(prepared.mode, 'L')            # grayscale
        self.assertLessEqual(max(prepared.size), 2600)  # huge phone photos are shrunk

    def test_photo_without_text_still_creates_a_note(self):
        self.fake_tesseract.return_value = '  \n\x0c'
        job = self.job(self.upload(photo()))
        self.assertIn('No text was found', Note.objects.get(pk=job['notes'][0]).body)

    def test_a_ticket_delivered_twice_makes_only_one_note(self):
        # After a worker crash, Redis hands the same ticket out again. The photo is already
        # done by then, so the second delivery must do nothing.
        response, tickets = self.queue_only(photo('first.png'))
        with self.captureOnCommitCallbacks(execute=True):
            read_photo(tickets[0])
            read_photo(tickets[0])
        self.assertEqual(self.fake_tesseract.call_count, 1)
        self.assertEqual(Note.objects.filter(title='first').count(), 1)
        self.assertEqual(self.job(response)['status'], 'done')

    def test_one_unreadable_photo_does_not_stop_the_others(self):
        from planner.ocr import OcrError
        self.fake_tesseract.side_effect = ['Page one', OcrError('page 2.png is not a readable image.'), 'Page three']
        job = self.job(self.upload(photo('page 1.png'), photo('page 2.png'), photo('page 3.png')))
        self.assertEqual((job['status'], job['done'], job['failed']), ('done', 2, 1))
        self.assertIn('page 2.png', job['error'])

    def test_stalled_upload_is_restarted_by_the_hourly_cleanup(self):
        # A worker crashed after reading a photo but before queuing the next one:
        # photos are waiting and none are queued. The cleanup must queue them again.
        response, _ = self.queue_only(photo(), photo())
        job = OcrJob.objects.get(pk=response.data['id'])
        job.photos.update(state=OcrPhoto.WAITING)
        with mock.patch('planner.tasks.read_photo.delay') as queue:
            with self.captureOnCommitCallbacks(execute=True):
                clean_up_ocr_jobs()
        self.assertEqual(queue.call_count, 2)

    def test_other_users_cannot_see_your_job(self):
        response = self.upload(photo())
        self.as_user(self.outsider)
        self.assertEqual(self.client.get(f"/api/notes/ocr/{response.data['id']}/").status_code, 404)

    def test_fake_image_is_rejected(self):
        fake = SimpleUploadedFile('virus.png', b'not really a picture', content_type='image/png')
        self.assertEqual(self.upload(fake).status_code, 400)

    def test_one_bad_file_cancels_the_whole_upload(self):
        fake = SimpleUploadedFile('bad.jpg', b'nope', content_type='image/jpeg')
        response = self.upload(photo('good.png'), fake)
        self.assertEqual(response.status_code, 400)
        self.assertIn('bad.jpg', response.data['error'])
        self.assertFalse(Note.objects.filter(title='good').exists())
        self.fake_tesseract.assert_not_called()

    def test_unsupported_format_is_rejected(self):
        self.assertEqual(self.upload(photo('anim.gif', image_format='GIF')).status_code, 400)

    def test_images_with_too_many_pixels_are_rejected_before_decoding(self):
        image = Image.new('1', (8000, 6000))  # 48 million pixels, but a tiny file
        buffer = io.BytesIO()
        image.save(buffer, 'PNG')
        bomb = SimpleUploadedFile('bomb.png', buffer.getvalue(), content_type='image/png')
        response = self.upload(bomb)
        self.assertEqual(response.status_code, 400)
        self.assertIn('too many pixels', response.data['error'])

    def test_oversized_upload_is_cut_off_while_arriving(self):
        huge = SimpleUploadedFile('huge.jpg', b'0' * (11 * 1024 * 1024), content_type='image/jpeg')
        with mock.patch('config.uploads.UploadSizeLimitHandler.receive_data_chunk',
                        autospec=True, side_effect=UploadCounter()) as counter:
            response = self.upload(huge)
        self.assertEqual(response.status_code, 413)
        # Reading stopped right after the 10 MB mark, not at the end of the 11 MB file.
        self.assertLess(counter.side_effect.received, 10 * 1024 * 1024 + 128 * 1024)
        self.fake_tesseract.assert_not_called()

    def test_upload_limits(self):
        self.assertEqual(self.upload().status_code, 400)
        eleven = [photo(f'p{i}.png') for i in range(11)]
        self.assertEqual(self.upload(*eleven).status_code, 400)

    def test_cannot_add_photos_to_someone_elses_subject(self):
        self.as_user(self.member)
        response = self.upload(photo(), subject=self.subject.id)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Note.objects.filter(user=self.member).exists())

    def test_missing_tesseract_fails_the_job_with_a_clear_error(self):
        from pytesseract import TesseractNotFoundError
        self.fake_tesseract.side_effect = TesseractNotFoundError()
        job = self.job(self.upload(photo()))
        self.assertEqual(job['status'], 'failed')
        self.assertIn('not installed', job['error'])
        self.assertFalse(OcrPhoto.objects.filter(data__isnull=False).exists())  # photos not kept

    def test_requires_sign_in(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.upload(photo()).status_code, 403)

    def test_uploads_are_rate_limited(self):
        for _ in range(30):
            self.upload(photo())
        self.assertEqual(self.upload(photo()).status_code, 429)


@skipUnless(shutil.which('tesseract'), 'Tesseract is not installed in this environment')
class RealTesseractTests(PlannerTestCase):
    """One end-to-end check with the real Tesseract program, when it is installed."""

    def test_printed_text_is_read(self):
        self.as_user(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/notes/ocr/', {'images': [photo(size=(1400, 300), text='Eigenvalues and matrices')]},
                                        format='multipart')
        self.assertEqual(response.status_code, 202)
        job = self.client.get(f"/api/notes/ocr/{response.data['id']}/").data
        body = Note.objects.get(pk=job['notes'][0]).body.lower()
        self.assertIn('eigenvalues', body)
        self.assertIn('matrices', body)

    def test_page_with_little_writing_is_read(self):
        # A big phone-sized JPEG where the text covers under 1% of the pixels. An overly
        # aggressive contrast step once turned exactly this kind of page into an empty note.
        image = Image.new('RGB', (3000, 2000), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=110)
        draw.text((150, 250), 'Lecture three', fill='black', font=font)
        draw.text((150, 510), 'Matrix determinants', fill='black', font=font)
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=90)
        upload = SimpleUploadedFile('sparse.jpg', buffer.getvalue(), content_type='image/jpeg')
        self.as_user(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/notes/ocr/', {'images': [upload]}, format='multipart')
        job = self.client.get(f"/api/notes/ocr/{response.data['id']}/").data
        body = Note.objects.get(pk=job['notes'][0]).body.lower()
        self.assertIn('determinants', body)
        self.assertIn('lecture', body)


class ReminderTests(PlannerTestCase):
    """The daily job that emails students about tasks due tomorrow."""

    def setUp(self):
        super().setUp()
        self.today = datetime.now(ZoneInfo('Europe/Bucharest')).date()
        tomorrow = self.today + timedelta(days=1)
        Task.objects.create(user=self.owner, subject=self.subject, title='Exam prep', date=tomorrow, kind='exam', color='rose')
        Task.objects.create(user=self.owner, title='Essay', date=tomorrow, kind='assignment', color='blue')
        Task.objects.create(user=self.owner, title='Already done', date=tomorrow, kind='exam', color='sage', done=True)
        Task.objects.create(user=self.owner, title='Next week', date=tomorrow + timedelta(days=6), kind='exam', color='sage')
        Task.objects.create(user=self.member, title='Member task', date=tomorrow, kind='study', color='sage')

    def test_one_email_per_student_listing_only_open_tasks_due_tomorrow(self):
        self.assertEqual(send_deadline_reminders(), 2)
        self.assertEqual(len(mail.outbox), 2)
        owner_mail = next(m for m in mail.outbox if m.to == ['owner@uni.ro'])
        self.assertEqual(owner_mail.subject, 'Due tomorrow: 2 tasks')
        self.assertIn('Exam prep (Exam, Math)', owner_mail.body)
        self.assertNotIn('Already done', owner_mail.body)
        self.assertNotIn('Next week', owner_mail.body)

    def test_reminders_are_never_sent_twice_on_the_same_day(self):
        send_deadline_reminders()
        mail.outbox.clear()
        self.assertEqual(send_deadline_reminders(), 0)
        self.assertEqual(mail.outbox, [])

    def test_students_without_an_email_are_skipped(self):
        User.objects.filter(pk=self.member.pk).update(email='')
        self.assertEqual(send_deadline_reminders(), 1)


class DeadlineNotificationTests(PlannerTestCase):
    """The hourly job that fills the notifications panel and pushes reminders to browsers."""

    def setUp(self):
        super().setUp()
        self.today = datetime.now(ZoneInfo('Europe/Bucharest')).date()
        day = lambda n: self.today + timedelta(days=n)
        self.midterm = Task.objects.create(user=self.owner, subject=self.subject, title='Algebra midterm', date=day(3),
                                           kind='midterm', color='orange')
        Task.objects.create(user=self.owner, title='Essay draft', date=day(3), kind='assignment', color='blue')
        Task.objects.create(user=self.owner, title='Problem set', date=day(1), kind='assignment', color='blue')
        Task.objects.create(user=self.owner, title='Finished', date=day(1), kind='exam', color='sage', done=True)
        Task.objects.create(user=self.member, title='Member exam', date=day(1), kind='exam', color='sage')
        patcher = mock.patch('planner.tasks.push_notification.delay')
        self.pushed = patcher.start()
        self.addCleanup(patcher.stop)

    def run_job(self):
        with self.captureOnCommitCallbacks(execute=True):
            return create_deadline_notifications()

    def test_exams_and_midterms_get_an_early_reminder_and_everything_gets_a_day_before(self):
        self.assertEqual(self.run_job(), 3)
        titles = sorted(Notification.objects.filter(user=self.owner).values_list('title', flat=True))
        self.assertEqual(titles, ['Due tomorrow: Problem set', 'Midterm in 3 days: Algebra midterm'])
        midterm = Notification.objects.get(task=self.midterm)
        self.assertEqual(midterm.body, f'Midterm · Math · {self.midterm.date:%d %b}')
        self.assertEqual(Notification.objects.get(user=self.member).title, 'Exam tomorrow: Member exam')

    def test_running_every_hour_never_repeats_a_reminder(self):
        self.run_job()
        self.assertEqual(self.run_job(), 0)
        self.assertEqual(Notification.objects.count(), 3)
        self.assertEqual(self.pushed.call_count, 3)  # one push per new reminder, never again

    def test_moving_a_deadline_gives_a_fresh_reminder(self):
        self.run_job()
        self.midterm.date = self.today + timedelta(days=1)
        self.midterm.save()
        self.run_job()
        self.assertEqual(Notification.objects.filter(task=self.midterm).count(), 2)


class NotificationApiTests(PlannerTestCase):
    def setUp(self):
        super().setUp()
        self.mine = Notification.objects.create(user=self.owner, key='a', title='Mine')
        Notification.objects.create(user=self.owner, key='b', title='Also mine', read=True)
        self.theirs = Notification.objects.create(user=self.outsider, key='a', title='Theirs')
        self.as_user(self.owner)

    def test_list_shows_only_your_notifications_and_the_unread_count(self):
        data = self.client.get('/api/notifications/').data
        self.assertEqual(sorted(n['title'] for n in data['results']), ['Also mine', 'Mine'])
        self.assertEqual(data['unread'], 1)

    def test_delete_your_own_but_not_someone_elses(self):
        self.assertEqual(self.client.delete(f'/api/notifications/{self.mine.id}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/notifications/{self.theirs.id}/').status_code, 404)
        self.assertTrue(Notification.objects.filter(pk=self.theirs.pk).exists())

    def test_opening_the_panel_marks_everything_read(self):
        self.client.post('/api/notifications/read-all/')
        self.assertEqual(self.client.get('/api/notifications/').data['unread'], 0)
        self.assertFalse(Notification.objects.get(pk=self.theirs.pk).read)  # other users untouched


class PushTests(PlannerTestCase):
    subscription = {'endpoint': 'https://push.example.com/abc', 'keys': {'p256dh': 'key', 'auth': 'secret'}}

    def setUp(self):
        super().setUp()
        self.as_user(self.owner)

    @override_settings(VAPID_PUBLIC_KEY='', VAPID_PRIVATE_KEY='')
    def test_push_is_off_when_the_server_has_no_keys(self):
        self.assertIsNone(self.client.get('/api/push/').data['public_key'])

    @override_settings(VAPID_PUBLIC_KEY='public', VAPID_PRIVATE_KEY='private')
    def test_subscribe_and_unsubscribe_a_browser(self):
        self.assertEqual(self.client.get('/api/push/').data['public_key'], 'public')
        self.assertEqual(self.client.post('/api/push/', self.subscription, format='json').status_code, 201)
        self.assertEqual(self.owner.push_subscriptions.count(), 1)
        self.client.delete('/api/push/unsubscribe/', {'endpoint': self.subscription['endpoint']}, format='json')
        self.assertEqual(self.owner.push_subscriptions.count(), 0)

    def test_only_https_push_addresses_are_accepted(self):
        bad = {**self.subscription, 'endpoint': 'http://127.0.0.1:6379/'}
        self.assertEqual(self.client.post('/api/push/', bad, format='json').status_code, 400)

    @override_settings(VAPID_PUBLIC_KEY='public', VAPID_PRIVATE_KEY='private')
    def test_reminders_are_pushed_and_dead_browsers_are_forgotten(self):
        from pywebpush import WebPushException
        alive = PushSubscription.objects.create(user=self.owner, endpoint='https://push.example.com/1', p256dh='k', auth='a')
        gone = PushSubscription.objects.create(user=self.owner, endpoint='https://push.example.com/2', p256dh='k', auth='a')

        def fake_webpush(subscription_info, **kwargs):
            if subscription_info['endpoint'] == gone.endpoint:
                raise WebPushException('Gone', response=mock.Mock(status_code=410))

        with mock.patch('planner.push.webpush', side_effect=fake_webpush) as webpush:
            delivered = send_to_user(self.owner, {'title': 'Exam tomorrow'})
        self.assertEqual(delivered, 1)
        self.assertEqual(webpush.call_count, 2)
        self.assertTrue(PushSubscription.objects.filter(pk=alive.pk).exists())
        self.assertFalse(PushSubscription.objects.filter(pk=gone.pk).exists())  # unsubscribed browser removed


class OcrCleanupTests(PlannerTestCase):
    def test_stuck_jobs_fail_and_old_jobs_are_forgotten(self):
        stuck = OcrJob.objects.create(user=self.owner)
        OcrPhoto.objects.create(job=stuck, position=0, name='p.png', data=b'bytes', state=OcrPhoto.QUEUED)
        old = OcrJob.objects.create(user=self.owner, status=OcrJob.DONE)
        OcrJob.objects.filter(pk=stuck.pk).update(created=timezone.now() - timedelta(hours=2))
        OcrJob.objects.filter(pk=old.pk).update(created=timezone.now() - timedelta(days=8))

        clean_up_ocr_jobs()
        stuck.refresh_from_db()
        self.assertEqual(stuck.status, OcrJob.FAILED)
        self.assertFalse(OcrPhoto.objects.filter(data__isnull=False).exists())
        self.assertFalse(OcrJob.objects.filter(pk=old.pk).exists())


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
