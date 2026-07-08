const CALENDLY_API_BASE = "https://api.calendly.com";

export type CalendlyEventType = {
  uri: string;
  name: string;
  schedulingUrl: string;
  durationMinutes: number;
  active: boolean;
};

export type CalendlyScheduledEvent = {
  uri: string;
  name: string;
  startTime: string;
  endTime: string;
  status: string;
  location: string | null;
};

function calendlyHeaders() {
  return {
    Authorization: `Bearer ${process.env.CALENDLY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Single shared Calendly account for the whole app (a Personal Access Token,
 * not per-user OAuth) — every LifeFlow user sees/books against this one
 * operator-owned Calendly account. Every export here is a no-op/empty result
 * when CALENDLY_API_KEY isn't set, so callers never need to branch on
 * whether Calendly is configured.
 */
export function isCalendlyConfigured(): boolean {
  return !!process.env.CALENDLY_API_KEY;
}

let cachedUserUri: string | null = null;

/**
 * Calendly Personal Access Tokens are JWTs carrying a `user_uuid` claim —
 * decoding it locally gives the user URI `/event_types` and
 * `/scheduled_events` need, without an extra `/users/me` call. This matters
 * because this app's PAT scope set doesn't include `users:read` (only
 * event_types/scheduled_events/availability read+write), so `/users/me`
 * would 403 — this sidesteps that entirely, no network round-trip needed.
 */
function getCurrentUserUri(): string | null {
  if (cachedUserUri) return cachedUserUri;
  const token = process.env.CALENDLY_API_KEY;
  if (!token) return null;

  try {
    const payloadSegment = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    if (typeof payload.user_uuid !== "string") return null;
    cachedUserUri = `${CALENDLY_API_BASE}/users/${payload.user_uuid}`;
    return cachedUserUri;
  } catch {
    return null;
  }
}

export async function getBookableEventTypes(): Promise<CalendlyEventType[]> {
  const userUri = getCurrentUserUri();
  if (!userUri) return [];

  try {
    const url = new URL(`${CALENDLY_API_BASE}/event_types`);
    url.searchParams.set("user", userUri);
    url.searchParams.set("active", "true");

    const res = await fetch(url, { headers: calendlyHeaders() });
    if (!res.ok) {
      console.error(`Calendly /event_types failed: ${res.status} ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as any;
    return (data?.collection ?? []).map(
      (e: { uri: string; name: string; scheduling_url: string; duration: number; active: boolean }) => ({
        uri: e.uri,
        name: e.name,
        schedulingUrl: e.scheduling_url,
        durationMinutes: e.duration,
        active: e.active,
      })
    );
  } catch (err) {
    console.error("Calendly /event_types request threw:", err);
    return [];
  }
}

export async function getUpcomingScheduledEvents(limit = 10): Promise<CalendlyScheduledEvent[]> {
  const userUri = getCurrentUserUri();
  if (!userUri) return [];

  try {
    const url = new URL(`${CALENDLY_API_BASE}/scheduled_events`);
    url.searchParams.set("user", userUri);
    url.searchParams.set("status", "active");
    url.searchParams.set("sort", "start_time:asc");
    url.searchParams.set("min_start_time", new Date().toISOString());
    url.searchParams.set("count", String(limit));

    const res = await fetch(url, { headers: calendlyHeaders() });
    if (!res.ok) {
      console.error(`Calendly /scheduled_events failed: ${res.status} ${await res.text()}`);
      return [];
    }
    const data = (await res.json()) as any;
    return (data?.collection ?? []).map(
      (e: {
        uri: string;
        name: string;
        start_time: string;
        end_time: string;
        status: string;
        location?: { join_url?: string; location?: string } | null;
      }) => ({
        uri: e.uri,
        name: e.name,
        startTime: e.start_time,
        endTime: e.end_time,
        status: e.status,
        location: e.location?.join_url ?? e.location?.location ?? null,
      })
    );
  } catch (err) {
    console.error("Calendly /scheduled_events request threw:", err);
    return [];
  }
}
