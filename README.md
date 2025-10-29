pw-test

Minimal Playwright project ready to run.

Setup
##Load credentials for Jira, Git and other tools from .credentials folder(load_credentials.sh) and use context.txt file for instructions

```bash
npm install
npm run install:browsers
```

Note: If Playwright browsers are already installed on your machine, you can skip running `npm run install:browsers`.

Credentials

- High-level only: Load credentials once in your shell session before starting Cursor or running tests. Do not load credentials inside Playwright or per test.
- Recommended: add exports to your shell init (e.g., `~/.zshrc`) or manually run `source ~/.credentials/load_credentials.sh` once per session.
- Available variables:
  - Jira: `JIRA_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN`
  - Git: `GIT_USERNAME`, `GIT_EMAIL`, `GIT_ACCESS_TOKEN`
  - PractiTest: `PT_API_URL`, `PT_API_TOKEN`, `PT_PROJECT_ID`

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


