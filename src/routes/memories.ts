import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const memoriesRouter = Router();
memoriesRouter.use(requireAuth);

memoriesRouter.get("/", async (req, res) => {
  const memories = await prisma.memory.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, category: true, confidence: true, createdAt: true },
  });
  res.json({ memories });
});

const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  category: z.enum(["PREFERENCE", "FACT", "RELATIONSHIP", "CONTEXT"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

memoriesRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.memory.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const parsed = updateMemorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const memory = await prisma.memory.update({
    where: { id },
    data: {
      ...parsed.data,
      // Content changed — the stored vector is now stale.
      embedding: parsed.data.content !== undefined ? [] : undefined,
    },
  });
  res.json({ memory });
});

memoriesRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.memory.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.memory.delete({ where: { id } });
  res.json({ ok: true });
});
