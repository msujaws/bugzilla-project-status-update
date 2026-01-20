import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import unicorn from "eslint-plugin-unicorn";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import eslintConfigPrettier from "eslint-config-prettier";

const commonUnicornRules = {
  "unicorn/filename-case": "off",
  "unicorn/prevent-abbreviations": "off",
};

export default [
  {
    ignores: ["node_modules", "dist", ".wrangler", "coverage", "public/vendor"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      unicorn,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...unicorn.configs.recommended.rules,
      ...commonUnicornRules,
    },
  },
  {
    files: ["cli/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Match both relative (when run from snazzybot/) and absolute paths (when run from root)
    files: ["functions/**/*.ts", "**/functions/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        PagesFunction: "readonly",
        Env: "readonly",
        ExecutionContext: "readonly",
        KVNamespace: "readonly",
      },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      unicorn,
      "no-unsanitized": noUnsanitized,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...unicorn.configs.recommended.rules,
      ...commonUnicornRules,
      // Security: Prevent XSS via innerHTML/outerHTML - use textContent, createElement, or DOMPurify
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
    },
  },
  eslintConfigPrettier, // must come last; turns off style rules that conflict with Prettier
];
