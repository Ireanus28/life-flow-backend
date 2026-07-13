import { Router } from "express";
import { isCalendlyConfigured, getBookableEventTypes, getUpcomingScheduledEvents, getSchedulingUrl } from "../lib/calendly.js";
import { requireAuth } from "../middleware/auth.js";

export const calendlyRouter = Router();
calendlyRouter.use(requireAuth);

calendlyRouter.get("/event-types", async (_req, res) => {
  const [{ items: eventTypes, authError }, schedulingUrl] = await Promise.all([
    getBookableEventTypes(),
    getSchedulingUrl(),
  ]);
  res.json({ eventTypes, configured: isCalendlyConfigured(), authError, schedulingUrl });
});

calendlyRouter.get("/scheduled-events", async (_req, res) => {
  const { items: events, authError } = await getUpcomingScheduledEvents();
  res.json({ events, configured: isCalendlyConfigured(), authError });
});
