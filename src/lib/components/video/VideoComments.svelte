<script lang="ts">
	import { ThumbsUp, MessageCircle } from 'lucide-svelte';

	interface Props {
		videoId: string;
	}

	let { videoId }: Props = $props();

	interface Comment {
		author: string;
		authorThumbnails: { url: string; width: number }[];
		content: string;
		contentHtml: string;
		publishedText: string;
		likeCount: number;
		replies?: { replyCount: number; continuation: string };
	}

	let comments = $state<Comment[]>([]);
	let commentCount = $state(0);
	let loaded = $state(false);
	let loading = $state(false);
	let sortBy = $state<'top' | 'new'>('top');

	// Track which comments have expanded replies
	let expandedReplies = $state<Record<number, Comment[]>>({});
	let loadingReplies = $state<Record<number, boolean>>({});

	async function loadComments() {
		if (loading) return;
		loading = true;
		try {
			const sortParam = sortBy === 'new' ? '&sort_by=new' : '';
			const res = await fetch(`/api/video/comments/${videoId}?${sortParam}`);
			if (res.ok) {
				const data = await res.json();
				comments = data.comments ?? [];
				commentCount = data.commentCount ?? comments.length;
				loaded = true;
			}
		} catch { /* silent */ } finally {
			loading = false;
		}
	}

	async function loadReplies(index: number, continuation: string) {
		if (loadingReplies[index]) return;
		loadingReplies[index] = true;
		try {
			const res = await fetch(`/api/video/comments/${videoId}?continuation=${encodeURIComponent(continuation)}`);
			if (res.ok) {
				const data = await res.json();
				expandedReplies[index] = data.comments ?? [];
			}
		} catch { /* silent */ } finally {
			loadingReplies[index] = false;
		}
	}

	function switchSort(newSort: 'top' | 'new') {
		if (newSort === sortBy) return;
		sortBy = newSort;
		loaded = false;
		comments = [];
		expandedReplies = {};
		loadComments();
	}

	function getAuthorThumb(c: Comment): string {
		if (!c.authorThumbnails?.length) return '';
		const sorted = [...c.authorThumbnails].sort((a, b) => a.width - b.width);
		return sorted.find(t => t.width >= 48)?.url ?? sorted[sorted.length - 1].url;
	}
</script>

<div class="mt-6">
	{#if !loaded && !loading}
		<button
			class="flex items-center gap-2 rounded-lg bg-cream/[0.04] px-4 py-2.5 text-sm text-cream/70 transition-colors hover:bg-cream/[0.08]"
			onclick={loadComments}
		>
			<MessageCircle size={16} />
			Show comments
		</button>
	{:else if loading && !loaded}
		<!-- Skeleton loading -->
		<div class="space-y-4">
			{#each [1, 2, 3] as _}
				<div class="flex gap-3">
					<div class="h-8 w-8 animate-pulse rounded-full bg-cream/[0.06]"></div>
					<div class="flex-1 space-y-2">
						<div class="h-3 w-24 animate-pulse rounded bg-cream/[0.06]"></div>
						<div class="h-3 w-full animate-pulse rounded bg-cream/[0.04]"></div>
						<div class="h-3 w-3/4 animate-pulse rounded bg-cream/[0.04]"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Header with count + sort -->
		<div class="mb-4 flex items-center gap-4">
			<h3 class="text-sm font-medium text-cream">{commentCount.toLocaleString()} Comments</h3>
			<div class="flex gap-1 text-xs">
				<button
					class="rounded px-2 py-1 transition-colors {sortBy === 'top' ? 'bg-cream/10 text-cream' : 'text-muted hover:text-cream/70'}"
					onclick={() => switchSort('top')}
				>Top</button>
				<button
					class="rounded px-2 py-1 transition-colors {sortBy === 'new' ? 'bg-cream/10 text-cream' : 'text-muted hover:text-cream/70'}"
					onclick={() => switchSort('new')}
				>Newest</button>
			</div>
		</div>

		<!-- Comment list -->
		<div class="space-y-4">
			{#each comments as comment, i}
				<div class="flex gap-3">
					{#if getAuthorThumb(comment)}
						<img
							src={getAuthorThumb(comment)}
							alt={comment.author}
							class="h-8 w-8 flex-shrink-0 rounded-full object-cover"
							loading="lazy"
						/>
					{:else}
						<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-nexus-surface text-xs font-bold text-cream/40">
							{comment.author.charAt(0).toUpperCase()}
						</div>
					{/if}

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-cream">{comment.author}</span>
							<span class="text-xs text-muted">{comment.publishedText}</span>
						</div>
						<p class="mt-0.5 text-sm leading-relaxed text-cream/80">{comment.content}</p>
						<div class="mt-1.5 flex items-center gap-3 text-xs text-muted">
							{#if comment.likeCount > 0}
								<span class="flex items-center gap-1">
									<ThumbsUp size={12} />
									{comment.likeCount.toLocaleString()}
								</span>
							{/if}
							{#if comment.replies && comment.replies.replyCount > 0 && !expandedReplies[i]}
								<button
									class="text-accent hover:underline"
									disabled={loadingReplies[i]}
									onclick={() => loadReplies(i, comment.replies!.continuation)}
								>
									{loadingReplies[i] ? 'Loading...' : `Show ${comment.replies.replyCount} replies`}
								</button>
							{/if}
						</div>

						<!-- Replies -->
						{#if expandedReplies[i]}
							<div class="mt-3 space-y-3 border-l border-cream/[0.06] pl-4">
								{#each expandedReplies[i] as reply}
									<div class="flex gap-2.5">
										{#if getAuthorThumb(reply)}
											<img
												src={getAuthorThumb(reply)}
												alt={reply.author}
												class="h-6 w-6 flex-shrink-0 rounded-full object-cover"
												loading="lazy"
											/>
										{:else}
											<div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-nexus-surface text-[10px] font-bold text-cream/40">
												{reply.author.charAt(0).toUpperCase()}
											</div>
										{/if}
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="text-xs font-medium text-cream">{reply.author}</span>
												<span class="text-[10px] text-muted">{reply.publishedText}</span>
											</div>
											<p class="mt-0.5 text-xs leading-relaxed text-cream/80">{reply.content}</p>
											{#if reply.likeCount > 0}
												<span class="mt-1 flex items-center gap-1 text-[10px] text-muted">
													<ThumbsUp size={10} />
													{reply.likeCount.toLocaleString()}
												</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if loading}
			<div class="mt-4 flex justify-center">
				<div class="h-5 w-5 animate-spin rounded-full border-2 border-cream/20 border-t-cream/60"></div>
			</div>
		{/if}
	{/if}
</div>
