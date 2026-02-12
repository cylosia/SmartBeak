// H01-FIX: Replaced `any` with proper interface for type safety in security-critical path

export interface DiligenceSession {
  status: string;
  expires_at: string | Date;
}

export function assertActiveSession(session: DiligenceSession): void {
  if (!session || session.status !== 'active') {
  throw new Error('Diligence session inactive or revoked');
  }
  const expiresAt = session.expires_at instanceof Date
  ? session.expires_at
  : new Date(session.expires_at);
  if (isNaN(expiresAt.getTime())) {
  throw new Error('Invalid expiration date');
  }
  if (expiresAt < new Date()) {
  throw new Error('Diligence session expired');
  }
}
