// Next вызывает register() один раз при старте сервера, до любого запроса.
// NodeSDK не работает в edge, поэтому подключается только в node (docs: OpenTelemetry).
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation.node');
}
