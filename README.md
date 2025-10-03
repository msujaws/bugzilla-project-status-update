# Weekly Bugzilla Status (Mozilla)

Node 18+ (for global fetch). TypeScript.

## Features

- **Inputs:**
  - `--component "Product:Component"` (repeatable)  
  - `--whiteboard "[fx-vpn]" (repeatable)
  - `--metabug 12345` (repeatable)  
  - `--days 8` (default 8)  
  - `--model gpt-5` (default)  
  - `--debug`

- **Env vars:**
  - `BUGZILLA_API_KEY` (required)  
  - `OPENAI_API_KEY` (required)

- **Output:** Markdown to stdout, ending with a bare URL line in parentheses.

## Install

```bash
npm i -D ts-node typescript
npm i openai yargs
# Node 18+ provides fetch; if on older Node, also: npm i undici
```

## Run

```bash
ts-node weekly-bugzilla-status.ts \
  --component "Firefox:General" \
  --component "Fenix:Toolbar" \
  --metabug 1880000 \
  --days 8 \
  --debug
```
