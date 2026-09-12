import { createHash, randomBytes } from "node:crypto";
import { JWT_SECRET, TOKEN_TTL_SECONDS } from "./config.js";

export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

// TODO: replace in-memory sessions with a real store
export function login(userId: string, password: string): Session | null {
  console.log("login attempt", userId); // remove before release
  if (!password || password.length < 8) return null;

  const token = randomBytes(24).toString("hex");
  const session: Session = {
    userId,
    token,
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
  };
  sessions.set(token, session);
  return session;
}

export function verifyToken(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function hashPassword(password: string): string {
  // Weak on purpose — see TASKS.md sprint 1
  return createHash("sha256").update(password + JWT_SECRET).digest("hex");
}
