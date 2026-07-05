import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { whoami, revokeToken } from "./api.js";
import {
  clearCredentials,
  loadCredentials,
  portalOrigin,
  saveCredentials,
} from "./config.js";
import { bold, dim, fail, step, success, warn } from "./ui.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url.replaceAll("&", "^&")]
        : ["xdg-open", url];
  const child = spawn(command[0]!, command.slice(1), {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    // Browser could not be opened; the URL is already printed as a fallback.
  });
  child.unref();
}

function landingPage(message: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Metaloot CLI</title></head>
  <body style="font-family: system-ui, sans-serif; background: #0b0b12; color: #e8e8f0; display: grid; place-items: center; min-height: 100vh; margin: 0;">
    <div style="text-align: center;">
      <h1 style="font-size: 1.4rem;">${message}</h1>
      <p style="opacity: 0.7;">You can close this tab and return to your terminal.</p>
    </div>
  </body>
</html>`;
}

/** Waits for the browser to hand a token back to a loopback HTTP server. */
function waitForToken(state: string): Promise<{
  port: number;
  token: Promise<string>;
}> {
  return new Promise((resolveServer, rejectServer) => {
    let resolveToken: (token: string) => void;
    let rejectToken: (error: Error) => void;
    const token = new Promise<string>((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const receivedToken = url.searchParams.get("token");
      const receivedState = url.searchParams.get("state");
      const ok = Boolean(receivedToken) && receivedState === state;

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        landingPage(ok ? "You're signed in to Metaloot 🎮" : "Sign-in failed.")
      );

      if (ok) {
        resolveToken(receivedToken!);
      } else {
        rejectToken(new Error("Sign-in was denied or the state did not match."));
      }
      setTimeout(() => server.close(), 100).unref();
    });

    const timeout = setTimeout(() => {
      server.close();
      rejectToken(new Error("Timed out waiting for browser sign-in."));
    }, LOGIN_TIMEOUT_MS);
    timeout.unref();

    server.on("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectServer(new Error("Could not start local sign-in server."));
        return;
      }
      resolveServer({ port: address.port, token });
    });
  });
}

export async function login(args: { token?: string }): Promise<void> {
  let token = args.token;

  if (!token) {
    const state = randomBytes(24).toString("base64url");
    const { port, token: pendingToken } = await waitForToken(state);

    const authorizeUrl = new URL("/cli/auth", portalOrigin());
    authorizeUrl.searchParams.set(
      "redirect",
      `http://127.0.0.1:${port}/callback`
    );
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("label", `Metaloot CLI on ${hostname()}`);

    step(`Opening your browser to sign in to Metaloot…`);
    console.log(dim(`  If it doesn't open, visit:\n  ${authorizeUrl}`));
    openBrowser(authorizeUrl.toString());

    token = await pendingToken;
  }

  const identity = await whoami(token).catch(() => null);
  if (!identity) {
    fail("That token was not accepted by Metaloot.");
  }

  saveCredentials({ token, user: identity.user });
  success(
    `Signed in as ${bold(identity.user.name)}${
      identity.user.email ? dim(` (${identity.user.email})`) : ""
    }`
  );
}

export async function logout(): Promise<void> {
  const credentials = loadCredentials();
  if (!credentials) {
    warn("You are not signed in.");
    return;
  }

  await revokeToken(credentials.token).catch(() => {
    warn("Could not revoke the token on the server; clearing it locally.");
  });
  clearCredentials();
  success("Signed out of Metaloot.");
}

export async function printWhoAmI(): Promise<void> {
  const credentials = loadCredentials();
  if (!credentials) {
    fail("Not signed in. Run `metaloot login` first.");
  }

  const identity = await whoami(credentials.token).catch(() => null);
  if (!identity) {
    fail("Your session is no longer valid. Run `metaloot login` again.");
  }

  console.log(
    `${bold(identity.user.name)}${
      identity.user.email ? ` <${identity.user.email}>` : ""
    } ${dim(`· ${portalOrigin()}`)}`
  );
}
