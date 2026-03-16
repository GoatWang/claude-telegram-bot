/**
 * Lightweight structured logging helpers for operational diagnostics.
 */

export function logTelemetry(
	event: string,
	data: Record<string, string | number | boolean | null | undefined>,
): void {
	const payload = {
		ts: new Date().toISOString(),
		event,
		...data,
	};
	console.log(`[telemetry] ${JSON.stringify(payload)}`);
}
