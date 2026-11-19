# web

One local web server for module pages. Modules register routes; web serves them on a single port that is reachable only from your machine.

## Commands
| Command | What it does |
|---|---|
| `web status` | Shows the server state, its address and the registered routes |

The server starts when the yena app opens (the command runs once at UI start) and never in a headless run. See `help web`.

## Environment
| Variable | Meaning |
|---|---|
| `YENA_WEB_PORT` | Port of the server, 1024 to 65535 (default 7300). Set it before `./yena rebuild`: compose publishes the same port on the host's `127.0.0.1`. An invalid value is reported by `web status` and nothing listens. |

## Routes API
A module registers pages through web's public entry `src/public.ts` (through its own adapter `src/deps/web.ts`):

```ts
const off = registerRoute({module: 'demo', endpoint: 'page', methods: ['GET'], handle: req => ({status: 200, type: 'text/html; charset=utf-8', body: '<p>Hi</p>'})});
```

- A route is `/<module>/<endpoint>`; `endpoint` has 1 to 8 segments, each 1 to 64 characters of `[a-z0-9._-]` that start with a letter or digit. A `prefix` route also takes deeper paths; the remainder arrives as `req.rest`.
- Methods are `GET` and `POST`. Everything else (`OPTIONS` included) is answered 405 with no CORS headers.
- `maxBodyBytes` is at most 1 MiB (`MAX_BODY_BYTES`, default 64 KiB). A larger body is answered 413.
- At most 64 routes; a duplicate module and endpoint is refused. `registerRoute` returns an idempotent unregister function.
- `webBaseUrl()` gives `http://127.0.0.1:<port>`; `webStatus()` the server state; `webRoutes()` the registered routes.
- A handler that throws is answered 500 `Internal error` (the error text is only logged). A status outside 100 to 599 is also 500.
- Every response carries fixed security headers (`nosniff`, `no-referrer`, `no-store`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, a strict `Content-Security-Policy` without inline scripts). They win over a handler's own headers; `Access-Control-*` headers from handlers are dropped, and so are their `Content-Length`, `Content-Type`, `Transfer-Encoding` and `Connection` (the content type goes in `type`).

## Data
None.

## Events
None.

## Dependencies
`core` (the text kit, for the command's output).

## Limits and known risks
- There is no access protection yet (SEC-15): every route answers any request that reaches the port. Compose publishes the port on the host's loopback only, but other programs on your machine can still reach it.
- Inside the container the server binds all interfaces (`0.0.0.0`) so the published port works; do not publish it differently in `compose.yaml`.
- URLs over 2048 characters, encoded slashes or `..` segments, more than 32 query keys, more than 64 connections and slow requests (15 s) are refused.
- When the port is busy the server retries every 30 s and `web status` says so.

## Development
`dev check web` (run inside the yena tree; `tsc` and `tsx` come from `/app/node_modules`).
