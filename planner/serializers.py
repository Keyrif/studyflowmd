from rest_framework import serializers

from .models import Subject, Task


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'title', 'subject', 'date', 'kind', 'color', 'done', 'user']
        read_only_fields = ['user']
