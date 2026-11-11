import type { NextFunction, Request, Response } from "express";
import { storage, verifyPassword } from "./storage";
import type { PublicUser, User } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfIssuedAt?: number;
  }
}

export function toPublicUser(user: User): PublicUser {
  const { password: _password, ...pub } = user;
  return pub;
}

export async function attachUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.session.userId) {
    const user = await storage.getUser(req.session.userId);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ message: "Admin role required" });
    return;
  }
  next();
}

export async function login(
  username: string,
  password: string,
): Promise<User | undefined> {
  const user = await storage.getUserByUsername(username);
  if (!user) return undefined;
  if (!verifyPassword(password, user.password)) return undefined;
  return user;
}

/** Seed a default admin account on first boot. */
export async function seedAdmin(): Promise<void> {
  const existing = await storage.getUserByUsername("admin");
  if (existing) return;
  const password = process.env.ADMIN_PASSWORD ?? "admin";
  const user = await storage.createUser({ username: "admin", password });
  await storage.updateUserRole(user.id, "admin");
  await storage.appendAuditLog({
    actor: "system",
    action: "auth.admin_seeded",
    entity: "user",
    entityId: user.id,
    detail: { username: "admin" },
    severity: "info",
  });
}
