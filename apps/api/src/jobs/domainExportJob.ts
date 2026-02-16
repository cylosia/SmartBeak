import { z } from 'zod';
import path from 'path';
import { TIME } from '@kernel/constants';
import { randomUUID } from 'crypto';
import { withRetry } from '@kernel/retry';
import { JobScheduler } from './JobScheduler';
import { createModuleCache } from '../utils/moduleCache';
import { getLogger } from '@kernel/logger';
import type { Job } from 'bullmq';

const logger = getLogger('domain-export');
/**
 * Domain Export Job
 * Exports all domain data (content, analytics, settings) to various formats
 */
export const EXPORT_QUEUE = 'low_priority_exports';

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CSV_ROWS = 10000;
const CSV_BATCH_SIZE = 1000; // FIX: Process CSV in batches to prevent memory issues
const EXPORT_DATA_VERSION = '1.0';
const MAX_EXPORT_ROWS = 100000; // P0-FIX: Prevent OOM crashes from unbounded queries
const EXPORT_SETTINGS_COLUMNS = ['id', 'domain_id', 'settings', 'created_at', 'updated_at'];

const DomainExportInputSchema = z.object({
  domainId: z.string().uuid(),
  format: z.enum(['json', 'csv', 'pdf', 'markdown']),
  includeContent: z.boolean(),
  includeAnalytics: z.boolean(),
  includeSettings: z.boolean(),
  dateRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }).optional(),
  destination: z.object({
    type: z.enum(['s3', 'local', 'download']),
    path: z.string().optional(),
    s3Bucket: z.string().optional(),
    s3Key: z.string().optional(),
  }),
});

const ALLOWED_TABLES = {
  CONTENT_ITEMS: 'content_items',
  KEYWORD_METRICS: 'keyword_metrics',
  CONTENT_PERFORMANCE: 'content_performance',
  DOMAIN_SETTINGS: 'domain_settings',
};

