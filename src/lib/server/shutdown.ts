import { closeDb } from '$lib/db';
import { stopSessionPoller } from './session-poller';
import { stopStatsScheduler } from './stats-scheduler';
import { stopRecScheduler } from './rec-scheduler';
import { stopVideoNotificationPoller } from './video-notifications';
import { stopHealthWatchdog } from './health-watchdog';

let shuttingDown = false;

export function isShuttingDown(): boolean {
	return shuttingDown;
}

export function registerShutdownHandler(): void {
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);

		try { stopSessionPoller(); } catch { /* already stopped */ }
		try { stopStatsScheduler(); } catch { /* already stopped */ }
		try { stopRecScheduler(); } catch { /* already stopped */ }
		try { stopVideoNotificationPoller(); } catch { /* already stopped */ }
		try { stopHealthWatchdog(); } catch { /* already stopped */ }
		try { closeDb(); } catch { /* already closed */ }

		console.log('[shutdown] Cleanup complete, exiting.');
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
