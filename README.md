# Weekly Bugzilla and Jira Status (Mozilla)

Generate weekly summaries of recently resolved Bugzilla bugs and Jira issues, either from the command line or a Cloudflare Pages UI. Supports Bugzilla-only, Jira-only, or combined reports with separate sections for each system.

## Requirements

- Node 18+ (for global `fetch` support)
- `BUGZILLA_API_KEY` and `OPENAI_API_KEY` environment variables (required)
- `JIRA_URL` and `JIRA_API_KEY` environment variables (optional, for Jira support)

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

**Bugzilla options:**

- `--component "Product:Component"` (repeatable) to scope by components
- `--whiteboard "[tag]"` (repeatable) to match whiteboard substrings
- `--metabug 12345` (repeatable) to include metabug children
- `--assignee dev@example.com` (repeatable) to focus on specific Bugzilla users

**Jira options:**

- `--jira-url "https://your-org.atlassian.net"` to specify Jira instance (or use `JIRA_URL` env var)
- `--jira-project KEY` (repeatable) to filter by Jira project keys (e.g., `PROJ1`, `PROJ2`)
- `--jira-jql "JQL query"` (repeatable) for advanced JQL queries

**General options:**

- `--days 8` (default 8) to control the history window
- `--format <md|html>` to choose the output wrapper
- `--model gpt-5` (default) to select the summarization model
- `--debug` for additional logging on stderr

The CLI prints the rendered status document to stdout and logs fetch progress to stderr.

## Jira Integration

### Setup

To use Jira features, you need to set up two environment variables:

1. `JIRA_URL` - Your Jira instance URL (e.g., `https://your-org.atlassian.net`)
2. `JIRA_API_KEY` - Your Jira API token (see "Getting a Jira API Token" below)

You can set these in your environment or in a `.env` file in the `snazzybot` directory:

```bash
JIRA_URL=https://your-org.atlassian.net
JIRA_API_KEY=your_api_token_here
```

### Getting a Jira API Token

For Jira Cloud:

1. Log in to your Jira instance
2. Go to Account Settings (click your profile icon in the top right)
3. Select Security from the left sidebar
4. Under "API token", click "Create and manage API tokens"
5. Click "Create API token"
6. Give it a label (e.g., "Bugzilla Status Tool") and copy the token
7. Store the token securely in your `JIRA_API_KEY` environment variable

### Usage Examples

**Query by Jira project:**

```bash
cd snazzybot
JIRA_URL="https://your-org.atlassian.net" \
JIRA_API_KEY="..." \
BUGZILLA_API_KEY="..." \
OPENAI_API_KEY="..." \
  npm run cli -- --jira-project MYPROJ --days 7
```

This will fetch all issues from the `MYPROJ` project that transitioned to "Done" in the last 7 days.

**Query multiple projects:**

```bash
npm run cli -- --jira-project PROJ1 --jira-project PROJ2 --days 7
```

**Use custom JQL queries:**

```bash
npm run cli -- --jira-jql "project = MYPROJ AND assignee = currentUser()" --days 7
```

**Combine Bugzilla and Jira:**

```bash
npm run cli -- \
  --whiteboard "[fx-vpn]" \
  --jira-project VPNPROJ \
  --days 7
```

This will generate a two-section report with both Bugzilla bugs and Jira issues.

**Multiple JQL queries (results are merged):**

```bash
npm run cli -- \
  --jira-jql "project = PROJ1 AND priority = High" \
  --jira-jql "project = PROJ2 AND component = Security" \
  --days 7
```

### How Jira Filtering Works

The tool applies several filters to ensure only relevant issues are included:

1. **Time Window**: Only issues updated in the last N days (specified by `--days`)
2. **Status Transitions**: Issues must have transitioned to a "Done" status within the time window
3. **Security Filtering**: Issues marked as secure/private are automatically excluded from reports
4. **Deduplication**: If the same issue appears in multiple queries, it's only included once

When using `--jira-project`, the tool automatically generates JQL like:

```
project = MYPROJ AND statusCategory = Done AND updated >= -7d
```

### Jira-Only Reports

You can generate Jira-only reports by omitting all Bugzilla filters:

```bash
npm run cli -- --jira-project MYPROJ --days 7
```

Note: `BUGZILLA_API_KEY` is still required in the environment, but won't be used if no Bugzilla filters are specified.

### Troubleshooting

**Error: "Jira options require both JIRA_URL and JIRA_API_KEY"**

- Make sure both environment variables are set when using `--jira-project` or `--jira-jql`

**No Jira issues appearing in report:**

- Check that issues have transitioned to "Done" (or similar completion status) within the time window
- Verify your JQL query is correct by testing it in Jira's issue search
- Try increasing `--days` to expand the time window
- Check that issues aren't marked as secure/private (these are excluded automatically)

**"Failed to initialize Jira client" warning:**

- Verify your `JIRA_URL` is correct (should not have a trailing slash)
- Ensure your `JIRA_API_KEY` is valid and not expired
- Check network connectivity to your Jira instance

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
npm run test:e2e # runs Chromium and Firefox
```

When working from the repository root (for example via VS Code's built-in test runner), you can also use:

```bash
npm run test
npm run test:watch
npm run test:e2e # runs Chromium and Firefox
npm run test:all
npm run coverage
```

Each command proxies to the scripts in `snazzybot/package.json` so that editors can discover and execute them without manual navigation.
