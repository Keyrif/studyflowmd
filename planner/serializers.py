import re

from rest_framework import serializers

from .models import Note, Notification, Subject, Task

# Colors end up inside HTML style attributes in the browser, so only accept values
# that cannot contain anything but a color.
HEX_COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
EVENT_COLOR_NAMES = {'sage', 'blue', 'violet', 'rose', 'orange', 'red'}


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'title', 'subject', 'date', 'kind', 'color', 'done', 'followed', 'user']
        read_only_fields = ['user']

    def validate_color(self, color):
        if color in EVENT_COLOR_NAMES or HEX_COLOR.match(color):
            return color
        raise serializers.ValidationError('Pick one of the event colors.')

    def validate_subject(self, subject):
        if subject is None:
            return subject
        user = self.context['request'].user
        if subject.owner_id != user.id and not subject.members.filter(pk=user.pk).exists():
            raise serializers.ValidationError('You do not have access to this subject.')
        return subject


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'title', 'body', 'task', 'read', 'created']
        read_only_fields = fields


class NoteSerializer(serializers.ModelSerializer):
    """A full note, including its text. Used when opening, saving, or exporting one."""

    class Meta:
        model = Note
        fields = ['id', 'title', 'subject', 'body', 'format', 'updated', 'user']
        read_only_fields = ['user', 'updated']

    def validate_subject(self, subject):
        if subject is not None and subject.owner_id != self.context['request'].user.id:
            raise serializers.ValidationError('You can only add notes to your own subjects.')
        return subject


class NoteListSerializer(serializers.ModelSerializer):
    """A light version for lists: a short preview and the size instead of the whole text.

    `preview` and `size` are calculated by PostgreSQL (see NoteViewSet.get_queryset),
    so the full text of each note never even leaves the database for a list.
    """

    preview = serializers.CharField(read_only=True)
    size = serializers.IntegerField(read_only=True)

    class Meta:
        model = Note
        fields = ['id', 'title', 'subject', 'format', 'updated', 'user', 'preview', 'size']
        read_only_fields = fields


class SubjectSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    invite_code = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()
    note_count = serializers.SerializerMethodField()

    class Meta:
        model = Subject
        fields = ['id', 'name', 'color', 'public', 'role', 'owner_name', 'invite_code', 'members', 'note_count']

    def get_note_count(self, subject):
        # Lists get the number pre-counted by the database in one query (see SubjectViewSet);
        # a single subject that was just created or changed is counted on the spot.
        counted = getattr(subject, 'counted_notes', None)
        return counted if counted is not None else subject.note_set.count()

    def _is_owner(self, subject):
        return subject.owner_id == self.context['request'].user.id

    def get_role(self, subject):
        return 'owner' if self._is_owner(subject) else 'member'

    def get_invite_code(self, subject):
        return subject.invite_code if self._is_owner(subject) else ''

    def get_members(self, subject):
        if not self._is_owner(subject):
            return []
        return [{'id': m.id, 'username': m.username} for m in subject.members.all()]

    def validate_color(self, color):
        if not HEX_COLOR.match(color):
            raise serializers.ValidationError('Use a color like #89a392.')
        return color

    def validate_name(self, name):
        name = name.strip()
        if not name:
            raise serializers.ValidationError('Give your subject a name.')
        user = self.context['request'].user
        clash = Subject.objects.filter(owner=user, name__iexact=name)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError('A subject with that name already exists.')
        return name
