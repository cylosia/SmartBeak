/**
 * Monitoring Configuration
 *
 * Alert webhook and monitoring settings.
 */

export const monitoringConfig = {
  get slackWebhookUrl(): string | undefined {
    return process.env['SLACK_WEBHOOK_URL'];
  },

  get alertWebhookUrl(): string | undefined {
    return process.env['ALERT_WEBHOOK_URL'];
  },
} as const;
