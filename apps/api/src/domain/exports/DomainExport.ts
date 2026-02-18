/**
* Export scope configuration
* Defines what data to include in a domain export
*/
export interface ExportScope {
  /** Include content items in export */
  includeContent?: boolean;
  /** Include analytics data in export */
  includeAnalytics?: boolean;
  /** Include keyword data in export */
  includeKeywords?: boolean;
  /** Date range filter for exported data */
  dateRange?: { from: string; to: string };
  // P2-20 FIX: Removed index signature that defeated type safety
}

/**
* Possible states of a domain export operation.
* P2-TYPE-FIX: Changed from `string` to a union type. Using `string` allowed
* invalid status values to be set at construction time with no compile-time
* error, and made exhaustive switch statements on status impossible.
*/
export type ExportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
* Domain export entity
* Represents an export operation for domain data
*/
export class DomainExport {
  /**
  * Creates a DomainExport instance
  * @param id - Unique export identifier
  * @param scope - Export scope configuration
  * @param status - Current export status
  */
  constructor(
  readonly id: string,
  readonly scope: ExportScope,
  readonly status: ExportStatus
  ) {}
}
