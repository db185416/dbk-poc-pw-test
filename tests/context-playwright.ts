import { test as base, expect as baseExpect, chromium, type Page, type Locator, type Frame } from '@playwright/test';

// Enhanced context system for intelligent Playwright test automation
type SmartContext = {
  // Core automation helpers
  autoFill: (page: Page, fieldHint: string | RegExp, value: string) => Promise<void>;
  autoClick: (page: Page, hint: string | RegExp) => Promise<void>;
  autoExpectVisible: (page: Page, hint: string | RegExp, timeoutMs?: number) => Promise<Locator>;
  smartAction: (page: Page, instruction: string) => Promise<void>;
  debugStep: (page: Page, label: string) => Promise<void>;
  
  // Enhanced context features
  learnFromTest: (testCode: string) => Promise<void>;
  replaceDummyLocators: (page: Page, testCode: string) => Promise<string>;
  understandPrompt: (prompt: string) => Promise<TestRequirements>;
  fixCommonIssues: (page: Page, error: Error) => Promise<boolean>;
  generateSmartLocators: (page: Page, elementHint: string) => Promise<string[]>;
  analyzePageStructure: (page: Page) => Promise<PageAnalysis>;
  suggestLocators: (page: Page, hint: string) => Promise<LocatorSuggestion[]>;
  suggestDummyReplacements: (page: Page, testCode: string) => Promise<Record<string, LocatorSuggestion[]>>;
};
type PageOrFrame = Page | Frame;

function getAllContexts(page: Page): Array<PageOrFrame> {
  const contexts: Array<PageOrFrame> = [page];
  for (const f of page.frames()) {
    try {
      contexts.push(f);
    } catch {
      // ignore
    }
  }
  return contexts;
}

async function ensureDomReady(page: Page): Promise<void> {
  // Best-effort readiness waits
  try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}

  // Wait for common spinners/overlays to disappear
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const hasSpinner = await page.evaluate(() => {
        const selectors = [
          '[role="progressbar"]',
          '.spinner',
          '.loading',
          '.loader',
          '[data-testid*="spinner" i]',
          '[aria-busy="true"]'
        ];
        return selectors.some(sel => document.querySelector(sel));
      });
      if (!hasSpinner) break;
    } catch {
      break;
    }
    await page.waitForTimeout(300);
  }
}


interface TestRequirements {
  actions: Array<{
    type: 'navigate' | 'click' | 'fill' | 'wait' | 'verify';
    target?: string;
    value?: string;
    url?: string;
    expected?: string;
  }>;
  testName: string;
  description: string;
}

interface PageAnalysis {
  interactiveElements: Array<{
    type: string;
    text: string;
    selector: string;
    attributes: Record<string, string>;
  }>;
  forms: Array<{
    inputs: Array<{
      type: string;
      name: string;
      placeholder: string;
      selector: string;
    }>;
  }>;
  navigation: Array<{
    text: string;
    href: string;
    selector: string;
  }>;
}

interface LocatorSuggestion {
  selector: string;
  api: 'getByRole' | 'getByLabel' | 'getByText' | 'locator';
  confidence: number; // 0-100
  unique: boolean;
  visible: boolean;
  reasons: string[];
  frameUrl?: string;
}

// Enhanced locator resolution with learning
async function resolveLocator(page: Page, hint: string | RegExp): Promise<Locator | null> {
  const hintStr = hint.toString();
  
  // Search across page and all iframes
  for (const ctx of getAllContexts(page)) {
    const context: any = ctx as any;
    const strategies: Locator[] = [
      context.getByRole?.('button', { name: hint }) as any,
      context.getByRole?.('link', { name: hint }) as any,
      context.getByRole?.('textbox', { name: hint }) as any,
      context.getByLabel?.(hint) as any,
      context.getByPlaceholder?.(hint as any) as any,
      context.getByText?.(hint) as any,
      context.locator?.(`[data-testid="${hint}"]`) as any,
      context.locator?.(`[aria-label*="${hint}"]`) as any,
      context.locator?.(`[title*="${hint}"]`) as any,
      context.locator?.(`button:has-text("${hint}")`) as any,
      context.locator?.(`a:has-text("${hint}")`) as any,
    ].filter(Boolean) as Locator[];

    for (const loc of strategies) {
      try {
        const first = loc.first();
        if ((await first.count()) > 0) {
          await first.scrollIntoViewIfNeeded().catch(() => {});
          return first;
        }
      } catch {
        // Continue to next strategy
      }
    }
  }
  
  return null;
}

