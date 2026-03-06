<script lang="ts">
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Create Account — Nexus</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, #7c6cf815 0%, transparent 60%), #05050a">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-nebula)] shadow-[0_0_40px_#7c6cf840]">
				<svg width="24" height="24" viewBox="0 0 18 18" fill="none">
					<path d="M9 1L11.5 6.5H17L12.5 10L14.5 16L9 12.5L3.5 16L5.5 10L1 6.5H6.5L9 1Z" fill="white"/>
				</svg>
			</div>
			<div>
				<h1 class="text-display text-2xl font-bold">Create Account</h1>
				<p class="mt-1 text-sm text-[var(--color-subtle)]">Join Nexus — your media OS.</p>
			</div>
		</div>

		<form method="POST" class="card p-6 flex flex-col gap-4" onsubmit={() => (loading = true)}>
			{#if form?.error}
				<div class="rounded-lg border border-[var(--color-nova)]/30 bg-[var(--color-nova)]/10 px-3 py-2 text-sm text-[var(--color-nova)]">
					{form.error}
				</div>
			{/if}

			<div>
				<label for="reg-username" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Username</label>
				<input id="reg-username" name="username" class="input" placeholder="your-username" autocomplete="username" required />
			</div>
			<div>
				<label for="reg-display" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Display Name</label>
				<input id="reg-display" name="displayName" class="input" placeholder="Your name" required />
			</div>
			<div>
				<label for="reg-password" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Password</label>
				<input id="reg-password" name="password" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
			</div>
			<div>
				<label for="reg-confirm" class="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">Confirm Password</label>
				<input id="reg-confirm" name="confirm" type="password" class="input" placeholder="••••••••" autocomplete="new-password" required />
			</div>

			<button type="submit" class="btn btn-primary mt-2" disabled={loading}>
				{loading ? 'Creating account…' : 'Create Account'}
			</button>
		</form>

		<p class="mt-4 text-center text-xs text-[var(--color-muted)]">
			Already have an account? <a href="/login" class="text-[var(--color-nebula)] hover:underline">Sign in</a>
		</p>
	</div>
</div>
