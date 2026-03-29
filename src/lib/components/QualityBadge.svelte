<script lang="ts">
	interface Props {
		quality?: {
			resolution?: string;
			hdr?: string;
			audioFormat?: string;
			audioChannels?: string;
			videoCodec?: string;
			source?: string;
			customFormats?: string[];
			qualityProfile?: string;
		};
		mode?: 'overlay' | 'inline';
	}

	let { quality, mode = 'overlay' }: Props = $props();

	interface Badge {
		label: string;
		color: string;
	}

	function resolveResolution(res: string): Badge | null {
		const lower = res.toLowerCase();
		if (lower.includes('2160') || lower.includes('4k') || lower.includes('uhd')) {
			return { label: '4K', color: '#4a9eff' };
		}
		if (lower.includes('1080') || lower.includes('hd') || lower.includes('720')) {
			return { label: 'HD', color: 'rgba(74, 158, 255, 0.7)' };
		}
		if (lower.includes('480') || lower.includes('sd') || lower.includes('576') || lower.includes('360')) {
			return { label: 'SD', color: 'rgba(255, 255, 255, 0.4)' };
		}
		return null;
	}

	function resolveHdr(hdr: string): Badge | null {
		const lower = hdr.toLowerCase();
		if (lower.includes('dolby') || lower.includes('dv') || lower.includes('vision')) {
			return { label: 'DV', color: '#f59e0b' };
		}
		if (lower.includes('hdr10+') || lower.includes('hdr10plus')) {
			return { label: '10+', color: 'rgba(245, 158, 11, 0.7)' };
		}
		if (lower.includes('hdr')) {
			return { label: 'HDR', color: 'rgba(245, 158, 11, 0.7)' };
		}
		return null;
	}

	function resolveAudio(format: string): Badge | null {
		const lower = format.toLowerCase();
		if (lower.includes('atmos')) {
			return { label: 'AT', color: '#a78bfa' };
		}
		if (lower.includes('dts:x') || lower.includes('dts-x') || lower.includes('dtsx')) {
			return { label: 'DX', color: '#a78bfa' };
		}
		if (lower.includes('flac')) {
			return { label: 'FL', color: '#22c55e' };
		}
		return null;
	}

	const badges = $derived.by(() => {
		if (!quality) return [];

		const result: Badge[] = [];

		if (quality.resolution) {
			const b = resolveResolution(quality.resolution);
			if (b) result.push(b);
		}

		if (quality.hdr) {
			const b = resolveHdr(quality.hdr);
			if (b) result.push(b);
		}

		if (quality.audioFormat) {
			const b = resolveAudio(quality.audioFormat);
			if (b) result.push(b);
		}

		if (mode === 'overlay') {
			return result.slice(0, 3);
		}

		return result;
	});
</script>

{#if badges.length > 0}
	{#if mode === 'overlay'}
		<div class="badge-stack">
			{#each badges as badge (badge.label)}
				<span class="badge" style:color={badge.color}>{badge.label}</span>
			{/each}
		</div>
	{:else}
		<div class="badge-row">
			{#each badges as badge (badge.label)}
				<span class="badge" style:color={badge.color}>{badge.label}</span>
			{/each}
		</div>
	{/if}
{/if}

<style>
	.badge-stack {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.badge-row {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.badge {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.5rem;
		font-weight: 700;
		line-height: 1;
	}
</style>
