import { error } from '@sveltejs/kit';
import { getServiceConfig } from '$lib/server/services';
import { getUserCredentialForService } from '$lib/server/auth';
import { registry } from '$lib/adapters/registry';
import { isPlayableInBrowser, getEmulatorJSConfig } from '$lib/emulator/cores';
import type { RequestHandler } from './$types';

/**
 * Serves a self-contained HTML page with EmulatorJS.
 * Loaded inside an iframe on the /play page to avoid SPA global conflicts.
 * Communicates save/load events to the parent via postMessage.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401);

	const serviceId = url.searchParams.get('serviceId');
	if (!serviceId) throw error(400, 'serviceId required');

	const config = getServiceConfig(serviceId);
	if (!config || config.type !== 'romm') throw error(404);

	const adapter = registry.get('romm');
	if (!adapter?.getItem) throw error(501);

	const userCred = getUserCredentialForService(locals.user.id, serviceId) ?? undefined;
	const item = await adapter.getItem(config, params.id, userCred);
	if (!item) throw error(404, 'Game not found');

	const platformSlug = item.metadata?.platformSlug as string | undefined;
	if (!platformSlug || !isPlayableInBrowser(platformSlug)) {
		throw error(400, 'Platform not supported for emulation');
	}

	const romUrl = `/api/games/${params.id}/rom?serviceId=${serviceId}`;
	const ejsConfig = getEmulatorJSConfig(platformSlug, romUrl);
	if (!ejsConfig) throw error(500);

	const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  #game { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="game"></div>
<script>
  // EmulatorJS config
  EJS_player = '#game';
  EJS_core = '${ejsConfig.core}';
  EJS_gameUrl = '${ejsConfig.gameUrl}';
  EJS_pathtodata = '${ejsConfig.pathtodata}';
  EJS_color = '${ejsConfig.color}';
  EJS_startOnLoaded = true;
  EJS_oldCores = false;
  EJS_Settings = {};

  // Notify parent when save state is triggered
  EJS_onSaveState = function(args) {
    var stateBuf = (args.state instanceof ArrayBuffer) ? args.state : new Uint8Array(args.state).buffer;
    var ssBuf = args.screenshot ? ((args.screenshot instanceof ArrayBuffer) ? args.screenshot : new Uint8Array(args.screenshot).buffer) : null;
    var transferable = [stateBuf];
    if (ssBuf) transferable.push(ssBuf);
    parent.postMessage({
      type: 'ejs:saveState',
      state: stateBuf,
      screenshot: ssBuf
    }, '*', transferable);
  };

  // Notify parent when load state is triggered
  EJS_onLoadState = function() {
    if (EJS_emulator) EJS_emulator.pause();
    parent.postMessage({ type: 'ejs:requestLoadState' }, '*');
  };

  // Notify parent when SRAM save changes (EJS_onSaveSave for newer EmulatorJS)
  EJS_onSaveSave = function(args) {
    var saveBuf = (args.save instanceof ArrayBuffer) ? args.save : new Uint8Array(args.save).buffer;
    var ssBuf = args.screenshot ? ((args.screenshot instanceof ArrayBuffer) ? args.screenshot : new Uint8Array(args.screenshot).buffer) : null;
    var transferable = [saveBuf];
    if (ssBuf) transferable.push(ssBuf);
    parent.postMessage({
      type: 'ejs:saveSRAM',
      save: saveBuf,
      screenshot: ssBuf
    }, '*', transferable);
  };
  // Fallback for older EmulatorJS versions
  EJS_onSaveUpdate = EJS_onSaveSave;

  EJS_onGameStart = function() {
    parent.postMessage({ type: 'ejs:gameStarted' }, '*');
  };

  // Listen for commands from parent
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'ejs:loadState' && EJS_emulator) {
      var stateData = e.data.state instanceof ArrayBuffer
        ? new Uint8Array(e.data.state)
        : new Uint8Array(e.data.state);
      EJS_emulator.gameManager.loadState(stateData);
      EJS_emulator.play();
    }
    if (e.data.type === 'ejs:loadSave' && EJS_emulator) {
      var saveData = e.data.save instanceof ArrayBuffer
        ? new Uint8Array(e.data.save)
        : new Uint8Array(e.data.save);
      var FS = EJS_emulator.gameManager.FS;
      var savePath = EJS_emulator.gameManager.getSaveFilePath();
      var parts = savePath.split('/');
      var cp = '';
      for (var i = 0; i < parts.length - 1; i++) {
        if (parts[i] === '') continue;
        cp += '/' + parts[i];
        if (!FS.analyzePath(cp).exists) FS.mkdir(cp);
      }
      if (FS.analyzePath(savePath).exists) FS.unlink(savePath);
      FS.writeFile(savePath, saveData);
      EJS_emulator.gameManager.loadSaveFiles();
      EJS_emulator.play();
    }
    if (e.data.type === 'ejs:requestSaveState' && EJS_emulator) {
      // Programmatic quick save — trigger the save state pipeline
      try {
        var gm = EJS_emulator.gameManager;
        var state = gm.getState ? gm.getState() : null;
        var ss = gm.screenshot ? gm.screenshot() : null;
        if (state) {
          var sBuf = (state instanceof ArrayBuffer) ? state : new Uint8Array(state).buffer;
          var ssBuf = ss ? ((ss instanceof ArrayBuffer) ? ss : new Uint8Array(ss).buffer) : null;
          var xfer = [sBuf];
          if (ssBuf) xfer.push(ssBuf);
          parent.postMessage({ type: 'ejs:saveState', state: sBuf, screenshot: ssBuf }, '*', xfer);
        }
      } catch(err) { console.warn('Quick save failed:', err); }
    }
    if (e.data.type === 'ejs:pause' && EJS_emulator) {
      EJS_emulator.pause();
    }
    if (e.data.type === 'ejs:play' && EJS_emulator) {
      EJS_emulator.play();
    }
  });
<\/script>
<script src="https://cdn.emulatorjs.org/stable/data/loader.js"><\/script>
</body>
</html>`;

	return new Response(html, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-cache'
		}
	});
};
