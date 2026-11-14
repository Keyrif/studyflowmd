from django.db import models
from django.conf import settings  

class Task(models.Model):
    KIND_CHOICES = [('assignment','Assignment'), ('exam','Exam'), ('study','Study session')]

    user    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)  
    title   = models.CharField(max_length=200)                    
    subject = models.CharField(max_length=100)
    date    = models.DateField(db_index=True)                                  
    kind    = models.CharField(max_length=20, choices=KIND_CHOICES)  
    color   = models.CharField(max_length=7)                      
    done    = models.BooleanField(default=False)                  