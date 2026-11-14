from django.urls import path

from .views import LoginView, LogoutView, MeView, RegisterView

urlpatterns = [
    path('me/', MeView.as_view()),
    path('register/', RegisterView.as_view()),
    path('login/', LoginView.as_view()),
    path('logout/', LogoutView.as_view()),
]
