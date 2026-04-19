import type { ReaderSettings } from './reader-settings';

export type ReaderAction = 'prev' | 'next' | 'toggleUI';

const SWIPE_MIN_PX = 50;
const SWIPE_VERTICAL_RATIO = 2; // |dx| must be > 2*|dy|

export function hitZone(x: number, width: number): ReaderAction {
	const third = width / 3;
	if (x < third) return 'prev';
	if (x < 2 * third) return 'toggleUI';
	return 'next';
}

export function isHorizontalSwipe({ dx, dy }: { dx: number; dy: number }): ReaderAction | null {
	if (Math.abs(dx) < SWIPE_MIN_PX) return null;
	if (Math.abs(dx) <= Math.abs(dy) * SWIPE_VERTICAL_RATIO) return null;
	return dx > 0 ? 'prev' : 'next';
}

export function mapKeyToAction(key: string): ReaderAction | null {
	switch (key) {
		case 'ArrowLeft':
		case 'PageUp':
			return 'prev';
		case 'ArrowRight':
		case 'PageDown':
		case ' ':
			return 'next';
		default:
			return null;
	}
}

export function flipForRtl<A extends ReaderAction>(action: A, direction: ReaderSettings['direction']): A {
	if (direction !== 'rtl') return action;
	if (action === 'prev') return 'next' as A;
	if (action === 'next') return 'prev' as A;
	return action;
}

interface UseInputsArgs {
	getSettings: () => Pick<ReaderSettings, 'inputs' | 'direction'>;
	onPrev: () => void;
	onNext: () => void;
	onToggleUI: () => void;
}

export function useReaderInputs(args: UseInputsArgs) {
	const dispatch = (action: ReaderAction) => {
		const { direction } = args.getSettings();
		const final = flipForRtl(action, direction);
		if (final === 'prev') args.onPrev();
		else if (final === 'next') args.onNext();
		else if (final === 'toggleUI') args.onToggleUI();
	};

	const tapHandlers = {
		onpointerup(e: PointerEvent) {
			if (!args.getSettings().inputs.tapZones) return;
			const target = e.currentTarget as HTMLElement;
			const rect = target.getBoundingClientRect();
			dispatch(hitZone(e.clientX - rect.left, rect.width));
		}
	};

	let touchStart: { x: number; y: number } | null = null;
	const swipeHandlers = {
		ontouchstart(e: TouchEvent) {
			if (!args.getSettings().inputs.swipe) return;
			const t = e.changedTouches[0];
			touchStart = { x: t.clientX, y: t.clientY };
		},
		ontouchend(e: TouchEvent) {
			if (!args.getSettings().inputs.swipe || !touchStart) return;
			const t = e.changedTouches[0];
			const dx = t.clientX - touchStart.x;
			const dy = t.clientY - touchStart.y;
			touchStart = null;
			const action = isHorizontalSwipe({ dx, dy });
			if (action) dispatch(action);
		}
	};

	function attachKeyboard(target: Window | HTMLElement = window): () => void {
		const onKey = (e: KeyboardEvent) => {
			if (!args.getSettings().inputs.keyboard) return;
			const action = mapKeyToAction(e.key);
			if (!action) return;
			e.preventDefault();
			dispatch(action);
		};
		target.addEventListener('keydown', onKey as EventListener);
		return () => target.removeEventListener('keydown', onKey as EventListener);
	}

	return { tapHandlers, swipeHandlers, attachKeyboard };
}
