import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'public/', 'electron/']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',   
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]|^motion$', argsIgnorePattern: '^_' }],
      // Silent-fail catches are an intentional pattern throughout the codebase
      // (e.g. best-effort localStorage writes, optional server calls on logout).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Context files intentionally co-export their hook alongside the Provider
      // component (AuthContext, CallContext). Keep as warning, not error.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
