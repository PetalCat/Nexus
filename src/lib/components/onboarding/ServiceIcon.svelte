<script lang="ts">
	interface Props {
		type: string;
		size?: number;
	}

	let { type, size = 24 }: Props = $props();
</script>

{#if type === 'jellyfin'}
	<svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor">
		<path d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256 256-114.6 256-256S397.4 0 256 0zm0 472c-119.1 0-216-96.9-216-216S136.9 40 256 40s216 96.9 216 216-96.9 216-216 216z" opacity="0.3"/>
		<path d="M256 80c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176S353.2 80 256 80zm-60 248c-22.1 0-40-17.9-40-40s17.9-40 40-40 40 17.9 40 40-17.9 40-40 40zm120 0c-22.1 0-40-17.9-40-40s17.9-40 40-40 40 17.9 40 40-17.9 40-40 40z"/>
	</svg>
{:else if type === 'plex'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M11.643 0H4.68l7.679 12L4.68 24h6.963l7.677-12z"/>
	</svg>
{:else if type === 'radarr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
	</svg>
{:else if type === 'sonarr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
	</svg>
{:else if type === 'lidarr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
	</svg>
{:else if type === 'overseerr' || type === 'seerr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
	</svg>
{:else if type === 'bazarr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12zM7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
	</svg>
{:else if type === 'streamystats'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/>
	</svg>
{:else if type === 'invidious'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
	</svg>
{:else if type === 'romm'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
	</svg>
{:else if type === 'calibre'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
	</svg>
{:else if type === 'prowlarr'}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
	</svg>
{:else}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
		<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/>
	</svg>
{/if}
