# Low Priority Issues Report

## Summary

### CodeOrg (0 issues)


### MissingReadonly (578 issues)
- E:\SmartBeak\packages\analytics\pipeline.ts:9 - keyword: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:10 - domainId: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:19 - timestamp: Date;
- E:\SmartBeak\packages\analytics\pipeline.ts:24 - contentId: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:25 - postId: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:26 - impressions: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:27 - clicks: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:28 - likes: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:29 - comments: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:30 - shares: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:31 - engagementRate: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:32 - timestamp: Date;
- E:\SmartBeak\packages\analytics\pipeline.ts:36 - contentId: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:37 - domainId: string;
- E:\SmartBeak\packages\analytics\pipeline.ts:38 - pageViews: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:39 - uniqueVisitors: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:40 - avgTimeOnPage: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:41 - bounceRate: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:42 - conversions: number;
- E:\SmartBeak\packages\analytics\pipeline.ts:43 - revenue: number;


### JSDoc (226 issues)
- E:\SmartBeak\packages\analytics\pipeline.ts:8 - export interface KeywordMetric {
- E:\SmartBeak\packages\analytics\pipeline.ts:22 - export interface SocialMetric {
- E:\SmartBeak\packages\analytics\pipeline.ts:35 - export interface ContentPerformance {
- E:\SmartBeak\packages\analytics\pipeline.ts:47 - export class AnalyticsPipeline {
- E:\SmartBeak\packages\kernel\chaos.ts:2 - export function maybeChaos(rate = 0.1) {
- E:\SmartBeak\packages\kernel\dlq.ts:12 - export interface DLQMessage {
- E:\SmartBeak\packages\kernel\dlq.ts:29 - export interface DLQStorage {
- E:\SmartBeak\packages\kernel\health-check.ts:13 - export interface HealthCheckResult {
- E:\SmartBeak\packages\kernel\health-check.ts:21 - export interface HealthCheck {
- E:\SmartBeak\packages\kernel\logger.ts:12 - export interface LogEntry {
- E:\SmartBeak\packages\kernel\metrics.ts:7 - export interface Metric {
- E:\SmartBeak\packages\kernel\request-context.ts:11 - export interface RequestContext {
- E:\SmartBeak\packages\kernel\retry.ts:11 - export interface RetryOptions {
- E:\SmartBeak\packages\kernel\retry.ts:148 - export interface CircuitBreakerOptions {
- E:\SmartBeak\packages\kernel\safe-handler.ts:2 - export async function runSafely(
- E:\SmartBeak\packages\kernel\queue\DLQService.ts:14 - export interface DLQEntry {
- E:\SmartBeak\packages\kernel\queue\DLQService.ts:50 - export class DLQService {
- E:\SmartBeak\packages\kernel\queue\RegionWorker.ts:9 - export interface QueueConfig {
- E:\SmartBeak\packages\kernel\queue\RegionWorker.ts:36 - export class RegionWorker {
- E:\SmartBeak\packages\kernel\queues\bullmq-worker.ts:5 - export function startWorker(eventBus: EventBus) {


### Performance (0 issues)


### Naming (0 issues)


### DeadCode (17 issues)
- E:\SmartBeak\packages\kernel\index.ts:71 - // Constants (M6)
- E:\SmartBeak\packages\security\security.ts:313 - // Export singleton instances for global use
- E:\SmartBeak\apps\api\src\adapters\email\ConstantContactAdapter.ts:247 - // Constant Contact sequences are implemented as automated email campaigns
- E:\SmartBeak\apps\api\src\jobs\contentIdeaGenerationJob.ts:16 - // Constants for configuration (MEDIUM FIX M3, M6)
- E:\SmartBeak\apps\api\src\jobs\domainTransferJob.ts:121 - // Export schema for reuse
- E:\SmartBeak\apps\api\src\jobs\experimentStartJob.ts:131 - // Export for job registration
- E:\SmartBeak\apps\api\src\jobs\feedbackIngestJob.ts:9 - // Constants for window sizes
- E:\SmartBeak\apps\api\src\jobs\feedbackIngestJob.ts:259 - // Export for use in job registration
- E:\SmartBeak\apps\api\src\jobs\index.ts:6 - // Import first
- E:\SmartBeak\apps\api\src\jobs\publishExecutionJob.ts:226 - // Export for testing
- E:\SmartBeak\apps\api\src\middleware\abuseGuard.ts:140 - // Constants
- E:\SmartBeak\apps\api\src\seo\buyerCompleteness.ts:51 - // Export schema for reuse in other modules
- E:\SmartBeak\apps\api\src\utils\cache.ts:100 - // Constants
- E:\SmartBeak\apps\api\src\utils\config.ts:95 - // Construct base URL
- E:\SmartBeak\apps\api\src\utils\idempotency.ts:84 - // Constants
- E:\SmartBeak\apps\web\lib\env.ts:200 - // Export the list of required env vars for external use
- E:\SmartBeak\apps\web\pages\api\webhooks\clerk.ts:41 - // Construct signed content (svix-id.svix-timestamp.body)

