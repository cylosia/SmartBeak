/**
* Metadata for audit events
* Allows flexible key-value pairs for audit context
*/
export interface AuditMetadata {
  [key: string]: unknown;
}

/**
* Audit event entity
* Records security and compliance events
*/
export class AuditEvent {
  /**
  * Creates an AuditEvent instance
  * @param action - Action that triggered the audit (e.g., 'create', 'delete')
  * @param entityType - Type of entity affected
  * @param metadata - Additional context for the audit event
  */
  constructor(
  readonly action: string,
  readonly entityType: string,
  readonly metadata: AuditMetadata
  ) {}
}
