import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ORIGIN = "https://www.metaloot.app";

export function portalOrigin(): string {
  return (process.env.METALOOT_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, "");
}

export type CliUserInfo = {
  id: string;
  name: string;
  email?: string;
};

export type Credentials = {
  token: string;
  user: CliUserInfo;
};

type CredentialsFile = Record<string, Credentials>;

export function configDir(): string {
  return (
    process.env.METALOOT_CONFIG_DIR ?? join(homedir(), ".config", "metaloot")
  );
}

function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

function readCredentialsFile(): CredentialsFile {
  try {
    return JSON.parse(readFileSync(credentialsPath(), "utf8"));
  } catch {
    return {};
  }
}

export function loadCredentials(): Credentials | null {
  const token = process.env.METALOOT_TOKEN;
  if (token) {
    return { token, user: { id: "env", name: "METALOOT_TOKEN" } };
  }
  return readCredentialsFile()[portalOrigin()] ?? null;
}

export function saveCredentials(credentials: Credentials): void {
  const all = readCredentialsFile();
  all[portalOrigin()] = credentials;
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(credentialsPath(), JSON.stringify(all, null, 2), {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  const all = readCredentialsFile();
  delete all[portalOrigin()];
  if (Object.keys(all).length === 0) {
    rmSync(credentialsPath(), { force: true });
    return;
  }
  writeFileSync(credentialsPath(), JSON.stringify(all, null, 2), {
    mode: 0o600,
  });
}

// Per-project config, written next to package.json after the first deploy so
// later deploys target the same game.
export type ProjectConfig = {
  gameId?: string;
  slug?: string;
  name?: string;
  outDir?: string;
};

const PROJECT_CONFIG_FILE = "metaloot.json";

export function loadProjectConfig(cwd: string): ProjectConfig {
  try {
    return JSON.parse(readFileSync(join(cwd, PROJECT_CONFIG_FILE), "utf8"));
  } catch {
    return {};
  }
}

export function saveProjectConfig(cwd: string, config: ProjectConfig): void {
  writeFileSync(
    join(cwd, PROJECT_CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`
  );
}