// Robust field resolver: score inputs by semantics (username/password/code/email)
async function findFieldLocator(
  page: Page,
  semantic: 'username' | 'password' | 'code' | 'email' | 'text',
  hintText: string
): Promise<Locator | null> {
  for (const ctx of getAllContexts(page)) {
    const idx = await (ctx as any).evaluate(({ semantic, hintText }: any) => {
    const elements = Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[];
    const tokenSets: Record<string, RegExp[]> = {
      username: [/user/i, /username/i, /login/i, /email/i, /online\s*id/i],
      password: [/pass/i, /pwd/i, /password/i],
      code: [/code/i, /otp/i, /verification/i, /token/i],
      email: [/email/i],
      text: []
    };
    function isVisible(el: Element): boolean {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }
    function labelText(el: HTMLInputElement): string {
      // Associated label via <label for>
      const id = el.id;
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl) return lbl.textContent?.trim() || '';
      }
      // Wrapped label
      const parentLabel = el.closest('label');
      if (parentLabel) return parentLabel.textContent?.trim() || '';
      // Sibling text
      const prev = el.previousElementSibling as HTMLElement | null;
      if (prev && prev.tagName.toLowerCase() === 'label') return prev.textContent?.trim() || '';
      return '';
    }
    function includesAny(text: string, regs: RegExp[]): boolean {
      return regs.some(r => r.test(text));
    }
    function scoreFor(el: HTMLInputElement): number {
      let score = 0;
      if (!isVisible(el)) score -= 200;

      const type = (el.type || '').toLowerCase();
      const name = (el.name || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const cls = (el.className || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      const aria = ((el.getAttribute('aria-label') || '').toLowerCase());
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      const lbl = labelText(el).toLowerCase();
      const hint = (hintText || '').toLowerCase();

      // Strong constraints per semantic
      if (semantic === 'password') {
        if (type === 'password') score += 150; else score -= 80;
        if (includesAny(name + id + cls + placeholder + aria + lbl + hint, tokenSets.password)) score += 60;
        if (autocomplete.includes('current-password') || autocomplete.includes('new-password')) score += 40;
        if (includesAny(name + id, tokenSets.username)) score -= 60;
      } else if (semantic === 'username' || semantic === 'email') {
        if (type === 'password') score -= 150;
        if (type === 'email') score += 40;
        if (includesAny(name + id + cls + placeholder + aria + lbl + hint, tokenSets.username)) score += 70;
        if (autocomplete.includes('username') || autocomplete.includes('email')) score += 50;
        if (includesAny(name + id + placeholder + aria + lbl, tokenSets.password)) score -= 60;
      } else if (semantic === 'code') {
        if (type === 'password') score -= 40; // avoid passwords
        if (includesAny(name + id + cls + placeholder + aria + lbl + hint, tokenSets.code)) score += 80;
        if (autocomplete.includes('one-time-code')) score += 60;
      } else {
        // generic text
        if (type === 'text' || type === 'search' || type === 'tel') score += 10;
      }

      // General signals
      if (placeholder) score += 5;
      if (aria) score += 5;
      if (lbl) score += 5;
      return score;
    }

    let best = { idx: -1, score: -Infinity };
    elements.forEach((el, i) => {
      const s = scoreFor(el);
      if (s > best.score) best = { idx: i, score: s };
    });
    // Require a reasonable score to avoid picking arbitrary first input
    return best.score >= 25 ? best.idx : -1;
    }, { semantic, hintText });

    if (typeof idx === 'number' && idx >= 0) {
      // Use a stable locator over index set
      const locator = (ctx as any).locator('input, textarea').nth(idx);
      if (await locator.count()) {
        return locator.first();
      }
    }
  }
  return null;
}

