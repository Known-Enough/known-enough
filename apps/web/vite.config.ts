import { defineConfig } from 'vite';
// The supported Cognito SDK's browser buffer dependency refers to Node's global alias.
// Resolve that alias at bundle time; no process, credentials or server modules are supplied.
export default defineConfig({ define: { global: 'globalThis' } });
