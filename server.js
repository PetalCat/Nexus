// server.js — Node HTTP server that wraps the built SvelteKit handler and
// attaches the WebSocket upgrade handler for /api/ws.
//
// adapter-node's default entry (build/index.js) would work fine on its own
// but doesn't expose the http.Server instance, so we couldn't attach a WS
// upgrade listener. This wrapper:
//   1. Imports the SvelteKit request handler (build/handler.js).
//   2. Imports the SvelteKit server bundle for side-effects — hooks.server.ts
//      imports $lib/server/ws at module scope, and ws.ts registers
//      `globalThis.__nexusAttachWs` when loaded.
//   3. Creates an http.Server wrapping the handler.
//   4. Invokes the registered attach function with the server reference.
//
// The WS code itself still lives in src/lib/server/ws.ts. Broadcast helpers
// (broadcastToUser, broadcastToFriends, etc.) keep the same in-process
// connectedUsers map, so everywhere in SvelteKit that calls them goes to the
// same WebSocketServer instance this file attached.

import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import './build/server/index.js';

const PORT = Number(process.env.PORT ?? 8585);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createServer(handler);

const attachWs = globalThis.__nexusAttachWs;
if (typeof attachWs === 'function') {
	attachWs(server);
	console.log('[ws] attached to http server on /api/ws');
} else {
	console.warn('[ws] globalThis.__nexusAttachWs not registered — WS disabled');
}

server.listen(PORT, HOST, () => {
	console.log(`Listening on http://${HOST}:${PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
	process.on(sig, () => {
		console.log(`[${sig}] shutting down`);
		server.close(() => process.exit(0));
		// Force-kill after 10 s if anything's hanging.
		setTimeout(() => process.exit(1), 10_000).unref();
	});
}
