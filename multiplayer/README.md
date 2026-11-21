# KARTSWAR multiplayer server

The Next.js app is the game client. Real network rooms run in the separate Colyseus server process; a Next.js/Vercel function is not used as a WebSocket server.

## Local development

Use Node.js 22 or newer. In one terminal, run:

```sh
npm run multiplayer:dev
```

In another terminal, run:

```sh
npm run dev
```

The client defaults to `http://localhost:2567`. Set `NEXT_PUBLIC_MULTIPLAYER_URL` to the multiplayer server's HTTP(S) URL when the server runs elsewhere. The Colyseus client upgrades the connection to WebSockets.

Open the app in two separate browser sessions, create a private room in one, join with its code in the other, ready both players, then start from the host session. The server assigns player IDs and slots, coordinates the shared countdown and match lifecycle, and relays validated player snapshots.

## Deployment

Deploy `multiplayer/server.ts` as a persistent Node.js 22 service with WebSocket support and set its `PORT` environment variable if required by the host. Configure the deployed Next.js client with `NEXT_PUBLIC_MULTIPLAYER_URL` pointing to that service. The multiplayer service must stay available independently of the Next.js deployment.
