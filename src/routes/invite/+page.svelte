<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Join Nexus</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, #7c6cf815 0%, transparent 60%), #05050a">
	<div class="w-full max-w-sm">
		<!-- Logo -->
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-nebula)] shadow-[0_0_40px_#7c6cf840]">
				<svg width="24" height="24" viewBox="0 0 18 18" fill="none">
					<path d="M9 1L11.5 6.5H17L12.5 10L14.5 16L9 12.5L3.5 16L5.5 10L1 6.5H6.5L9 1Z" fill="white"/>
				</svg>
			</div>
			<div>
				<h1 class="text-display text-2xl font-bold">Join Nexus</h1>
				<p class="mt-1 text-sm text-[var(--color-subtle)]">You've been invited — create your account.</p>
			</div>
		</div>

		{#if !data.valid}
			<div class="card p-6 text-center">
				<div class="mb-4 flex justify-center">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-nova)" stroke-width="1.5" stroke-linecap="round">
						<circle cx="12" cy="12" r="10"/>
						<path d="M15 9l-6 6M9 9l6 6"/>
					</svg>
				</div>
				<p class="text-sm text-[var(--color-nova)]">{data.error}</p>
				<a href="/login" class="btn btn-ghost mt-4 text-sm">Go to Login</a>
			</div>
		{:else}
			<form method="POST" class="card p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
				<input type="hidden" name="code" value={data.code} />

				{#if form?.error}
					<div class="rounded-lg border border-[var(--color-nova)]/30 bg-[var(--color-nova)]/10 px-3 py-2 text-sm text-[var(--color-nova)]">
						{form.error}
					</div>
				{/if}

				<div>
					<label for="invite-username" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
					<input id="invite-username" name="username" class="input" placeholder="your-username" autocomplete="username" required />
				</div>
				<div>
					<label for="invite-display" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
					<input id="invite-display" name="displayName" class="input" placeholder="Your name" required />
				</div>
				<div>
					<label for="invite-password" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
					<input id="invite-password" name="password" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
				</div>
				<div>
					<label for="invite-confirm" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm Password</label>
					<input id="invite-confirm" name="confirm" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
				</div>

				<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
					{loading ? 'Creating account…' : 'Create Account'}
				</button>
			</form>

			<p class="mt-4 text-center text-xs text-[var(--color-muted)]">
				Already have an account? <a href="/login" class="text-[var(--color-nebula)] hover:underline">Sign in</a>
			</p>
		{/if}
	</div>
</div>
