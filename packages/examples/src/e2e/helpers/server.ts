import { spawn, ChildProcess, execSync } from "child_process";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { BASE_URL, PORT } from "./config";
// __dirname = packages/examples/src/e2e/helpers — three levels up is packages/examples/
const EXAMPLES_DIR = path.resolve(__dirname, "../../..");
const ENV_FILE = path.resolve(EXAMPLES_DIR, "../../.env");

let serverProcess: ChildProcess | null = null;

export async function startServer(): Promise<void> {
  killExistingServer();

  // Explicitly load .env so the spawned process inherits the vars regardless of its CWD
  const envFromFile = fs.existsSync(ENV_FILE)
    ? dotenv.parse(fs.readFileSync(ENV_FILE))
    : {};

  serverProcess = spawn("npx", ["ts-node", "./src/server/index.ts"], {
    cwd: EXAMPLES_DIR,
    env: { ...process.env, ...envFromFile, PORT: String(PORT) },
    stdio: "pipe",
  });

  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) process.stderr.write(`[server] ${line}\n`);
  });

  await waitForServer(30_000);
}

export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
  killExistingServer();
}

function killExistingServer(): void {
  try {
    execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { stdio: "ignore" });
    // Brief pause for port to free
    execSync("sleep 0.5", { stdio: "ignore" });
  } catch {
    // ignore — no process on that port
  }
}

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/agents`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}
