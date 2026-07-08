import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const updatePrefsSchema = z.object({
  notifyInApp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
});

const notificationSelect = {
  notifyInApp: true,
  notifyEmail: true,
  notifySms: true,
  notifyPush: true,
  quietHoursStart: true,
  quietHoursEnd: true,
} as const;

settingsRouter.get("/notifications", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: notificationSelect });
  res.json({ preferences: user });
});

settingsRouter.patch("/notifications", async (req, res) => {
  const parsed = updatePrefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: parsed.data,
    select: notificationSelect,
  });
  res.json({ preferences: user });
});

const onboardingSchema = z.object({
  timezone: z.string().min(1),
  wakeTime: z.string().regex(/^\d{2}:\d{2}$/),
  primaryMode: z.enum(["PROFESSIONAL", "PARENT", "SENIOR", "STUDENT", "SOLOPRENEUR"]),
});

settingsRouter.patch("/onboarding", async (req, res) => {
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { ...parsed.data, onboardedAt: new Date() },
    select: { timezone: true, wakeTime: true, primaryMode: true, onboardedAt: true },
  });
  res.json({ user });
});
