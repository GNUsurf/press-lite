import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  { ignores: ['dist/**', 'node_modules/**', '.old-scaffold/**', 'public/**'] },
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
