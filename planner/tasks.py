"""Background jobs, run by Celery workers instead of the web server.

The web server only *queues* these, which takes a few milliseconds; a worker container picks
them up from Redis and does the slow part.

Photo reading works like a fair queue at a shop:
- Every photo is its own ticket, so several photos of one upload are read at the same time.
- But an upload only ever has OCR_WINDOW tickets in the queue at once. When one of its photos
  finishes, its next photo joins the *back* of the queue. Other students' tickets therefore
  get in between, and one big upload can never occupy every worker.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from pytesseract import TesseractNotFoundError

from .models import Note, Notification, OcrJob, OcrPhoto, Task
from .ocr import OcrError, image_to_text
from .push import send_to_user

log = logging.getLogger(__name__)
NO_TEXT = '_No text was found in this photo._'
OCR_WINDOW = 4  # tickets one upload may have in the queue at the same time


def advance_upload(job_id):
    """Top up an upload's window: queue its next waiting photos until OCR_WINDOW are queued.
    When nothing is left to read, mark the upload as finished.

    Called when an upload arrives, after each of its photos is read, and by the hourly
    cleanup (in case a worker crashed between reading a photo and calling this).
    """
    with transaction.atomic():
        # Lock the upload's row: if two of its photos finish at the same moment, the second
        # call waits here, so the same photo is never queued twice and the window never overflows.
        job = OcrJob.objects.select_for_update().filter(pk=job_id).first()
        if job is None or job.status in (OcrJob.DONE, OcrJob.FAILED):
            return
        photos = job.photos.all()
        free = OCR_WINDOW - photos.filter(state=OcrPhoto.QUEUED).count()
        next_ids = list(photos.filter(state=OcrPhoto.WAITING).values_list('id', flat=True)[:max(free, 0)])
        if next_ids:
            photos.filter(id__in=next_ids).update(state=OcrPhoto.QUEUED)
            # Put the tickets in Redis only once this is saved, so a fast worker can't look
            # for a photo whose "queued" state isn't visible yet.
            transaction.on_commit(lambda: [read_photo.delay(photo_id) for photo_id in next_ids])
        elif not photos.filter(state__in=[OcrPhoto.WAITING, OcrPhoto.QUEUED]).exists():
            failed = photos.filter(state=OcrPhoto.FAILED).count()
            read = photos.filter(state=OcrPhoto.DONE).count()
            job.status = OcrJob.DONE if read else OcrJob.FAILED
            if failed and not job.error:
                job.error = (photos.filter(state=OcrPhoto.FAILED).values_list('error', flat=True).first()
                             if failed == 1 else f'{failed} photos could not be read.')[:300]
            job.save(update_fields=['status', 'error', 'updated'])


def _fail_upload(job, message):
    """Give up on a whole upload (for example when OCR isn't installed at all)."""
    with transaction.atomic():
        job.photos.filter(state__in=[OcrPhoto.WAITING, OcrPhoto.QUEUED]).update(state=OcrPhoto.FAILED, data=None)
        OcrJob.objects.filter(pk=job.pk).update(status=OcrJob.FAILED, error=message[:300], updated=timezone.now())


@shared_task
def read_photo(photo_id):
    """One ticket: read one photo and turn it into a note.

    Safe to receive twice. A ticket only counts as handled once this function returns
    (CELERY_TASK_ACKS_LATE), so if a worker crashes mid-photo, Redis gives the ticket to
    another worker. The row lock below makes sure only one worker reads a photo, and a photo
    that is already done is simply skipped, so no duplicate notes.
    """
    job_id = None
    try:
        with transaction.atomic():
            photo = (OcrPhoto.objects.select_for_update(skip_locked=True, of=('self',))
                     .select_related('job__user', 'job__subject').filter(pk=photo_id).first())
            if photo is None or photo.state != OcrPhoto.QUEUED:
                return  # another worker has it, or it was already handled
            job = photo.job
            job_id = job.id
            if job.status == OcrJob.QUEUED:
                OcrJob.objects.filter(pk=job.pk).update(status=OcrJob.RUNNING, updated=timezone.now())
            try:
                text = image_to_text(bytes(photo.data), photo.name)
            except OcrError as error:
                photo.state, photo.error, photo.data = OcrPhoto.FAILED, str(error)[:300], None
                photo.save(update_fields=['state', 'error', 'data'])
                return
            # The note and "this photo is done" are saved together, or not at all.
            photo.note = Note.objects.create(
                user=job.user, subject=job.subject, format='md',
                title=Path(photo.name).stem[:200] or 'Scanned note', body=text or NO_TEXT,
            )
            photo.state, photo.data = OcrPhoto.DONE, None  # the photo's bytes are deleted right away
            photo.save(update_fields=['note', 'state', 'data'])
    except TesseractNotFoundError:
        job = OcrJob.objects.get(pk=job_id)
        _fail_upload(job, 'Text recognition is not installed on the server yet.')
        return
    except Exception:
        # Anything unexpected: give up on this one photo (so it doesn't hold a window slot
        # forever), keep the details in the worker's log, and carry on with the rest.
        log.exception('Reading photo %s failed', photo_id)
        OcrPhoto.objects.filter(pk=photo_id, state=OcrPhoto.QUEUED).update(
            state=OcrPhoto.FAILED, error='Something went wrong while reading this photo.', data=None)
    finally:
        # Whatever happened to this photo, let the upload's next photo join the queue.
        if job_id:
            advance_upload(job_id)


# Reminders, by how many days before the deadline they go out. Exams and midterms get an
# early one too, so there is still time to study.
REMINDER_DAYS = {'exam': (3, 1), 'midterm': (3, 1), 'assignment': (1,), 'study': (1,)}


def _reminder_text(task, days):
    kind = task.get_kind_display()
    when = 'tomorrow' if days == 1 else f'in {days} days'
    title = f'{kind} {when}: {task.title}' if task.kind in ('exam', 'midterm') else f'Due {when}: {task.title}'
    body = ' · '.join(part for part in (kind, task.subject.name if task.subject else '', task.date.strftime('%d %b')) if part)
    return title[:200], body[:300]


@shared_task
def create_deadline_notifications():
    """Every hour: create a notification for each reminder that is due and not sent yet.

    Running hourly (not once a day) means a task added at 14:00 and due tomorrow still gets
    its reminder the same afternoon. The unique (user, key) rule makes repeats impossible.
    """
    today = datetime.now(ZoneInfo(settings.CELERY_TIMEZONE)).date()
    created = 0
    for days in {d for lead_times in REMINDER_DAYS.values() for d in lead_times}:
        kinds = [kind for kind, lead_times in REMINDER_DAYS.items() if days in lead_times]
        due = Task.objects.filter(done=False, date=today + timedelta(days=days), kind__in=kinds).select_related('subject')
        for task in due:
            title, body = _reminder_text(task, days)
            notification, new = Notification.objects.get_or_create(
                user_id=task.user_id, key=f'task-{task.pk}-{task.date.isoformat()}-{days}d',
                defaults={'task': task, 'title': title, 'body': body},
            )
            if new:
                created += 1
                # Each push is its own small job, so one slow push service can't hold up the rest.
                transaction.on_commit(lambda pk=notification.pk: push_notification.delay(pk))
    return created


@shared_task
def push_notification(notification_id):
    """Send one notification to every browser its owner enabled push in."""
    notification = Notification.objects.select_related('user').filter(pk=notification_id).first()
    if notification is None:
        return 0
    return send_to_user(notification.user, {
        'title': notification.title,
        'body': notification.body,
        'tag': notification.key,  # the same reminder never stacks up twice on screen
        'url': '/#tasks',
    })


@shared_task
def send_deadline_reminders():
    """Every morning: email each student a list of their unfinished tasks due tomorrow."""
    today = datetime.now(ZoneInfo(settings.CELERY_TIMEZONE)).date()
    due = (
        Task.objects.filter(done=False, date=today + timedelta(days=1))
        .exclude(reminded_on=today)          # never send the same reminder twice in one day
        .exclude(user__email='')
        .select_related('user', 'subject')
        .order_by('user_id', 'title')
    )
    per_user = defaultdict(list)
    for task in due:
        per_user[task.user].append(task)

    sent = 0
    for user, tasks in per_user.items():
        lines = [f'- {t.title} ({t.get_kind_display()}{", " + t.subject.name if t.subject else ""})' for t in tasks]
        try:
            send_mail(
                subject=f'Due tomorrow: {len(tasks)} task{"s" if len(tasks) != 1 else ""}',
                message=f'Hi {user.username},\n\nThese are due tomorrow:\n\n' + '\n'.join(lines)
                        + '\n\nA little progress today makes tomorrow easier.\nStudyFlowMD',
                from_email=None,
                recipient_list=[user.email],
            )
        except Exception:
            log.exception('Could not send a reminder to user %s', user.pk)
            continue  # one broken address must not stop everyone else's reminders
        Task.objects.filter(pk__in=[t.pk for t in tasks]).update(reminded_on=today)
        sent += 1
    return sent


@shared_task
def clean_up_ocr_jobs():
    """Every hour: restart stalled uploads, give up on lost ones, and forget old ones."""
    now = timezone.now()
    active = OcrJob.objects.filter(status__in=[OcrJob.QUEUED, OcrJob.RUNNING])
    # Stalled: photos waiting, but none queued. Happens if a worker crashed right after
    # reading a photo, before it could queue the next one. Topping up the window restarts it.
    for job in active.filter(photos__state=OcrPhoto.WAITING).exclude(photos__state=OcrPhoto.QUEUED).distinct():
        advance_upload(job.id)
    # Lost: still unfinished after an hour (for example Redis was wiped); tell the user.
    for job in active.filter(created__lt=now - timedelta(hours=1)):
        _fail_upload(job, 'Reading these photos took too long. Please upload them again.')
    # The notes stay; only the bookkeeping about old uploads is removed.
    OcrJob.objects.filter(created__lt=now - timedelta(days=7)).delete()
    return OcrPhoto.objects.filter(data__isnull=False).count()
