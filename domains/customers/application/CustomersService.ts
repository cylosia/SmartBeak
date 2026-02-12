import { Pool } from 'pg';

﻿
// ============================================================================
// Type Definitions
// ============================================================================


/**
* Customer data structure
*/
export interface Customer {
  /** Customer ID */
  id: string;
  /** Organization ID */
  orgId: string;
  /** Customer name */
  name: string;
  /** Customer email */
  email: string;
  /** Customer status */
  status: 'active' | 'inactive' | 'suspended';
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
* Result type for customer operations
*/
export interface CustomerOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Single customer (if applicable) */
  customer?: Customer;
  /** List of customers (if applicable) */
  customers?: Customer[];
  /** Total count for pagination */
  totalCount?: number;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Customers Service
// ============================================================================

/**
* Service for managing customers.
*
* This service provides CRUD operations for customers with proper
* validation, pagination, and error handling.
*/
export class CustomersService {
  /** Default page size */
  private static readonly DEFAULT_PAGE_SIZE = 20;
  /** Maximum page size */
  private static readonly MAX_PAGE_SIZE = 100;

  /**
  * Create a new CustomersService
  * @param pool - Database connection pool
  */
  constructor(private readonly pool: Pool) {}

  /**
  * Get a customer by ID
  *
  * @param id - Customer ID
  * @returns Promise resolving to the result of the operation
  */
  async getById(id: string): Promise<CustomerOperationResult> {
  const validationError = this.validateId(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const { rows } = await this.pool.query(
    `SELECT id, org_id as "orgId", name, email, status,
        created_at as "createdAt", updated_at as "updatedAt"
    FROM customers
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return { success: false, error: `Customer with ID '${id}' not found` };
    }

    return { success: true, customer: this.mapRowToCustomer(rows[0]) };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to get customer'
    };
  }
  }

  /**
  * List customers by organization with pagination
  *
  * @param orgId - Organization ID
  * @param page - Page number (1-based)
  * @param pageSize - Number of items per page
  * @returns Promise resolving to the result of the operation
  */
  async listByOrg(
  orgId: string,
  page: number = 1,
  pageSize: number = CustomersService.DEFAULT_PAGE_SIZE
  ): Promise<CustomerOperationResult> {
  // Validate orgId
  const orgError = this.validateId(orgId);
  if (orgError) {
    return { success: false, error: orgError };
  }

  // Validate and clamp pagination
  const validatedPage = Math.max(1, page);
  const validatedPageSize = Math.min(
    Math.max(1, pageSize),
    CustomersService.MAX_PAGE_SIZE
  );
  // P1-FIX: Add MAX_SAFE_OFFSET to prevent unbounded offset pagination issues
  const MAX_SAFE_OFFSET = 10000;
  const offset = Math.min((validatedPage - 1) * validatedPageSize, MAX_SAFE_OFFSET);

  try {
    // Use pagination to limit results
    const { rows } = await this.pool.query(
    `SELECT id, org_id as "orgId", name, email, status,
        created_at as "createdAt", updated_at as "updatedAt"
    FROM customers
    WHERE org_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [orgId, validatedPageSize, offset]
    );

    // Get total count for pagination metadata
    const countResult = await this.pool.query(
    'SELECT COUNT(*) FROM customers WHERE org_id = $1',
    [orgId]
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    return {
    success: true,
    customers: rows.map(r => this.mapRowToCustomer(r)),
    };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to list customers'
    };
  }
  }

  /**
  * Create a new customer
  *
  * @param orgId - Organization ID
  * @param name - Customer name
  * @param email - Customer email
  * @returns Promise resolving to the result of the operation
  */
  async create(
  orgId: string,
  name: string,
  email: string
  ): Promise<CustomerOperationResult> {
  // Validate inputs
  const validationError = this.validateCreateInputs(orgId, name, email);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Sanitize inputs
  const sanitizedName = this.sanitizeString(name);
  const sanitizedEmail = this.sanitizeString(email.toLowerCase().trim());

  try {
    const now = new Date();
    const { rows } = await this.pool.query(
    `INSERT INTO customers (id, org_id, name, email, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, org_id as "orgId", name, email, status,
        created_at as "createdAt", updated_at as "updatedAt"`,
    [crypto.randomUUID(), orgId, sanitizedName, sanitizedEmail, 'active', now, now]
    );

    return { success: true, customer: this.mapRowToCustomer(rows[0]) };
  } catch (error) {
    // Handle duplicate email using PostgreSQL error code 23505 (unique_violation)
    const pgError = error as Error & { code?: string };
    if (error instanceof Error && pgError.code === '23505') {
    return { success: false, error: 'Email already exists' };
    }
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to create customer'
    };
  }
  }

