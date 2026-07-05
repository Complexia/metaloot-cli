const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

function paint(code: number, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const bold = (text: string) => paint(1, text);
export const dim = (text: string) => paint(2, text);
export const green = (text: string) => paint(32, text);
export const red = (text: string) => paint(31, text);
export const cyan = (text: string) => paint(36, text);
export const yellow = (text: string) => paint(33, text);

export function step(message: string): void {
  console.log(`${cyan("▸")} ${message}`);
}

export function success(message: string): void {
  console.log(`${green("✓")} ${message}`);
}

export function warn(message: string): void {
  console.log(`${yellow("!")} ${message}`);
}

export function fail(message: string): never {
  console.error(`${red("✗")} ${message}`);
  process.exit(1);
}

/** Rewrites the current line when attached to a TTY, else stays quiet. */
export function progress(message: string): void {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K${dim(message)}`);
  }
}

export function endProgress(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\r\x1b[2K");
  }
}
