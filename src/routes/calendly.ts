import { Router } from "express";
import { isCalendlyConfigured, getBookableEventTypes, getUpcomingScheduledEvents } from "../lib/calendly.js";
import { requireAuth } from "../middleware/auth.js";

export const calendlyRouter = Router();
calendlyRouter.use(requireAuth);

calendlyRouter.get("/event-types", async (_req, res) => {
  const eventTypes = await getBookableEventTypes();
  res.json({ eventTypes, configured: isCalendlyConfigured() });
});

calendlyRouter.get("/scheduled-events", async (_req, res) => {
  const events = await getUpcomingScheduledEvents();
  res.json({ events, configured: isCalendlyConfigured() });
});
