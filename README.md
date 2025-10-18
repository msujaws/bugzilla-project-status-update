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

## Legacy Script

The original root-level script remains available:

```bash
npm install
BUGZILLA_API_KEY="..." OPENAI_API_KEY="..." \
  npm run status -- --component "Firefox:General" --days 8
```

Its flags mirror the CLI options described above, with markdown output to stdout.
