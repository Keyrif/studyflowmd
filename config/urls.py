from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from config.admin_guard import rate_limited_login
from config.views import index
from planner.views import NoteViewSet, SubjectViewSet, TaskViewSet

# Must happen before admin.site.urls is read below, which is when the login view is wired up.
admin.site.login = rate_limited_login(admin.site.login)

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')
router.register('subjects', SubjectViewSet, basename='subject')
router.register('notes', NoteViewSet, basename='note')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include(router.urls)),
    path('', index),
]