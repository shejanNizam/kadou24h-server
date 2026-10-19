/* eslint-disable no-console -- a CLI launcher */
/**
 * `npm run dev:local`, but on the DEMO database filled by `npm run seed:demo`.
 * Everything else comes from .env (Node's --env-file never overrides a variable
 * that is already set, so DATABASE_URL below wins).
 */
import { spawn } from "node:child_process";

const DATABASE_URL = process.env.DEMO_DATABASE_URL || "mongodb://127.0.0.1:27017/kadou24h-demo";
console.log(`API on the demo database: ${DATABASE_URL}`);

const child = spawn("npx", ["tsx", "watch", "--env-file=.env", "src/server.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL },
});
child.on("exit", (code) => process.exit(code ?? 0));
