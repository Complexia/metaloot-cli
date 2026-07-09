import { portalOrigin } from "./config.js";

export type WhoAmI = {
  user: { id: string; name: string; email?: string };
  tokenLabel: string;
};

export type DeployStartResponse = {
  deployId: string;
  gameId: string;
  slug: string;
  title: string;
  url: string;
  uploads: { path: string; uploadUrl: string }[];
};

export type DeployFinalizeResponse = {
  url: string;
  gameId: string;
  slug: string;
  title: string;
  playUrl: string;
  manageUrl: string;
  auth: { clientId: string; provisioned: boolean };
  /** Absent when deploying against an older portal. */
  multiplayer?: { enabled: boolean; roomsUrl: string; docsUrl: string };
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(new URL(path, portalOrigin()), {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : `${options.method ?? "GET"} ${path} failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export function whoami(token: string): Promise<WhoAmI> {
  return request<WhoAmI>("/api/cli/whoami", { token });
}

export function revokeToken(token: string): Promise<void> {
  return request("/api/cli/tokens", { method: "DELETE", token });
}

export function startDeploy(
  token: string,
  body: {
    name: string;
    slug?: string;
    gameId?: string;
    description?: string;
    files: { path: string; size: number }[];
  }
): Promise<DeployStartResponse> {
  return request<DeployStartResponse>("/api/deploy", {
    method: "POST",
    token,
    body,
  });
}

export function finalizeDeploy(
  token: string,
  deployId: string
): Promise<DeployFinalizeResponse> {
  return request<DeployFinalizeResponse>(
    `/api/deploy/${encodeURIComponent(deployId)}/finalize`,
    { method: "POST", token, body: {} }
  );
}
