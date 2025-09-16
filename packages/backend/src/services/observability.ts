/**
 * Observability Service
 * Initializes and configures OpenTelemetry for distributed tracing and metrics.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317';
const SERVICE_NAME = 'aaelink-backend';
const SERVICE_VERSION = '1.0.0';

let sdk: NodeSDK;

/**
 * Initialize OpenTelemetry SDK
 */
export async function initializeObservability() {
  if (process.env.SIGNOZ_ENABLED !== 'true') {
    console.log('⚪ Observability is disabled.');
    return;
  }

  try {
    console.log('🔄 Initializing OpenTelemetry...');

    // Exporters
    const traceExporter = new OTLPTraceExporter({
      url: OTEL_EXPORTER_OTLP_ENDPOINT,
    });

    const metricExporter = new OTLPMetricExporter({
      url: OTEL_EXPORTER_OTLP_ENDPOINT,
    });

    // Metric reader
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60000,
    });

    // SDK configuration
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
        [SemanticResourceAttributes.SERVICE_VERSION]: SERVICE_VERSION,
      }),
      traceExporter,
      metricReader,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable noisy fs instrumentation
          },
          '@opentelemetry/instrumentation-dns': {
            enabled: false,
          },
        }),
      ],
    });

    // Start the SDK
    await sdk.start();
    console.log('✅ OpenTelemetry SDK started');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk.shutdown().then(
        () => console.log('✅ OpenTelemetry terminated'),
        (err) => console.error('❌ Error terminating OpenTelemetry', err)
      ).finally(() => process.exit(0));
    });

  } catch (error) {
    console.error('❌ Failed to initialize OpenTelemetry:', error);
  }
}

/**
 * Shutdown OpenTelemetry SDK
 */
export async function shutdownObservability() {
  if (sdk) {
    await sdk.shutdown();
  }
}