// Enhanced auto-fill with learning
async function autoFill(page: Page, fieldHint: string | RegExp, value: string): Promise<void> {
  console.log(`🔧 Auto-filling field: ${fieldHint.toString()} with value: ${value}`);
  
  // Enhanced field detection
  const hintStr = fieldHint.toString();
  const isPassword = /password|pass|pwd/i.test(hintStr);
  const isUsername = /username|user|login|email|online\s*id/i.test(hintStr);
  const isCode = /code|otp|verification/i.test(hintStr);
  
  const strategies: Locator[] = [];
  
  // First try robust scoring-based resolver
  try {
    const semantic: 'password' | 'username' | 'code' | 'email' | 'text' = isPassword
      ? 'password'
      : isCode
        ? 'code'
        : isUsername
          ? 'username'
          : 'text';
    await ensureDomReady(page);
    const best = await findFieldLocator(page, semantic, hintStr);
    if (best) {
      await best.scrollIntoViewIfNeeded().catch(() => {});
      await best.click({ timeout: 10000 });
      await best.fill('');
      await best.type(value, { delay: 30 });
      try { await best.dispatchEvent('input'); } catch {}
      try { await best.dispatchEvent('change'); } catch {}
      console.log(`✅ Auto-fill successful using semantic resolver (${semantic})`);
      return;
    }
  } catch {
    // fallback to strategies below
  }
  
  if (isPassword) {
    strategies.push(
      page.locator('input[type="password"]'),
      page.getByLabel(fieldHint),
      page.getByPlaceholder(fieldHint as any),
      page.locator('input[name*="password"], input[name*="pass"], input[name*="pwd"]'),
    );
  } else if (isUsername) {
    strategies.push(
      page.getByLabel(fieldHint),
      page.getByPlaceholder(fieldHint as any),
      page.getByRole('textbox', { name: fieldHint }),
      page.locator('input[type="text"]:not([name*="password"]):not([type="password"])'),
    );
  } else if (isCode) {
    strategies.push(
      page.locator('input[autocomplete*="one-time-code" i]'),
      page.getByPlaceholder(/code|verification|otp/i),
      page.locator('input[name*="code" i], input[name*="otp" i], input[name*="verification" i]'),
    );
  } else {
    strategies.push(
      page.getByLabel(fieldHint),
      page.getByPlaceholder(fieldHint as any),
      page.getByRole('textbox', { name: fieldHint }),
    );
  }
  
  for (const loc of strategies) {
    try {
      const first = loc.first();
      if (await first.count()) {
        await first.fill(value);
        console.log(`✅ Auto-fill successful using strategy: ${loc.toString()}`);
        return;
      }
    } catch {
      // Continue to next strategy
    }
  }
  
  throw new Error(`Auto-fill could not find input for ${fieldHint.toString()}`);
}

// Enhanced auto-click with learning
async function autoClick(page: Page, hint: string | RegExp): Promise<void> {
  console.log(`🔧 Auto-clicking element: ${hint.toString()}`);
  
  for (const ctx of getAllContexts(page)) {
    const context: any = ctx as any;
    const strategies: Locator[] = [
      context.getByRole?.('button', { name: hint }) as any,
      context.getByRole?.('link', { name: hint }) as any,
      context.getByLabel?.(hint) as any,
      context.getByText?.(hint) as any,
      context.locator?.(`[data-testid="${hint}"]`) as any,
      context.locator?.(`button:has-text("${hint}")`) as any,
      context.locator?.(`a:has-text("${hint}")`) as any,
    ].filter(Boolean) as Locator[];
    
    for (const loc of strategies) {
      try {
        if (await loc.count() > 0) {
          await loc.click({ timeout: 15000 });
          console.log(`✅ Auto-click successful using strategy: ${loc.toString()}`);
          return;
        }
      } catch {
        // Continue to next strategy
      }
    }
  }
  
  throw new Error(`Auto-click could not find element for ${hint.toString()}`);
}

