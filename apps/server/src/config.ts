import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Reads `VAR` or, when `VAR_FILE` is set, the file it points at (Docker secrets). */
function env(name: string, fallback?: string): string | undefined {
  const fileVar = process.env[`${name}_FILE`];
  if (fileVar && existsSync(fileVar)) return readFileSync(fileVar, 'utf8').trim();
  return process.env[name] ?? fallback;
}
const bool = (v: string | undefined, d = false) =>
  v == null ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
const int = (v: string | undefined, d: number) => {
  const n = Number(v); return Number.isFinite(n) ? n : d;
};

const dataDir = path.resolve(env('HOMESTEAD_DATA_DIR', './data')!);

export const config = {
  env: env('NODE_ENV', 'development')!,
  host: env('HOST', '0.0.0.0')!,
  port: int(env('PORT'), 8080),
  basePath: (env('BASE_PATH', '') || '').replace(/\/$/, ''),
  publicUrl: env('PUBLIC_URL', '')!,
  dataDir,
  filesDir: path.resolve(env('HOMESTEAD_FILES_DIR', path.join(dataDir, 'files'))!),
  dbPath: path.resolve(env('HOMESTEAD_DB_PATH', path.join(dataDir, 'homestead.db'))!),
  backupDir: path.resolve(env('HOMESTEAD_BACKUP_DIR', path.join(dataDir, 'backups'))!),
  secretKey: env('HOMESTEAD_SECRET_KEY', '')!,
  sessionDays: int(env('SESSION_DAYS'), 30),
  demo: bool(env('HOMESTEAD_DEMO')),
  /** Off by default: the app must work with no internet (GEN-002, FOOD-020). */
  externalLookups: bool(env('HOMESTEAD_EXTERNAL_LOOKUPS')),
  trustProxy: bool(env('TRUST_PROXY')),
  maxUploadBytes: int(env('MAX_UPLOAD_BYTES'), 50 * 1024 * 1024),
  webDir: env('HOMESTEAD_WEB_DIR', path.resolve('../web/dist'))!,
  scheduler: {
    enabled: bool(env('SCHEDULER_ENABLED'), true),
    tickSeconds: int(env('SCHEDULER_TICK_SECONDS'), 60),
  },
  smtp: {
    host: env('SMTP_HOST'),
    port: int(env('SMTP_PORT'), 587),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('SMTP_FROM', 'homestead@localhost')!,
    secure: bool(env('SMTP_SECURE')),
  },
  ntfy: { url: env('NTFY_URL'), topic: env('NTFY_TOPIC') },
  gotify: { url: env('GOTIFY_URL'), token: env('GOTIFY_TOKEN') },
  webhookUrl: env('NOTIFY_WEBHOOK_URL'),
} as const;

export type Config = typeof config;
