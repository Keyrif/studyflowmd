from django.db import transaction
from django.db.models import Count, Func, IntegerField, Q
from django.db.models.functions import Substr
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from django.conf import settings

from .models import Note, Notification, OcrJob, OcrPhoto, PushSubscription, Subject, Task, generate_invite_code
from .ocr import OcrError, check_image, read_upload
from .pagination import NotePagination
from .tasks import advance_upload
from .push import push_enabled
from .serializers import NoteListSerializer, NoteSerializer, NotificationSerializer, SubjectSerializer, TaskSerializer

PREVIEW_LENGTH = 240
MAX_IMAGES_PER_UPLOAD = 10


def ocr_job_data(job):
    """What the browser needs to show progress: status, counts, and the notes made so far."""
    job.refresh_from_db(fields=['status', 'error'])
    photos = list(job.photos.values_list('name', 'state', 'note_id'))
    return {
        'id': str(job.id),
        'status': job.status,
        'error': job.error,
        'subject': job.subject_id,
        'mode': job.mode,
        'total': len(photos),
        'done': sum(1 for _, state, _ in photos if state == OcrPhoto.DONE),
        'failed': sum(1 for _, state, _ in photos if state == OcrPhoto.FAILED),
        'notes': [note_id for _, state, note_id in photos if state == OcrPhoto.DONE and note_id],
        # One entry per photo, so the page can show an "Uploading file" placeholder for each.
        'photos': [{'name': name, 'state': state, 'note': note_id} for name, state, note_id in photos],
    }


