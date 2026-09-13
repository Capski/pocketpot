import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";

nextEnv.loadEnvConfig(process.cwd());
const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
];
for (const key of keys) {
  if (!process.env[key]?.trim()) throw new Error(`Missing ${key}`);
}
for (const key of keys) {
  const value = process.env[key].trim();
  const visibility = key.startsWith("NEXT_PUBLIC_") ? "--no-sensitive" : "--sensitive";
  const result = spawnSync(`npx --offline vercel env add ${key} production ${visibility} --yes`, {
    shell: true,
    input: value,
    encoding: "utf8",
    timeout: 120000,
  });
  // Never print environment values, including on CLI failure.
  let output = `${result.stdout || ""}${result.stderr || ""}`;
  for (const name of keys) output = output.split(process.env[name]).join("[redacted]");
  console.log(output.trim());
  if (result.error || result.status !== 0) throw new Error(`Failed to configure ${key}`);
}
