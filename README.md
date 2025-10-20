pw-test

Minimal Playwright project ready to run.

Setup

```bash
npm install
npm run install:browsers
```

Run tests

- All tests (headed, chromium project):
```bash
npm run test
```
- Headed Chromium only:
```bash
npm run test:headed
```
- UI mode:
```bash
npm run test:ui
```
- Debug example test:
```bash
npm run test:debug
```
- Open last HTML report:
```bash
npm run show-report
```

Files

- `playwright.config.ts` – config (headed, chromium project).
- `tests/example.spec.ts` – sample test.


