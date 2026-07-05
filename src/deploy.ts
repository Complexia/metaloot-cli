import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, relative, sep } from "node:path";
import { finalizeDeploy, startDeploy } from "./api.js";
import {
  loadCredentials,
  loadProjectConfig,
  saveProjectConfig,
} from "./config.js";
import {
  bold,
  cyan,
  dim,
  endProgress,
  fail,
  progress,
  step,
  success,
  warn,
} from "./ui.js";

const UPLOAD_CONCURRENCY = 8;
const UPLOAD_RETRIES = 3;
const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"]);

export type DeployArgs = {
  name?: string;
  dir?: string;
  noBuild?: boolean;
};

type PackageJson = {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
};

function readPackageJson(cwd: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    return "bun";
  }
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function runBuild(cwd: string, pkg: PackageJson | null): void {
  if (!pkg?.scripts?.build) {
    warn("No build script found in package.json; deploying files as-is.");
    return;
  }

  const pm = detectPackageManager(cwd);
  step(`Building with ${bold(`${pm} run build`)}…`);
  const result = spawnSync(pm, ["run", "build"], {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    fail(`Could not run ${pm}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail("Build failed. Fix the errors above and run `metaloot deploy` again.");
  }
}

function resolveOutputDir(cwd: string, args: DeployArgs, configured?: string): string {
  const candidates = [args.dir, configured, "dist", "build"].filter(
    (dir): dir is string => Boolean(dir)
  );
  for (const candidate of candidates) {
    const path = join(cwd, candidate);
    if (existsSync(join(path, "index.html"))) return path;
  }
  if (existsSync(join(cwd, "index.html"))) {
    fail(
      "No build output found. Found an index.html in the project root — if this is a static site with no build step, run `metaloot deploy --dir .`"
    );
  }
  fail(
    "No build output with an index.html found (looked in dist/ and build/). Run your build first or pass --dir <folder>."
  );
}

function collectFiles(root: string): { path: string; size: number }[] {
  const files: { path: string; size: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
        files.push({
          path: relative(root, full).split(sep).join("/"),
          size: statSync(full).size,
        });
      }
    }
  };
  walk(root);
  return files;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadFiles(
  outDir: string,
  uploads: { path: string; uploadUrl: string }[]
): Promise<void> {
  let completed = 0;
  let failed: string | null = null;
  const queue = [...uploads];

  async function uploadOne(item: { path: string; uploadUrl: string }) {
    const body = await readFile(join(outDir, item.path));
    for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt += 1) {
      const response = await fetch(item.uploadUrl, {
        method: "PUT",
        body: new Uint8Array(body),
        headers: { "Content-Type": "application/octet-stream" },
      }).catch(() => null);
      if (response?.ok) return;
      if (attempt === UPLOAD_RETRIES) {
        throw new Error(
          `Upload failed for ${item.path}${
            response ? ` (${response.status})` : ""
          }`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  const workers = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0 && !failed) {
        const item = queue.shift()!;
        try {
          await uploadOne(item);
          completed += 1;
          progress(`Uploading ${completed}/${uploads.length} files…`);
        } catch (error) {
          failed = error instanceof Error ? error.message : String(error);
        }
      }
    }
  );

  await Promise.all(workers);
  endProgress();
  if (failed) fail(failed);
}

export async function deploy(args: DeployArgs): Promise<void> {
  const credentials = loadCredentials();
  if (!credentials) {
    fail("Not signed in. Run `metaloot login` first.");
  }

  const cwd = process.cwd();
  const pkg = readPackageJson(cwd);
  const projectConfig = loadProjectConfig(cwd);

  const name =
    args.name ??
    projectConfig.name ??
    pkg?.name?.replace(/^@[^/]+\//, "") ??
    basename(cwd);

  if (!args.noBuild) {
    runBuild(cwd, pkg);
  }

  const outDir = resolveOutputDir(cwd, args, projectConfig.outDir);
  const files = collectFiles(outDir);
  if (files.length === 0) {
    fail(`No files found in ${outDir}.`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  step(
    `Deploying ${bold(name)} ${dim(
      `(${files.length} files, ${formatBytes(totalBytes)})`
    )}`
  );

  const started = await startDeploy(credentials.token, {
    name,
    slug: projectConfig.slug,
    gameId: projectConfig.gameId,
    description: pkg?.description,
    files,
  });

  await uploadFiles(outDir, started.uploads);
  success(`Uploaded ${started.uploads.length} files.`);

  const finalized = await finalizeDeploy(credentials.token, started.deployId);

  saveProjectConfig(cwd, {
    ...projectConfig,
    gameId: finalized.gameId,
    slug: finalized.slug,
    name,
    ...(args.dir ? { outDir: args.dir } : {}),
  });

  console.log("");
  success(`${bold(finalized.title)} is live!`);
  console.log("");
  console.log(`  ${cyan("Play it:")}      ${bold(finalized.url)}`);
  console.log(`  ${cyan("Metaloot page:")} ${finalized.playUrl}`);
  console.log(`  ${cyan("Manage:")}       ${finalized.manageUrl}`);
  console.log("");
  console.log(
    dim(
      "Metaloot sign-in is provisioned for this game — players can log in at /auth/metaloot/start. Add a description and screenshots from the manage page."
    )
  );
}
