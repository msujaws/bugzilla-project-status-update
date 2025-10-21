import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import unicorn from 'eslint-plugin-unicorn';

const commonUnicornRules = {
  'unicorn/filename-case': 'off',
  'unicorn/prevent-abbreviations': 'off'
};

export default [
  {
    ignores: ['public/lib/markdown.js', 'node_modules', 'dist', '.wrangler']
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      unicorn
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...unicorn.configs.recommended.rules,
      ...commonUnicornRules
    }
  },
  {
    files: ['cli/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['functions/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        PagesFunction: 'readonly',
        Env: 'readonly',
        ExecutionContext: 'readonly',
        KVNamespace: 'readonly'
      }
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      unicorn
    },
    rules: {
      ...js.configs.recommended.rules,
      ...unicorn.configs.recommended.rules,
      ...commonUnicornRules
    }
  }
];
