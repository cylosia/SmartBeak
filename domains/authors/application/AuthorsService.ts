import { Pool } from 'pg';


// ============================================================================
// Type Definitions
// ============================================================================


/**
* Author data structure
*/
export interface Author {
  /** Author ID */
  id: string;
  /** Author name */
  name: string;
  /** Author email */
  email: string;
  /** Author bio (optional) */
  bio?: string | undefined;
  /** Creation timestamp */
  createdAt: Date;
}

/**
* Result type for author operations
*/
export interface AuthorOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Single author (if applicable) */
  author?: Author;
  /** List of authors (if applicable) */
  authors?: Author[];
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Authors Service
// ============================================================================

/**
* Service for managing authors.
*
* This service provides CRUD operations for authors with proper
* validation, pagination, and error handling.
*/
export class AuthorsService {
  /** Default page size */
  private static readonly DEFAULT_PAGE_SIZE = 20;
  /** Maximum page size */
  private static readonly MAX_PAGE_SIZE = 100;
  /** Maximum bio length */
  private static readonly MAX_BIO_LENGTH = 5000;

  /**
  * Create a new AuthorsService
  * @param pool - Database connection pool
  */
  constructor(private readonly pool: Pool) {}

  /**
  * Get an author by ID
  *
  * @param id - Author ID
  * @returns Promise resolving to the result of the operation
  */
  async getById(id: string): Promise<AuthorOperationResult> {
  const validationError = this.validateId(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const { rows } = await this.pool.query(
    `SELECT id, name, email, bio, created_at as "createdAt"
    FROM authors
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return { success: false, error: `Author with ID '${id}' not found` };
    }

    return { success: true, author: this.mapRowToAuthor(rows[0]) };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to get author'
    };
  }
  }

  /**
  * List authors with pagination
  *
  * @param page - Page number (1-based)
  * @param pageSize - Number of items per page
  * @returns Promise resolving to the result of the operation
  */
  async list(
  page: number = 1,
  pageSize: number = AuthorsService.DEFAULT_PAGE_SIZE
  ): Promise<AuthorOperationResult> {
  // Validate and clamp pagination
  const validatedPage = Math.max(1, page);
  const validatedPageSize = Math.min(
    Math.max(1, pageSize),
    AuthorsService.MAX_PAGE_SIZE
  );
  // P1-FIX: Add MAX_SAFE_OFFSET to prevent unbounded offset pagination issues
  const MAX_SAFE_OFFSET = 10000;
  const offset = Math.min((validatedPage - 1) * validatedPageSize, MAX_SAFE_OFFSET);

  try {
    // Use pagination to limit results
    const { rows } = await this.pool.query(
    `SELECT id, name, email, bio, created_at as "createdAt"
    FROM authors
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2`,
    [validatedPageSize, offset]
    );

    return {
    success: true,
    authors: rows.map(r => this.mapRowToAuthor(r))
    };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to list authors'
    };
  }
  }

  /**
  * Create a new author
  *
  * @param name - Author name
  * @param email - Author email
  * @param bio - Author biography (optional)
  * @returns Promise resolving to the result of the operation
  */
  async create(
  name: string,
  email: string,
  bio?: string
  ): Promise<AuthorOperationResult> {
  // Validate inputs
  const validationError = this.validateCreateInputs(name, email, bio);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Sanitize inputs
  const sanitizedName = this.sanitizeString(name);
  const sanitizedEmail = this.sanitizeString(email.toLowerCase().trim());
  const sanitizedBio = bio ? this.sanitizeString(bio) : undefined;

  try {
    const { rows } = await this.pool.query(
    `INSERT INTO authors (id, name, email, bio, created_at)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, bio, created_at as "createdAt"`,
    [crypto.randomUUID(), sanitizedName, sanitizedEmail, sanitizedBio, new Date()]
    );

    return { success: true, author: this.mapRowToAuthor(rows[0]) };
  } catch (error) {
    // Handle duplicate email using PostgreSQL error code 23505 (unique_violation)
    const pgError = error as Error & { code?: string };
    if (error instanceof Error && pgError.code === '23505') {
    return { success: false, error: 'Email already exists' };
    }
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to create author'
    };
  }
  }

  /**
  * Update an author
  *
  * @param id - Author ID
  * @param name - New name (optional)
  * @param email - New email (optional)
  * @param bio - New bio (optional)
  * @returns Promise resolving to the result of the operation
  */
  async update(
  id: string,
  name?: string,
  email?: string,
  bio?: string
  ): Promise<AuthorOperationResult> {
  // Validate ID
  const idError = this.validateId(id);
  if (idError) {
    return { success: false, error: idError };
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    const sanitized = this.sanitizeString(name);
    if (sanitized.length < 1 || sanitized.length > 255) {
    return { success: false, error: 'Name must be between 1 and 255 characters' };
    }
    updates.push(`name = $${paramIndex++}`);
    values.push(sanitized);
  }

  if (email !== undefined) {
    const sanitized = this.sanitizeString(email.toLowerCase().trim());
    if (!this.isValidEmail(sanitized)) {
    return { success: false, error: 'Invalid email format' };
    }
    updates.push(`email = $${paramIndex++}`);
    values.push(sanitized);
  }

  if (bio !== undefined) {
    const sanitized = this.sanitizeString(bio);
    if (sanitized.length > AuthorsService.MAX_BIO_LENGTH) {
    return { success: false, error: `Bio must be less than ${AuthorsService.MAX_BIO_LENGTH} characters` };
    }
    updates.push(`bio = $${paramIndex++}`);
    values.push(sanitized);
  }

  if (updates.length === 0) {
    return { success: false, error: 'No fields to update' };
  }

  values.push(id);

  try {
    const { rows } = await this.pool.query(
    `UPDATE authors
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, email, bio, created_at as "createdAt"`,
    values
    );

    if (!rows[0]) {
    return { success: false, error: `Author with ID '${id}' not found` };
    }

    return { success: true, author: this.mapRowToAuthor(rows[0]) };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to update author'
    };
  }
  }

  /**
  * Delete an author
  *
  * @param id - Author ID
  * @returns Promise resolving to the result of the operation
  */
  async delete(id: string): Promise<AuthorOperationResult> {
  const validationError = this.validateId(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const result = await this.pool.query(
    'DELETE FROM authors WHERE id = $1 RETURNING id',
    [id]
    );

    if (result.rowCount === 0) {
    return { success: false, error: `Author with ID '${id}' not found` };
    }

    return { success: true };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to delete author'
    };
  }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
  * Maps a database row to an Author object
  * @param row - Database row
  * @returns Author object
  */
  private mapRowToAuthor(row: Record<string, unknown>): Author {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    bio: row["bio"] ? String(row["bio"]) : undefined,
    createdAt: row["createdAt"] instanceof Date ? row["createdAt"] : new Date(String(row["createdAt"]))
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
  * @param name - Author name
  * @param email - Author email
  * @param bio - Author bio (optional)
  * @returns Error message if invalid, undefined if valid
  */
  private validateCreateInputs(
  name: string,
  email: string,
  bio?: string
  ): string | undefined {
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

  if (bio && bio.length > AuthorsService.MAX_BIO_LENGTH) {
    return `Bio must be less than ${AuthorsService.MAX_BIO_LENGTH} characters`;
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
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}
