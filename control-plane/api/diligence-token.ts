export function assertActiveSession(session: any) {
  if (!session || session.status !== 'active') {
  throw new Error('Diligence session inactive or revoked');
  }
  if (new Date(session["expires_at"]) < new Date()) {
  throw new Error('Diligence session expired');
  }
}
