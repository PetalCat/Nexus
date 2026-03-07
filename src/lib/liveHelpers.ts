import type { ProgramSlot } from './types/media-ui';

export interface CurrentProgram {
	program: ProgramSlot;
	index: number;
	startMinute: number;
	endMinute: number;
	progress: number;
	elapsedMinutes: number;
	remainingMinutes: number;
}

export interface ScheduleEntry {
	program: ProgramSlot;
	index: number;
	startMinute: number;
	endMinute: number;
	startTime: string;
	endTime: string;
	isPast: boolean;
	isCurrent: boolean;
}

/** Minutes since midnight for the current time */
function getMinuteOfDay(): number {
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

/** Format a minute-of-day value to a time string like "2:30 PM" */
export function formatTime(minuteOfDay: number): string {
	const wrapped = ((minuteOfDay % 1440) + 1440) % 1440;
	const hours = Math.floor(wrapped / 60);
	const minutes = wrapped % 60;
	const period = hours >= 12 ? 'PM' : 'AM';
	const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
	return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/** Format a duration in minutes to a human-readable string like "2h 30m" */
export function formatDuration(minutes: number): string {
	if (minutes < 60) return `${minutes}m`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Get the currently airing program from a schedule */
export function getCurrentProgram(schedule: ProgramSlot[]): CurrentProgram | null {
	if (schedule.length === 0) return null;

	const now = getMinuteOfDay();
	let startMinute = 0;

	for (let i = 0; i < schedule.length; i++) {
		const program = schedule[i];
		const endMinute = startMinute + program.duration;

		if (now >= startMinute && now < endMinute) {
			const elapsedMinutes = now - startMinute;
			const remainingMinutes = endMinute - now;
			const progress = elapsedMinutes / program.duration;

			return {
				program,
				index: i,
				startMinute,
				endMinute,
				progress,
				elapsedMinutes,
				remainingMinutes
			};
		}

		startMinute = endMinute;
	}

	// If we're past all programs (shouldn't happen with 1440-min schedules), return the last one
	const last = schedule[schedule.length - 1];
	const lastStart = startMinute - last.duration;
	return {
		program: last,
		index: schedule.length - 1,
		startMinute: lastStart,
		endMinute: startMinute,
		progress: 1,
		elapsedMinutes: last.duration,
		remainingMinutes: 0
	};
}

/** Get the next N upcoming programs after the current one */
export function getUpcomingPrograms(schedule: ProgramSlot[], count: number): ScheduleEntry[] {
	if (schedule.length === 0) return [];

	const current = getCurrentProgram(schedule);
	if (!current) return [];

	const upcoming: ScheduleEntry[] = [];
	let startMinute = current.endMinute;

	for (let i = current.index + 1; i < schedule.length && upcoming.length < count; i++) {
		const program = schedule[i];
		const endMinute = startMinute + program.duration;
		upcoming.push({
			program,
			index: i,
			startMinute,
			endMinute,
			startTime: formatTime(startMinute),
			endTime: formatTime(endMinute),
			isPast: false,
			isCurrent: false
		});
		startMinute = endMinute;
	}

	return upcoming;
}

/** Get the full day schedule with time info and status flags */
export function getDaySchedule(schedule: ProgramSlot[]): ScheduleEntry[] {
	if (schedule.length === 0) return [];

	const now = getMinuteOfDay();
	const entries: ScheduleEntry[] = [];
	let startMinute = 0;

	for (let i = 0; i < schedule.length; i++) {
		const program = schedule[i];
		const endMinute = startMinute + program.duration;
		const isPast = now >= endMinute;
		const isCurrent = now >= startMinute && now < endMinute;

		entries.push({
			program,
			index: i,
			startMinute,
			endMinute,
			startTime: formatTime(startMinute),
			endTime: formatTime(endMinute),
			isPast,
			isCurrent
		});

		startMinute = endMinute;
	}

	return entries;
}
