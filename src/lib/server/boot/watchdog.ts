let started = false;

export function startWatchdog(): void {
	if (started) return;
	started = true;
}
