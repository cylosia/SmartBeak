import { getDb } from '../db';
import crypto from 'crypto';

const TOKEN_EXPIRY_HOURS = 24;

export async function createDoubleOptin(subscriber_id: string): Promise<string> {
  const token = crypto.randomBytes(16).toString('hex');
  const db = await getDb();
  await db('email_optin_confirmations').insert({
    subscriber_id,
    token,
    expires_at: new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
  });
  return token;
}

export async function confirmDoubleOptin(token: string): Promise<boolean> {
  const db = await getDb();
  const rec = await db('email_optin_confirmations')
    .where({ token })
    .first();
  if (!rec || (rec.expires_at && new Date(rec.expires_at) < new Date()) || rec.confirmed_at) {
    throw new Error('Invalid or expired token');
  }
  
  await db('email_optin_confirmations')
    .where({ token })
    .update({ confirmed_at: new Date() });
  return true;
}
