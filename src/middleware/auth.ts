import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Verifies the `Authorization: Bearer <jwt>` header AND re-checks the user
 * row still exists — the single source of truth for both issuing and
 * validating sessions now lives here, so a JWT for a deleted/reset user is
 * always caught before any downstream query can crash on a missing FK.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
    if (!user) return res.status(401).json({ error: "Session expired — please sign in again." });

    req.userId = user.id;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
