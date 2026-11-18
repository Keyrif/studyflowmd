# Load the Celery app whenever Django starts, so `some_task.delay()` knows where to send jobs.
from .celery import app as celery_app

__all__ = ('celery_app',)
