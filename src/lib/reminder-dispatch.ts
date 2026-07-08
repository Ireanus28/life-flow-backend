import { prisma } from "./prisma.js";
import { ensureWebPushConfigured, webPush } from "./push.js";

/**
 * Scans due, unsent reminders and dispatches each by channel. Called both by
 * the in-process setInterval loop in src/index.ts (this backend is a
 * persistent server, so no external cron trigger is needed) and by the
 * manual/ops GET /api/cron/reminders endpoint.
 */
export async function dispatchDueReminders(): Promise<number> {
  const due = await prisma.reminder.findMany({
    where: { sent: false, remindAt: { lte: new Date() } },
    include: { user: { include: { pushSubscriptions: true } } },
  });

  let dispatched = 0;
  for (const reminder of due) {
    switch (reminder.channel) {
      case "PUSH": {
        if (reminder.user.notifyPush && ensureWebPushConfigured()) {
          const payload = JSON.stringify({ title: "LifeFlow reminder", body: reminder.title });
          await Promise.all(
            reminder.user.pushSubscriptions.map((sub) =>
              webPush
                .sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  payload
                )
                // A 410/404 means the browser dropped the subscription — clean it up.
                .catch(async (err: { statusCode?: number }) => {
                  if (err?.statusCode === 404 || err?.statusCode === 410) {
                    await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
                  }
                })
            )
          );
        }
        break;
      }
      case "EMAIL":
        // TODO: wire a real provider (e.g. Resend) once RESEND_API_KEY exists.
        console.log(`[stub email] to ${reminder.user.email}: ${reminder.title}`);
        break;
      case "SMS":
        // TODO: wire a real provider (e.g. Twilio) once TWILIO_* keys exist.
        console.log(`[stub sms] to user ${reminder.userId}: ${reminder.title}`);
        break;
      case "IN_APP":
      default:
        // No dispatch needed — the dashboard/reminders page reads Reminder rows directly.
        break;
    }

    await prisma.reminder.update({ where: { id: reminder.id }, data: { sent: true } });
    dispatched++;
  }

  return dispatched;
}
