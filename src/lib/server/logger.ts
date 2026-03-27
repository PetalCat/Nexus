const isDev = process.env.NODE_ENV !== 'production';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
	level: LogLevel;
	msg: string;
	ts: string;
	[key: string]: unknown;
}

function formatDev(entry: LogEntry): string {
	const colors: Record<LogLevel, string> = {
		info: '\x1b[36m',  // cyan
		warn: '\x1b[33m',  // yellow
		error: '\x1b[31m'  // red
	};
	const reset = '\x1b[0m';
	const extra = Object.entries(entry)
		.filter(([k]) => !['level', 'msg', 'ts'].includes(k))
		.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
		.join(' ');
	return `${colors[entry.level]}[${entry.level.toUpperCase()}]${reset} ${entry.msg}${extra ? ' ' + extra : ''}`;
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
	const entry: LogEntry = {
		level,
		msg,
		ts: new Date().toISOString(),
		...data
	};

	const output = isDev ? formatDev(entry) : JSON.stringify(entry);
	const stream = level === 'error' ? process.stderr : process.stdout;
	stream.write(output + '\n');
}

export const logger = {
	info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
	warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
	error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data)
};
