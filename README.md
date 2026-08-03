# Harness Analyzer CLI

Collect Claude Code, Codex and other local AI harness usage without uploading raw sessions, prompts, files or project paths.

## Install

```bash
npm install -g harness-analyzer
```

## Sync the hosted profile

1. Open `https://harness-analyzer.marketmaker.cc/profile`.
2. In "CLI sync", create and copy a token.
3. Connect this computer and upload an aggregate snapshot:

```bash
harness-analyzer login
harness-analyzer sync
```

The token is stored in `~/.config/harness-analyzer/credentials.json` with mode `0600`. For automation, provide it through `HARNESS_ANALYZER_TOKEN` instead. `harness-analyzer logout` removes the local copy; revoke the server token from Profile.

Use `harness-analyzer sync --dry-run` to inspect totals without making a network request. Existing offline commands remain available: `summary`, `today`, `week`, `month`, `projects`, and `sessions`.
