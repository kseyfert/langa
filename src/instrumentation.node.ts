import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

// Трейсинг вызовов Claude в Langfuse (architecture.md). Без ключей провайдер не
// регистрируется: вызовы @langfuse/tracing уходят в no-op OTel — без ошибок и предупреждений.
if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    // batched: процесс один и долгоживущий — спаны уходят пачками в фоне, ответ их не ждёт.
    // Неотправленное при остановке сервера теряется — это допустимо (architecture.md).
    new NodeSDK({ serviceName: 'langa', spanProcessors: [new LangfuseSpanProcessor({ exportMode: 'batched' })] }).start();
}
