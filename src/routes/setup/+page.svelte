<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Welcome to Nexus — Setup</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<div class="w-full max-w-sm">
		<!-- Logo -->
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent)] shadow-[0_0_40px_var(--color-accent)40]">
				<svg width="24" height="24" viewBox="0 0 18 18" fill="none">
					<path d="M9 1L11.5 6.5H17L12.5 10L14.5 16L9 12.5L3.5 16L5.5 10L1 6.5H6.5L9 1Z" fill="white"/>
				</svg>
			</div>
			<div>
				<h1 class="text-display text-2xl font-bold">Welcome to Nexus</h1>
				<p class="mt-1 text-sm text-[var(--color-muted)]">Create your admin account to get started.</p>
			</div>
		</div>

		<form method="POST" class="card p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
			{#if form?.error}
				<div class="rounded-lg border border-[var(--color-warm)]/30 bg-[var(--color-warm)]/10 px-3 py-2 text-sm text-[var(--color-warm)]">
					{form.error}
				</div>
			{/if}

			<div>
				<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
				<input name="username" class="input" placeholder="admin" autocomplete="username" required />
			</div>
			<div>
				<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
				<input name="displayName" class="input" placeholder="Your name" required />
			</div>
			<div>
				<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
				<input name="password" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
			</div>
			<div>
				<label class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm Password</label>
				<input name="confirm" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
			</div>

			<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
				{loading ? 'Creating account…' : 'Create Account'}
			</button>
		</form>
	</div>
</div>
