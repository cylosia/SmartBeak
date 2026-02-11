/**
* Interface for email provider adapter implementations.
* Defines the contract for managing email lists, sequences, and subscribers.
*/
export interface EmailProviderAdapter {
  /**
  * Creates a new email list/audience
  * @param name - Name of the list to create
  * @returns Promise resolving to the created list ID
  * @throws Error if list creation fails
  */
  createList(name: string): Promise<string>;

  /**
  * Creates an automated email sequence/campaign
  * @param sequence - Configuration for the email sequence
  * @returns Promise resolving when sequence is created
  * @throws Error if sequence creation fails
  */
  createSequence(sequence: EmailSequence): Promise<void>;

  /**
  * Adds a subscriber to an email list
  * @param email - Subscriber email address
  * @param listId - ID of the list to add subscriber to
  * @returns Promise resolving when subscriber is added
  * @throws Error if subscriber addition fails
  */
  addSubscriber(email: string, listId: string): Promise<void>;
}

/**
* Represents an email in a sequence
*/
export interface SequenceEmail {
  /** Subject line of the email */
  subject: string;
  /** HTML or plain text content */
  content: string;
  /** Days after subscription to send (0 = immediate) */
  delayDays: number;
}

/**
* Configuration for an email sequence/automation
*/
export interface EmailSequence {
  /** Name of the sequence */
  name: string;
  /** List ID to associate with this sequence */
  listId?: string;
  /** Emails in the sequence, in order */
  emails: SequenceEmail[];
  /** Whether sequence should be active immediately */
  isActive?: boolean;
}

/**
* Validates an email sequence object
* @param sequence - Object to validate
* @returns Validation result with success flag and optional error message
*/
export function validateEmailSequence(sequence: unknown): { valid: boolean; error?: string } {
  if (!sequence || typeof sequence !== 'object') {
  return { valid: false, error: 'Sequence must be an object' };
  }

  const seq = sequence as Record<string, unknown>;

  if (!seq['name'] || typeof seq['name'] !== 'string') {
  return { valid: false, error: 'Sequence name is required and must be a string' };
  }

  if (!Array.isArray(seq['emails'])) {
  return { valid: false, error: 'Sequence emails must be an array' };
  }

  for (const email of seq['emails']) {
  if (!email || typeof email !== 'object') {
    return { valid: false, error: 'Each email must be an object' };
  }

  const emailObj = email as Record<string, unknown>;

  if (!emailObj['subject'] || typeof emailObj['subject'] !== 'string') {
    return { valid: false, error: 'Email subject is required and must be a string' };
  }

  if (!emailObj['content'] || typeof emailObj['content'] !== 'string') {
    return { valid: false, error: 'Email content is required and must be a string' };
  }

  if (typeof emailObj['delayDays'] !== 'number' || emailObj['delayDays'] < 0) {
    return { valid: false, error: 'Email delayDays must be a non-negative number' };
  }
  }

  return { valid: true };
}

/**
* Validates an email address format
* @param email - Email address to validate
* @returns Whether the email format is valid
*/
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
