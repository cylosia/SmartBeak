import { 
  DeliveryAdapter, 
  SendNotificationInput, 
  DeliveryResult,
  DeliveryAdapterError
} from '../../packages/types/notifications';
import { getOptionalEnv, getEnvWithDefault } from '../../packages/config';

import { ErrorCodes, ExternalAPIError } from '../../packages/kernel/validation';
import { getLogger } from '../../packages/kernel/logger';

// Alias for backward compatibility
const getEnv = getOptionalEnv;

/**
* Email Notification Adapter
* Supports multiple email providers: AWS SES, SMTP, SendGrid, Postmark
*
* Required configuration (choose one):
* - AWS SES: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
* - SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
* - SendGrid: SENDGRID_API_KEY
* - Postmark: POSTMARK_SERVER_TOKEN
*
* MEDIUM FIX C1: Replace direct process.env access with @config
* MEDIUM FIX M6: Extract magic numbers to constants
* MEDIUM FIX M16: Add JSDoc comments
* MEDIUM FIX E4: Improve generic error messages
* MEDIUM FIX I5: Add length validation
* MEDIUM FIX I6: Add format validation
*/


const logger = getLogger('EmailAdapter');

/** Email provider types - MEDIUM FIX I8: Add enum validation */
export type EmailProvider = 'ses' | 'smtp' | 'sendgrid' | 'postmark';

/** Valid email providers */
const VALID_PROVIDERS: EmailProvider[] = ['ses', 'smtp', 'sendgrid', 'postmark'];

/** Default email configuration - MEDIUM FIX M6: Extract magic numbers */
const DEFAULT_FROM_EMAIL = 'noreply@smartbeak.io';
const DEFAULT_FROM_NAME = 'SmartBeak';
const DEFAULT_AWS_REGION = 'us-east-1';
const DEFAULT_SMTP_PORT = 587;

/** Maximum subject length - MEDIUM FIX I5: Add length validation */
const MAX_SUBJECT_LENGTH = 998; // RFC 2822 limit
const MAX_EMAIL_LENGTH = 255;

/**
* Email configuration interface
* MEDIUM FIX M16: Add JSDoc comments
*/
export interface EmailConfig {
  /** Email provider to use */
  provider?: EmailProvider;
  // AWS SES
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // SMTP
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  // SendGrid
  sendgridApiKey?: string;
  // Postmark
  postmarkToken?: string;
  // Common
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
}

/**
* Email payload interface
* MEDIUM FIX M16: Add JSDoc comments
*/
export interface EmailPayload {
  /** Recipient(s) */
  to: string | string[];
  /** CC recipient(s) */
  cc?: string | string[];
  /** BCC recipient(s) */
  bcc?: string | string[];
  /** Email subject */
  subject: string;
  /** HTML content */
  html?: string;
  /** Plain text content */
  text?: string;
  /** Attachments */
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
* Email adapter implementation
* MEDIUM FIX M16: Add JSDoc comments
*/
export class EmailAdapter implements DeliveryAdapter {
  private config: EmailConfig;
  private provider: EmailProvider;

  /**
  * Create a new EmailAdapter
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  *
  * @param config - Partial email configuration
  */
  constructor(config?: Partial<EmailConfig>) {
    this.config = {
      fromEmail: config?.fromEmail || getEnvWithDefault('EMAIL_FROM', DEFAULT_FROM_EMAIL),
      fromName: config?.fromName || getEnvWithDefault('EMAIL_FROM_NAME', DEFAULT_FROM_NAME),
      replyTo: config?.replyTo || getEnv('EMAIL_REPLY_TO') || undefined,
      ...(config as Partial<EmailConfig>),
    } as EmailConfig;

    // Auto-detect provider from env vars
    this.provider = config?.provider || this.detectProvider();

    this.validateConfig();
  }

  /**
  * Detect email provider from environment variables
  * MEDIUM FIX C1: Replace direct process.env access with @config
  *
  * @returns Detected provider
  */
  private detectProvider(): EmailProvider {
    if (getEnv('SENDGRID_API_KEY')) return 'sendgrid';
    if (getEnv('POSTMARK_SERVER_TOKEN')) return 'postmark';
    if (getEnv('AWS_ACCESS_KEY_ID') && getEnv('AWS_SECRET_ACCESS_KEY')) return 'ses';
    if (getEnv('SMTP_HOST')) return 'smtp';

    logger.warn('No email provider configured, defaulting to SMTP');
    return 'smtp';
  }

