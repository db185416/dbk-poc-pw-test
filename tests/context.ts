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
  console.log(`🔧 Auto-filling field: ${fieldHint.toString()} with value: ${value}`);
  
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
        console.log(`✅ Auto-fill successful using strategy: ${loc.toString()}`);
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
      console.log('✅ Auto-fill successful using neighbor input strategy');
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
      if (await first.count()) { await first.fill(value); console.log('✅ Auto-fill successful using username positional strategy'); return; }
    }
    if (typeof fieldHint !== 'string' && fieldHint.test('password')) {
      const second = boxes.nth(1);
      if (await second.count()) { await second.fill(value); console.log('✅ Auto-fill successful using password positional strategy'); return; }
    }
    if (typeof fieldHint === 'string') {
      if (/username/i.test(fieldHint)) {
        const first = boxes.first();
        if (await first.count()) { await first.fill(value); console.log('✅ Auto-fill successful using username string strategy'); return; }
      }
      if (/password/i.test(fieldHint)) {
        const second = boxes.nth(1);
        if (await second.count()) { await second.fill(value); console.log('✅ Auto-fill successful using password string strategy'); return; }
      }
    }
  } catch {
    // ignore
  }
  
  // Enhanced auto-fix: Use browser-side smart finding
  try {
    console.log('🔄 Trying browser-side auto-fix...');
    const result = await page.evaluate(({ hint, val }) => {
      const element = (window as any).smartFind(hint, 'input');
      if (element) {
        (element as HTMLInputElement).value = val;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, { hint: fieldHint.toString(), val: value });
    
    if (result) {
      console.log('✅ Auto-fill successful using browser-side smart find');
      return;
    }
  } catch (e) {
    console.log('❌ Browser-side auto-fix failed:', e);
  }
  
  // Final attempt: Use autoFixElement
  try {
    console.log('🔄 Trying autoFixElement...');
    const result = await page.evaluate(({ hint, val }) => {
      const element = (window as any).autoFixElement(hint);
      if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA')) {
        (element as HTMLInputElement).value = val;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, { hint: fieldHint.toString(), val: value });
    
    if (result) {
      console.log('✅ Auto-fill successful using autoFixElement');
      return;
    }
  } catch (e) {
    console.log('❌ autoFixElement failed:', e);
  }
  
  console.log('❌ All auto-fill strategies failed');
  console.log('💡 Available debugging helpers:');
  console.log('- getFormElements() - see all form inputs');
  console.log('- smartFind("hint") - try to find element');
  console.log('- analyzePage() - understand page structure');
  
  throw new Error(
    `Auto-fix could not find input for ${fieldHint.toString()}. Use browser console helpers to investigate and fix manually.`
  );
}

async function autoClick(page: Page, hint: string | RegExp): Promise<void> {
  console.log(`🔧 Auto-clicking element: ${hint.toString()}`);
  
  const loc = await resolveLocator(page, hint);
  if (loc) {
    try {
      await loc.click({ timeout: 15000 });
      console.log(`✅ Auto-click successful using standard locator`);
      return;
    } catch (e) {
      console.log('🔄 Standard click failed, trying dispatchEvent...');
      try {
        await loc.dispatchEvent('click');
        console.log(`✅ Auto-click successful using dispatchEvent`);
        return;
      } catch (e2) {
        console.log('❌ dispatchEvent also failed:', e2);
      }
    }
  }
  
  // Enhanced auto-fix: Use browser-side smart finding
  try {
    console.log('🔄 Trying browser-side auto-fix...');
    const result = await page.evaluate((hint) => {
      const element = (window as any).smartFind(hint, 'button');
      if (element) {
        element.click();
        return true;
      }
      return false;
    }, hint.toString());
    
    if (result) {
      console.log('✅ Auto-click successful using browser-side smart find');
      return;
    }
  } catch (e) {
    console.log('❌ Browser-side auto-fix failed:', e);
  }
  
  // Final attempt: Use autoFixElement
  try {
    console.log('🔄 Trying autoFixElement...');
    const result = await page.evaluate((hint) => {
      const element = (window as any).autoFixElement(hint);
      if (element && (element.tagName === 'BUTTON' || element.tagName === 'A' || element.onclick)) {
        element.click();
        return true;
      }
      return false;
    }, hint.toString());
    
    if (result) {
      console.log('✅ Auto-click successful using autoFixElement');
      return;
    }
  } catch (e) {
    console.log('❌ autoFixElement failed:', e);
  }
  
  console.log('❌ All auto-click strategies failed');
  console.log('💡 Available debugging helpers:');
  console.log('- getClickableElements() - see all clickable elements');
  console.log('- smartFind("hint") - try to find element');
  console.log('- analyzePage() - understand page structure');
  
  throw new Error(
    `Auto-fix could not locate clickable element for ${hint.toString()}. Use browser console helpers to investigate and fix manually.`
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
        '--disable-features=VizDisplayCompositor',
        '--window-size=1920,1080',
        '--force-device-scale-factor=1'
      ]
    });
    const context = await browser.newContext({ 
      ignoreHTTPSErrors: true,
      // Use large viewport that matches browser window size
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Add comprehensive real-time DOM inspection helpers
    await page.addInitScript(() => {
      // Enhanced element inspection with auto-fix capabilities
      (window as any).inspectElement = (selector: string) => {
        const element = document.querySelector(selector);
        if (element) {
        (element as HTMLElement).style.border = '3px solid red';
        (element as HTMLElement).style.backgroundColor = 'yellow';
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log('✅ Element found and highlighted:', selector);
          console.log('Element details:', {
            tagName: element.tagName,
            text: element.textContent?.trim(),
            id: element.id,
            className: element.className,
            visible: (element as HTMLElement).offsetParent !== null,
            rect: element.getBoundingClientRect()
          });
          return element;
        } else {
          console.log('❌ Element not found:', selector);
          return null;
        }
      };
      
      // Auto-fix helper that tries multiple strategies
      (window as any).autoFixElement = (hint: string) => {
        console.log(`🔧 Attempting to auto-fix element: ${hint}`);
        
        // Strategy 1: Try exact text match
        let element = Array.from(document.querySelectorAll('*')).find(el => 
          el.textContent?.trim() === hint
        );
        if (element) {
          console.log('✅ Found by exact text match');
          return element;
        }
        
        // Strategy 2: Try partial text match
        element = Array.from(document.querySelectorAll('*')).find(el => 
          el.textContent?.toLowerCase().includes(hint.toLowerCase())
        );
        if (element) {
          console.log('✅ Found by partial text match');
          return element;
        }
        
        // Strategy 3: Try role-based search
        const roleSelectors = ['button', 'link', 'textbox', 'combobox'];
        for (const role of roleSelectors) {
          const foundElement = document.querySelector(`${role}[aria-label*="${hint}"], ${role}[title*="${hint}"]`);
          if (foundElement) {
            console.log(`✅ Found by ${role} with aria-label/title`);
            return foundElement;
          }
        }
        
        // Strategy 4: Try common patterns
        const patterns = [
          `[data-testid*="${hint}"]`,
          `[id*="${hint}"]`,
          `[class*="${hint}"]`,
          `[name*="${hint}"]`
        ];
        
        for (const pattern of patterns) {
          const foundElement = document.querySelector(pattern);
          if (foundElement) {
            console.log(`✅ Found by pattern: ${pattern}`);
            return foundElement;
          }
        }
        
        console.log('❌ Auto-fix failed - element not found');
        return undefined;
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
          (el as HTMLElement).style.border = '2px solid blue';
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
            visible: (el as HTMLElement).offsetParent !== null
        }));
        console.table(elements);
        return elements;
      };
      
      // Highlight all elements of a type
      (window as any).highlightByTag = (tagName: string) => {
        const elements = document.querySelectorAll(tagName);
        console.log(`🎯 Found ${elements.length} ${tagName} elements`);
        elements.forEach((el, i) => {
          (el as HTMLElement).style.border = '1px solid green';
          (el as HTMLElement).style.backgroundColor = 'lightgreen';
        });
        return elements;
      };
      
      // Advanced DOM analysis for debugging
      (window as any).analyzePage = () => {
        console.log('🔍 PAGE ANALYSIS:');
        console.log('URL:', window.location.href);
        console.log('Title:', document.title);
        console.log('Viewport:', {
          width: window.innerWidth,
          height: window.innerHeight
        });
        
        // Analyze all interactive elements
        const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [onclick]');
        console.log(`📊 Interactive elements: ${interactive.length}`);
        
        // Analyze forms
        const forms = document.querySelectorAll('form');
        console.log(`📝 Forms found: ${forms.length}`);
        
        // Analyze iframes
        const iframes = document.querySelectorAll('iframe');
        console.log(`🖼️ Iframes found: ${iframes.length}`);
        iframes.forEach((iframe, i) => {
          console.log(`  Iframe ${i}:`, {
            src: iframe.src,
            title: iframe.title,
            id: iframe.id,
            visible: (iframe as HTMLElement).offsetParent !== null
          });
        });
        
        return {
          interactive: interactive.length,
          forms: forms.length,
          iframes: iframes.length,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        };
      };
      
      // Smart element finder with multiple fallback strategies
      (window as any).smartFind = (hint: string, elementType = 'any') => {
        console.log(`🔍 Smart finding: "${hint}" (type: ${elementType})`);
        
        const strategies = [
          // Strategy 1: Exact text match
          () => Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent?.trim() === hint
          ),
          
          // Strategy 2: Partial text match
          () => Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent?.toLowerCase().includes(hint.toLowerCase())
          ),
          
          // Strategy 3: Role-based with text
          () => document.querySelector(`button:has-text("${hint}"), a:has-text("${hint}")`),
          
          // Strategy 4: Attribute-based
          () => document.querySelector(`[aria-label*="${hint}"], [title*="${hint}"], [alt*="${hint}"]`),
          
          // Strategy 5: ID/class based
          () => document.querySelector(`#${hint}, .${hint}`),
          
          // Strategy 6: Data attributes
          () => document.querySelector(`[data-testid*="${hint}"], [data-id*="${hint}"]`)
        ];
        
        for (let i = 0; i < strategies.length; i++) {
          try {
            const element = strategies[i]();
            if (element) {
              console.log(`✅ Found using strategy ${i + 1}`);
            (element as HTMLElement).style.border = '2px solid blue';
            (element as HTMLElement).style.backgroundColor = 'lightblue';
              return element;
            }
          } catch (e) {
            // Continue to next strategy
          }
        }
        
        console.log('❌ Smart find failed - no strategies worked');
        return undefined;
      };
      
      // Auto-retry mechanism for common actions
      (window as any).autoRetry = async (action: () => Promise<any>, maxRetries = 3, delay = 1000) => {
        for (let i = 0; i < maxRetries; i++) {
          try {
            console.log(`🔄 Auto-retry attempt ${i + 1}/${maxRetries}`);
            return await action();
          } catch (error) {
            console.log(`❌ Attempt ${i + 1} failed:`, error);
            if (i < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        throw new Error(`Auto-retry failed after ${maxRetries} attempts`);
      };
    });
    
    try {
      await use(page);
    } catch (error) {
      // Enhanced failure handling with detailed debugging - NO EXIT
      console.log('\n🚨 TEST FAILED - Browser kept open for inspection and auto-fix');
      console.log('Current URL:', page.url());
      console.log('Page title:', await page.title());
      console.log('Error:', error);
      
      // Run page analysis
      try {
        await page.evaluate(() => {
          (window as any).analyzePage();
        });
      } catch (analysisErr) {
        console.error('Failed to run page analysis:', analysisErr);
      }
      
      // Save comprehensive DOM snapshot
      try {
        const html = await page.content();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `failure-dom-${timestamp}.html`;
        const fs = (globalThis as any).require('fs');
        fs.writeFileSync(filename, html, 'utf8');
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
      
      console.log('\n🔧 ENHANCED Browser console helpers available:');
      console.log('- inspectElement("selector") - highlight an element');
      console.log('- autoFixElement("hint") - try to find element with multiple strategies');
      console.log('- smartFind("hint", "type") - advanced element finder');
      console.log('- getClickableElements() - list all clickable elements');
      console.log('- findByText("text") - find elements by text content');
      console.log('- getFormElements() - list all form inputs');
      console.log('- highlightByTag("button") - highlight all buttons');
      console.log('- analyzePage() - comprehensive page analysis');
      console.log('- autoRetry(action, retries, delay) - retry mechanism');
      console.log('\n💡 Use these helpers to inspect the page and fix the test!');
      console.log('🔄 Browser will remain open indefinitely for manual inspection and auto-fix...');
      
      // Enhanced debugging mode - keep browser open and provide interactive debugging
      console.log('\n🎯 INTERACTIVE DEBUGGING MODE:');
      console.log('1. Use browser console helpers to investigate the issue');
      console.log('2. Try autoFixElement() or smartFind() to locate problematic elements');
      console.log('3. Use analyzePage() to understand the page structure');
      console.log('4. Modify the test code based on findings');
      console.log('5. Re-run the test with fixes');
      
      // Keep browser open indefinitely on failure for manual inspection and auto-fix
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
      const stepDelayEnv = Number((globalThis as any).process?.env?.STEP_DELAY_MS);
      const stepDelayMs = Number.isFinite(stepDelayEnv) && stepDelayEnv >= 0 ? stepDelayEnv : 1000;
      await page.waitForTimeout(stepDelayMs);
      
      // In debug/confirm mode, pause to allow manual confirmation
      // Triggers if either PWDEBUG is set (Playwright inspector) OR explicit STEP_CONFIRM=1
      if ((globalThis as any).process?.env?.PWDEBUG || (globalThis as any).process?.env?.STEP_CONFIRM === '1') {
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


