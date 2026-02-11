export type EmailSubscriberStatus =
  | 'active'
  | 'unsubscribed'
  | 'bounced'
  | 'deleted';

export type EmailSubscriber = {
  id: string;
  domain_id: string;
  email: string;
  status: EmailSubscriberStatus;
  consent_source: 'optin_form' | 'manual_import' | 'api';
  consent_form_id?: string;
  consent_ip?: string;
  consent_user_agent?: string;
  consent_timestamp: string;
  experiment_variant_id?: string;
  provider?: string;
  provider_subscriber_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
};
