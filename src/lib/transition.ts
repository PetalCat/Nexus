/**
 * Tracks which media ID is actively transitioning.
 * Used to set view-transition-name on only the clicked card (avoiding duplicates)
 * and to restore it on the correct card during back navigation.
 */
let activeMediaId: string | null = null;

export function setActiveTransition(id: string) {
	activeMediaId = id;
}

export function getActiveTransition() {
	return activeMediaId;
}

/**
 * True while a view-transition navigation is in progress.
 * Used by useReady to skip skeleton during transitions.
 */
let _navigating = false;

export function setNavigating(v: boolean) {
	_navigating = v;
}

export function isNavigating() {
	return _navigating;
}
