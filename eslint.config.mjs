import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['**/dist/**', '**/node_modules/**', 'docs/reference/**', 'planning-checks/**', 'test-results/**', 'playwright-report/**'] }, js.configs.recommended, ...tseslint.configs.recommended, { languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly', TextEncoder: 'readonly', crypto: 'readonly', document: 'readonly', structuredClone: 'readonly' } } });
