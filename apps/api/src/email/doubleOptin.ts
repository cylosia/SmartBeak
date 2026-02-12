import { getDb } from '../db';
import crypto from 'crypto';

const TOKEN_EXPIRY_HOURS = 24;

export async function createDoubleOptin(subscriber_id: string): Promise<string> {
  if (!subscriber_id || typeof subscriber_id !== 'string') {
    throw new Error('Valid subscriber_id is required');
  }
  const token = crypto.randomBytes(16).toString('hex');
  const db = getDb();
  await db('email_optin_confirmations').insert({
    subscriber_id,
    token,
    expires_at: new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
  });
  return token;
}

export async function confirmDoubleOptin(token: string): Promise<boolean> {
  if (!token || typeof token !== 'string' || token.length > 200) {
    throw new Error('Invalid token format');
  }

  const db = getDb();

  // C06-FIX: Use a single atomic UPDATE with WHERE clause to prevent TOCTOU race.
  // Previously: read token → check conditions → update separately.
  // Two concurrent requests could both read confirmed_at=null and both succeed.
  // Now: single atomic UPDATE that only succeeds if token is valid, not expired, and not confirmed.
  const updatedRows = await db('email_optin_confirmations')
    .where({ token })
    .whereNull('confirmed_at')
    .where('expires_at', '>', new Date())
    .update({ confirmed_at: new Date() });

  if (updatedRows === 0) {
    throw new Error('Invalid or expired token');
  }

  return true;
}
