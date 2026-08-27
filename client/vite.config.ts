import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ mode }) => {
  // Only VITE_* variables reach the bundle; everything else stays server-side.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const port = Number.parseInt(env.VITE_PORT ?? '5173', 10);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // The shared package is consumed straight from source, so a change to
        // the physics is picked up by HMR without a build step.
        '@polyball/shared': resolvePath('../shared/src/index.ts'),
      },
    },
    server: {
      port: Number.isFinite(port) ? port : 5173,
      strictPort: false,
      host: true,
      // Vite must be allowed to read ../shared while serving from ./client.
      fs: { allow: [resolvePath('..')] },
    },
    preview: { port: 4173, host: true },
    build: {
      target: 'es2020',
      outDir: 'dist',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 900,
    },
    esbuild: {
      // Keep the neon look but drop developer noise from production bundles.
      drop: mode === 'production' ? ['debugger'] : [],
    },
  };
});
