export function playerErrorMessage(error: string | Error | unknown): string {
	const msg = error instanceof Error ? error.message : String(error ?? '');
	if (msg.includes('404')) return 'Stream not found. The media may have been removed.';
	if (msg.includes('403')) return 'Access denied. Try reconnecting your account.';
	if (msg.includes('timeout') || msg.includes('abort')) return 'The stream timed out. Check your connection.';
	if (msg.includes('decode') || msg.includes('codec')) return 'This format is not supported by your browser.';
	if (msg.includes('network') || msg.includes('fetch')) return 'Network error. Check your connection.';
	return 'Playback error. Try refreshing the page.';
}
