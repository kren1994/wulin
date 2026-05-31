# WebSocket migration guide (Cloudflare Durable Objects)

This project now uses a Peer-compatible adapter over WebSocket.
The gameplay/state logic in index.html remains unchanged.

## What was added

- Client adapter: peer-over-ws.js
- Client endpoint config: ws-config.js
- Worker server: ws-worker/src/index.js
- Worker config: ws-worker/wrangler.toml
- Deploy workflow: .github/workflows/deploy-worker.yml

## Protocol overview

Client opens websocket to /ws-peer?room=<roomId> and exchanges JSON messages:

- peer-open / peer-opened / peer-error
- connect-request / incoming-connection / connect-opened / connect-rejected
- connection-data
- connection-close

The adapter exposes a Peer-like API used by index.html:

- new Peer(peerId?, { roomId })
- peer.on('open'|'connection'|'error', ...)
- peer.connect(targetPeerId, { metadata })
- peer.destroy()
- connection.on('open'|'data'|'close'|'error', ...)
- connection.send(...)
- connection.close()

## Local development

1. Install dependencies

   cd ws-worker
   npm install

2. Run worker locally

   npx wrangler dev

3. Set endpoint in ws-config.js:

   DEFAULT_WORKER_ENDPOINT = 'ws://127.0.0.1:8787/ws-peer'

You can also override from URL query while testing:

   ?wsEndpoint=ws://127.0.0.1:8787/ws-peer

This value is cached in localStorage (key: playren:ws-endpoint).

If endpoint is not configured, the adapter falls back to same-origin /ws-peer.

## Production deployment

1. In Cloudflare dashboard, create API token for Workers deploy.
2. Add GitHub secret: CLOUDFLARE_API_TOKEN
3. Push to main or trigger workflow manually.
4. Confirm worker URL is reachable:

   https://<your-worker-subdomain>.workers.dev/healthz

5. Configure frontend endpoint in ws-config.js:

   DEFAULT_WORKER_ENDPOINT = 'wss://<your-worker-subdomain>.workers.dev/ws-peer'

## Notes

- This migration replaces transport from PeerJS to WebSocket relay.
- Existing game authority flow is preserved in current client logic.
- A later phase can move full game authority to server if needed.
