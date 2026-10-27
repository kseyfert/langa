import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

// Трейсинг вызовов Claude в Langfuse (architecture.md). Без ключей провайдер не
// регистрируется: вызовы @langfuse/tracing уходят в no-op OTel — без ошибок и предупреждений.
if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    // batched: процесс один и долгоживущий — спаны уходят пачками в фоне, ответ их не ждёт.
    // Неотправленное при остановке сервера теряется — это допустимо (architecture.md).
    new NodeSDK({ serviceName: 'langa', spanProcessors: [new LangfuseSpanProcessor({ exportMode: 'batched' })] }).start();
}

/**
 * Содержимое областей (content/<key>/) — до первого запроса. С битыми настройками или без нужных
 * промптов сервер не стартует: ошибка в register() Next только пишет в лог и дальше отвечает 500.
 * Предупреждения (guide без плана фокуса) только пишутся в лог.
 */
export async function checkContentOrExit(): Promise<void> {
    const { checkContent } = await import('./server/content');
    try {
        const warnings = await checkContent();
        if (warnings.length) {
            console.warn(`Guide без плана фокуса — задания по этим юнитам выйдут однообразнее (exercise-spec §7):\n${warnings.map((w) => `- ${w}`).join('\n')}`);
        }
    } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        process.exit(1);
    }
}
