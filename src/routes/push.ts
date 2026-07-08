import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const pushRouter = Router();

// Public — the client needs this before it has a session-dependent reason to call anything else.
pushRouter.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRouter.post("/subscribe", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: {
      userId: req.userId!,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
    update: {
      userId: req.userId!,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
  });
  res.status(201).json({ ok: true });
});

pushRouter.delete("/subscribe", requireAuth, async (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: req.userId! },
  });
  res.json({ ok: true });
});
