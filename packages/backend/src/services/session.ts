// Session management service
export interface SessionData {
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface Session {
  id: string;
  userId: string;
  data: SessionData;
  createdAt: Date;
  expiresAt: Date;
}

// Mock session storage - in production you'd use Redis
const sessions = new Map<string, Session>();

export async function createSession(userId: string, data: SessionData): Promise<Session> {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const session: Session = {
    id: sessionId,
    userId,
    data,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  };

  sessions.set(sessionId, session);
  return session;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  // Check if session is expired
  if (session.expiresAt < new Date()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  sessions.delete(sessionId);
}

export async function updateSession(sessionId: string, data: Partial<SessionData>): Promise<void> {
  const session = sessions.get(sessionId);
  if (session) {
    session.data = { ...session.data, ...data };
    sessions.set(sessionId, session);
  }
}
