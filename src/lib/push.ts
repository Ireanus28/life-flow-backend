import webPush from "web-push";

let configured = false;

/**
 * Single call site for VAPID setup. Returns false (caller should skip
 * sending) if keys aren't configured yet.
 */
export function ensureWebPushConfigured(): boolean {
  if (configured) return true;
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;

  webPush.setVapidDetails(VAPID_SUBJECT, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export { webPush };
