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
  /** Additional export options */
  [key: string]: unknown;
}

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
  readonly status: string
  ) {}
}
