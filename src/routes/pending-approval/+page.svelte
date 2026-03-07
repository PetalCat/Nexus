<svelte:head>
	<title>Pending Approval — Nexus</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent)] shadow-[0_0_40px_var(--color-accent)40]">
				<svg width="24" height="24" viewBox="0 0 18 18" fill="none">
					<path d="M9 1L11.5 6.5H17L12.5 10L14.5 16L9 12.5L3.5 16L5.5 10L1 6.5H6.5L9 1Z" fill="white"/>
				</svg>
			</div>
		</div>

		<div class="card p-6 text-center">
			<div class="mb-4 flex justify-center">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round">
					<circle cx="12" cy="12" r="10"/>
					<path d="M12 6v6l4 2"/>
				</svg>
			</div>
			<h2 class="text-display text-lg font-semibold mb-2">Pending Approval</h2>
			<p class="text-sm text-[var(--color-muted)] mb-6">
				Your account is waiting for admin approval. Check back later.
			</p>
			<a href="/api/auth/logout" class="btn btn-ghost text-sm" data-sveltekit-reload>Sign Out</a>
		</div>
	</div>
</div>
