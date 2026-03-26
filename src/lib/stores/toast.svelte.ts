/** Global toast notification store */

export interface Toast {
	id: string;
	message: string;
	type: 'success' | 'error' | 'info';
	durationMs: number;
}

let toasts = $state<Toast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function getToasts(): Toast[] {
	return toasts;
}

export function addToast(message: string, type: Toast['type'] = 'info', durationMs = 3500) {
	const id = crypto.randomUUID();
	toasts = [...toasts, { id, message, type, durationMs }];

	const timer = setTimeout(() => {
		dismissToast(id);
	}, durationMs);
	timers.set(id, timer);

	return id;
}

export function dismissToast(id: string) {
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
	toasts = toasts.filter((t) => t.id !== id);
}

/** Convenience shorthands */
export const toast = {
	success: (msg: string, ms?: number) => addToast(msg, 'success', ms),
	error: (msg: string, ms?: number) => addToast(msg, 'error', ms ?? 5000),
	info: (msg: string, ms?: number) => addToast(msg, 'info', ms)
};
