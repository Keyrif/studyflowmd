from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Note, Subject, Task, generate_invite_code
from .serializers import NoteSerializer, SubjectSerializer, TaskSerializer


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user).order_by('date', 'id')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class NoteViewSet(viewsets.ModelViewSet):
    serializer_class = NoteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Note.objects.filter(Q(user=user) | Q(subject__members=user))
            .distinct()
            .select_related('subject')
            .order_by('-updated')
        )

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


class SubjectViewSet(viewsets.ModelViewSet):
    serializer_class = SubjectSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Subject.objects.filter(Q(owner=user) | Q(members=user))
            .distinct()
            .select_related('owner')
            .prefetch_related('members')
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
        instance.delete()

    @action(detail=False, methods=['post'])
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
        member = subject.members.filter(pk=request.data.get('user_id')).first()
        if member is None:
            return Response({'error': 'This person is not a member.'}, status=status.HTTP_404_NOT_FOUND)
        subject.members.remove(member)
        Task.objects.filter(user=member, subject=subject).update(subject=None)
        return Response(self.get_serializer(subject).data)
