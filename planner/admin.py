from django.contrib import admin

from .models import Note, Subject, Task

admin.site.register(Subject)
admin.site.register(Task)
admin.site.register(Note)
