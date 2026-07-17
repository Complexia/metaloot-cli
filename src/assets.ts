import { parseArgs } from "node:util";
import { basename, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadCredentials } from "./config.js";
import { bold, dim, endProgress, fail, progress, step, success } from "./ui.js";

type PipelineStatus = "queued" | "running" | "success" | "failed";

type Asset = {
  id: string; name: string; slug: string; status: string; progress: number;
  visibility: string; category: string; kind?: string; modelFormat?: string; modelUrl?: string;
  fileFormat?: string; fileName?: string; fileCount?: number; hostedFileCount?: number;
  manifestUrl?: string; collection?: string; creator?: string; license?: string;
  sourceModelUrl?: string; lodModelUrl?: string;
  lodStatus?: PipelineStatus | null;
  rigStatus?: PipelineStatus | null;
  animations?: { [preset: string]: { status: PipelineStatus; url?: string } };
};

type PackFile = { path: string; bytes: number; contentType: string; sha256: string };
type PackManifest = {
  id: string; slug: string; name: string; creator: string; license: string;
  archive: { url: string; bytes: number; sha256: string };
  files: PackFile[];
};

function studioOrigin(): string {
  return (process.env.METALOOT_STUDIO_ORIGIN ?? "https://studio.metaloot.app").replace(/\/+$/, "");
}

function token(required = true): string | undefined {
  const value = loadCredentials()?.token;
  // Local studio dev servers fall back to a dev user, so requests work
  // without credentials — only hard-require a token for remote origins.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(studioOrigin());
  if (!value && required && !local) fail("Sign in first with `metaloot login`.");
  return value;
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const bearer = token(auth);
  const response = await fetch(new URL(path, studioOrigin()), {
    ...init,
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("Image is too large for upload. Resize/compress it (JPEG under ~1 MB works well) or pass a public URL via --image https://…");
    }
    throw new Error(body.error || `Studio request failed (${response.status}).`);
  }
  return body as T;
}

function animationSummary(asset: Asset): string {
  const entries = Object.entries(asset.animations ?? {});
  if (!entries.length) {
    return asset.rigStatus === "failed" ? " · rig failed"
      : asset.rigStatus ? ` · rigging ${asset.rigStatus}` : "";
  }
  const parts = entries.map(([preset, animation]) =>
    animation.status === "success" ? preset
      : animation.status === "failed" ? `${preset}✗`
        : `${preset}…`);
  const prefix = asset.rigStatus && asset.rigStatus !== "success" ? `rig ${asset.rigStatus}; ` : "";
  return ` · anim: ${prefix}${parts.join(" ")}`;
}

function printAssets(assets: Asset[]): void {
  if (!assets.length) { console.log(dim("No assets found.")); return; }
  for (const asset of assets) {
    const state = asset.status === "success" ? asset.fileFormat?.toUpperCase() ?? asset.modelFormat?.toUpperCase() ?? "READY"
      : `${asset.status.toUpperCase()} ${asset.progress ? `${asset.progress}%` : ""}`;
    const lod = asset.lodStatus === "success" ? " · game-ready"
      : asset.lodStatus === "queued" || asset.lodStatus === "running" ? " · optimizing…" : "";
    const files = asset.hostedFileCount ? ` · ${asset.hostedFileCount.toLocaleString()} hosted files`
      : asset.fileCount && asset.fileCount > 1 ? ` · ${asset.fileCount.toLocaleString()} assets` : "";
    console.log(`${bold(asset.name)}  ${dim(asset.id)}\n  ${asset.category} · ${asset.visibility} · ${state}${files}${lod}${animationSummary(asset)}`);
  }
}