  /**
  * Validate configuration for selected provider
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @throws ExternalAPIError if configuration is invalid
  */
  private validateConfig(): void {
    switch (this.provider) {
      case 'ses':
        if (!this.config.awsAccessKeyId && !getEnv('AWS_ACCESS_KEY_ID')) {
          throw new ExternalAPIError(
            'AWS_ACCESS_KEY_ID is required for SES email provider',
            ErrorCodes.REQUIRED_FIELD,
            { provider: 'ses', field: 'awsAccessKeyId' }
          );
        }
        if (!this.config.awsSecretAccessKey && !getEnv('AWS_SECRET_ACCESS_KEY')) {
          throw new ExternalAPIError(
            'AWS_SECRET_ACCESS_KEY is required for SES email provider',
            ErrorCodes.REQUIRED_FIELD,
            { provider: 'ses', field: 'awsSecretAccessKey' }
          );
        }
        break;
      case 'smtp':
        if (!this.config.smtpHost && !getEnv('SMTP_HOST')) {
          throw new ExternalAPIError(
            'SMTP_HOST is required for SMTP email provider',
            ErrorCodes.REQUIRED_FIELD,
            { provider: 'smtp', field: 'smtpHost' }
          );
        }
        break;
      case 'sendgrid':
        if (!this.config.sendgridApiKey && !getEnv('SENDGRID_API_KEY')) {
          throw new ExternalAPIError(
            'SENDGRID_API_KEY is required for SendGrid email provider',
            ErrorCodes.REQUIRED_FIELD,
            { provider: 'sendgrid', field: 'sendgridApiKey' }
          );
        }
        break;
      case 'postmark':
        if (!this.config.postmarkToken && !getEnv('POSTMARK_SERVER_TOKEN')) {
          throw new ExternalAPIError(
            'POSTMARK_SERVER_TOKEN is required for Postmark email provider',
            ErrorCodes.REQUIRED_FIELD,
            { provider: 'postmark', field: 'postmarkToken' }
          );
        }
        break;
    }
  }