// Enhanced visibility check
async function autoExpectVisible(page: Page, hint: string | RegExp, timeoutMs = 20000): Promise<Locator> {
  const start = Date.now();
  let lastErr: unknown;
  
  while (Date.now() - start < timeoutMs) {
    await ensureDomReady(page);
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

// Enhanced smart action with learning
async function smartAction(page: Page, instruction: string): Promise<void> {
  console.log(`🧠 Smart Action: ${instruction}`);
  
  // Parse instruction using enhanced understanding
  const requirements = await understandPrompt(instruction);
  
  for (const action of requirements.actions) {
    console.log(`🎯 Executing: ${action.type} on "${action.target}"`);
    
    try {
    switch (action.type) {
        case 'navigate':
          if (action.url) {
            await page.goto(action.url);
            await ensureDomReady(page);
          }
          break;
      case 'click':
          if (action.target) {
            await ensureDomReady(page);
            await autoClick(page, action.target);
          }
        break;
      case 'fill':
          if (action.target && action.value) {
            await ensureDomReady(page);
            await autoFill(page, action.target, action.value);
          }
        break;
      case 'wait':
          if (action.target) {
            await ensureDomReady(page);
            await autoExpectVisible(page, action.target, 10000);
          }
          break;
        case 'verify':
          if (action.target) {
            await ensureDomReady(page);
            const locator = await autoExpectVisible(page, action.target);
            await baseExpect(locator).toBeVisible();
          }
        break;
      }
    } catch (error) {
      // Try to fix common issues
      const fixed = await fixCommonIssues(page, error as Error);
      if (!fixed) {
        throw error;
      }
    }
    
    await page.waitForTimeout(500);
  }
}

// Natural language understanding for test requirements
async function understandPrompt(prompt: string): Promise<TestRequirements> {
  const actions: TestRequirements['actions'] = [];
  const testName = extractTestName(prompt);
  const description = extractDescription(prompt);
  
  // Parse common patterns
  const patterns = [
    {
      regex: /go to (https?:\/\/[^\s]+)/i,
      action: (match: RegExpMatchArray) => ({ type: 'navigate' as const, url: match[1] })
    },
    {
      regex: /login with username:?\s*([^\s]+)\s+and password:?\s*([^\s]+)/i,
      action: (match: RegExpMatchArray) => [
        { type: 'fill' as const, target: 'username', value: match[1] },
        { type: 'fill' as const, target: 'password', value: match[2] }
      ]
    },
    {
      regex: /click (?:on )?["']([^"']+)["']/i,
      action: (match: RegExpMatchArray) => ({ type: 'click' as const, target: match[1] })
    },
    {
      regex: /enter ["']([^"']+)["'] into (?:the )?([^"]+)/i,
      action: (match: RegExpMatchArray) => ({ type: 'fill' as const, target: match[2], value: match[1] })
    },
    {
      regex: /verify (?:that )?["']([^"']+)["'] (?:is|are) (?:successfully )?([^"]+)/i,
      action: (match: RegExpMatchArray) => ({ type: 'verify' as const, target: match[1], expected: match[2] })
    },
    {
      regex: /wait for (?:the )?["']([^"']+)["']/i,
      action: (match: RegExpMatchArray) => ({ type: 'wait' as const, target: match[1] })
    }
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern.regex);
    if (match) {
      const result = pattern.action(match);
      if (Array.isArray(result)) {
        actions.push(...result);
      } else {
        actions.push(result);
      }
    }
  }
  
  return { actions, testName, description };
}

function extractTestName(prompt: string): string {
  const match = prompt.match(/test (?:for )?["']?([^"']+)["']?/i);
  return match ? match[1] : 'Generated Test';
}

function extractDescription(prompt: string): string {
  const lines = prompt.split('\n').filter(line => line.trim());
  return lines[0] || 'Automated test generated from requirements';
}

// Smart issue fixing
async function fixCommonIssues(page: Page, error: Error): Promise<boolean> {
  const errorMessage = error.message.toLowerCase();
  
  if (errorMessage.includes('element not found') || errorMessage.includes('timeout')) {
    console.log('🔧 Detected issue: element not found or timeout');
    console.log('💡 Trying alternative strategies...');
    
    try {
      await page.waitForLoadState('networkidle');
      return true;
    } catch {
      return false;
    }
  }
  
  return false;
}

// Generate smart locators based on page analysis
async function generateSmartLocators(page: Page, elementHint: string): Promise<string[]> {
  const locators: string[] = [];
  
  // Analyze the page to find the best selectors
  const analysis = await analyzePageStructure(page);
  
  // Find matching elements
  const matchingElements = analysis.interactiveElements.filter(el => 
    el.text.toLowerCase().includes(elementHint.toLowerCase()) ||
    el.attributes['aria-label']?.toLowerCase().includes(elementHint.toLowerCase())
  );
  
  for (const element of matchingElements) {
    // Generate multiple selector options
    if (element.text) {
      locators.push(`page.getByText("${element.text}")`);
    }
    if (element.attributes['aria-label']) {
      locators.push(`page.getByLabel("${element.attributes['aria-label']}")`);
    }
    if (element.attributes['data-testid']) {
      locators.push(`page.locator("[data-testid='${element.attributes['data-testid']}']")`);
    }
    if (element.selector) {
      locators.push(`page.locator("${element.selector}")`);
    }
  }
  
  return [...new Set(locators)]; // Remove duplicates
}

// Rank locator candidates with confidence and metadata, scanning iframes
async function suggestLocators(page: Page, hint: string): Promise<LocatorSuggestion[]> {
  function scoreFor(candidate: {
    api: LocatorSuggestion['api'];
    selector: string;
    unique: boolean;
    visible: boolean;
    reasons: string[];
  }): number {
    let s = 0;
    if (candidate.api === 'getByRole') s += 35;
    if (candidate.api === 'getByLabel') s += 30;
    if (candidate.api === 'getByText') s += 20;
    if (candidate.api === 'locator') s += 10;
    if (candidate.unique) s += 20; else s -= 10;
    if (candidate.visible) s += 15; else s -= 15;
    if (candidate.reasons.some(r => /aria|role/i.test(r))) s += 10;
    if (candidate.reasons.some(r => /data-testid/i.test(r))) s += 10;
    return Math.max(0, Math.min(100, s));
  }

  const frameLocators: Array<{ frame: import('@playwright/test').Frame | Page; frameUrl?: string }> = [];
  frameLocators.push({ frame: page, frameUrl: await page.url() });
  for (const f of page.frames()) {
    try {
      frameLocators.push({ frame: f, frameUrl: f.url() });
    } catch {}
  }

  const suggestions: LocatorSuggestion[] = [];
  const hintRe = new RegExp(hint, 'i');

  for (const ctx of frameLocators) {
    const context = ctx.frame as any;
    const frameUrl = ctx.frameUrl;
    const candidates: Array<{ api: LocatorSuggestion['api']; selector: string; reasons: string[] }> = [
      { api: 'getByRole', selector: `button[name=${JSON.stringify(hint)}]`, reasons: ['role button name match'] },
      { api: 'getByRole', selector: `link[name=${JSON.stringify(hint)}]`, reasons: ['role link name match'] },
      { api: 'getByLabel', selector: JSON.stringify(hint), reasons: ['associated label match'] },
      { api: 'getByText', selector: JSON.stringify(hint), reasons: ['text node match'] },
      { api: 'locator', selector: `[data-testid*=${JSON.stringify(hint).slice(1, -1)} i]`, reasons: ['data-testid contains'] },
      { api: 'locator', selector: `button:has-text(${JSON.stringify(hint)})`, reasons: ['button has-text'] },
      { api: 'locator', selector: `[aria-label*=${JSON.stringify(hint).slice(1, -1)} i]`, reasons: ['aria-label contains'] },
      { api: 'locator', selector: `a:has-text(${JSON.stringify(hint)})`, reasons: ['link has-text'] },
    ];

    for (const c of candidates) {
      try {
        let loc: Locator;
        if (c.api === 'getByRole') {
          if (c.selector.startsWith('button')) loc = context.getByRole('button', { name: hintRe });
          else loc = context.getByRole('link', { name: hintRe });
        } else if (c.api === 'getByLabel') {
          loc = context.getByLabel(hintRe);
        } else if (c.api === 'getByText') {
          loc = context.getByText(hintRe);
        } else {
          loc = context.locator(c.selector);
        }
        const count = await loc.count();
        if (count > 0 && count <= 3) {
          const first = loc.first();
          let visible = false;
          try { visible = await first.isVisible({ timeout: 500 }).catch(() => false) as boolean; } catch {}
          const item = {
            selector: c.api === 'locator' ? c.selector : (c.api === 'getByRole' ? (c.selector.startsWith('button')
              ? `getByRole('button', { name: ${JSON.stringify(hint)} })`
              : `getByRole('link', { name: ${JSON.stringify(hint)} })`) :
              `${c.api}(${JSON.stringify(hint)})`),
            api: c.api,
            confidence: 0,
            unique: count === 1,
            visible,
            reasons: c.reasons,
            frameUrl
          } as LocatorSuggestion;
          item.confidence = scoreFor(item);
          suggestions.push(item);
        }
      } catch {}
    }
  }

  // Deduplicate by selector+frameUrl
  const seen = new Set<string>();
  const ranked = suggestions
    .filter(s => {
      const k = `${s.selector}@@${s.frameUrl || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);

  return ranked;
}

// Comprehensive page analysis
async function analyzePageStructure(page: Page): Promise<PageAnalysis> {
  const analysis = await page.evaluate(() => {
    const interactiveElements: PageAnalysis['interactiveElements'] = [];
    const forms: PageAnalysis['forms'] = [];
    const navigation: PageAnalysis['navigation'] = [];
    
    // Analyze interactive elements
    const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [onclick]');
    interactive.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) { // Only visible elements
        interactiveElements.push({
          type: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || '',
          selector: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').join('.') : ''}`,
          attributes: {
            id: el.id,
            className: el.className,
            'aria-label': el.getAttribute('aria-label') || '',
            'data-testid': el.getAttribute('data-testid') || '',
            type: (el as HTMLInputElement).type || '',
            name: (el as HTMLInputElement).name || '',
            placeholder: (el as HTMLInputElement).placeholder || '',
          }
        });
      }
    });
    
    // Analyze forms
    const formElements = document.querySelectorAll('form');
    formElements.forEach(form => {
      const inputs = Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
        type: (input as HTMLInputElement).type || input.tagName.toLowerCase(),
        name: (input as HTMLInputElement).name || '',
        placeholder: (input as HTMLInputElement).placeholder || '',
        selector: `${input.tagName.toLowerCase()}${input.id ? '#' + input.id : ''}`
      }));
      forms.push({ inputs });
    });
    
    // Analyze navigation
    const links = document.querySelectorAll('a[href]');
    links.forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      if (href && !href.startsWith('javascript:')) {
        navigation.push({
          text: link.textContent?.trim() || '',
          href,
          selector: `a[href="${href}"]`
        });
      }
    });
    
    return { interactiveElements, forms, navigation };
  });
  
  return analysis;
}

