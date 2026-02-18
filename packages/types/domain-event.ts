// EVT-1-FIX P2: Branded string type for ISO-8601 dates.
// `occurredAt: string` accepted ANY string, including non-dates, which silently
// corrupted chronological sort order. The brand forces callers to produce the
// value via `toISOString()` or an explicit factory, preventing NaN from Date.parse.
declare const _isoDateBrand: unique symbol;
export type IsoDateString = string & { readonly [_isoDateBrand]: 'IsoDateString' };
export function toIsoDateString(date: Date): IsoDateString {
  return date.toISOString() as IsoDateString;
}

// EVT-2-FIX P1: Add TName generic so TypeScript can narrow on `name` in discriminated
// unions. With `name: string` the compiler cannot use the event name as a discriminant,
// preventing exhaustive `switch (event.name)` patterns and allowing silently unhandled
// event types to reach production.
export interface DomainEventEnvelope<TName extends string, TPayload> {
  name: TName;
  version: number;
  // EVT-1-FIX P2: Use branded IsoDateString instead of plain string.
  occurredAt: IsoDateString;
  payload: TPayload;
  meta: {
  correlationId: string;
  domainId: string;
  source: 'control-plane' | 'domain';
  };
}
