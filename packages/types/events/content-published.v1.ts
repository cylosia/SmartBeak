export const CONTENT_PUBLISHED_V1 = {
  name: 'content.published',
  version: 1
} as const;

export interface ContentPublishedV1Payload {
  contentId: string;
}
