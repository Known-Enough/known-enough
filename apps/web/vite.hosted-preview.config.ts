import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'import.meta.env.VITE_HOSTED_PREVIEW': JSON.stringify('true'),
  },
  resolve: {
    alias: {
      './local-api-client': '/src/hosted-local-api-stub.ts',
    },
  },
  build: {
    outDir: 'dist-hosted-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'hosted-preview/index.html',
      },
    },
  },
});
