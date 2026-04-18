/**
 * Small buffer that the client-side crash reporter pushes the last few
 * errors into. The bug-report modal reads from here so "Report a bug"
 * can auto-include "I just saw a crash" context without the user having
 * to copy/paste a stack trace. Kept client-only and intentionally small.
 */

interface RecentCrash {
	message: string;
	stack?: string;
	surface?: string;
	at: number;
}

const MAX = 5;
const buffer: RecentCrash[] = [];

export function recordRecentCrash(c: RecentCrash): void {
	buffer.push(c);
	while (buffer.length > MAX) buffer.shift();
}

export function getRecentCrashes(): RecentCrash[] {
	return buffer.slice();
}
