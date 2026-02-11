export interface PublishTargetConfig {
  url?: string;
  token?: string;
  apiKey?: string;
  webhook?: string;
  options?: Record<string, unknown>;
}

export class PublishTarget {
  private constructor(
  public readonly id: string,
  public readonly domainId: string,
  public readonly type: string,
  public readonly config: PublishTargetConfig,
  public readonly enabled: boolean
  ) {}

  /**
  * Create a new publish target
  */
  static create(
  id: string,
  domainId: string,
  type: string,
  config: PublishTargetConfig,
  enabled: boolean = true
  ): PublishTarget {
  return new PublishTarget(id, domainId, type, config, enabled);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  domainId: string,
  type: string,
  config: PublishTargetConfig,
  enabled: boolean
  ): PublishTarget {
  return new PublishTarget(id, domainId, type, config, enabled);
  }

  /**
  * Create a copy with updated config (immutable update)
  */
  withConfig(config: PublishTargetConfig): PublishTarget {
  return new PublishTarget(
    this["id"],
    this.domainId,
    this.type,
    JSON.parse(JSON.stringify({ ...this.config, ...config })),
    this.enabled
  );
  }

  /**
  * Create a copy with enabled status toggled
  */
  toggleEnabled(): PublishTarget {
  return new PublishTarget(
    this["id"],
    this.domainId,
    this.type,
    this.config,
    !this.enabled
  );
  }

  /**
  * Validate the target configuration
  */
  validate(): void {
  if (!this.type || typeof this.type !== 'string') {
    throw new Error('Publish target type is required');
  }
  if (!this.config || typeof this.config !== 'object') {
    throw new Error('Publish target config is required');
  }
  }
}
