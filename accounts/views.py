from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

User = get_user_model()


def user_data(user):
    """Ce trimitem frontend-ului despre user (niciodata parola)."""
    return {'id': user.id, 'username': user.username, 'email': user.email}


@method_decorator(ensure_csrf_cookie, name='dispatch')
class MeView(APIView):
    """GET /api/auth/me/ -> cine e logat acum (sau null)."""
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        if request.user.is_authenticated:
            return Response({'user': user_data(request.user)})
        return Response({'user': None})


@method_decorator(csrf_protect, name='dispatch')
class RegisterView(APIView):
    """POST /api/auth/register/ -> creeaza un rand nou in auth_user si logheaza userul."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = str(request.data.get('username', '')).strip()
        email = str(request.data.get('email', '')).strip().lower()
        password = str(request.data.get('password', ''))

        if not username or not email or not password:
            return Response({'error': 'Username, email and password are required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username__iexact=username).exists():
            return Response({'error': 'That username is already taken.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'An account with this email already exists.'},
                            status=status.HTTP_400_BAD_REQUEST)

        user = User(username=username, email=email)
        try:
            validate_password(password, user)  # regulile din AUTH_PASSWORD_VALIDATORS
        except ValidationError as error:
            return Response({'error': ' '.join(error.messages)},
                            status=status.HTTP_400_BAD_REQUEST)

        user.set_password(password)  # salveaza HASH-ul, nu parola
        user.save()
        login(request, user)         # porneste sesiunea (cookie)
        return Response({'user': user_data(user)}, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    """POST /api/auth/login/ -> verifica parola si porneste sesiunea."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        identifier = str(request.data.get('login', '')).strip()  # email SAU username
        password = str(request.data.get('password', ''))

        lookup = {'email__iexact': identifier} if '@' in identifier else {'username__iexact': identifier}
        match = User.objects.filter(**lookup).first()
        user = authenticate(request, username=match.username, password=password) if match else None

        if user is None:
            return Response({'error': 'Wrong email/username or password.'},
                            status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response({'user': user_data(user)})


class LogoutView(APIView):
    """POST /api/auth/logout/ -> inchide sesiunea."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)
