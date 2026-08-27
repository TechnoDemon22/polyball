import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const port = Number.parseInt(env.VITE_PORT ?? '5173', 10);

  return {
    base: './',
    root: path.resolve(__dirname, 'client'),
    plugins: [react()],
    resolve: {
      alias: {
        '@polyball/shared': path.resolve(__dirname, 'shared/src/index.ts'),
      },
    },
    server: {
      port: Number.isFinite(port) ? port : 5173,
      strictPort: false,
      host: true,
      fs: { allow: [__dirname] },
    },
    preview: { port: 4173, host: true },
    build: {
      outDir: path.resolve(__dirname, 'client/dist'),
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 900,
    },
    esbuild: {
      drop: mode === 'production' ? ['debugger'] : [],
    },
  };
});