class OctetLength(Func):
    """PostgreSQL's OCTET_LENGTH: the size of a text in bytes, computed inside the database."""

    function = 'OCTET_LENGTH'
    output_field = IntegerField()


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user).order_by('date', 'id')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class NoteViewSet(viewsets.ModelViewSet):
    """Notes the user wrote, plus notes in subjects they joined.

    GET /api/notes/                  one page of light notes (no full text)
        ?page=2                      the next page
        ?subject=5                   only notes in subject 5
        ?search=matrix               only notes whose title, text, or subject matches
    GET /api/notes/12/               one full note, with its text
    GET /api/notes/export/?subject=5 every full note in subject 5 (for the skill ZIP)
    POST /api/notes/ocr/             queue photos to be read; answers at once with a job id
    GET  /api/notes/ocr/<job id>/    how that job is going, and which notes it created
    """

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = NotePagination
    throttle_scope = None  # set to 'ocr' on the ocr action below

    def get_serializer_class(self):
        return NoteListSerializer if self.action == 'list' else NoteSerializer

    def visible_notes(self):
        user = self.request.user
        # '-id' breaks ties between notes saved at the same moment. Without a fully
        # stable order, a note could show up on two pages or on none.
        return (
            Note.objects.filter(Q(user=user) | Q(subject__members=user))
            .distinct()
            .select_related('subject')
            .order_by('-updated', '-id')
        )

    def subject_filter(self, notes, required=False):
        raw = self.request.query_params.get('subject')
        if raw in (None, ''):
            if required:
                raise ValidationError({'subject': 'Choose a subject.'})
            return notes
        try:
            return notes.filter(subject_id=int(raw))
        except ValueError:
            raise ValidationError({'subject': 'Unknown subject.'})

    def get_queryset(self):
        notes = self.visible_notes()
        if self.action != 'list':
            return notes
        notes = self.subject_filter(notes)
        search = self.request.query_params.get('search', '').strip()
        if search:
            notes = notes.filter(
                Q(title__icontains=search) | Q(body__icontains=search) | Q(subject__name__icontains=search)
            )
        # Let PostgreSQL cut the preview and measure the size, and don't load the full text.
        return notes.annotate(preview=Substr('body', 1, PREVIEW_LENGTH), size=OctetLength('body')).defer('body')

    @action(detail=False, methods=['get'])
    def export(self, request):
        notes = self.subject_filter(self.visible_notes(), required=True)
        return Response(NoteSerializer(notes, many=True, context=self.get_serializer_context()).data)

    # Reading photos is heavy work for the server, so each user gets a limited number of uploads.
    @action(detail=False, methods=['post'], throttle_classes=[ScopedRateThrottle], throttle_scope='ocr')
    def ocr(self, request):
        images = request.FILES.getlist('images')
        # Set by config.uploads.UploadSizeLimitHandler when it cut an upload off mid-way.
        if getattr(request, 'upload_too_large', False):
            return Response({'error': 'Photos must be 10 MB or smaller each.'},
                            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        if not images:
            return Response({'error': 'Choose at least one photo.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(images) > MAX_IMAGES_PER_UPLOAD:
            return Response({'error': f'Upload at most {MAX_IMAGES_PER_UPLOAD} photos at once.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # "text" (the default): read with Tesseract. "math": lines of formulas, read with pix2tex.
        mode = request.data.get('mode') or OcrJob.TEXT
        if mode not in (OcrJob.TEXT, OcrJob.MATH):
            return Response({'error': 'Choose text or math photos.'}, status=status.HTTP_400_BAD_REQUEST)

        # Check the target subject with the same rules as a normal new note (your own subjects only).
        subject = request.data.get('subject') or None
        check = NoteSerializer(data={'title': 'check', 'subject': subject}, context=self.get_serializer_context())
        if not check.is_valid():
            return Response({'error': 'You can only add notes to your own subjects.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Quick checks on every photo before accepting any, so one bad file rejects the whole
        # upload right away instead of failing later in the background.
        try:
            photos = [(upload.name[:255], read_upload(upload)) for upload in images]
            for name, data in photos:
                check_image(data, name)
        except OcrError as error:
            return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)

        # Store the photos and the job, then hand the job to a worker. Reading the photos is
        # the slow part, and the user doesn't wait for it: this request finishes right away.
        with transaction.atomic():
            job = OcrJob.objects.create(user=request.user, subject=check.validated_data.get('subject'), mode=mode)
            OcrPhoto.objects.bulk_create(
                OcrPhoto(job=job, position=index, name=name, data=data) for index, (name, data) in enumerate(photos)
            )
            # Once the photos are really saved, put the upload's first few photos in the queue
            # (its "window"); each finished photo then queues the next one.
            transaction.on_commit(lambda: advance_upload(job.id))
        return Response(ocr_job_data(job), status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=['get'], url_path=r'ocr/(?P<job_id>[0-9a-f-]{36})')
    def ocr_status(self, request, job_id=None):
        # Filtering by user means someone else's job id simply "doesn't exist" for you.
        job = OcrJob.objects.filter(pk=job_id, user=request.user).first()
        if job is None:
            return Response({'error': 'Upload not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(ocr_job_data(job))

    def _require_author(self, note):
        if note.user_id != self.request.user.id:
            raise PermissionDenied('Shared notes are read-only.')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        self._require_author(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_author(instance)
        instance.delete()


class NotificationViewSet(viewsets.mixins.ListModelMixin, viewsets.mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Your notifications, newest first.

    GET    /api/notifications/            the latest 100 (only your own)
    DELETE /api/notifications/<id>/       remove one (the x in the panel)
    POST   /api/notifications/read-all/   mark everything read (when the panel is opened)
    """

    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    def list(self, request):
        notifications = self.get_queryset()
        return Response({
            'unread': notifications.filter(read=False).count(),
            'results': self.get_serializer(notifications[:100], many=True).data,
        })

    @action(detail=False, methods=['post'], url_path='read-all')
    def read_all(self, request):
        self.get_queryset().filter(read=False).update(read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PushViewSet(viewsets.ViewSet):
    """Turn browser push notifications on or off for this browser.

    GET    /api/push/              the server's public key (null when push isn't configured)
    POST   /api/push/              save this browser's subscription
    DELETE /api/push/unsubscribe/  forget it ({"endpoint": ...})
    """

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        return Response({'public_key': settings.VAPID_PUBLIC_KEY if push_enabled() else None})

    def create(self, request):
        endpoint = str(request.data.get('endpoint', ''))
        keys = request.data.get('keys') or {}
        # Only real push-service addresses over HTTPS; the server will send requests there.
        if not endpoint.startswith('https://') or len(endpoint) > 1000 or not keys.get('p256dh') or not keys.get('auth'):
            return Response({'error': 'This browser sent an invalid subscription.'}, status=status.HTTP_400_BAD_REQUEST)
        PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={'user': request.user, 'p256dh': str(keys['p256dh'])[:200], 'auth': str(keys['auth'])[:100]},
        )
        return Response(status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['delete'], url_path='unsubscribe')
    def unsubscribe(self, request):
        request.user.push_subscriptions.filter(endpoint=str(request.data.get('endpoint', ''))).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SubjectViewSet(viewsets.ModelViewSet):
    serializer_class = SubjectSerializer
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = None  # set to 'join' on the join action below

    def get_queryset(self):
        user = self.request.user
        return (
            Subject.objects.filter(Q(owner=user) | Q(members=user))
            .distinct()
            .select_related('owner')
            .prefetch_related('members')
            # Count each subject's notes in the same query, instead of one query per subject.
            .annotate(counted_notes=Count('note', distinct=True))
            .order_by('id')
        )

    def _require_owner(self, subject):
        if subject.owner_id != self.request.user.id:
            raise PermissionDenied('Only the owner can change this subject.')

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_update(self, serializer):
        self._require_owner(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_owner(instance)
        # Members' own tasks are theirs: keep them as unfiled instead of letting the
        # owner's delete cascade into other people's data. The owner's tasks go with it.
        Task.objects.filter(subject=instance).exclude(user=instance.owner).update(subject=None)
        instance.delete()

    # Rate-limited so invitation codes cannot be guessed by trying thousands per minute.
    @action(detail=False, methods=['post'], throttle_classes=[ScopedRateThrottle], throttle_scope='join')
    def join(self, request):
        code = str(request.data.get('code', '')).strip().upper()
        subject = Subject.objects.filter(invite_code=code, public=True).first()
        if subject is None:
            return Response({'error': 'No shared subject uses this code.'}, status=status.HTTP_400_BAD_REQUEST)
        if self.get_queryset().filter(pk=subject.pk).exists():
            return Response({'error': 'This subject is already in your workspace.'}, status=status.HTTP_400_BAD_REQUEST)
        if self.get_queryset().filter(name__iexact=subject.name).exists():
            return Response({'error': 'A subject with this name already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        subject.members.add(request.user)
        return Response(self.get_serializer(subject).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        subject = self.get_object()
        if subject.owner_id == request.user.id:
            return Response({'error': 'Owners cannot leave their own subject.'}, status=status.HTTP_400_BAD_REQUEST)
        subject.members.remove(request.user)
        Task.objects.filter(user=request.user, subject=subject).update(subject=None)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='rotate-code')
    def rotate_code(self, request, pk=None):
        subject = self.get_object()
        self._require_owner(subject)
        subject.invite_code = generate_invite_code()
        subject.save(update_fields=['invite_code'])
        return Response(self.get_serializer(subject).data)

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        subject = self.get_object()
        self._require_owner(subject)
        try:
            user_id = int(request.data.get('user_id'))
        except (TypeError, ValueError):
            return Response({'error': 'This person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        member = subject.members.filter(pk=user_id).first()
        if member is None:
            return Response({'error': 'This person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        subject.members.remove(member)
        Task.objects.filter(user=member, subject=subject).update(subject=None)
        return Response(self.get_serializer(subject).data)
