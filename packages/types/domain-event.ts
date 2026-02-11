export interface DomainEventEnvelope<TPayload> {
  name: string;
  version: number;
  occurredAt: string;
  payload: TPayload;
  meta: {
  correlationId: string;
  domainId: string;
  source: 'control-plane' | 'domain';
  };
}
