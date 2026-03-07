<div class="mx-auto max-w-5xl px-6 py-12 lg:px-10">
	<div class="flex flex-col gap-10 md:flex-row md:gap-14">
		<!-- Poster -->
		<div class="w-full flex-shrink-0 md:w-72 lg:w-80">
			<div class="skeleton-bone aspect-[2/3] overflow-hidden rounded-2xl"></div>
		</div>

		<!-- Info -->
		<div class="flex flex-1 flex-col gap-5">
			<!-- Badge + rating -->
			<div class="flex items-center gap-3">
				<div class="skeleton-bone h-6 w-20 rounded-full"></div>
				<div class="skeleton-bone h-6 w-16 rounded-full"></div>
			</div>
			<!-- Title -->
			<div class="skeleton-bone h-10 w-3/4 rounded-lg lg:h-12"></div>
			<!-- Year -->
			<div class="skeleton-bone h-4 w-16 rounded"></div>
			<!-- Description -->
			<div class="space-y-2">
				<div class="skeleton-bone h-4 w-full max-w-lg rounded"></div>
				<div class="skeleton-bone h-4 w-4/5 max-w-lg rounded"></div>
				<div class="skeleton-bone h-4 w-3/5 max-w-lg rounded"></div>
			</div>
			<!-- Metadata grid -->
			<div class="mt-3 grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-3">
				{#each Array(6) as _}
					<div>
						<div class="skeleton-bone h-2.5 w-12 rounded"></div>
						<div class="skeleton-bone mt-1.5 h-4 w-20 rounded"></div>
					</div>
				{/each}
			</div>
			<!-- Action button -->
			<div class="mt-6">
				<div class="skeleton-bone h-11 w-36 rounded-full"></div>
			</div>
		</div>
	</div>
</div>
