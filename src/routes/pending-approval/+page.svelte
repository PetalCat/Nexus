<svelte:head>
	<title>Pending Approval — Nexus</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4" style="background: radial-gradient(ellipse at 50% 0%, var(--color-accent)15 0%, transparent 60%), var(--color-void)">
	<div class="w-full max-w-sm">
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-accent)] shadow-[0_0_40px_var(--color-accent)40]">
				<svg width="24" height="24" viewBox="-85 -754 1058 828" fill="none">
					<g transform="scale(1,-1)"><path d="M543 -5 275 483Q275 483 277.0 501.0Q279 519 281.0 542.5Q283 566 285.0 584.0Q287 602 287 602Q295 639 292.5 656.5Q290 674 272.5 680.5Q255 687 216 688L221 708Q237 707 260.5 706.0Q284 705 310 705Q357 705 391 708L615 272Q615 272 611.5 252.0Q608 232 602.0 200.5Q596 169 590.0 133.5Q584 98 578.0 66.5Q572 35 568.5 15.0Q565 -5 565 -5ZM851 737Q826 737 804.0 721.0Q782 705 766 682Q720 614 672.0 443.0Q624 272 565 -5L551 23Q566 90 583.0 167.5Q600 245 619.5 323.0Q639 401 659.5 472.0Q680 543 702.5 599.5Q725 656 748 690Q767 717 793.0 735.5Q819 754 856 754Q909 754 941.0 723.0Q973 692 973 647Q973 599 940.5 570.5Q908 542 861 542Q821 542 796.5 561.5Q772 581 772 616Q772 661 802.0 691.5Q832 722 876 729Q872 733 865.5 735.0Q859 737 851 737ZM37 -57Q65 -57 86.0 -41.5Q107 -26 123 -1Q152 45 181.5 143.0Q211 241 241.5 380.0Q272 519 303 685L320 664Q304 582 286.5 497.5Q269 413 251.0 332.5Q233 252 214.0 183.0Q195 114 176.0 63.5Q157 13 139 -11Q121 -35 96.5 -54.5Q72 -74 32 -74Q-21 -74 -53.0 -43.0Q-85 -12 -85 33Q-85 81 -52.0 109.5Q-19 138 27 138Q68 138 92.0 118.5Q116 99 116 64Q116 19 86.0 -11.0Q56 -41 12 -49Q16 -53 22.5 -55.0Q29 -57 37 -57Z" fill="white"/></g>
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
