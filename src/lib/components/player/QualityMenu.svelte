<script lang="ts">
	import type { Level } from '$lib/components/player/PlayerEngine';

	interface Props {
		levels: Level[];
		activeLevel: Level | null;
		autoQuality: boolean;
		qualityLabel: string;
		onselect: (index: number) => void;
		/** Fires when user picks a preset height that doesn't match an
		 *  engine-reported level — the parent re-negotiates with the server
		 *  to force a transcode at that resolution. */
		onrequest?: (targetHeight: number) => void;
	}

	let { levels, activeLevel, autoQuality, onselect, onrequest }: Props = $props();

	// Standard transcode presets — shown when the engine's level list doesn't
	// already cover them. User can force any of these; the parent calls
	// negotiatePlayback with { targetHeight } to trigger a Jellyfin transcode.
	const PRESETS = [2160, 1440, 1080, 720, 480, 360, 240];

	/** Rough H.264 encoder defaults for streaming at each height — used to
	 *  show a bitrate estimate next to preset options that don't come from
	 *  the engine's actual level list. */
	const PRESET_BITRATES: Record<number, number> = {
		2160: 35_000_000,
		1440: 16_000_000,
		1080: 8_000_000,
		720: 4_000_000,
		480: 2_000_000,
		360: 1_000_000,
		240: 500_000,
	};

	function fmtBitrate(bps: number): string {
		if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
		if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} kbps`;
		return `${bps} bps`;
	}

	// Merge engine levels + preset heights. If a preset already matches an
	// engine level by height, prefer the engine level (instant in-manifest
	// switch). Otherwise surface the preset as a "force transcode" option.
	const merged = $derived.by(() => {
		const levelHeights = new Set(levels.map((l) => l.height));
		type Row =
			| { kind: 'level'; level: Level }
			| { kind: 'preset'; height: number };
		const rows: Row[] = [];
		const presetHeights = PRESETS.filter((h) => !levelHeights.has(h));
		const byHeightDesc = (a: { height: number }, b: { height: number }) => b.height - a.height;
		const combined: { height: number; kind: 'level' | 'preset'; level?: Level }[] = [
			...levels.map((l) => ({ height: l.height, kind: 'level' as const, level: l })),
			...presetHeights.map((h) => ({ height: h, kind: 'preset' as const })),
		];
		combined.sort(byHeightDesc);
		for (const c of combined) {
			if (c.kind === 'level' && c.level) rows.push({ kind: 'level', level: c.level });
			else rows.push({ kind: 'preset', height: c.height });
		}
		return rows;
	});
</script>

<div class="panel">
	<div class="panel__head">Quality</div>

	<button
		class="panel__item"
		class:panel__item--on={autoQuality}
		onclick={() => onselect(-1)}
	>
		<span>
			Auto
			{#if autoQuality && activeLevel}
				<span class="panel__meta">
					→ {activeLevel.height}p{#if activeLevel.bitrate > 0} · {fmtBitrate(activeLevel.bitrate)}{/if}
				</span>
			{/if}
		</span>
		{#if autoQuality}<span class="panel__ck">&#10003;</span>{/if}
	</button>

	{#each merged as row (row.kind === 'level' ? `l${row.level.index}` : `p${row.height}`)}
		{#if row.kind === 'level'}
			<button
				class="panel__item"
				class:panel__item--on={!autoQuality && activeLevel?.index === row.level.index}
				onclick={() => onselect(row.level.index)}
			>
				<span>
					{row.level.height}p
					{#if row.level.bitrate > 0}<span class="panel__meta">{fmtBitrate(row.level.bitrate)}</span>{/if}
				</span>
				{#if !autoQuality && activeLevel?.index === row.level.index}
					<span class="panel__ck">&#10003;</span>
				{/if}
			</button>
		{:else}
			<button
				class="panel__item"
				onclick={() => onrequest?.(row.height)}
				disabled={!onrequest}
			>
				<span>
					{row.height}p
					<span class="panel__meta">
						{fmtBitrate(PRESET_BITRATES[row.height] ?? 0)} · transcode
					</span>
				</span>
			</button>
		{/if}
	{/each}
</div>

<style>
	.panel {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 0.5rem;
		min-width: 13rem;
		max-height: calc(100vh - 8rem);
		overflow-y: auto;
		background: rgba(15, 15, 20, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 0.5rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		padding: 0.25rem;
		z-index: 20;
	}
	.panel__head {
		padding: 0.5rem 0.75rem 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(255, 255, 255, 0.5);
	}
	.panel__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		border-radius: 0.375rem;
		color: rgba(255, 255, 255, 0.9);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.15s;
	}
	.panel__item:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
	.panel__item:disabled { opacity: 0.4; cursor: not-allowed; }
	.panel__item--on { background: rgba(255, 255, 255, 0.04); font-weight: 500; }
	.panel__meta {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.5);
		margin-left: 0.25rem;
	}
	.panel__ck {
		color: var(--color-accent, #fbbf24);
		font-size: 0.85rem;
	}
</style>