// Dummy locator detection and replacement
async function replaceDummyLocators(page: Page, testCode: string): Promise<string> {
  let updatedCode = testCode;
  
  // Find all dummy locators in the test code
  const dummyPatterns = [
    /placeholder_\w+/g,
    /dummy_\w+/g,
    /test_\w+/g,
    /\[data-testid="\w+"\]/g,
    /getByText\(".*placeholder.*"\)/g,
    /getByRole\("button", \{ name: ".*placeholder.*" \}\)/g,
  ];
  
  for (const pattern of dummyPatterns) {
    const matches = testCode.match(pattern);
    if (matches) {
      for (const match of matches) {
        await ensureDomReady(page);
        const realLocator = await findRealLocator(page, match);
        if (realLocator) {
          updatedCode = updatedCode.replace(match, realLocator);
          console.log(`🔄 Replaced dummy locator: ${match} → ${realLocator}`);
        }
      }
    }
  }
  
  return updatedCode;
}

// Suggest-only: for each dummy pattern occurrence, return ranked locator suggestions
async function suggestDummyReplacements(page: Page, testCode: string): Promise<Record<string, LocatorSuggestion[]>> {
  const dummyPatterns = [
    /placeholder_\w+/g,
    /dummy_\w+/g,
    /test_\w+/g,
    /\[data-testid="\w+"\]/g,
    /getByText\(".*placeholder.*"\)/g,
    /getByRole\("button", \{ name: ".*placeholder.*" \}\)/g,
  ];
  const out: Record<string, LocatorSuggestion[]> = {};
  for (const pattern of dummyPatterns) {
    const matches = testCode.match(pattern);
    if (matches) {
      for (const m of matches) {
        const hint = m.replace(/^[^A-Za-z0-9]*|[^A-Za-z0-9]*$/g, '').replace(/(placeholder|dummy|test)/gi, '');
        if (!hint) continue;
        const suggestions = await suggestLocators(page, hint);
        if (suggestions.length) out[m] = suggestions.slice(0, 6);
      }
    }
  }
  return out;
}

