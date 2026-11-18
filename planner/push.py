"""Send browser push notifications (the Web Push standard).

How it works:
1. When a student turns on notifications, the browser asks its push service (Google for
   Chrome, Mozilla for Firefox, Apple for Safari) for a private delivery address, the
   "endpoint", and hands it to us. We store it as a PushSubscription.
2. To notify them, we encrypt a small message for that browser and send it to the endpoint.
   The push service delivers it, even if no StudyFlowMD tab is open.
3. Our service worker (assets/sw.js) wakes up in the browser and shows the notification.

The VAPID key pair proves to the push services that messages really come from this server.
The public half goes to the browser; the private half stays in .env.
"""
import json
import logging

from django.conf import settings
from pywebpush import WebPushException, webpush

log = logging.getLogger(__name__)


def push_enabled():
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def send_to_user(user, payload):
    """Push `payload` to every browser this user enabled. Returns how many got it."""
    if not push_enabled():
        return 0
    delivered = 0
    for subscription in list(user.push_subscriptions.all()):
        try:
            webpush(
                subscription_info={
                    'endpoint': subscription.endpoint,
                    'keys': {'p256dh': subscription.p256dh, 'auth': subscription.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={'sub': settings.VAPID_SUBJECT},
                ttl=24 * 60 * 60,  # the push service keeps it up to a day if the browser is offline
            )
            delivered += 1
        except WebPushException as error:
            status = getattr(error.response, 'status_code', None)
            if status in (404, 410):
                # The browser unsubscribed or the address expired: forget it for good.
                subscription.delete()
            else:
                log.warning('Push to subscription %s failed: %s', subscription.pk, error)
    return delivered
