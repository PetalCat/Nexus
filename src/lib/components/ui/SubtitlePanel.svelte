<script lang="ts">
	import type { SubtitleStatus } from '$lib/types/media-ui';
	import { Search, Upload } from 'lucide-svelte';

	interface Props {
		status: SubtitleStatus;
		mode?: 'compact' | 'full';
	}

	let { status, mode = 'compact' }: Props = $props();

	const langFlags: Record<string, string> = {
		en: '\u{1F1FA}\u{1F1F8}',
		fr: '\u{1F1EB}\u{1F1F7}',
		es: '\u{1F1EA}\u{1F1F8}',
		de: '\u{1F1E9}\u{1F1EA}',
		it: '\u{1F1EE}\u{1F1F9}',
		pt: '\u{1F1E7}\u{1F1F7}',
		ja: '\u{1F1EF}\u{1F1F5}',
		ko: '\u{1F1F0}\u{1F1F7}',
		zh: '\u{1F1E8}\u{1F1F3}',
		ru: '\u{1F1F7}\u{1F1FA}',
		ar: '\u{1F1F8}\u{1F1E6}',
		hi: '\u{1F1EE}\u{1F1F3}',
		nl: '\u{1F1F3}\u{1F1F1}',
		sv: '\u{1F1F8}\u{1F1EA}',
		pl: '\u{1F1F5}\u{1F1F1}'
	};

	const langNames: Record<string, string> = {
		en: 'English',
		fr: 'French',
		es: 'Spanish',
		de: 'German',
		it: 'Italian',
		pt: 'Portuguese',
		ja: 'Japanese',
		ko: 'Korean',
		zh: 'Chinese',
		ru: 'Russian'
	};

	function flag(code: string): string {
		return langFlags[code] ?? '\u{1F3F3}\u{FE0F}';
	}

	function langName(code: string): string {
		return langNames[code] ?? code.toUpperCase();
	}
</script>

{#if mode === 'compact'}
	<!-- Compact: horizontal badge row -->
	<div class="flex flex-wrap items-center gap-1.5">
		{#each status.available as track}
			<span
				class="inline-flex items-center gap-1 rounded-full bg-steel/10 px-2 py-0.5 text-[10px] font-medium text-steel-light ring-1 ring-steel/15"
			>
				<span class="text-xs">{flag(track.languageCode)}</span>
				{track.languageCode.toUpperCase()}
				{#if track.hearingImpaired}
					<span class="text-faint">CC</span>
				{/if}
			</span>
		{/each}
		{#each status.missing as code}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-dashed border-accent/30 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent/70"
			>
				<span class="text-xs">{flag(code)}</span>
				{code.toUpperCase()}
			</span>
		{/each}
		{#if status.searchNeeded}
			<button
				class="ml-1 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/20"
				onclick={() => console.log('Search subtitles')}
			>
				<Search size={10} strokeWidth={2} />
				Search
			</button>
		{/if}
	</div>
{:else}
	<!-- Full: detailed cards -->
	<div class="flex flex-col gap-4">
		<!-- Available tracks -->
		{#if status.available.length > 0}
			<div class="flex flex-col gap-2">
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Available</span>
				<div class="flex flex-wrap gap-2">
					{#each status.available as track}
						<div class="flex items-center gap-2.5 rounded-lg bg-steel/[0.07] px-3 py-2 ring-1 ring-steel/10">
							<span class="text-base">{flag(track.languageCode)}</span>
							<div class="flex flex-col">
								<span class="text-xs font-medium text-cream/90">{track.language}</span>
								<span class="text-[10px] text-faint">
									{track.source} · {track.format.toUpperCase()}
									{#if track.hearingImpaired}· CC{/if}
									{#if track.forced}· Forced{/if}
								</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Missing tracks -->
		{#if status.missing.length > 0}
			<div class="flex flex-col gap-2">
				<span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent/70">Missing</span>
				<div class="flex flex-wrap gap-2">
					{#each status.missing as code}
						<div
							class="flex items-center gap-2.5 rounded-lg border border-dashed border-accent/25 bg-accent/[0.04] px-3 py-2"
						>
							<span class="text-base">{flag(code)}</span>
							<span class="text-xs font-medium text-accent/80">{langName(code)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Actions -->
		{#if status.searchNeeded}
			<div class="flex flex-wrap gap-2 pt-1">
				<button
					class="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
					onclick={() => console.log('Search missing')}
				>
					<Search size={12} strokeWidth={2} />
					Search Missing
				</button>
				<button
					class="inline-flex items-center gap-1.5 rounded-lg bg-cream/[0.05] px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-cream/[0.08] hover:text-cream/80"
					onclick={() => console.log('Upload subtitle')}
				>
					<Upload size={12} strokeWidth={2} />
					Upload
				</button>
			</div>
		{/if}
	</div>
{/if}