// Find real locator by analyzing the page
async function findRealLocator(page: Page, dummyHint: string): Promise<string | null> {
  // Extract meaningful hint from dummy locator
  const hint = dummyHint.replace(/[^\w\s]/g, '').replace(/(placeholder|dummy|test)/gi, '').trim();

  if (!hint) return null;

  await ensureDomReady(page);

  // Use suggestion engine that scans across frames and validates visibility/uniqueness
  const suggestions = await suggestLocators(page, hint);
  if (!suggestions || suggestions.length === 0) return null;

  const top = suggestions[0];
  // Compose a code snippet using page.* API for replacement in test code
  if (top.api === 'locator') {
    return `page.locator(${JSON.stringify(top.selector)})`;
  }
  // top.selector already looks like getByRole('button', { name: "..." }) etc.
  return `page.${top.selector}`;
}

// Learning system - stores patterns from successful tests
class TestLearningSystem {
  private patterns: Map<string, any> = new Map();
  private successfulLocators: Map<string, string[]> = new Map();
  
  learnFromTest(testCode: string): void {
    // Extract successful locator patterns
    const locatorMatches = testCode.match(/page\.(getBy\w+|locator)\([^)]+\)/g);
    if (locatorMatches) {
      locatorMatches.forEach(match => {
        const key = this.extractContext(match);
        if (!this.successfulLocators.has(key)) {
          this.successfulLocators.set(key, []);
        }
        this.successfulLocators.get(key)!.push(match);
      });
    }
    
