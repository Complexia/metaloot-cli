#!/usr/bin/env node
import { parseArgs } from "node:util";
import { deploy } from "./deploy.js";
import { login, logout, printWhoAmI } from "./login.js";
import { bold, cyan, dim, fail } from "./ui.js";

const VERSION = "0.2.0";

const HELP = `
${bold("metaloot")} — publish browser games to Metaloot

${cyan("Usage")}
  metaloot <command> [options]

${cyan("Commands")}
  login             Sign in to Metaloot (opens your browser)
  logout            Sign out and revoke this machine's token
  whoami            Show the signed-in Metaloot account
  deploy            Build and publish the game in the current folder

${cyan("Deploy options")}
  --game <game-id>  Deploy into an existing Metaloot game (copy the command
                    from your game's settings page)
  --name <name>     Game name (defaults to package.json name)
  --dir <folder>    Build output folder (defaults to dist/ or build/)
  --no-build        Skip running the build script

${cyan("Login options")}
  --token <token>   Sign in with a token from ${dim("https://metaloot.app/cli/auth")}

${cyan("Environment")}
  METALOOT_ORIGIN   Portal origin (default https://www.metaloot.app)
  METALOOT_TOKEN    Token override for CI
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      token: { type: "string" },
      game: { type: "string" },
      name: { type: "string" },
      dir: { type: "string" },
      "no-build": { type: "boolean" },
    },
    allowPositionals: true,
  });

  const command = positionals[0];

  if (values.version) {
    console.log(VERSION);
    return;
  }

  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "login":
      await login({ token: values.token });
      return;
    case "logout":
      await logout();
      return;
    case "whoami":
      await printWhoAmI();
      return;
    case "deploy":
      await deploy({
        game: values.game,
        name: values.name,
        dir: values.dir,
        noBuild: values["no-build"],
      });
      return;
    default:
      console.log(HELP);
      fail(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