  /**
  * Send email notification
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @param input - Send notification input
  * @param input.channel - The delivery channel (always 'email')
  * @param input.to - Recipient email
  * @param input.template - Template name
  * @param input.payload - Template payload
  * @returns Delivery result with success status
  */
  async send({ channel, to, template, payload }: SendNotificationInput): Promise<DeliveryResult> {
    const attemptedAt = new Date();
    
    try {
      // Validate email format - MEDIUM FIX I6: Add format validation
      const { EmailSchema } = await import('@kernel/validation');
      const emailValidation = EmailSchema.safeParse(to);
      if (!emailValidation.success) {
        throw new ExternalAPIError(
          `Invalid recipient email address: ${to}`,
          ErrorCodes.INVALID_EMAIL,
          { recipient: to }
        );
      }

      const emailPayload = await this.buildEmailPayload(template, payload, to);

      // Validate subject length - MEDIUM FIX I5: Add length validation
      if (emailPayload.subject.length > MAX_SUBJECT_LENGTH) {
        throw new ExternalAPIError(
          `Email subject exceeds maximum length of ${MAX_SUBJECT_LENGTH} characters`,
          ErrorCodes.INVALID_LENGTH,
          { subjectLength: emailPayload.subject.length, maxLength: MAX_SUBJECT_LENGTH }
        );
      }

      switch (this.provider) {
        case 'ses':
          await this.sendWithSES(emailPayload);
          break;
        case 'smtp':
          await this.sendWithSMTP(emailPayload);
          break;
        case 'sendgrid':
          await this.sendWithSendGrid(emailPayload);
          break;
        case 'postmark':
          await this.sendWithPostmark(emailPayload);
          break;
        default:
          throw new ExternalAPIError(
            `Unknown email provider: ${this.provider}`,
            ErrorCodes.INVALID_FORMAT,
            { provider: this.provider, validProviders: VALID_PROVIDERS }
          );
      }

      return {
        success: true,
        attemptedAt,
        deliveryId: `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
    } catch (error) {
      return {
        success: false,
        attemptedAt,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof DeliveryAdapterError ? error.code : 'UNKNOWN_ERROR'
      };
    }
  }

  /**
  * Build email payload from template
  * MEDIUM FIX M16: Add JSDoc comments
  *
  * @param template - Template name
  * @param payload - Template data
  * @param to - Recipient email
  * @returns Email payload
  */
  private async buildEmailPayload(
    template: string,
    payload: Record<string, unknown>,
    to: string
  ): Promise<EmailPayload> {
    // Helper function to safely extract string value from payload
    const getString = (key: string, defaultValue = ''): string => {
      const value = payload[key];
      return typeof value === 'string' ? value : defaultValue;
    };

    // Helper function to safely extract number value from payload
    const getNumber = (key: string, defaultValue = 0): number => {
      const value = payload[key];
      return typeof value === 'number' ? value : defaultValue;
    };

    // Template rendering (simplified - could use Handlebars, EJS, etc.)
    const templates: Record<string, () => { subject: string; html: string; text: string }> = {
      'welcome': () => {
        const name = getString('name', 'there');
        const dashboardUrl = getString('dashboardUrl', '#');
        return {
          subject: `Welcome to SmartBeak, ${name}!`,
          html: `
            <h1>Welcome to SmartBeak!</h1>
            <p>Hi ${name},</p>
            <p>Thanks for joining SmartBeak. We're excited to help you manage your content empire.</p>
            <p><a href="${dashboardUrl}" style="padding: 12px 24px; background: #0066cc; color: white; text-decoration: none; border-radius: 4px;">Go to Dashboard</a></p>
          `,
          text: `Welcome to SmartBeak!\n\nHi ${name},\n\nThanks for joining SmartBeak.`,
        };
      },
      'content-published': () => {
        const contentTitle = getString('contentTitle', 'New Content');
        const contentUrl = getString('contentUrl');
        return {
          subject: `Content Published: ${contentTitle}`,
          html: `
            <h1>Content Published Successfully</h1>
            <p>Your content '${contentTitle}' has been published.</p>
            <p><a href="${contentUrl}">View Content</a></p>
          `,
          text: `Content Published: ${contentTitle}`,
        };
      },
      'weekly-summary': () => {
        const publishedCount = getNumber('publishedCount', 0);
        const newKeywords = getNumber('newKeywords', 0);
        const revenue = getNumber('revenue', 0);
        return {
          subject: `Your Weekly SmartBeak Summary`,
          html: `
            <h1>Weekly Summary</h1>
            <p>Here's what happened this week:</p>
            <ul>
              <li>Content Published: ${publishedCount}</li>
              <li>New Keywords Ranking: ${newKeywords}</li>
              <li>Revenue: $${revenue}</li>
            </ul>
          `,
          text: `Weekly Summary: ${publishedCount} published, ${newKeywords} new keywords`,
        };
      },
      'alert': () => {
        const alertType = getString('alertType', 'Notification');
        const message = getString('message');
        const severity = getString('severity', 'medium');
        return {
          subject: `Alert: ${alertType}`,
          html: `
            <h1 style="color: #cc0000;">Alert: ${alertType}</h1>
            <p>${message}</p>
            <p><strong>Severity:</strong> ${severity}</p>
          `,
          text: `ALERT: ${alertType}\n${message}`,
        };
      },
    };

    const renderer = templates[template] || templates['welcome'];
    if (!renderer) {
      throw new ExternalAPIError(
        `Unknown email template: ${template}`,
        ErrorCodes.INVALID_FORMAT,
        { template, validTemplates: Object.keys(templates) }
      );
    }
    const rendered = renderer();

    return {
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      metadata: {
        sentAt: new Date().toISOString(),
      },
    };
  }

  /**
  * Send via AWS SES
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @param payload - Email payload
  * @throws ExternalAPIError if send fails
  */
  private async sendWithSES(payload: EmailPayload): Promise<void> {
    // Dynamic import to avoid bundling AWS SDK if not used
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');

    const client = new SESClient({
      region: this.config.awsRegion || getEnvWithDefault('AWS_REGION', DEFAULT_AWS_REGION),
      credentials: {
        accessKeyId: this.config.awsAccessKeyId || getEnv('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.awsSecretAccessKey || getEnv('AWS_SECRET_ACCESS_KEY')!,
      },
    });

    const command = new SendEmailCommand({
      Source: `${this.config.fromName} <${this.config.fromEmail}>`,
      Destination: {
        ToAddresses: Array.isArray(payload.to) ? payload.to : [payload.to],
        CcAddresses: payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : undefined,
        BccAddresses: payload.bcc ? (Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc]) : undefined,
      },
      Message: {
        Subject: { Data: payload.subject },
        Body: {
          Html: payload.html ? { Data: payload.html } : undefined,
          Text: payload.text ? { Data: payload.text } : undefined,
        },
      },
      ReplyToAddresses: this.config.replyTo ? [this.config.replyTo] : undefined,
    });

    try {
      await client.send(command);
      logger.info('Sent via SES', { to: payload.to });
    } catch (error) {
      throw new ExternalAPIError(
        `SES send failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.EXTERNAL_API_ERROR,
        { provider: 'ses', recipient: payload.to },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
  * Send via SMTP
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @param payload - Email payload
  * @throws ExternalAPIError if send fails
  */
  private async sendWithSMTP(payload: EmailPayload): Promise<void> {
    const nodemailer = await import('nodemailer');

    const smtpSecure = this.config.smtpSecure ?? (getEnvWithDefault('SMTP_SECURE', 'false') === 'true');

    const transporter = nodemailer.createTransport({
      host: this.config.smtpHost || getEnv('SMTP_HOST'),
      port: this.config.smtpPort || parseInt(getEnvWithDefault('SMTP_PORT', String(DEFAULT_SMTP_PORT)), 10),
      secure: smtpSecure,
      auth: {
        user: this.config.smtpUser || getEnv('SMTP_USER'),
        pass: this.config.smtpPass || getEnv('SMTP_PASS'),
      },
    });

    try {
      await transporter.sendMail({
        from: `${this.config.fromName} <${this.config.fromEmail}>`,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: this.config.replyTo,
        attachments: payload.attachments,
      });

      logger.info('Sent via SMTP', { to: payload.to });
    } catch (error) {
      throw new ExternalAPIError(
        `SMTP send failed: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.EXTERNAL_API_ERROR,
        { provider: 'smtp', recipient: payload.to },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
  * Send via SendGrid
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @param payload - Email payload
  * @throws ExternalAPIError if send fails
  */
  private async sendWithSendGrid(payload: EmailPayload): Promise<void> {
    const apiKey = this.config.sendgridApiKey || getEnv('SENDGRID_API_KEY');

    if (!apiKey) {
      throw new ExternalAPIError(
        'SendGrid API key not configured',
        ErrorCodes.REQUIRED_FIELD,
        { provider: 'sendgrid', field: 'sendgridApiKey' }
      );
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: Array.isArray(payload.to)
            ? payload.to.map(e => ({ email: e }))
            : [{ email: payload.to }],
        }],
        from: { email: this.config.fromEmail, name: this.config.fromName },
        reply_to: this.config.replyTo ? { email: this.config.replyTo } : undefined,
        subject: payload.subject,
        content: [
          payload.text && { type: 'text/plain', value: payload.text },
          payload.html && { type: 'text/html', value: payload.html },
        ].filter(Boolean),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExternalAPIError(
        `SendGrid API error: ${response.status} - ${errorText}`,
        ErrorCodes.EXTERNAL_API_ERROR,
        { provider: 'sendgrid', status: response.status, recipient: payload.to }
      );
    }

    logger.info('Sent via SendGrid', { to: payload.to });
  }

  /**
  * Send via Postmark
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX E4: Improve generic error messages
  *
  * @param payload - Email payload
  * @throws ExternalAPIError if send fails
  */
  private async sendWithPostmark(payload: EmailPayload): Promise<void> {
    const token = this.config.postmarkToken || getEnv('POSTMARK_SERVER_TOKEN');

    if (!token) {
      throw new ExternalAPIError(
        'Postmark server token not configured',
        ErrorCodes.REQUIRED_FIELD,
        { provider: 'postmark', field: 'postmarkToken' }
      );
    }

    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: `${this.config.fromName} <${this.config.fromEmail}>`,
        To: Array.isArray(payload.to) ? payload.to.join(',') : payload.to,
        Subject: payload.subject,
        HtmlBody: payload.html,
        TextBody: payload.text,
        ReplyTo: this.config.replyTo,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ExternalAPIError(
        `Postmark API error: ${response.status} - ${errorText}`,
        ErrorCodes.EXTERNAL_API_ERROR,
        { provider: 'postmark', status: response.status, recipient: payload.to }
      );
    }

    logger.info('Sent via Postmark', { to: payload.to });
  }

  /**
  * Validate email address format
  * MEDIUM FIX I6: Add format validation
  *
  * @param email - Email to validate
  * @returns True if valid
  */
  static async isValidEmail(email: string): Promise<boolean> {
    const { EmailSchema } = await import('@kernel/validation');
    const result = EmailSchema.safeParse(email);
    return result.success;
  }

  /**
  * Get sending quota/limits
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX M16: Add JSDoc comments
  *
  * @returns Quota information
  */
  async getQuota(): Promise<{
    remaining: number;
    resetTime?: Date;
    limit: number;
  }> {
    switch (this.provider) {
      case 'ses': {
        const { SESClient, GetSendQuotaCommand } = await import('@aws-sdk/client-ses');
        const client = new SESClient({
          region: this.config.awsRegion || getEnvWithDefault('AWS_REGION', DEFAULT_AWS_REGION),
          credentials: {
            accessKeyId: this.config.awsAccessKeyId || getEnv('AWS_ACCESS_KEY_ID')!,
            secretAccessKey: this.config.awsSecretAccessKey || getEnv('AWS_SECRET_ACCESS_KEY')!,
          },
        });
        const response = await client.send(new GetSendQuotaCommand({}));
        return {
          limit: Math.floor((response.Max24HourSend || 0) * 24),
          remaining: Math.floor((response.Max24HourSend || 0) * 24 - (response.SentLast24Hours || 0)),
        };
      }
      default:
        // Other providers don't have standard quota APIs
        return { limit: -1, remaining: -1 };
    }
  }
}
