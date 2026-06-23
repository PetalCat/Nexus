import { closeDb } from '$lib/db';
import { logger } from './logger';

let shuttingDown = false;

export function isShuttingDown(): boolean {
	return shuttingDown;
}

export function registerShutdownHandler(): void {
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info('Graceful shutdown initiated', { signal });
		try {
			closeDb();
		} catch {
			// already closed
		}
		logger.info('Shutdown cleanup complete, exiting');
		process.exit(0);
	};

	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}
