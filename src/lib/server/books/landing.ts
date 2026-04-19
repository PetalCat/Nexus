type SessionRow = {
	mediaId?: string;
	updatedAt: number;
	endedAt?: number | null;
	durationMs?: number | null;
	progress?: number | null;
	completed?: number | null;
};

const DAY = 86400_000;
const THIRTY_DAYS = 30 * DAY;

export function computeStreak14(sessions: SessionRow[], now: number): boolean[] {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const startOfToday = today.getTime();
	const strip = Array<boolean>(14).fill(false);
	for (const s of sessions) {
		if ((s.durationMs ?? 0) < 60_000) continue;
		const dayIndex = Math.floor((s.updatedAt - startOfToday) / DAY) + 13;
		if (dayIndex >= 0 && dayIndex < 14) strip[dayIndex] = true;
	}
	return strip;
}

export function pickCurrentBook(sessions: SessionRow[], now: number): string | null {
	const active = sessions
		.filter(s => s.mediaId && s.updatedAt >= now - THIRTY_DAYS && (s.progress ?? 0) > 0 && (s.progress ?? 0) < 1)
		.sort((a, b) => b.updatedAt - a.updatedAt);
	return active[0]?.mediaId ?? null;
}

export function computeYearProgress(sessions: SessionRow[], now: number, goal = 40): { booksThisYear: number; goal: number } {
	const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
	const done = new Set<string>();
	for (const s of sessions) {
		if (s.completed && s.updatedAt >= yearStart && s.mediaId) done.add(s.mediaId);
	}
	return { booksThisYear: done.size, goal };
}
