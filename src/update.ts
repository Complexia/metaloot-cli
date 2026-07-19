import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";
import { bold, dim } from "./ui.js";

const REGISTRY_LATEST_URL = "https://registry.npmjs.org/@metaloot/cli/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

type UpdateCache = { latest: string; checkedAt: number };

function cachePath(): string {
  return join(configDir(), "update-check.json");
}

function readCache(): UpdateCache | null {
  try {
    const cache = JSON.parse(readFileSync(cachePath(), "utf8")) as UpdateCache;
    return typeof cache.latest === "string" &&
      typeof cache.checkedAt === "number"
      ? cache
      : null;
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(
      cachePath(),
      JSON.stringify({ latest, checkedAt: Date.now() } satisfies UpdateCache)
    );
  } catch {
    // The cache is best-effort; an unwritable disk just means more checks.
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function nudgeLine(currentVersion: string): string | null {
  const cache = readCache();
  if (!cache || !isNewer(cache.latest, currentVersion)) return null;
  return `metaloot ${currentVersion} → ${bold(cache.latest)} available: ${dim(
    "npm i -g @metaloot/cli"
  )}`;
}

let nudgeShown = false;

/**
 * Update line from the on-disk cache (never the network), or null when the
 * installed version is current or nothing is cached yet. Marks the nudge as
 * shown so the exit-time hook does not repeat it.
 */
export function cachedUpdateNudge(currentVersion: string): string | null {
  if (process.env.METALOOT_NO_UPDATE_CHECK) return null;
  const line = nudgeLine(currentVersion);
  if (line) nudgeShown = true;
  return line;
}

function scheduleNudge(currentVersion: string): void {
  const line = nudgeLine(currentVersion);
  if (!line) return;
  process.once("exit", () => {
    if (!nudgeShown) process.stderr.write(`\n${line}\n`);
  });
}

/**
 * Kicks off a background check for a newer published CLI. Never blocks the
 * running command: a fresh cache costs one file read, and a stale one starts
 * a fetch capped at 1.5 s whose failure (offline, registry down) is ignored.
 * When a newer version is known, one line is printed to stderr at exit.
 */
export function maybeCheckForUpdate(currentVersion: string): void {
  if (process.env.METALOOT_NO_UPDATE_CHECK) return;
  if (process.env.CI) return;
  if (!process.stdout.isTTY) return;

  const cache = readCache();
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    scheduleNudge(currentVersion);
    return;
  }

  void fetch(REGISTRY_LATEST_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const latest = (data as { version?: unknown } | null)?.version;
      if (typeof latest !== "string") return;
      writeCache(latest);
      scheduleNudge(currentVersion);
    })
    .catch(() => {
      // Offline or slow registry — the command must not care.
    });
}
