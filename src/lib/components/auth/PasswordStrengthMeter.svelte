<script lang="ts">
	interface Props {
		password: string;
	}

	let { password }: Props = $props();

	const strength = $derived.by(() => {
		if (!password) return 0;
		let score = 0;
		if (password.length >= 8) score++;
		if (/[A-Z]/.test(password)) score++;
		if (/[0-9]/.test(password)) score++;
		if (/[^A-Za-z0-9]/.test(password)) score++;
		return score;
	});

	const label = $derived(['', 'Weak', 'Fair', 'Good', 'Strong'][strength] ?? '');
	const colorClass = $derived(
		strength <= 1 ? 'bg-warm' : strength === 2 ? 'bg-accent' : 'bg-steel'
	);
</script>

{#if password}
	<div class="mt-2 space-y-1.5">
		<div class="flex gap-1">
			{#each [1, 2, 3, 4] as segment}
				<div
					class="h-1 flex-1 rounded-full transition-colors duration-300 {segment <= strength
						? colorClass
						: 'bg-cream/[0.08]'}"
				></div>
			{/each}
		</div>
		<p
			class="text-xs {strength <= 1
				? 'text-warm'
				: strength === 2
					? 'text-accent'
					: 'text-steel-light'}"
		>
			{label}
		</p>
	</div>
{/if}
