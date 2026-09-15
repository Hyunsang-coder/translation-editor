# Testing

## Default harness

`npm run test:harness` is the normal background-only gate:

1. Vitest unit/component/store tests
2. Rust backend tests

It does not launch a browser, WebView, Tauri app, video recorder, or real AI call.

## Test layers

| Layer | Command | When to use |
|---|---|---|
| Background harness | `npm run test:harness` | Default verification |
| Focused Vitest | `npx vitest run <file>` | During frontend/AI refactors |
| Focused Rust | `cargo test --manifest-path src-tauri/Cargo.toml <name>` | During backend refactors |
| Web E2E | `npm run test:e2e:web` | Only when browser interaction is the behavior under test |
| Tauri smoke | `npm run test:e2e` | Packaging/integration changes |
| Release gate | `npm run test:tauri` | Before deployment |

## Vitest

- Config: `vitest.config.ts`
- Setup/mocks: `src/test/setup.ts`
- Tests live beside the code they cover.
- `.env.local` API keys are exposed only to Vitest. The runtime app uses Settings/secure storage.
- Live model tests remain skipped unless `LIVE_AI=1` is explicitly set.

Paste normalization is covered by `src/utils/htmlNormalizer*.test.ts` and `src/components/editor/TipTapEditor.paste.test.tsx`; there is no separate editor page or browser harness.

## Web E2E

- Config: `playwright.web.config.ts`
- Specs: `e2e/*.spec.ts`
- Tauri mock: `e2e/tauri-mock.ts`
- `record-*.spec.ts` is excluded and uses `playwright.record.config.ts`.
- Seed structured documents through the mock instead of keyboard-building fixtures.
- Grant clipboard permissions before clipboard assertions.

Do not add a browser/E2E test when a deterministic Vitest or Rust test can cover the contract.
