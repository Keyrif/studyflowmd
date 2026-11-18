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
    KIND_CHOICES = [('assignment','Assignment'), ('exam','Exam'), ('study','Study session')]

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)  
    title   = models.CharField(max_length=200)       
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, null=True, blank=True)             
    date    = models.DateField(db_index=True)                                  
    kind    = models.CharField(max_length=20, choices=KIND_CHOICES)  
    color   = models.CharField(max_length=7)
    done    = models.BooleanField(default=False)
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


class OcrJob(models.Model):
    """One photo upload, read in the background by a Celery worker.

    The browser gets the job's id right away and asks for its status every few seconds.
    The id is a random UUID, so nobody can guess another user's job address.
    """

    QUEUED, RUNNING, DONE, FAILED = 'queued', 'running', 'done', 'failed'
    STATUS_CHOICES = [(QUEUED, 'Queued'), (RUNNING, 'Running'), (DONE, 'Done'), (FAILED, 'Failed')]

    id      = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    subject = models.ForeignKey(Subject, on_delete=models.SET_NULL, null=True, blank=True)
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
