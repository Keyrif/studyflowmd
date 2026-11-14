from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter

from planner.views import NoteViewSet, SubjectViewSet, TaskViewSet

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')
router.register('subjects', SubjectViewSet, basename='subject')
router.register('notes', NoteViewSet, basename='note')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),
    path('api/', include(router.urls)),
    path('', TemplateView.as_view(template_name='index.html')),
]