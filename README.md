# Weekly Bugzilla Status (Mozilla)

Generate weekly summaries of recently resolved Bugzilla bugs, either from the command line or a Cloudflare Pages UI.

## Requirements

- Node 18+ (for global `fetch` support)
- `BUGZILLA_API_KEY` and `OPENAI_API_KEY` environment variables

## Install Dependencies

```bash
cd snazzybot
npm install
```

## CLI Usage

Run the TypeScript CLI to print a markdown report:

```bash
cd snazzybot
BUGZILLA_API_KEY="..." OPENAI_API_KEY="..." \
  npm run cli -- --whiteboard "[fx-vpn]" --days 3 --format md
```

Key flags:
- `--component "Product:Component"` (repeatable) to scope by components
- `--whiteboard "[tag]"` (repeatable) to match whiteboard substrings
- `--metabug 12345` (repeatable) to include metabug children
- `--assignee dev@example.com` (repeatable) to focus on specific Bugzilla users
- `--days 8` (default 8) to control the history window
- `--format <md|html>` to choose the output wrapper
- `--model gpt-5` (default) to select the summarization model
- `--debug` for additional logging on stderr

The CLI prints the rendered status document to stdout and logs fetch progress to stderr.

## Local UI Preview

Launch the Cloudflare Pages preview using Wrangler:

```bash
cd snazzybot
BUGZILLA_API_KEY="..." OPENAI_API_KEY="..." \
  wrangler pages dev ./public
```

This serves the assets in `snazzybot/public` and proxies API calls through the local worker.

## Local Testing

```bash
cd snazzybot
npm ci
npm run test:watch
npm run test:e2e
```

When working from the repository root (for example via VS Code's built-in test runner), you can also use:

```bash
npm run test
npm run test:watch
npm run test:e2e
npm run test:all
npm run coverage
```

Each command proxies to the scripts in `snazzybot/package.json` so that editors can discover and execute them without manual navigation.