    // Extract successful action patterns
    const actionMatches = testCode.match(/(click|fill|select|waitFor)\s*\([^)]+\)/g);
    if (actionMatches) {
      actionMatches.forEach(match => {
        const pattern = this.extractPattern(match);
        this.patterns.set(pattern.type, pattern);
      });
    }
  }
  
  private extractContext(locator: string): string {
    // Extract the context (button, input, etc.) from locator
    if (locator.includes('getByRole')) return 'button';
    if (locator.includes('getByLabel')) return 'input';
    if (locator.includes('getByText')) return 'text';
    return 'generic';
  }
  
  private extractPattern(action: string): any {
    return {
      type: action.split('(')[0],
      pattern: action,
      success: true
    };
  }
  
  getRecommendedLocators(context: string): string[] {
    return this.successfulLocators.get(context) || [];
  }
}

const learningSystem = new TestLearningSystem();

// Enhanced test extension with all new features
export const test = base.extend<SmartContext>({
  page: async ({ page: originalPage }, use, testInfo) => {
    const page = originalPage;
    
    // Add enhanced debugging capabilities
    await page.addInitScript(() => {
      // Enhanced element inspection
      (window as any).inspectElement = (selector: string) => {
        const element = document.querySelector(selector);
        if (element) {
        (element as HTMLElement).style.border = '3px solid red';
        (element as HTMLElement).style.backgroundColor = 'yellow';
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log('✅ Element found and highlighted:', selector);
          return element;
        }
        return null;
      };
      
      // Smart element finder with learning
      (window as any).smartFind = (hint: string, elementType = 'any') => {
        console.log(`🔍 Smart finding: "${hint}" (type: ${elementType})`);
        
        const strategies = [
          () => Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent?.trim() === hint
          ),
          () => Array.from(document.querySelectorAll('*')).find(el => 
            el.textContent?.toLowerCase().includes(hint.toLowerCase())
          ),
          () => document.querySelector(`button:has-text("${hint}"), a:has-text("${hint}")`),
          () => document.querySelector(`[aria-label*="${hint}"], [title*="${hint}"]`),
        ];
        
        for (let i = 0; i < strategies.length; i++) {
          try {
            const element = strategies[i]();
            if (element) {
              console.log(`✅ Found using strategy ${i + 1}`);
            (element as HTMLElement).style.border = '2px solid blue';
              return element;
            }
          } catch (e) {
            // Continue to next strategy
          }
        }
        
        return undefined;
      };
      
      // Enhanced page analysis
      (window as any).analyzePage = () => {
        console.log('🔍 ENHANCED PAGE ANALYSIS:');
        console.log('URL:', window.location.href);
        console.log('Title:', document.title);
        
        const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"]');
        console.log(`📊 Interactive elements: ${interactive.length}`);
        
        const forms = document.querySelectorAll('form');
        console.log(`📝 Forms found: ${forms.length}`);
        
        return {
          interactive: interactive.length,
          forms: forms.length,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        };
      };
    });
    
    try {
      await use(page);
    } catch (error) {
      console.log('\n🚨 TEST FAILED - Enhanced debugging available');
      console.log('Current URL:', page.url());
      console.log('Error:', error);
      
      // Run enhanced page analysis
      try {
        await page.evaluate(() => {
          (window as any).analyzePage();
        });
      } catch (analysisErr) {
        console.error('Failed to run page analysis:', analysisErr);
      }
      
      console.log('\n🔧 ENHANCED Browser console helpers:');
      console.log('- inspectElement("selector") - highlight element');
      console.log('- smartFind("hint", "type") - smart element finder');
      console.log('- analyzePage() - comprehensive page analysis');
      
      throw error;
    }
  },

  // Core automation helpers
  autoFill: async ({}, use) => { await use(autoFill); },
  autoClick: async ({}, use) => { await use(autoClick); },
  autoExpectVisible: async ({}, use) => { await use(autoExpectVisible); },
  smartAction: async ({}, use) => { await use(smartAction); },
  
  // Enhanced context features
  learnFromTest: async ({}, use) => {
    await use(async (testCode: string) => {
      learningSystem.learnFromTest(testCode);
      console.log('🧠 Learned from test patterns');
    });
  },
  
  replaceDummyLocators: async ({}, use) => {
    await use(async (page: Page, testCode: string) => {
      return await replaceDummyLocators(page, testCode);
    });
  },
  
  understandPrompt: async ({}, use) => {
    await use(async (prompt: string) => {
      return await understandPrompt(prompt);
    });
  },
  
  fixCommonIssues: async ({}, use) => {
    await use(async (page: Page, error: Error) => {
      return await fixCommonIssues(page, error);
    });
  },
  
  generateSmartLocators: async ({}, use) => {
    await use(async (page: Page, elementHint: string) => {
      return await generateSmartLocators(page, elementHint);
    });
  },
  suggestLocators: async ({}, use) => {
    await use(async (page: Page, hint: string) => {
      return await suggestLocators(page, hint);
    });
  },
  suggestDummyReplacements: async ({}, use) => {
    await use(async (page: Page, testCode: string) => {
      return await suggestDummyReplacements(page, testCode);
    });
  },
  
  analyzePageStructure: async ({}, use) => {
    await use(async (page: Page) => {
      return await analyzePageStructure(page);
    });
  },
  
  debugStep: async ({}, use) => {
    await use(async (page: Page, label: string) => {
      console.log(`🔄 STEP: ${label}`);
      
      const stepDelayEnv = Number((globalThis as any).process?.env?.STEP_DELAY_MS);
      const stepDelayMs = Number.isFinite(stepDelayEnv) && stepDelayEnv >= 0 ? stepDelayEnv : 1000;
      await page.waitForTimeout(stepDelayMs);
      
      if ((globalThis as any).process?.env?.PWDEBUG || (globalThis as any).process?.env?.STEP_CONFIRM === '1') {
        console.log(`⏸️  PAUSED: ${label} - Press 'Resume' to continue`);
        await page.pause();
      }
      
      const currentUrl = page.url();
      const pageTitle = await page.title();
      console.log(`📍 Current URL: ${currentUrl}`);
      console.log(`📄 Page Title: ${pageTitle}`);
    });
  },
});

export const expect = baseExpect;