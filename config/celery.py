"""The Celery app: how the web server hands slow jobs to background workers.

The web container puts a job ("read these photos") into Redis and answers the user at once.
A worker container, running the same code, takes jobs out of Redis one by one and does them.
A third container, "beat", is a clock: at set times it puts scheduled jobs into Redis too
(daily deadline reminders, cleaning up old upload jobs).

Start a worker with:   celery -A config worker -l info
Start the clock with:  celery -A config beat -l info
"""
import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('studyflowmd')
# Every setting that starts with CELERY_ in settings.py configures Celery.
app.config_from_object('django.conf:settings', namespace='CELERY')
# Find the jobs defined in each app's tasks.py (planner/tasks.py).
app.autodiscover_tasks()
