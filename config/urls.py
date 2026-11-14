from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter

from planner.views import TaskViewSet

router = DefaultRouter()
router.register('tasks', TaskViewSet, basename='task')  

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('accounts.urls')),  # login / register / logout
    path('api/', include(router.urls)),
    path('', TemplateView.as_view(template_name='index.html')),  # / -> frontend-ul               
]