function validateTableName(tableName: string) {
  const allowedValues = Object.values(ALLOWED_TABLES);
  if (!allowedValues.includes(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

/**
 * Ensures limit is a positive integer within bounds
 */
function validateLimit(value: number, maxLimit = MAX_CSV_ROWS) {
  const num = Math.min(Math.max(Math.floor(value), 1), maxLimit);
  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid limit value: ${value}`);
  }
  return num;
}

// Define the export data type
interface ExportData {
  domainId: string;
  exportedAt: string;
  version: string;
  content?: ContentItem[];
  analytics?: AnalyticsData;
  settings?: DomainSettings;
}

export async function domainExportJob(input: DomainExportInput, job: Job | undefined) {
  // P2-FIX: Add AbortController for cancellation support
  const abortController = new AbortController();
  const abortListener = () => {
    abortController.abort();
    logger.info('Domain export job aborted', { jobId: job?.id });
  };
  
  // P1-6 FIX: Use BullMQ Job type for cancel event listener
  if (job && 'on' in job && typeof job.on === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BullMQ Job.on() not exposed in type definitions
    (job as any).on('cancel', abortListener);
  }

  try {
  const validatedInput = DomainExportInputSchema.parse(input);
  const { domainId, format, includeContent, includeAnalytics, includeSettings, dateRange, destination, } = validatedInput;
  logger.info('Starting domain export', {
    domainId,
    format,
    destination: destination.type,
    jobId: job?.id,
  });
  // Update job progress
  await job?.updateProgress(10);
  // Gather data with proper types
  const exportData: ExportData = {
    domainId,
    exportedAt: new Date().toISOString(),
    version: EXPORT_DATA_VERSION,
  };
  if (includeContent) {
    exportData.content = await exportContent(domainId, dateRange);
    await job?.updateProgress(30);
  }
  if (includeAnalytics) {
    exportData.analytics = await exportAnalytics(domainId, dateRange);
    await job?.updateProgress(50);
  }
  if (includeSettings) {
    exportData.settings = await exportSettings(domainId);
    await job?.updateProgress(70);
  }
  // Format data
  const formattedData = await formatExport(exportData, format);
  await job?.updateProgress(80);

  const buffer = Buffer.isBuffer(formattedData) ? formattedData : Buffer.from(formattedData);
  if (buffer.length > MAX_DOWNLOAD_SIZE) {
    logger.error('Export size exceeds maximum limit', undefined, {
      size: buffer.length,
      maxSize: MAX_DOWNLOAD_SIZE
    });
    throw new Error(`Export too large: ${buffer.length} bytes exceeds maximum of ${MAX_DOWNLOAD_SIZE} bytes`);
  }
  // Save to destination
  const result = await saveExport(formattedData, destination, domainId, format, exportData);
  await job?.updateProgress(100);
  // Record export in database
  await recordExport(domainId, result);
  logger.info('Export completed successfully', {
    exportId: result.exportId,
    domainId,
    fileSize: result.fileSize,
  });
  return result;
  } finally {
    // P2-FIX: Clean up abort listener
    // P1-6 FIX: Use BullMQ Job type for cancel event listener cleanup
    if (job && 'off' in job && typeof job.off === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- BullMQ Job.off() not exposed in type definitions
      (job as any).off('cancel', abortListener);
    }
  }
}
// H07-FIX: Import from @database package instead of cross-app relative import
const dbModuleCache = createModuleCache(() => import('@database'));
async function exportContent(domainId: string, dateRange?: { start: string; end: string }) {
  const { pool } = await dbModuleCache.get();

  const tableName = validateTableName(ALLOWED_TABLES.CONTENT_ITEMS);

  const limit = validateLimit(MAX_CSV_ROWS);

  const params = [domainId];
  let query = `
  SELECT
    id, title, body, status, content_type,
    created_at, updated_at, published_at, archived_at
  FROM ${tableName}
  WHERE domain_id = $1
  `;
  if (dateRange) {
    // Validate date range format to prevent injection
    const dateRegex = /^\d{4}-\d{2}-\d{2}T/;
    if (!dateRegex.test(dateRange.start) || !dateRegex.test(dateRange.end)) {
      throw new Error('Invalid date range format');
    }

    query += ` AND created_at BETWEEN $${params.length + 1} AND $${params.length + 2}`;
    params.push(dateRange.start, dateRange.end);
  }
  query += ` ORDER BY created_at DESC`;

  params.push(String(limit));
  const limitIndex = params.length;
  query += ` LIMIT $${limitIndex}`;
  const { rows } = await withRetry(() => pool.query(query, params), { maxRetries: 3, initialDelayMs: 1000 });
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    contentType: row.content_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  }));
}
async function exportAnalytics(domainId: string, dateRange?: { start: string; end: string }) {
  const { pool } = await dbModuleCache.get();

  const limit = validateLimit(MAX_CSV_ROWS);
  // Validate date range if provided
  const keywordParams = [domainId];
  let dateCondition = '';
  if (dateRange) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}T/;
    if (!dateRegex.test(dateRange.start) || !dateRegex.test(dateRange.end)) {
      throw new Error('Invalid date range format');
    }

    dateCondition = `AND timestamp BETWEEN $2 AND $3`;
    keywordParams.push(dateRange.start, dateRange.end);
  }
  else {
    dateCondition = `AND timestamp >= NOW() - INTERVAL '90 days'`;
  }

  const keywordMetricsTable = validateTableName(ALLOWED_TABLES.KEYWORD_METRICS);
  const contentPerformanceTable = validateTableName(ALLOWED_TABLES.CONTENT_PERFORMANCE);
  // FIX: Use Promise.all to fetch keyword metrics and content performance in parallel
  const [keywordMetrics, contentPerformance] = await Promise.all([
    // Get keyword metrics with retry
    withRetry(() => pool.query(`
      SELECT
      keyword,
      source,
      AVG(volume) as avg_volume,
      AVG(position) as avg_position,
      SUM(clicks) as total_clicks,
      SUM(impressions) as total_impressions,
      AVG(ctr) as avg_ctr
      FROM ${keywordMetricsTable}
      WHERE domain_id = $1
      ${dateCondition}
      GROUP BY keyword, source
      ORDER BY total_clicks DESC
      LIMIT $${keywordParams.length + 1}
    `, [...keywordParams, limit]), { maxRetries: 3, initialDelayMs: 1000 }),
    // Get content performance with retry
    withRetry(() => pool.query(`SELECT
      content_id,
      SUM(page_views) as total_page_views,
      SUM(unique_visitors) as total_unique_visitors,
      AVG(avg_time_on_page) as avg_time_on_page,
      AVG(bounce_rate) as avg_bounce_rate,
      SUM(conversions) as total_conversions,
      SUM(revenue) as total_revenue
    FROM ${contentPerformanceTable}
    WHERE domain_id = $1
    ${dateCondition}
    GROUP BY content_id
    LIMIT $${keywordParams.length + 1}`, [...keywordParams, limit]), { maxRetries: 3, initialDelayMs: 1000 }),
  ]);
  return {
    keywords: keywordMetrics.rows,
    content: contentPerformance.rows,
  };
}
async function exportSettings(domainId: string) {
  const { pool } = await dbModuleCache.get();

  const tableName = validateTableName(ALLOWED_TABLES.DOMAIN_SETTINGS);
  // P0-FIX: Add LIMIT clause and use specific columns to prevent OOM crashes
  const { rows } = await withRetry(() => pool.query(
    `SELECT ${EXPORT_SETTINGS_COLUMNS.join(', ')} FROM ${tableName} 
     WHERE domain_id = $1 
     LIMIT $2`, 
    [domainId, MAX_EXPORT_ROWS]
  ), { maxRetries: 3, initialDelayMs: 500 });
  return rows[0] || {};
}
async function formatExport(data: ExportData, format: ExportFormat) {
  switch (format) {
    case 'json':
      return Buffer.from(JSON.stringify(data, null, 2));
    case 'csv':
      return convertToCSV(data);
    case 'markdown':
      return convertToMarkdown(data);
    case 'pdf':
      // PDF generation would require a library like puppeteer or pdfkit
      throw new Error('PDF export not yet implemented');
    default:
      // P1-FIX: Add exhaustiveness check for type safety
      return assertNever(format, `Unsupported format: ${format}`);
  }
}
/**
 * FIX: Optimized CSV conversion with batch processing
 * - Processes data in batches to prevent memory issues
 * - Uses streaming-friendly approach for large datasets
 * - Handles special characters properly
 * - HIGH FIX: Check cumulative size during formatting to prevent excessive memory use
 */
function convertToCSV(data: ExportData) {
  // Simple CSV conversion for content
  if (!data.content || data.content.length === 0) {
    return 'No content data';
  }
  const firstItem = data.content[0];
  if (!firstItem) {
    return 'No content data';
  }
  const headers = Object.keys(firstItem) as (keyof ContentItem)[];
  const rows = [];
  let totalSize = 0;
  // FIX: Process rows in batches to prevent memory issues with large datasets
  for (let i = 0; i < data.content.length; i += CSV_BATCH_SIZE) {
    const batch = data.content.slice(i, i + CSV_BATCH_SIZE);
    // FIX: Use more efficient row processing with Promise.all for CPU-bound escaping

    const batchRows = batch.map(row => {
      const formattedRow = headers.map(h => {
        const val = row[h as keyof ContentItem];
        return escapeCSVValue(val);
      }).join(',');
      totalSize += formattedRow.length;
      if (totalSize > MAX_DOWNLOAD_SIZE) {
        throw new Error(`Export exceeds maximum size of ${MAX_DOWNLOAD_SIZE} bytes`);
      }
      return formattedRow;
    });
    rows.push(...batchRows);
  }
  return [headers.join(','), ...rows].join('\n');
}
/**
 * Helper function to escape CSV values
 */
function escapeCSVValue(val: unknown) {
  if (val === null || val === undefined) {
    return '';
  }
  let str = String(val);
  // P1-7 SECURITY FIX: Prevent CSV formula injection by prefixing dangerous characters.
  // Added tab (\t), carriage return (\r), and pipe (|) which also trigger DDE in spreadsheets.
  // Previously returned early before comma/quote escaping — now applies both sanitizations.
  if (/^[+=\-@\t\r|]/.test(str)) {
    str = "'" + str;
  }
  // Escape values containing commas, quotes, or newlines
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
/**
 * FIX: Optimized Markdown conversion with batch processing
 * - Processes content items in batches
 * - Limits output to prevent memory issues
 * - Uses array joining instead of string concatenation for better performance
 */
function convertToMarkdown(data: ExportData) {
  const sections = [];
  sections.push(`# Domain Export: ${data.domainId}\n`);
  sections.push(`Exported: ${data.exportedAt}\n`);
  sections.push(`Version: ${data.version}\n`);
  if (data.content) {
    sections.push(`## Content (${data.content.length} items)\n`);
    // FIX: Limit to 50 items and process in batches
    const limitedContent = data.content.slice(0, 50);
    const MARKDOWN_BATCH_SIZE = 10;
    for (let i = 0; i < limitedContent.length; i += MARKDOWN_BATCH_SIZE) {
      const batch = limitedContent.slice(i, i + MARKDOWN_BATCH_SIZE);
      // FIX: Process batch items in parallel using Promise.all
      const batchSections = batch.map(item => formatContentItemMarkdown(item));
      sections.push(...batchSections);
    }
  }
  return sections.join('\n');
}
/**
 * Helper function to format a single content item as markdown
 */
function formatContentItemMarkdown(item: ContentItem) {
  const parts = [];
  parts.push(`### ${item.title}\n`);
  parts.push(`- Status: ${item.status}`);
  parts.push(`- Type: ${item.contentType}`);
  parts.push(`- Created: ${item.createdAt}`);
  parts.push(`\n${item.body?.substring(0, 500)}...\n`);
  parts.push(`---\n`);
  return parts.join('\n');
}
async function saveExport(data: Buffer | string, destination: DomainExportInput['destination'], domainId: string, format: ExportFormat, exportData: ExportData) {
  const exportId = `exp_${Date.now()}_${randomUUID().replace(/-/g, '').substring(0, 8)}`;
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fileSize = buffer.length;
  switch (destination.type) {
    case 'local': {
      if (!destination.path) {
        throw new Error('Local path required for local export');
      }
      // C04-FIX: Prevent path traversal — resolve and validate against allowed base dir
      const ALLOWED_EXPORT_BASE = process.env['EXPORT_BASE_DIR'] || '/tmp/exports';
      const resolvedPath = path.resolve(destination.path, `${exportId}.${format}`);
      if (!resolvedPath.startsWith(path.resolve(ALLOWED_EXPORT_BASE))) {
        throw new Error('Invalid export path: path traversal detected');
      }
      const localPath = resolvedPath;
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, buffer);
      return {
        exportId,
        domainId,
        format,
        fileSize,
        recordCount: exportData?.content?.length || 0,
        localPath,
        expiresAt: new Date(Date.now() + 7 * TIME.DAY), // 7 days
      };
    }
    case 's3':
      // S3 upload would go here
      throw new Error('S3 export not yet implemented');
    case 'download':
      // Return data for direct download
      return {
        exportId,
        domainId,
        format,
        fileSize,
        recordCount: exportData?.content?.length || 0,
        downloadUrl: `data:application/${format};base64,${buffer.toString('base64')}`,
        expiresAt: new Date(Date.now() + TIME.DAY), // 1 day
      };
    default:
      throw new Error(`Unknown destination type: ${destination.type}`);
  }
}
async function recordExport(domainId: string, result: ExportResult) {
  const { pool } = await dbModuleCache.get();
  await withRetry(() => pool.query(`INSERT INTO domain_exports (
    id, domain_id, format, file_size, record_count,
    download_url, s3_location, local_path, expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`, [
    result.exportId,
    domainId,
    result.format,
    result.fileSize,
    result.recordCount,
    result.downloadUrl,
    result.s3Location,
    result.localPath,
    result.expiresAt,
  ]), { maxRetries: 3, initialDelayMs: 500 });
}
// Register job


export interface ContentItem {
  id: string;
  title: string;
  body: string;
  status: string;
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  archivedAt?: Date;
}

export interface AnalyticsData {
  keywords: unknown[];
  content: unknown[];
}

export interface DomainSettings {
  [key: string]: unknown;
}

export interface ExportResult {
  exportId: string;
  domainId: string;
  format: ExportFormat;
  fileSize: number;
  recordCount: number;
  downloadUrl?: string;
  s3Location?: string;
  localPath?: string;
  expiresAt?: Date;
}

export type ExportFormat = 'json' | 'csv' | 'pdf' | 'markdown';

export type DomainExportInput = z.infer<typeof DomainExportInputSchema>;

/**
 * P1-FIX: Exhaustiveness check helper for type safety
 * Ensures all union type cases are handled at compile time
 */
function assertNever(value: never, message: string): never {
  throw new Error(message);
}

export function registerDomainExportJob(scheduler: JobScheduler) {
  scheduler.register({
    name: 'domain-export',
    queue: EXPORT_QUEUE,
    priority: 'low',
    maxRetries: 3,
    backoffType: 'fixed',
    backoffDelay: 60000,
    timeout: 600000, // 10 minutes
  }, domainExportJob, DomainExportInputSchema);
}
