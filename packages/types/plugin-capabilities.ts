/**
 * Plugin capability types
 * Defines the interface for plugin capabilities and manifests
 */

/** Analytics capability interface */
export interface AnalyticsCapability {
  recordMetric(name: string, value: number): Promise<void>;
}

/** Publishing capability interface */
export interface PublishingCapability {
  enqueuePublishJob(contentId: string): Promise<void>;
}

/** Plugin capability union type */
export type PluginCapability = 
  | { type: 'analytics'; handler: AnalyticsCapability }
  | { type: 'publishing'; handler: PublishingCapability }
  | { type: 'notification'; handler: unknown }
  | { type: 'storage'; handler: unknown }
  | { type: 'custom'; handler: unknown };

/** Plugin manifest - describes plugin metadata and capabilities */
export interface PluginManifest {
  /** Plugin unique identifier */
  id: string;
  /** Plugin name */
  name: string;
  /** Plugin version (semver) */
  version: string;
  /** Plugin description */
  description?: string;
  /** Plugin author */
  author?: string;
  /** Plugin capabilities */
  capabilities: PluginCapability[];
  /** Plugin dependencies */
  dependencies?: string[];
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Plugin configuration schema */
  configSchema?: Record<string, unknown>;
}
