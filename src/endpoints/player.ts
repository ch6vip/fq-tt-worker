// Player — static HTML page that auto-loads a video via /api/?api=video.
// Mirrors final_php/PlayerEndpoint.php (75 lines, no upstream call).

import { badRequest } from './base.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

export function handlePlayer(req: Request): Response {
  const u = new URL(req.url);
  const itemId = u.searchParams.get('item_id') ?? u.searchParams.get('item_ids');
  const bookId = u.searchParams.get('book_id') ?? u.searchParams.get('fq_id');
  if (!itemId && !bookId) return badRequest('item_id or book_id is required');

  const itemJson = JSON.stringify(itemId);
  const bookJson = JSON.stringify(bookId);

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Player</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:system-ui;overflow:hidden}
.player-container{width:100vw;height:100vh;position:relative}
video{width:100%;height:100%;object-fit:contain}
.controls{position:absolute;bottom:0;left:0;right:0;padding:16px;background:linear-gradient(transparent,rgba(0,0,0,.8))}
.progress{width:100%;height:4px;background:rgba(255,255,255,.3);border-radius:2px;cursor:pointer}
.progress-bar{height:100%;background:#fff;border-radius:2px;width:0}
.speed-btn{background:rgba(255,255,255,.2);border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer}
</style>
</head><body>
<div class="player-container">
<video id="player" playsinline></video>
<div class="controls" id="controls">
<div class="progress" id="progressBar"><div class="progress-bar" id="progressFill"></div></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
<span id="timeDisplay">0:00 / 0:00</span>
<button class="speed-btn" id="speedBtn">1.0x</button>
</div>
</div>
</div>
<script>
const itemId = ${escapeHtml(itemJson)};
const bookId = ${escapeHtml(bookJson)};
const player = document.getElementById('player');
const speeds = [1.0, 1.25, 1.5, 2.0];
let speedIdx = 0;
document.getElementById('speedBtn').onclick = () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    player.playbackRate = speeds[speedIdx];
    document.getElementById('speedBtn').textContent = speeds[speedIdx] + 'x';
};
async function loadVideo(vid) {
    const resp = await fetch('/api/?api=video&video_id=' + vid);
    const data = await resp.json();
    if (data.success && data.data && data.data.urls) {
        const urls = Object.values(data.data.urls);
        if (urls.length) player.src = urls[0];
        player.play();
    }
}
if (itemId) loadVideo(itemId);
</script>
</body></html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
