import secrets
import uuid

from django.db import models
from django.conf import settings  

def generate_invite_code():
    return secrets.token_hex(4).upper()

class Subject(models.Model):
    owner       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name        = models.CharField(max_length=100)
    color       = models.CharField(max_length=7, default='#89a392')
    public      = models.BooleanField(default=False)
    invite_code = models.CharField(max_length=8, unique=True, default=generate_invite_code)
    members     = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='joined_subjects',
        blank=True,
    )

    def __str__(self):
        return self.name

class Task(models.Model):
    KIND_CHOICES = [('assignment','Assignment'), ('exam','Exam'), ('midterm','Midterm'), ('study','Study session')]

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)  
    title   = models.CharField(max_length=200)       
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, null=True, blank=True)             
    date    = models.DateField(db_index=True)                                  
    kind    = models.CharField(max_length=20, choices=KIND_CHOICES)  
    color   = models.CharField(max_length=7)
    done    = models.BooleanField(default=False)
    # Followed tasks appear in the small widget at the top of every page, closest deadline first.
    followed = models.BooleanField(default=False)
    # Day a reminder email went out, so the daily job never sends the same reminder twice.
    reminded_on = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.title


class Note(models.Model):
    FORMAT_CHOICES = [('md', 'Markdown'), ('txt', 'Text')]

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    title   = models.CharField(max_length=200)
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True)
    body    = models.TextField(blank=True)
    format  = models.CharField(max_length=3, choices=FORMAT_CHOICES, default='md')
    updated = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title


class Notification(models.Model):
    """A reminder shown in the notifications panel (and pushed to the browser, if enabled).

    `key` names what the reminder is about, for example "task-12-2026-11-21-3d". The pair
    (user, key) is unique, so the hourly job can run as often as it likes without ever
    creating the same reminder twice.
    """

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    task    = models.ForeignKey(Task, on_delete=models.SET_NULL, null=True, blank=True)
    key     = models.CharField(max_length=120)
    title   = models.CharField(max_length=200)
    body    = models.CharField(max_length=300, blank=True)
    read    = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created', '-id']
        constraints = [models.UniqueConstraint(fields=['user', 'key'], name='one_notification_per_reminder')]


class PushSubscription(models.Model):
    """One browser that agreed to receive push notifications for a user.

    The browser gives us an `endpoint` (an address at Google's, Mozilla's or Apple's push
    service) and two keys used to encrypt messages so only that browser can read them.
    """

    user     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh   = models.CharField(max_length=200)
    auth     = models.CharField(max_length=100)
    created  = models.DateTimeField(auto_now_add=True)


class OcrJob(models.Model):
    """One photo upload, read in the background by a Celery worker.

    The browser gets the job's id right away and asks for its status every few seconds.
    The id is a random UUID, so nobody can guess another user's job address.
    """

    QUEUED, RUNNING, DONE, FAILED = 'queued', 'running', 'done', 'failed'
    STATUS_CHOICES = [(QUEUED, 'Queued'), (RUNNING, 'Running'), (DONE, 'Done'), (FAILED, 'Failed')]

    # What the photos contain, which decides who reads them: Tesseract (text) or pix2tex
    # (lines of maths, read by the separate math worker; see planner/math_ocr.py).
    TEXT, MATH = 'text', 'math'
    MODE_CHOICES = [(TEXT, 'Text'), (MATH, 'Math')]

    id      = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True)
    mode    = models.CharField(max_length=4, choices=MODE_CHOICES, default=TEXT)
    status  = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    error   = models.CharField(max_length=300, blank=True)
    created = models.DateTimeField(auto_now_add=True, db_index=True)
    updated = models.DateTimeField(auto_now=True)


class OcrPhoto(models.Model):
    """One photo of an upload. Each photo is its own job ("ticket") for the workers.

    Its life:  waiting -> queued (a ticket is in Redis) -> done (became a note) or failed.
    Only a few photos of one upload are queued at a time (see planner.tasks.OCR_WINDOW),
    so one big upload can't take every worker. The bytes are deleted once it is read.
    """

    WAITING, QUEUED, DONE, FAILED = 'waiting', 'queued', 'done', 'failed'
    STATE_CHOICES = [(WAITING, 'Waiting'), (QUEUED, 'Queued'), (DONE, 'Done'), (FAILED, 'Failed')]

    job      = models.ForeignKey(OcrJob, on_delete=models.CASCADE, related_name='photos')
    position = models.PositiveSmallIntegerField()
    name     = models.CharField(max_length=255)
    state    = models.CharField(max_length=10, choices=STATE_CHOICES, default=WAITING)
    error    = models.CharField(max_length=300, blank=True)
    data     = models.BinaryField(null=True)  # the uploaded file, kept only until it is read
    note     = models.ForeignKey(Note, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ['position']
