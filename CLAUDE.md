# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript application that generates AI-powered weekly summaries of resolved Bugzilla bugs and Jira issues. It supports three delivery mechanisms: CLI tool, Cloudflare Pages web UI, and REST API (Cloudflare Worker).

## Commands

All development happens in the `snazzybot/` directory. Run commands from the repo root unless noted.

### Testing

```bash
npm test              # Unit tests (Vitest)
npm run test:watch    # Watch mode with UI
npm run test:e2e      # E2E tests (Chromium + Firefox via Playwright)
npm run test:all      # All tests + lint
npm run coverage      # Coverage report
```

### Linting and Formatting

```bash
npm run pretty                    # Format with Prettier (root)
cd snazzybot && npm run lint      # ESLint check
cd snazzybot && npm run lint:fix  # ESLint auto-fix
```

### Running the CLI

```bash
cd snazzybot
BUGZILLA_API_KEY="..." OPENAI_API_KEY="..." npm run cli -- --whiteboard "[tag]" --days 7
```

### Local UI Development

```bash
cd snazzybot
BUGZILLA_API_KEY="..." OPENAI_API_KEY="..." npm run dev:pages
```

### Deployment

```bash
cd snazzybot && npm run deploy    # Deploy to Cloudflare Pages
```

## Architecture

```
snazzybot/
├── cli/                    # CLI entry point (weekly-bugzilla-status.ts)
├── src/
│   ├── core.ts             # Public API exports
│   ├── status/             # Core service modules
│   │   ├── service.ts      # State machine orchestration (recipe steps)
│   │   ├── bugzillaClient.ts  # Bugzilla REST/XML API with caching
│   │   ├── jiraClient.ts   # Jira Cloud integration
│   │   ├── candidateCollector.ts  # Bug discovery logic
│   │   ├── history.ts      # Temporal qualification filtering
│   │   ├── summarizer.ts   # OpenAI prompt engineering
│   │   ├── markdown.ts     # Output formatting
│   │   ├── stateMachine.ts # Recipe step execution
│   │   └── types.ts        # Core type definitions
│   └── utils/              # Shared utilities (cache, errors, time)
├── functions/api/          # Cloudflare Worker handlers
├── public/                 # Static UI assets (HTML, JS)
└── tests/                  # Unit, integration, and E2E tests
```

### Key Patterns

- **State Machine Processing**: `service.ts` orchestrates data collection through "recipe steps" defined in `stateMachine.ts`. Steps include candidate collection, history fetching, filtering, and summarization.

- **Multi-Source Support**: Bugzilla and Jira are processed in parallel with separate collection and filtering steps, then merged for summarization.

- **Caching**: `bugzillaClient.ts` implements caching for API responses. Cache utilities are in `src/utils/cache.ts`.

- **Streaming API**: The Cloudflare Worker supports multi-stage processing with streaming responses (discover, page, finalize modes).

## Environment Variables

Required:

- `BUGZILLA_API_KEY` - Bugzilla API authentication
- `OPENAI_API_KEY` - OpenAI API for summarization

Optional:

- `JIRA_URL` - Jira instance URL (e.g., `https://org.atlassian.net`)
- `JIRA_API_KEY` - Jira API token
- `GITHUB_API_KEY` - For GitHub activity integration
- `BUGZILLA_HOST` - Custom Bugzilla host

## Testing Structure

- **Unit tests**: `snazzybot/tests/unit/` - Test individual modules
- **Integration tests**: `snazzybot/tests/integration/` - Test module interactions
- **E2E tests**: `snazzybot/tests/e2e/` - Browser tests with Playwright
- **Test utilities**: `snazzybot/tests/utils/` - Shared test helpers

Tests use Vitest with MSW for API mocking.

## Development Practices

All code must be written using Test-Driven Development (TDD):

1. Write a failing test first
2. Write the minimum code to make the test pass
3. Refactor as needed while keeping tests green

## Git Conventions

Do not include `Co-Authored-By` lines in commit messages.
