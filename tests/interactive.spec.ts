// Node builtin types may not be available in this project's TS config.
// Use require with a ts-ignore to avoid adding @types/node as a dependency for this simple helper.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const fs = require('fs');
import { test, expect } from './context';

test('interactive debug: inspect on failure', async ({ page, autoClick, autoFill, autoExpectVisible }) => {
  try {
    await page.goto('/');

   
  } catch (err) {
    // Save a snapshot of the DOM for inspection
    try {
      const html = await page.content();
      fs.writeFileSync('test-failure-dom.html', html, 'utf8');
      console.log('Saved DOM snapshot to test-failure-dom.html');
    } catch (saveErr) {
      console.error('Failed to save DOM snapshot:', saveErr);
    }

    // Enter Playwright Inspector / pause so user can interact with the page in headed mode.
    // Run with PWDEBUG=1 (see package.json script) so the inspector opens.
    // This keeps the browser open for manual inspection instead of closing immediately.
    // If you run without PWDEBUG, this still pauses (useful when running from an IDE).
    // Note: the test runner will still mark the test as failed after you resume/throw.
    // Pause allows the developer to check locators, iframes, etc., per context2.txt instructions.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - page.pause() is available at runtime
    await page.pause();

    throw err;
  }
});
