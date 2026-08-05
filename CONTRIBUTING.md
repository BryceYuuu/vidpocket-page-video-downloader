# Contributing

Thanks for your interest in improving VidPocket.

## Scope

Good contributions include:

- improving detection for directly accessible media resources
- making the popup UI clearer and more reliable
- improving HLS handling for unencrypted streams
- adding tests and fixtures for supported cases
- improving installation docs and packaged media-processing portability

Out of scope:

- DRM circumvention
- bypassing login, paywall, or platform restrictions
- YouTube or protected platform extraction
- code that hides unsupported media as successful downloads

## Development Setup

1. Install Node.js 18 or newer.
2. Run `npm ci`.
3. Load the repository root from `chrome://extensions`.

Run checks:

```sh
npm test
```

## Pull Request Checklist

- Keep changes focused.
- Add or update tests for behavior changes.
- Do not add telemetry or remote services without discussion.
- Do not introduce code that bypasses access controls.
- Update `README.md` or `README.zh-CN.md` when usage changes.
