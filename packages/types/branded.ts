/**
 * Branded Types (pure type definitions)
 *
 * These type aliases are re-exported from packages/types to break the
 * circular dependency with packages/kernel. The runtime factory functions
 * (createUserId, createOrgId, etc.) remain in packages/kernel/validation/branded.ts.
 */

/** Branded type helper */
export type Branded<T, B> = T & { readonly __brand: B };

/** Alias for backward compatibility */
export type Brand<T, B> = Branded<T, B>;

export type UserId = Branded<string, 'UserId'>;
export type OrgId = Branded<string, 'OrgId'>;
export type SessionId = Branded<string, 'SessionId'>;
export type ContentId = Branded<string, 'ContentId'>;
export type DomainId = Branded<string, 'DomainId'>;
export type CustomerId = Branded<string, 'CustomerId'>;
export type InvoiceId = Branded<string, 'InvoiceId'>;
export type PaymentId = Branded<string, 'PaymentId'>;
export type PublishingJobId = Branded<string, 'PublishingJobId'>;
export type NotificationId = Branded<string, 'NotificationId'>;
export type MediaAssetId = Branded<string, 'MediaAssetId'>;
export type SearchIndexId = Branded<string, 'SearchIndexId'>;
export type IndexingJobId = Branded<string, 'IndexingJobId'>;
export type AuthorId = Branded<string, 'AuthorId'>;
export type RevisionId = Branded<string, 'RevisionId'>;
export type CommentId = Branded<string, 'CommentId'>;
export type WebhookId = Branded<string, 'WebhookId'>;
export type ApiKeyId = Branded<string, 'ApiKeyId'>;
export type AuditEventId = Branded<string, 'AuditEventId'>;
export type MembershipId = Branded<string, 'MembershipId'>;
export type DomainRegistryId = Branded<string, 'DomainRegistryId'>;
export type ContentVersionId = Branded<string, 'ContentVersionId'>;
export type ContentIdeaId = Branded<string, 'ContentIdeaId'>;
export type MediaCollectionId = Branded<string, 'MediaCollectionId'>;
export type EmailSubscriberId = Branded<string, 'EmailSubscriberId'>;
export type EmailCampaignId = Branded<string, 'EmailCampaignId'>;
export type EmailTemplateId = Branded<string, 'EmailTemplateId'>;
export type JobId = Branded<string, 'JobId'>;
export type TaskId = Branded<string, 'TaskId'>;
export type ExportId = Branded<string, 'ExportId'>;
export type AnalyticsEventId = Branded<string, 'AnalyticsEventId'>;
export type MetricId = Branded<string, 'MetricId'>;
export type ReportId = Branded<string, 'ReportId'>;
export type SubscriptionId = Branded<string, 'SubscriptionId'>;
export type AffiliateId = Branded<string, 'AffiliateId'>;
export type CommissionId = Branded<string, 'CommissionId'>;
