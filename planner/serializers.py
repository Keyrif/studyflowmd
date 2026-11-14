from rest_framework import serializers

from .models import Note, Subject, Task


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'title', 'subject', 'date', 'kind', 'color', 'done', 'user']
        read_only_fields = ['user']

    def validate_subject(self, subject):
        if subject is None:
            return subject
        user = self.context['request'].user
        if subject.owner_id != user.id and not subject.members.filter(pk=user.pk).exists():
            raise serializers.ValidationError('You do not have access to this subject.')
        return subject


class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ['id', 'title', 'subject', 'body', 'format', 'updated', 'user']
        read_only_fields = ['user', 'updated']

    def validate_subject(self, subject):
        if subject is not None and subject.owner_id != self.context['request'].user.id:
            raise serializers.ValidationError('You can only add notes to your own subjects.')
        return subject


class SubjectSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    invite_code = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()

    class Meta:
        model = Subject
        fields = ['id', 'name', 'color', 'public', 'role', 'owner_name', 'invite_code', 'members']

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
