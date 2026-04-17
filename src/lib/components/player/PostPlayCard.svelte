<script lang="ts">
	import type { NextItem } from './types';

	interface Props {
		nextItem: NextItem;
		/** Seconds remaining before autoplay-next fires. 0 or less = no countdown. */
		countdown: number;
		onplaynext: () => void;
		ondismiss: () => void;
	}

	let { nextItem, countdown, onplaynext, ondismiss }: Props = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			ondismiss();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<div class="postplay" role="dialog" aria-label="Up next">
	<div class="postplay__card">
		{#if nextItem.poster}
			<img src={nextItem.poster} alt="" class="postplay__poster" />
		{/if}
		<div class="postplay__body">
			<div class="postplay__eyebrow">Up Next</div>
			<div class="postplay__title">{nextItem.title}</div>
			{#if nextItem.subtitle}
				<div class="postplay__sub">{nextItem.subtitle}</div>
			{/if}
			<div class="postplay__actions">
				<button class="postplay__btn postplay__btn--primary" onclick={onplaynext} type="button">
					{#if countdown > 0}
						Play Next in {countdown}
					{:else}
						Play Next
					{/if}
				</button>
				<button class="postplay__btn" onclick={ondismiss} type="button">Back to details</button>
			</div>
		</div>
	</div>
</div>

<style>
	.postplay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: flex-end;
		padding: 0 2rem 8rem;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0) 40%,
			rgba(0, 0, 0, 0.65) 100%
		);
		z-index: 25;
		pointer-events: none;
		animation: postplay-fade 240ms ease-out;
	}
	.postplay__card {
		pointer-events: auto;
		display: flex;
		gap: 1rem;
		min-width: 20rem;
		max-width: 32rem;
		padding: 0.75rem;
		background: rgba(15, 15, 20, 0.92);
		backdrop-filter: blur(14px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.75rem;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
	}
	.postplay__poster {
		width: 6.5rem;
		height: 9.5rem;
		object-fit: cover;
		border-radius: 0.5rem;
		flex: none;
	}
	.postplay__body {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}
	.postplay__eyebrow {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgba(255, 255, 255, 0.55);
	}
	.postplay__title {
		font-size: 1.05rem;
		font-weight: 600;
		color: #fff;
		line-height: 1.2;
	}
	.postplay__sub {
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.6);
	}
	.postplay__actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.postplay__btn {
		padding: 0.5rem 0.9rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.4rem;
		cursor: pointer;
		transition: background 0.15s;
	}
	.postplay__btn:hover {
		background: rgba(255, 255, 255, 0.12);
	}
	.postplay__btn--primary {
		background: var(--color-accent, #fbbf24);
		color: #111;
		border-color: transparent;
	}
	.postplay__btn--primary:hover {
		filter: brightness(1.08);
	}

	@keyframes postplay-fade {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
</style>
