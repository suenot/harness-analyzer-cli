# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-09-27

### Fixed

- Recalculate GPT-6 and GLM-5.3/4.7 estimates from local transcripts with corrected Codex output token counts.

## [0.4.2] - 2026-09-27

### Fixed

- Keep model names from local chats even when no matching price is known, instead of replacing them with GLM 5.2.
- Recollect cached sessions with the corrected model detection.

## [0.4.1] - 2026-09-26

### Changed

- Renamed the source repository and core workspace import to Harness Analyzer.

## [0.4.0] - 2026-08-16

### Added

- Persist a stable private device identity across logins and upload it with every analytics snapshot.
- Support persistent `--device-name` aliases and temporary `HARNESS_ANALYZER_DEVICE_NAME` overrides for server fleets.
- Show the current device identity in `harness-analyzer status`.

[Unreleased]: https://github.com/suenot/harness-analyzer-cli/compare/v0.4.3...HEAD
[0.4.3]: https://github.com/suenot/harness-analyzer-cli/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/suenot/harness-analyzer-cli/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/suenot/harness-analyzer-cli/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/suenot/harness-analyzer-cli/compare/v0.3.0...v0.4.0
