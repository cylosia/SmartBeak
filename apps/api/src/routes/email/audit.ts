import type { AuditEventParams } from './types';
import { getDb } from '../../db';
import { getLogger } from '../../../../../packages/kernel/logger';

/**
* Audit Logging Module for Email Routes
* P2-MEDIUM FIX: Extracted from email.ts God class
*/

const logger = getLogger('EmailAudit');


/**
* Record an audit event
* @param params - Audit event parameters
*/
export async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const db = await getDb();
    await db('audit_events').insert({
    org_id: params.orgId,
    actor_type: 'user',
    actor_id: params.userId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId || null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ip_address: params["ip"],
    created_at: new Date(),
    });
  } catch (error) {
    // P2-MEDIUM FIX: error: unknown with proper type guard
    const errorMessage = error instanceof Error ? error["message"] : 'Unknown error';
    logger.error(`Failed to record audit event: ${errorMessage}`);
  }
}
