from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('planner', '0010_pushsubscription_notification'),
    ]

    operations = [
        migrations.AddField(
            model_name='ocrjob',
            name='mode',
            field=models.CharField(choices=[('text', 'Text'), ('math', 'Math')], default='text', max_length=4),
        ),
    ]
