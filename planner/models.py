import secrets

from django.db import models
from django.conf import settings  

def generate_invite_code():
    return secrets.token_hex(4).upper()

class Subject(models.Model):
    owner       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name        = models.CharField(max_length=100)
    color       = models.CharField(max_length=7, default='#89a392')
    public      = models.BooleanField(default=False)
    invite_code = models.CharField(max_length=8, unique=True, default=generate_invite_code)
    members     = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='joined_subjects',
        blank=True,
    )

class Task(models.Model):
    KIND_CHOICES = [('assignment','Assignment'), ('exam','Exam'), ('study','Study session')]

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)  
    title   = models.CharField(max_length=200)       
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE)             
    date    = models.DateField(db_index=True)                                  
    kind    = models.CharField(max_length=20, choices=KIND_CHOICES)  
    color   = models.CharField(max_length=7)                      
    done    = models.BooleanField(default=False)
