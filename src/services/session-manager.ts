import { randomBytes } from 'node:crypto';

/**
 * Session manager for admin authentication.
 *
 * Stores session tokens in memory with expiration tracking.
 * Session TTL is configurable via ADMIN_SESSION_TTL_MS environment variable.
 */

interface Session {
  createdAt: number;
  expiresAt: number;
}

// Default TTL: 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function getTTL(): number {
  const envTTL = process.env.ADMIN_SESSION_TTL_MS;
  if (envTTL) {
    const parsed = parseInt(envTTL, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TTL_MS;
}

// In-memory session store: token -> session info
const sessions = new Map<string, Session>();

/**
 * Create a new session and return the session token.
 * The token is a cryptographically random 64-character hex string.
 */
export function createSession(): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const ttl = getTTL();

  sessions.set(token, {
    createdAt: now,
    expiresAt: now + ttl,
  });

  return token;
}

/**
 * Validate a session token.
 * Returns true if the token exists and has not expired.
 */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) {
    return false;
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    // Session has expired, remove it
    sessions.delete(token);
    return false;
  }

  return true;
}

/**
 * Destroy a session token.
 * Returns true if the session was found and removed.
 */
export function destroySession(token: string): boolean {
  return sessions.delete(token);
}

/**
 * Clean up all expired sessions.
 * This can be called periodically to free memory.
 */
export function cleanExpiredSessions(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get the current number of active sessions (for debugging/monitoring).
 */
export function getSessionCount(): number {
  return sessions.size;
}
