/**
 * Server configuration.
 *
 * Everything here comes from the environment: nothing about a deployment is
 * hardcoded, and no secret ever ships inside the client bundle.
 */

const int = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const bool = (raw: string | undefined, fallback = false): boolean => {
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
};

const list = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isProduction: boolean;
  /** Origins allowed to open a WebSocket. Empty means "allow any" (dev only). */
  allowedOrigins: string[];
  /** Serve the built client from this process (single-container deployments). */
  serveStatic: boolean;
  clientDir: string;
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  return {
    port: int(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    isProduction: nodeEnv === 'production',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    serveStatic: bool(env.SERVE_STATIC, false),
    clientDir: env.CLIENT_DIR ?? '../client/dist',
    trustProxy: bool(env.TRUST_PROXY, false),
  };
}

/**
 * Origin check for WebSocket upgrades. A browser always sends Origin, so an
 * unknown or missing origin is rejected as soon as a whitelist is configured.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.includes(origin);
}
