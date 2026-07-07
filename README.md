# Metaloot CLI

Publish browser games to [Metaloot](https://metaloot.app) from your terminal.

```bash
npm install -g @metaloot/cli

metaloot login    # opens your browser to sign in
metaloot deploy   # builds and publishes the game in the current folder
```

That's it. `metaloot deploy` builds your game, uploads it, and prints a live
link like `https://your-game.metaloot.app`. The game is playable immediately —
including **Sign in with Metaloot**, which is provisioned automatically. Add a
description, screenshots, and tags later from your game's page on
[metaloot.app](https://metaloot.app).

## How it works

- `metaloot login` opens your browser, you sign in to Metaloot, and an access
  token is handed back to the CLI (stored in `~/.config/metaloot/`).
- `metaloot deploy`:
  1. Runs your `build` script (Vite, etc. — detected via your lockfile's
     package manager). Skip with `--no-build`.
  2. Finds the build output (`dist/`, then `build/`, or `--dir <folder>`).
  3. Uploads the files to Metaloot's CDN and flips your game live at
     `https://<name>.metaloot.app`.
  4. Provisions Metaloot auth: players can sign in at
     `/auth/metaloot/start` on your game's domain — no server code needed.
- A `metaloot.json` file is written next to your `package.json` so future
  deploys update the same game. Commit it.

## Commands

| Command | Description |
| --- | --- |
| `metaloot login` | Sign in to Metaloot via the browser. `--token <t>` for manual/CI setup. |
| `metaloot logout` | Sign out and revoke this machine's token. |
| `metaloot whoami` | Show the signed-in account. |
| `metaloot deploy` | Build and publish the current folder's game. |

### Deploy options

- `--game <game-id>` — deploy into an existing Metaloot game instead of
  creating a new one. Create the game page first at
  [metaloot.app/publish](https://metaloot.app/publish) and copy the exact
  command from the game's settings page.
- `--name <name>` — game name; defaults to `package.json` `name`, then the
  folder name. Becomes your subdomain (`my-game` → `my-game.metaloot.app`).
- `--dir <folder>` — build output folder; defaults to `dist/` or `build/`.
- `--no-build` — deploy without running the build script.

### CI

Set `METALOOT_TOKEN` (create one at `https://metaloot.app/cli/auth`) and run
`metaloot deploy --no-build` after your own build step.

## Using Metaloot auth in your game

Deployed games get a "Sign in with Metaloot" button (top right) out of the
box — signed-in players see their avatar with a sign-out menu instead. You
don't have to do anything. To build your own sign-in UI instead, opt out with:

```html
<meta name="metaloot-auth-widget" content="off" />
```

A tiny API is available at `window.metaloot`:

```ts
const session = await window.metaloot.session; // { signedIn, user? }
window.metaloot.signIn();
window.metaloot.signOut();
```

Under the hood, every deployed game gets these routes on its own domain,
handled by Metaloot's edge — you don't ship any server code:

- `GET /auth/metaloot/start` — begins sign-in
- `GET /auth/metaloot/callback` — OAuth callback
- `GET /auth/metaloot/session` — returns `{ signedIn, user, ... }`
- `GET|POST /auth/metaloot/logout`

From your game code, either fetch the session directly:

```ts
const session = await fetch("/auth/metaloot/session").then((r) => r.json());
if (session.signedIn) {
  console.log(`Hello ${session.user.name}!`);
}
```

or use the drop-in widget from [`@metaloot/auth`](https://github.com/Complexia/metaloot-auth):

```ts
import { mountMetalootAuth } from "@metaloot/auth/browser";

mountMetalootAuth(document.getElementById("auth")!);
```

## Requirements

- Node.js 20+
- A game that builds to static files with an `index.html` at the root
  (any Vite project works out of the box)

## License

MIT
