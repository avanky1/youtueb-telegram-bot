const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function ts(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (msg: string, ...args: unknown[]) =>
    console.log(`${C.dim}${ts()}${C.reset} ${C.blue}INFO${C.reset}  ${msg}`, ...args),

  warn: (msg: string, ...args: unknown[]) =>
    console.warn(`${C.dim}${ts()}${C.reset} ${C.yellow}WARN${C.reset}  ${msg}`, ...args),

  error: (msg: string, ...args: unknown[]) =>
    console.error(`${C.dim}${ts()}${C.reset} ${C.red}ERROR${C.reset} ${msg}`, ...args),

  debug: (msg: string, ...args: unknown[]) => {
    if (process.env["DEBUG"]) {
      console.log(`${C.dim}${ts()}${C.reset} ${C.dim}DEBUG${C.reset} ${msg}`, ...args);
    }
  },

  success: (msg: string, ...args: unknown[]) =>
    console.log(`${C.dim}${ts()}${C.reset} ${C.green}OK${C.reset}    ${msg}`, ...args),
};
