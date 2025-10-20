import { test as base, expect as baseExpect,  chromium, type Page, type Locator } from '@playwright/test';

type AutoHelpers = {
  autoFill: (page: Page, fieldHint: string | RegExp, value: string) => Promise<void>;
  autoClick: (page: Page, hint: string | RegExp) => Promise<void>;
  autoExpectVisible: (page: Page, hint: string | RegExp, timeoutMs?: number) => Promise<Locator>;
  debugStep: (page: Page, label: string) => Promise<void>;
};

async function resolveLocator(page: Page, hint: string | RegExp): Promise<Locator | null> {
  // Try common robust strategies in order
  const candidates: Locator[] = [
    page.getByRole('button', { name: hint }),
    page.getByRole('link', { name: hint }),
    page.getByLabel(hint),
    page.getByPlaceholder(hint as any),
    page.getByText(hint),
    page.locator(
      typeof hint === 'string'
        ? `[data-testid="${hint}"]`
        : '[data-testid]'
    ),
  ];

  for (const loc of candidates) {
    try {
      const first = loc.first();
      if ((await first.count()) > 0) {
        await first.scrollIntoViewIfNeeded().catch(() => {});
        return first;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function autoFill(page: Page, fieldHint: string | RegExp, value: string): Promise<void> {
  // Try label, placeholder, role textbox, name-based
  const strategies: Locator[] = [
    page.getByLabel(fieldHint),
    page.getByPlaceholder(fieldHint as any),
    page.getByRole('textbox', { name: fieldHint }),
    page.locator(
      typeof fieldHint === 'string'
        ? `input[name=${JSON.stringify(fieldHint)}], textarea[name=${JSON.stringify(fieldHint)}]`
        : 'input[name], textarea[name]'
    ),
  ];
  for (const loc of strategies) {
    try {
      const first = loc.first();
      if (await first.count()) {
        await first.fill(value);
        return;
      }
    } catch {
      // continue
    }
  }
  // Heuristic: find text node matching hint and the nearest input/textarea in same container
  try {
    const labelText = page.getByText(fieldHint, { exact: false }).first();
    const neighborInput = labelText.locator('xpath=following::input[1] | following::textarea[1]').first();
    if (await neighborInput.count()) {
      await neighborInput.fill(value);
      return;
    }
  } catch {
    // ignore
  }
  // Positional fallback: first/second textbox (common for simple forms)
  try {
    const boxes = page.getByRole('textbox');
    if (typeof fieldHint !== 'string' && fieldHint.test('username')) {
      const first = boxes.first();
      if (await first.count()) { await first.fill(value); return; }
    }
    if (typeof fieldHint !== 'string' && fieldHint.test('password')) {
      const second = boxes.nth(1);
      if (await second.count()) { await second.fill(value); return; }
    }
    if (typeof fieldHint === 'string') {
      if (/username/i.test(fieldHint)) {
        const first = boxes.first();
        if (await first.count()) { await first.fill(value); return; }
      }
      if (/password/i.test(fieldHint)) {
        const second = boxes.nth(1);
        if (await second.count()) { await second.fill(value); return; }
      }
    }
  } catch {
    // ignore
  }
  throw new Error(
    `Auto-fix could not find input for ${fieldHint.toString()}. Please provide a stable hint (label/placeholder/role) or data-testid.`
  );
}

async function autoClick(page: Page, hint: string | RegExp): Promise<void> {
  const loc = await resolveLocator(page, hint);
  if (loc) {
    await loc.click({ timeout: 15000 }).catch(async () => {
      await loc.dispatchEvent('click');
    });
    return;
  }
  throw new Error(
    `Auto-fix could not locate clickable element for ${hint.toString()}. Please share selector details or add a data-testid.`
  );
}


async function autoExpectVisible(page: Page, hint: string | RegExp, timeoutMs = 20000): Promise<Locator> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    const loc = await resolveLocator(page, hint);
    if (loc) {
      try {
        await baseExpect(loc).toBeVisible({ timeout: 2000 });
        return loc;
      } catch (e) {
        lastErr = e;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `Auto-fix visibility check failed for ${hint.toString()} after ${timeoutMs}ms. ${String(lastErr ?? '')}`
  );
}

export const test = base.extend<AutoHelpers & { page: Page }>({
  // Override the default page to ensure headed and keep browser during failures
  page: async ({}, use, testInfo) => {
    const browser = await chromium.launch({ 
      headless: false,
      slowMo: 500, // Slow down actions for better visibility
      args: [
        '--start-maximized',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    const context = await browser.newContext({ 
      ignoreHTTPSErrors: true,
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Add comprehensive real-time DOM inspection helpers
    await page.addInitScript(() => {
      // Enhanced element inspection
      (window as any).inspectElement = (selector: string) => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.border = '3px solid red';
          element.style.backgroundColor = 'yellow';
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log('✅ Element found and highlighted:', selector);
          console.log('Element details:', {
            tagName: element.tagName,
            text: element.textContent?.trim(),
            id: element.id,
            className: element.className,
            visible: element.offsetParent !== null
          });
          return element;
        } else {
          console.log('❌ Element not found:', selector);
          return null;
        }
      };
      
      // Get all clickable elements with detailed info
      (window as any).getClickableElements = () => {
        const clickable = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick]');
        console.log('🔍 Clickable elements found:', clickable.length);
        const elements = Array.from(clickable).map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            tagName: el.tagName,
            text: el.textContent?.trim().substring(0, 50),
            id: el.id,
            className: el.className,
            visible: rect.width > 0 && rect.height > 0,
            position: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            selector: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').join('.') : ''}`
          };
        });
        console.table(elements);
        return elements;
      };
      
      // Find elements by text content
      (window as any).findByText = (text: string) => {
        const elements = Array.from(document.querySelectorAll('*')).filter(el => 
          el.textContent?.includes(text) && el.children.length === 0
        );
        console.log(`🔍 Elements containing "${text}":`, elements.length);
        elements.forEach((el, i) => {
          el.style.border = '2px solid blue';
          console.log(`[${i}] ${el.tagName}: "${el.textContent?.trim()}"`);
        });
        return elements;
      };
      
      // Get form elements
      (window as any).getFormElements = () => {
        const inputs = document.querySelectorAll('input, textarea, select');
        console.log('📝 Form elements found:', inputs.length);
        const elements = Array.from(inputs).map((el, i) => ({
          index: i,
          tagName: el.tagName,
          type: (el as HTMLInputElement).type,
          name: (el as HTMLInputElement).name,
          placeholder: (el as HTMLInputElement).placeholder,
          value: (el as HTMLInputElement).value,
          visible: el.offsetParent !== null
        }));
        console.table(elements);
        return elements;
      };
      
      // Highlight all elements of a type
      (window as any).highlightByTag = (tagName: string) => {
        const elements = document.querySelectorAll(tagName);
        console.log(`🎯 Found ${elements.length} ${tagName} elements`);
        elements.forEach((el, i) => {
          el.style.border = '1px solid green';
          el.style.backgroundColor = 'lightgreen';
        });
        return elements;
      };
    });
    
    try {
      await use(page);
    } catch (error) {
      // Enhanced failure handling with detailed debugging
      console.log('\n🚨 TEST FAILED - Browser kept open for inspection');
      console.log('Current URL:', page.url());
      console.log('Page title:', await page.title());
      console.log('Error:', error);
      
      // Save comprehensive DOM snapshot
      try {
        const html = await page.content();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `failure-dom-${timestamp}.html`;
        require('fs').writeFileSync(filename, html, 'utf8');
        console.log(`📄 DOM snapshot saved to ${filename}`);
      } catch (saveErr) {
        console.error('Failed to save DOM snapshot:', saveErr);
      }
      
      // Save screenshot
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `failure-screenshot-${timestamp}.png`;
        await page.screenshot({ path: filename, fullPage: true });
        console.log(`📸 Screenshot saved to ${filename}`);
      } catch (screenshotErr) {
        console.error('Failed to save screenshot:', screenshotErr);
      }
      
      console.log('\n🔧 Browser console helpers available:');
      console.log('- inspectElement("selector") - highlight an element');
      console.log('- getClickableElements() - list all clickable elements');
      console.log('- findByText("text") - find elements by text content');
      console.log('- getFormElements() - list all form inputs');
      console.log('- highlightByTag("button") - highlight all buttons');
      console.log('\n💡 Use these helpers to inspect the page and fix the test!');
      
      // Keep browser open indefinitely on failure for manual inspection
      console.log('🔄 Browser will remain open indefinitely for manual inspection...');
      await new Promise(() => {}); // Never resolves, keeping browser open
    } finally {
      // Only close on success
      if (testInfo.status === 'passed') {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    }
  },

  autoFill: async ({}, use) => { await use(autoFill); },
  autoClick: async ({}, use) => { await use(autoClick); },
  autoExpectVisible: async ({}, use) => { await use(autoExpectVisible); },
  debugStep: async ({}, use) => {
    await use(async (page: Page, label: string) => {
      // Step-by-step execution with 1s delay
      console.log(`🔄 STEP: ${label}`);
      
      // Configurable delay between steps (default 1000ms)
      const stepDelayEnv = Number(process.env.STEP_DELAY_MS);
      const stepDelayMs = Number.isFinite(stepDelayEnv) && stepDelayEnv >= 0 ? stepDelayEnv : 1000;
      await page.waitForTimeout(stepDelayMs);
      
      // In debug/confirm mode, pause to allow manual confirmation
      // Triggers if either PWDEBUG is set (Playwright inspector) OR explicit STEP_CONFIRM=1
      if (process.env.PWDEBUG || process.env.STEP_CONFIRM === '1') {
        console.log(`⏸️  PAUSED: ${label} - Press 'Resume' to continue`);
        // @ts-ignore
        await page.pause();
      }
      
      // Log current page state
      const currentUrl = page.url();
      const pageTitle = await page.title();
      console.log(`📍 Current URL: ${currentUrl}`);
      console.log(`📄 Page Title: ${pageTitle}`);
    });
  },
});

export const expect = baseExpect;


