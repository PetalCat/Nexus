<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg' | 'xl';
		fill?: boolean;
		aspect?: 'portrait' | 'square' | 'video';
	}

	let { size = 'md', fill = false, aspect = 'portrait' }: Props = $props();

	const sizeClasses: Record<string, string> = {
		sm: 'w-[130px] md:w-[145px]',
		md: 'w-[155px] md:w-[185px]',
		lg: 'w-[185px] md:w-[220px]',
		xl: 'w-[200px] md:w-[230px]'
	};

	const aspectClasses: Record<string, string> = {
		portrait: 'aspect-[2/3]',
		square: 'aspect-square',
		video: 'aspect-video'
	};
</script>

<div class={fill ? 'w-full' : `flex-shrink-0 ${sizeClasses[size]}`}>
	<div class="skeleton-bone overflow-hidden rounded-xl {aspectClasses[aspect]}"></div>
	<div class="mt-1.5 px-0.5 space-y-1">
		<div class="skeleton-bone h-3 w-4/5 rounded"></div>
		<div class="skeleton-bone h-2.5 w-3/5 rounded"></div>
	</div>
</div>
