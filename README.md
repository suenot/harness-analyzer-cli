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

The token is stored in `~/.config/harness-analyzer/credentials.json` with mode `0600`. For automation, provide it through `HARNESS_ANALYZER_TOKEN` instead. `harness-analyzer logout` removes the local token; revoke the server token from Profile.

Each installation also keeps a random device ID and label in `~/.config/harness-analyzer/device.json` with mode `0600`. The ID survives logout so repeated uploads replace that device's latest snapshot instead of creating duplicates. By default the private label is the local hostname. Set a persistent alias with `--device-name`:

```bash
harness-analyzer login --device-name build-worker-01
# or update it during the next upload
harness-analyzer sync --device-name build-worker-01
```

`HARNESS_ANALYZER_DEVICE_NAME` overrides the saved label for one process without changing `device.json`. When both are present, the explicit `--device-name` value wins and is saved. Device labels, platform and architecture are sent only to the private owner analytics used for the device breakdown; they are never included in the public profile.

## Sync a server fleet

Connect every server to the same account token. Each installation retains its own ID, and the service aggregates the latest snapshot from every device:

```bash
# Run on worker-01 through worker-10 with the matching number.
export HARNESS_ANALYZER_TOKEN='ha_sync_...'
harness-analyzer sync --device-name worker-01
```

For scheduled jobs that should not persist an infrastructure hostname, use a temporary alias instead:

```bash
HARNESS_ANALYZER_DEVICE_NAME=worker-01 harness-analyzer sync --quiet
```

Use `harness-analyzer sync --dry-run` to inspect totals without making a network request. Existing offline commands remain available: `summary`, `today`, `week`, `month`, `projects`, and `sessions`.

Model names come from local logs. Token usage for a model without a known price is still shown, but its USD estimate is $0 until that model has a rate. USD figures are estimates, not billing records; subscription charges, service tiers, and long contexts may differ.
