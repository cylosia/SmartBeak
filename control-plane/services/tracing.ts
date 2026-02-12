import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

import { registerInstrumentations } from '@opentelemetry/instrumentation';

/**
* OpenTelemetry tracing initialization
*/

/**
* Initialize distributed tracing
*/
export function initTracing(): void {
  try {
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  provider.register();

  registerInstrumentations({
    instrumentations: [],
  });
  } catch (error) {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[${timestamp}] [ERROR] [tracing] Failed to initialize tracing: ${errorMessage}\n`);
  }
}
