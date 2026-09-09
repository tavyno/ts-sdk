import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  { languageOptions: { globals: { AbortController: 'readonly', Response: 'readonly', process: 'readonly' } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