async function waitForAsset(id: string): Promise<Asset> {
  for (;;) {
    const { asset } = await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}?refresh=1`);
    progress(`${asset.name}: ${asset.status} ${asset.progress}%`);
    if (["success", "failed", "cancelled"].includes(asset.status)) {
      endProgress();
      if (asset.status !== "success") fail(`${asset.name} ${asset.status}.`);
      return asset;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

/** Polls until every requested preset (or all known presets) is terminal. */
async function waitForAnimations(id: string, presets?: string[]): Promise<Asset> {
  for (;;) {
    const { asset } = await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}?refresh=1`);
    const states = asset.animations ?? {};
    const watched = presets?.length ? presets : Object.keys(states);
    const line = watched.map((preset) => `${preset}:${states[preset]?.status ?? "queued"}`).join(" ");
    progress(`${asset.name}: rig ${asset.rigStatus ?? "queued"} · ${line}`);
    const settled = asset.rigStatus === "failed" ||
      (watched.length > 0 && watched.every((preset) =>
        states[preset]?.status === "success" || states[preset]?.status === "failed"));
    if (settled) {
      endProgress();
      return asset;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

async function downloadAsset(id: string, directory?: string, variant?: string, packPath?: string): Promise<void> {
  const bearer = token(false);
  // refresh=1 also nudges any pending game-ready (LOD) conversion along.
  const detail = await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}?refresh=1`, {}, false);
  if (detail.asset.status !== "success") fail("Asset is not ready to download.");
  const isModel = detail.asset.kind === "model3d" && !detail.asset.manifestUrl;
  // Generated models retain source/lod variants. Catalog packs use an
  // optional manifest-relative path, or return their hosted ZIP by default.
  const chosen = variant ?? "source";
  if (variant && !isModel) fail("--variant is only available for individual 3D models; use --path for a pack file.");
  if (isModel && !["source", "lod", "auto"].includes(chosen)) fail("--variant must be source, lod, or auto.");
  const fileUrl = new URL(`/api/assets/${encodeURIComponent(id)}/file`, studioOrigin());
  if (isModel) fileUrl.searchParams.set("variant", chosen);
  if (packPath) fileUrl.searchParams.set("path", packPath);
  const response = await fetch(fileUrl, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  if (response.status === 404 && isModel && chosen === "lod") {
    fail("Game-ready variant is not ready yet — try again shortly, or download the source variant.");
  }
  if (!response.ok) fail(`Download failed (${response.status}).`);
  const outDir = directory ?? "assets/metaloot";
  mkdirSync(outDir, { recursive: true });
  const suffix = response.headers.get("x-metaloot-variant") === "lod" ? ".lod" : "";
  const filename = packPath ? basename(packPath)
    : isModel ? `${detail.asset.slug}${suffix}.glb`
      : detail.asset.fileName ?? `${detail.asset.slug}.${detail.asset.fileFormat ?? "bin"}`;
  const path = join(outDir, filename);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  success(`Downloaded ${bold(detail.asset.name)} to ${path}`);
}

async function getPackManifest(id: string): Promise<PackManifest> {
  return request<PackManifest>(`/api/assets/${encodeURIComponent(id)}/manifest`, {}, false);
}

function printPackFiles(manifest: PackManifest): void {
  console.log(`${bold(manifest.name)} · ${manifest.files.length.toLocaleString()} hosted files · ${manifest.license}\n`);
  for (const file of manifest.files) {
    console.log(`${file.path}\n  ${dim(`${file.contentType} · ${formatBytes(file.bytes)} · sha256:${file.sha256.slice(0, 12)}…`)}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function updateAsset(id: string, patch: Record<string, unknown>, json?: boolean): Promise<void> {
  const result = await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  success(`Updated ${bold(result.asset.name)} · ${result.asset.visibility}.`);
  if (json) console.log(JSON.stringify(result, null, 2));
}

export async function assetsCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      name: { type: "string" }, prompt: { type: "string" }, image: { type: "string" },
      visibility: { type: "string" }, category: { type: "string" }, provider: { type: "string" },
      kind: { type: "string" },
      help: { type: "boolean", short: "h" },
      wait: { type: "boolean" }, json: { type: "boolean" }, dir: { type: "string" },
      "face-limit": { type: "string" }, quality: { type: "string" },
      description: { type: "string" }, variant: { type: "string" },
      path: { type: "string" },
      presets: { type: "string" },
    },
    allowPositionals: true,
  });
  const command = values.help ? "help" : positionals[0] ?? "help";

  if (command === "explore" || command === "list") {
    const scope = command === "explore" ? "public" : "private";
    if (values.kind && !["model3d", "image", "video", "audio", "sprite", "texture", "animation"].includes(values.kind)) {
      fail("--kind must be model3d, image, video, audio, sprite, texture, or animation.");
    }
    const params = new URLSearchParams({ scope });
    if (values.category) params.set("category", values.category);
    if (values.kind) params.set("kind", values.kind);
    const result = await request<{ assets: Asset[] }>(`/api/assets?${params}`, {}, command !== "explore");
    if (values.json) console.log(JSON.stringify(result, null, 2)); else printAssets(result.assets);
    return;
  }

  if (command === "files" || command === "manifest") {
    const id = positionals[1];
    if (!id) fail("Usage: metaloot assets files <pack-id> [--json]");
    const manifest = await getPackManifest(id);
    if (values.json) console.log(JSON.stringify(manifest, null, 2)); else printPackFiles(manifest);
    return;
  }

  if (command === "generate") {
    if (!values.name) fail("--name is required.");
    if (!values.image && !values.prompt) fail("Provide --image <file> or --prompt <text>.");
    if (values.quality && !["draft", "standard", "hd"].includes(values.quality)) {
      fail("--quality must be draft, standard, or hd.");
    }
    step(`Starting ${values.image ? "image-to-3D" : "text-to-3D"} generation…`);
    const faceLimit = values["face-limit"] ? Number(values["face-limit"]) : undefined;
    let response: { asset: Asset };
    if (values.image && /^https?:\/\//.test(values.image)) {
      response = await request("/api/generations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, imageUrl: values.image, prompt: values.prompt,
          visibility: values.visibility ?? "private", category: values.category ?? "Characters",
          provider: values.provider ?? "tripo", faceLimit, quality: values.quality }),
      });
    } else if (values.image) {
      const file = readFileSync(values.image);
      const MIME: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
      };
      const extension = values.image.split(".").pop()?.toLowerCase() ?? "";
      const form = new FormData();
      form.set("name", values.name);
      form.set("image", new Blob([file], { type: MIME[extension] ?? "application/octet-stream" }), basename(values.image));
      if (values.prompt) form.set("prompt", values.prompt);
      form.set("visibility", values.visibility ?? "private"); form.set("category", values.category ?? "Characters");
      form.set("provider", values.provider ?? "tripo");
      if (faceLimit) form.set("faceLimit", String(faceLimit));
      if (values.quality) form.set("quality", values.quality);
      response = await request("/api/generations", { method: "POST", body: form });
    } else {
      response = await request("/api/generations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, prompt: values.prompt,
          visibility: values.visibility ?? "private", category: values.category ?? "Characters",
          provider: values.provider ?? "tripo", operation: "text_to_model",
          faceLimit, quality: values.quality }),
      });
    }
    success(`Queued ${bold(response.asset.name)} · ${response.asset.id}`);
    const finished = values.wait ? await waitForAsset(response.asset.id) : response.asset;
    if (values.wait) success(`${bold(finished.name)} is ready.`);
    if (values.json) console.log(JSON.stringify({ asset: finished }, null, 2));
    return;
  }

  if (command === "status") {
    const id = positionals[1];
    if (!id) fail("Usage: metaloot assets status <asset-id>");
    const result = values.wait ? { asset: await waitForAsset(id) }
      : await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}?refresh=1`);
    if (values.json) console.log(JSON.stringify(result, null, 2)); else printAssets([result.asset]);
    return;
  }

  if (command === "rig" || command === "animate") {
    const id = positionals[1];
    if (!id) fail("Usage: metaloot assets rig <asset-id> [--presets idle,walk,run] [--wait] [--json]");
    const presets = values.presets
      ? values.presets.split(",").map((preset) => preset.trim().toLowerCase()).filter(Boolean)
      : undefined;
    step("Queueing rig + animation variants…");
    const queued = await request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}/animate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(presets ? { presets } : {}),
    });
    const requested = presets ?? Object.keys(queued.asset.animations ?? {});
    success(`Animating ${bold(queued.asset.name)} · ${requested.join(", ")}`);
    let asset = queued.asset;
    if (values.wait) {
      asset = await waitForAnimations(id, requested);
      const done = requested.filter((preset) => asset.animations?.[preset]?.status === "success");
      const failed = requested.filter((preset) => asset.animations?.[preset]?.status !== "success");
      if (failed.length) {
        if (values.json) console.log(JSON.stringify({ asset }, null, 2));
        fail(`Animations failed for: ${failed.join(", ")}${done.length ? ` (ready: ${done.join(", ")})` : ""}`);
      }
      success(`${bold(asset.name)} animations ready: ${done.join(", ")}.`);
    }
    if (values.json) console.log(JSON.stringify({ asset }, null, 2));
    return;
  }

  if (command === "download") {
    const id = positionals[1];
    if (!id) fail("Usage: metaloot assets download <asset-id> [--path <pack-file>] [--dir <folder>] [--variant source|lod]");
    await downloadAsset(id, values.dir, values.variant, values.path);
    return;
  }

  if (command === "publish" || command === "unpublish") {
    const id = positionals[1];
    if (!id) fail(`Usage: metaloot assets ${command} <asset-id>`);
    await updateAsset(id, { visibility: command === "publish" ? "public" : "private" }, values.json);
    return;
  }

  if (command === "update") {
    const id = positionals[1];
    if (!id) fail("Usage: metaloot assets update <asset-id> [--visibility public|private] [--name <n>] [--description <d>] [--category <c>]");
    const patch: Record<string, unknown> = {};
    if (values.visibility) {
      if (!["public", "private"].includes(values.visibility)) fail("--visibility must be public or private.");
      patch.visibility = values.visibility;
    }
    if (values.name) patch.name = values.name;
    if (values.description !== undefined) patch.description = values.description;
    if (values.category) patch.category = values.category;
    if (!Object.keys(patch).length) fail("Nothing to update — pass --visibility, --name, --description, or --category.");
    await updateAsset(id, patch, values.json);
    return;
  }

  console.log(`${bold("metaloot assets")} — generate and manage game assets\n\n` +
    `  metaloot assets explore [--category <c>] [--kind model3d|image|video|audio|sprite|texture|animation] [--json]\n` +
    `  metaloot assets list [--category <c>] [--kind model3d|image|video|audio|sprite|texture|animation] [--json]\n` +
    `  metaloot assets files <pack-id> [--json]   (list every hosted file and SHA-256)\n` +
    `  metaloot assets generate --name <name> (--image <file|url> | --prompt <text>) [--quality draft|standard|hd] [--face-limit <n>] [--visibility public|private] [--wait]\n` +
    `  metaloot assets status <asset-id> [--wait] [--json]\n  metaloot assets download <asset-id> [--path <pack-file>] [--dir <folder>] [--variant source|lod]\n` +
    `  metaloot assets rig <asset-id> [--presets idle,walk,run] [--wait] [--json]   (rig + retarget animation clips)\n` +
    `  metaloot assets publish <asset-id>   (feature on Explore)\n  metaloot assets unpublish <asset-id>\n` +
    `  metaloot assets update <asset-id> [--visibility public|private] [--name <n>] [--description <d>] [--category <c>]\n\n` +
    `${dim("Set METALOOT_STUDIO_ORIGIN=http://localhost:3001 for local development.")}`);
}
