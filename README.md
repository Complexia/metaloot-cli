# Metaloot CLI

Publish browser games to [Metaloot](https://metaloot.app) from your terminal.

```bash
npm install -g @metaloot/cli

metaloot login    # opens your browser to sign in
metaloot deploy   # builds and publishes the game in the current folder
```

That's it. `metaloot deploy` builds your game, uploads it, and prints a live
link like `https://your-game.metaloot.app`. The game is playable immediately —
including **Sign in with Metaloot** and **multiplayer rooms**, both
provisioned automatically. Add a description, screenshots, and tags later
from your game's page on [metaloot.app](https://metaloot.app).

The CLI also talks to **Metaloot Studio**
([studio.metaloot.app](https://studio.metaloot.app)), which turns images or
text prompts into game-ready 3D models (GLB) — see
[`metaloot assets`](#metaloot-assets--generate-3d-models) below.

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
  5. Provisions multiplayer: realtime rooms for signed-in players at
     `wss://<name>.metaloot.app/mp/rooms/<roomId>`, ready whenever you want
     to add them (see below).
- A `metaloot.json` file is written next to your `package.json` so future
  deploys update the same game. Commit it.

## Commands

| Command | Description |
| --- | --- |
| `metaloot login` | Sign in to Metaloot via the browser. `--token <t>` for manual/CI setup. |
| `metaloot logout` | Sign out and revoke this machine's token. |
| `metaloot whoami` | Show the signed-in account. |
| `metaloot deploy` | Build and publish the current folder's game. |
| `metaloot assets generate` | Generate a 3D model (GLB) from an image or a text prompt. |
| `metaloot assets list` | List your own (private-scope) assets. |
| `metaloot assets explore` | Browse public assets from the community gallery. |
| `metaloot assets files <id>` | List every individually hosted file in a catalog pack. |
| `metaloot assets status <id>` | Check (or `--wait` for) a generation's progress. |
| `metaloot assets rig <id>` | Rig a finished model and build animated variants (idle/walk/run…). |
| `metaloot assets download <id>` | Download a generated GLB or hosted catalog ZIP; add `--path` for one pack file. |
| `metaloot assets publish <id>` | Make an asset public — it appears on Explore and games can hot-link it. |
| `metaloot assets unpublish <id>` | Make an asset private again. |
| `metaloot assets update <id>` | Update name/description/category/visibility of an asset you created. |

### Deploy options

- `--game <game-id>` — deploy into an existing Metaloot game instead of
  creating a new one. Create the game page first at
  [metaloot.app/publish](https://metaloot.app/publish) and copy the exact
  command from the game's settings page.
- `--name <name>` — game name; defaults to `package.json` `name`, then the
  folder name. Becomes your subdomain (`my-game` → `my-game.metaloot.app`).
- `--dir <folder>` — build output folder; defaults to `dist/` or `build/`.
  Use `--dir .` for static games with an `index.html` in the project root.
- `--no-build` — deploy without running the build script.

Dotfiles (`.env`, `.git/`, …) and `node_modules/` are never uploaded, so
`--dir .` is safe for source folders. `.well-known/` is the one exception.

## `metaloot assets` — generate 3D models

Metaloot Studio generates game-ready GLB models from an image or a text
prompt (via Tripo). The same Metaloot login is used — no separate account.
Generation is **asynchronous**: `generate` queues a job and returns
immediately unless you pass `--wait`.

### `metaloot assets generate`

```bash
# Image-to-3D from a local file
metaloot assets generate --image hero.png --name "Ember Mage" --wait

# Image-to-3D from a URL (an optional --prompt guides the generation)
metaloot assets generate --image https://example.com/sword.png \
  --prompt "ornate crystal blade" --name "Moonblade" --wait

# Text-to-3D
metaloot assets generate --prompt "low-poly enchanted sword, game-ready" \
  --name "Moonblade" --visibility public --wait
```

| Flag | Description |
| --- | --- |
| `--name <name>` | **Required.** Display name of the asset. |
| `--image <file\|url>` | Source image — a local file path or an `http(s)` URL. Local files should be under ~1 MB (JPEG recommended); larger images should be passed as URLs. |
| `--prompt <text>` | Text prompt. Required if `--image` is omitted (text-to-3D); optional guidance alongside an image. |
| `--quality <q>` | `draft` (fastest/cheapest), `standard`, or `hd` (default — best geometry and detailed PBR textures). |
| `--visibility <v>` | `private` (default) or `public`. Public assets appear in `explore` and are downloadable by anyone. |
| `--category <c>` | Label for organizing assets. Default `Characters`; the studio uses `Characters`, `Creatures`, `Weapons`, `Props`, `Environment`. |
| `--provider <p>` | Generation provider. Default (and currently only) provider: `tripo`. |
| `--face-limit <n>` | Optional polygon budget. Omit to let the provider pick optimal topology; set (e.g. `8000`) for a strict game-ready budget. |
| `--wait` | Poll until the generation finishes. Exits non-zero if it fails or is cancelled. |
| `--json` | Also print the asset as JSON (the *finished* asset when combined with `--wait`). |

**Tips for great image-to-3D results:** use a single full-body subject in a
neutral pose on a clean background, with every part physically connected
(floating/detached elements and glow/particle effects get dropped during 3D
reconstruction), matte lighting, and nothing cropped out of frame.

**Game-ready LOD:** after a generation finishes, the studio automatically
produces a lighter game-ready variant (~15k faces). The hosted asset URL
(`/api/assets/<id>/file` and the `/__metaloot/assets/<id>.glb` proxy) serves
the game-ready version as soon as it's ready — games hot-linking assets get
the optimization for free. `metaloot assets download` fetches the
full-resolution source by default; pass `--variant lod` for the game-ready
file. Assets generated with an explicit `--face-limit` of 15000 or less are
already game-ready and skip the extra conversion.

Without `--wait`, `generate` prints the queued asset's id — poll it with
`metaloot assets status <id>`.

### `metaloot assets list` / `metaloot assets explore`

```bash
metaloot assets list [--category <c>] [--kind model3d|image|video|audio|sprite|texture|animation] [--json]
metaloot assets explore [--category <c>] [--kind model3d|image|video|audio|sprite|texture|animation] [--json]
```

Each entry shows the name, id, category, visibility, and status
(e.g. `GLB` when ready, or `QUEUED`/`RUNNING 45%` while generating).
`--category` performs an exact, case-insensitive category match (for example,
`--category Characters`); `--kind` selects any supported asset kind shown above.
Both filters can be combined.

### `metaloot assets files <pack-id>`

```bash
metaloot assets files kenney-interface-sounds
metaloot assets files kenney-interface-sounds --json
```

Lists every Metaloot-hosted file in a pack, including its manifest-relative
path, MIME type, byte size, and SHA-256 hash. This is the agent-friendly way to
discover a usable sprite, sound, model, or animation before downloading it.

### `metaloot assets status <asset-id>`

```bash
metaloot assets status <asset-id> [--wait] [--json]
```

Fetches the latest state from the provider. `--wait` polls every few
seconds until the generation reaches `success`, `failed`, or `cancelled`,
and exits non-zero unless it succeeded.

### `metaloot assets rig <asset-id>`

```bash
metaloot assets rig <asset-id> [--presets idle,walk,run] [--wait] [--json]
```

Rigs a finished model (auto-skeleton + skinning) and retargets preset
animation clips onto it — by default `idle`, `walk`, and `run`. Owner-only.
Each finished preset is hosted at
`/api/assets/<id>/animation/<preset>` as a GLB containing the rigged model
plus that clip; clips from sibling presets share one skeleton, so a game can
load them all into a single mixer and crossfade. `--wait` polls until every
requested preset succeeds or fails (exits non-zero on any failure).
Re-running `rig` retries failed presets and can add new ones; the rig is
built only once per asset. `status`/`list` show per-preset progress, and the
asset JSON gains `rigStatus` plus `animations: { <preset>: { status, url } }`.

### `metaloot assets download <asset-id>`

```bash
metaloot assets download <asset-id> [--dir <folder>] [--variant source|lod]
metaloot assets download <pack-id> [--path <manifest-relative-path>] [--dir <folder>]
```

Generated models download as `<slug>.glb`; catalog packs download as their
Metaloot-hosted ZIP. Pass a path returned by `metaloot assets files` to pull
one individually hosted file instead. Files are written to `--dir` (default
`assets/metaloot/`), creating the folder if needed. Private assets require you
to be signed in as the owner; public assets download without auth.

> **Tip (Vite projects):** download into `public/` (e.g.
> `--dir public/assets`) so the GLB is copied into `dist/` by your build
> and served with your deployed game.

### JSON output for scripts and agents

`generate`, `list`, `explore`, `files`, `status`, and `rig` accept `--json`. The JSON
object is printed **last** on stdout, after the human-readable status
lines, so when piping strip everything before the first `{`:

```bash
metaloot assets generate --prompt "low-poly treasure chest" \
  --name "Treasure Chest" --wait --json \
  | sed -n '/^{/,$p' > asset.json

node -p "JSON.parse(require('fs').readFileSync('asset.json','utf8')).asset.id"
```

Asset JSON includes `id`, `name`, `slug`, `status` (`queued`, `running`,
`success`, `failed`, `cancelled`), `progress` (0–100), `visibility`,
`category`, and — once finished — `modelFormat` (`glb`) and `modelUrl`.
Assets animated with `metaloot assets rig` also carry `rigStatus` and
`animations` (per-preset `status` and, once ready, a hosted GLB `url`).

### Hosted assets — `@metaloot/sdk`

**Public** assets don't have to be downloaded at all: they're hosted at a
stable URL with CORS enabled, and games deployed on Metaloot hosting get a
same-origin, edge-cached proxy at `/__metaloot/assets/<id-or-slug>.glb`. The
[`@metaloot/sdk`](https://www.npmjs.com/package/@metaloot/sdk) npm package
picks the right URL automatically (and also wraps Metaloot auth and
multiplayer with types):

```ts
import { loadAssetObjectUrl } from "@metaloot/sdk";

const url = await loadAssetObjectUrl("<asset-id-or-slug>");
new GLTFLoader().load(url, (gltf) => scene.add(gltf.scene));
```

Private assets stay private — they're only served to their owner, so
download those with `metaloot assets download` and ship the file.

## End-to-end agent workflow

A coding agent can go from nothing to a deployed game with generated 3D
assets without a browser or any human step. The only prerequisite is a
CLI token, created once at
[metaloot.app/cli/auth](https://metaloot.app/cli/auth).

```bash
# 0. Authenticate non-interactively. Either export the env var…
export METALOOT_TOKEN="mlt_…"          # used by every command, nothing stored
#    …or persist it for the machine:
# metaloot login --token "mlt_…"

metaloot whoami                        # sanity check: prints the account

# 1. Generate an asset and wait for it to finish (typically 1–3 minutes)
metaloot assets generate \
  --prompt "low-poly treasure chest, stylized, game-ready" \
  --name "Treasure Chest" \
  --wait --json | sed -n '/^{/,$p' > /tmp/asset.json

ASSET_ID=$(node -p "JSON.parse(require('fs').readFileSync('/tmp/asset.json','utf8')).asset.id")

# 2. Download the GLB into the game (Vite: public/ is copied into dist/)
metaloot assets download "$ASSET_ID" --dir public/assets
# → public/assets/treasure-chest.glb  (filename is the asset's slug)

# 3. Load it in the game, e.g. with three.js:
#    new GLTFLoader().load("/assets/treasure-chest.glb", (gltf) => scene.add(gltf.scene));

# 4. Build and deploy — prints the live https://<name>.metaloot.app URL
metaloot deploy
```

Notes for agents:

- `METALOOT_TOKEN` takes precedence over stored credentials and works for
  **all** commands (`deploy`, `assets`, `whoami`, …).
- Steps 2–3 ship the GLB with the game — always required for **private**
  assets, which are only served to their owner. **Public** assets
  (`--visibility public`) can instead be hot-linked from their hosted URL
  and skip the download entirely: use
  `/__metaloot/assets/<id-or-slug>.glb` on a deployed game (same-origin,
  edge-cached), `https://studio.metaloot.app/api/assets/<id-or-slug>/file`
  anywhere else (CORS-enabled), or let
  [`@metaloot/sdk`](https://www.npmjs.com/package/@metaloot/sdk) pick the
  right one.
- The downloaded filename is `<slug>.glb`, where `slug` comes from the
  asset JSON (`.asset.slug`).
- Every command exits non-zero on failure (including `--wait` when a
  generation fails), so plain `&&` chaining is safe.

## CI

Set `METALOOT_TOKEN` (create one at `https://metaloot.app/cli/auth`) and run
`metaloot deploy --no-build` after your own build step.

## Environment variables

| Variable | Description |
| --- | --- |
| `METALOOT_TOKEN` | Access token override for CI/agents. Takes precedence over stored credentials for every command. |
| `METALOOT_ORIGIN` | Portal origin (default `https://www.metaloot.app`). |
| `METALOOT_STUDIO_ORIGIN` | Studio origin for `assets` commands (default `https://studio.metaloot.app`). Set to `http://localhost:3001` for local studio development. |
| `METALOOT_CONFIG_DIR` | Credentials directory (default `~/.config/metaloot`). |

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

## Adding multiplayer

Every deployed game also has Metaloot's multiplayer backend provisioned:
rooms with presence, message relay, and shared room state, running on
Metaloot's edge on your game's own domain. It builds on Metaloot auth — the
session cookie authenticates the room connection, so only signed-in players
can join and every message carries a verified player identity.

There is nothing to install; your site serves the client itself:

```ts
import { joinRoom, MetalootAuthRequiredError } from "/__metaloot/multiplayer.js";

const room = await joinRoom("lobby"); // throws MetalootAuthRequiredError when signed out
room.on("join", (player) => console.log(`${player.name} joined`));
room.on("message", ({ from, data }) => handle(from, data));
room.send({ kind: "move", x: 3, y: 7 });
```

Prefer npm and TypeScript types? The same client (same wire protocol) ships
in [`@metaloot/sdk`](https://www.npmjs.com/package/@metaloot/sdk) as
`import { joinRoom } from "@metaloot/sdk/multiplayer"`.

Full API, limits, and a copy-paste agent prompt:
[metaloot.app/docs/multiplayer](https://metaloot.app/docs/multiplayer).

## Troubleshooting

- **`Sign in first with \`metaloot login\`.`** — no credentials found. Run
  `metaloot login`, or set `METALOOT_TOKEN` in non-interactive environments.
- **Generation seems stuck** — generation is asynchronous and can take a
  few minutes. Use `--wait` on `generate`/`status`, or poll
  `metaloot assets status <id>` (each call refreshes from the provider).
- **`Asset is not ready to download.`** — the generation hasn't reached
  `success` yet (or it failed). Check `metaloot assets status <id>`.
- **`No build output with an index.html found`** — run your build first,
  pass `--dir <folder>`, or use `--dir .` for a static game with a root
  `index.html`.
- **Downloaded GLB missing from the deployed site** — the file must be in
  the *deployed* folder. For Vite, download into `public/` so the build
  copies it into `dist/`; for `--dir .` static games, any non-dot folder
  works.

## Requirements

- Node.js 20+
- A game that builds to static files with an `index.html` at the root
  (any Vite project works out of the box)

## License

MIT