  /**
  * Update customer status
  *
  * @param id - Customer ID
  * @param status - New status
  * @returns Promise resolving to the result of the operation
  */
  async updateStatus(
  id: string,
  status: 'active' | 'inactive' | 'suspended'
  ): Promise<CustomerOperationResult> {
  const idError = this.validateId(id);
  if (idError) {
    return { success: false, error: idError };
  }

  if (!['active', 'inactive', 'suspended'].includes(status)) {
    return { success: false, error: 'Invalid status' };
  }

  try {
    const { rows } = await this.pool.query(
    `UPDATE customers
    SET status = $1, updated_at = $2
    WHERE id = $3
    RETURNING id, org_id as "orgId", name, email, status,
        created_at as "createdAt", updated_at as "updatedAt"`,
    [status, new Date(), id]
    );

    if (!rows[0]) {
    return { success: false, error: `Customer with ID '${id}' not found` };
    }

    return { success: true, customer: this.mapRowToCustomer(rows[0]) };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to update customer status'
    };
  }
  }

  /**
  * Delete a customer
  *
  * @param id - Customer ID
  * @returns Promise resolving to the result of the operation
  */
  async delete(id: string): Promise<CustomerOperationResult> {
  const validationError = this.validateId(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const result = await this.pool.query(
    'DELETE FROM customers WHERE id = $1 RETURNING id',
    [id]
    );

    if (result.rowCount === 0) {
    return { success: false, error: `Customer with ID '${id}' not found` };
    }

    return { success: true };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to delete customer'
    };
  }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
  * Maps a database row to a Customer object
  * @param row - Database row
  * @returns Customer object
  */
  private mapRowToCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row["id"]),
    orgId: String(row["orgId"]),
    name: String(row["name"]),
    email: String(row["email"]),
    status: row["status"] as Customer['status'],
    createdAt: row["createdAt"] instanceof Date ? row["createdAt"] : new Date(String(row["createdAt"])),
    updatedAt: row["updatedAt"] instanceof Date ? row["updatedAt"] : new Date(String(row["updatedAt"]))
  };
  }

  /**
  * Validates an ID
  * @param id - ID to validate
  * @returns Error message if invalid, undefined if valid
  */
  private validateId(id: string): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'ID is required and must be a string';
  }
  if (id.length < 1 || id.length > 255) {
    return 'ID must be between 1 and 255 characters';
  }
  return undefined;
  }

  /**
  * Validates create inputs
  * @param orgId - Organization ID
  * @param name - Customer name
  * @param email - Customer email
  * @returns Error message if invalid, undefined if valid
  */
  private validateCreateInputs(
  orgId: string,
  name: string,
  email: string
  ): string | undefined {
  const orgError = this.validateId(orgId);
  if (orgError) {
    return `Organization ${orgError}`;
  }

  if (!name || typeof name !== 'string' || name.length < 1) {
    return 'Name is required and must be a non-empty string';
  }
  if (name.length > 255) {
    return 'Name must be less than 255 characters';
  }

  if (!email || typeof email !== 'string') {
    return 'Email is required and must be a string';
  }
  if (!this.isValidEmail(email)) {
    return 'Invalid email format';
  }

  return undefined;
  }

  /**
  * Validates email format
  * @param email - Email to validate
  * @returns Whether email is valid
  */
  private isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
  }

  /**
  * Sanitizes a string value
  * @param value - String to sanitize
  * @returns Sanitized string
  */
  private sanitizeString(value: string): string {
  return value
    .trim()
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}
