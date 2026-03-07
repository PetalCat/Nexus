<script lang="ts">
	import { Clock } from 'lucide-svelte';
	import type { PlaySession } from '$lib/types/media-ui';

	interface Props {
		sessions: PlaySession[];
	}

	let { sessions }: Props = $props();

	const maxDuration = $derived(
		sessions.length > 0
			? Math.max(...sessions.map((s) => s.durationMinutes))
			: 1
	);

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
	}
</script>

{#if sessions.length > 0}
	<div class="flex flex-col">
		{#each sessions as session, i (session.id)}
			<div class="nexus-stagger-item flex gap-4" style="animation-delay: {Math.min(i * 60, 600)}ms">
				<!-- Left column: date/time -->
				<div class="w-20 flex-shrink-0 pt-1 text-right">
					<p class="text-xs font-medium text-cream/80">{formatDate(session.date)}</p>
					<p class="text-[10px] text-faint">{formatTime(session.date)}</p>
				</div>

				<!-- Connector -->
				<div class="relative flex flex-col items-center">
					<div class="z-10 mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-warm bg-nexus-base"></div>
					{#if i < sessions.length - 1}
						<div class="w-px flex-1 bg-cream/[0.08]"></div>
					{/if}
				</div>

				<!-- Right column: content -->
				<div class="flex-1 pb-6">
					<!-- Duration bar -->
					<div class="flex items-center gap-3">
						<div class="h-2 flex-1 max-w-[200px] overflow-hidden rounded-full bg-cream/[0.06]">
							<div
								class="h-full rounded-full bg-gradient-to-r from-warm/80 to-warm-light transition-all duration-500"
								style="width: {(session.durationMinutes / maxDuration) * 100}%"
							></div>
						</div>
						<span class="text-xs font-medium text-warm-light">{session.duration}</span>
					</div>

					<!-- Notes -->
					{#if session.notes}
						<p class="mt-1.5 text-xs text-muted">{session.notes}</p>
					{/if}

					<!-- Progress change -->
					{#if session.progressBefore != null && session.progressAfter != null}
						<p class="mt-1 text-[10px] text-faint">
							{Math.round(session.progressBefore * 100)}% -> {Math.round(session.progressAfter * 100)}%
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="flex flex-col items-center justify-center rounded-xl border border-cream/[0.06] bg-cream/[0.02] py-12 text-center">
		<Clock size={32} strokeWidth={1} class="text-faint/30" />
		<p class="mt-3 text-sm text-muted">No play history</p>
		<p class="mt-1 text-xs text-faint">Play sessions will appear here</p>
	</div>
{/if}
