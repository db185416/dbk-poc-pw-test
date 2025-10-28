import { test, expect } from './context-playwright';

/**
 * Jira Ticket: PMTHUB-12077
 * Summary: Free form login test
 * 
 * Feature: Login
 * Description: Login to application with username and password. 
 *              On MFA click "Text Me" button and use "0000" code and register device.
 * 
 * Test URL: https://www.iqa018.com/dbank/live/app/login/consumer
 * Credentials: test18 / test123
 */

test.describe('PMTHUB-12077: Feature - Login with username, password and MFA verification', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to the consumer login page
    await page.goto('https://www.iqa018.com/dbank/live/app/login/consumer');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Scenario: Successful login with username, password and MFA verification', async ({ 
    page, 
    autoFill, 
    autoClick, 
    autoExpectVisible, 
    debugStep 
  }) => {
    // Increase test timeout for slower page loads
    test.setTimeout(60000);
    
    // Step 1: Verify we are on the login page
    await debugStep(page, 'Step 1: Verify login page is loaded');
    await expect(page).toHaveURL(/login\/consumer/);
    
    // Step 2: Enter username
    await debugStep(page, 'Step 2: Enter username');
    await autoFill(page, /username|user|online.*id/i, 'test18');
    
    // Step 3: Enter password
    await debugStep(page, 'Step 3: Enter password');
    await autoFill(page, /password|pass/i, 'test123');
    
    // Step 4: Click Login button
    await debugStep(page, 'Step 4: Click Login button');
    // Wait for the login button to be visible and enabled
    await page.waitForTimeout(1000);
    const loginButton = page.getByRole('button', { name: 'Login', exact: true });
    await loginButton.waitFor({ state: 'visible', timeout: 10000 });
    await loginButton.click();
    
    // Step 5: Wait for MFA page to load
    await debugStep(page, 'Step 5: Wait for MFA verification page');
    // Wait for MFA page to load - look for the "Secure login" heading
    await page.waitForLoadState('networkidle', { timeout: 40000 });
    await page.getByRole('heading', { name: 'Secure login' }).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1000); // Additional wait for buttons to be ready
    
    // Step 6: Click "Text Me" button for MFA
    await debugStep(page, 'Step 6: Click Text Me button for MFA');
    // Use direct locator for "Text me" button
    const textMeButton = page.getByRole('button', { name: /text me/i }).first();
    await textMeButton.waitFor({ state: 'visible', timeout: 10000 });
    await textMeButton.click();
    
    // Wait for code input field to be visible
    await page.waitForTimeout(2000);
    
    // Step 7: Enter verification code
    await debugStep(page, 'Step 7: Enter verification code');
    await autoFill(page, /code|verification|otp/i, '0000');
    
    // Step 8: Submit verification code and register device
    await debugStep(page, 'Step 8: Register device with verification code');
    // Click "Yes, register my private device" button
    const registerButton = page.getByRole('button', { name: /yes.*register.*private.*device/i });
    await registerButton.waitFor({ state: 'visible', timeout: 10000 });
    await registerButton.click();
    
    // Step 9: Verify successful login
    await debugStep(page, 'Step 9: Verify successful login and device registration');
    await page.waitForLoadState('networkidle');
    
    // Verify we are logged in (URL should change from login page)
    await expect(page).not.toHaveURL(/login/);
    
    // Additional verification - check for common post-login elements
    // This may need adjustment based on actual application behavior
    await page.waitForTimeout(2000);
    
    console.log('✅ Test completed successfully - User logged in with MFA');
  });

  test('Scenario Outline: Login validation', async ({ page, autoFill }) => {
    // This is a placeholder for testing different login scenarios
    // Can be expanded with data-driven tests
    
    await autoFill(page, /username/i, 'test18');
    await autoFill(page, /password/i, 'test123');
    
    // Click login button with explicit locator
    await page.waitForTimeout(1000);
    const loginButton = page.getByRole('button', { name: 'Login', exact: true });
    await loginButton.waitFor({ state: 'visible', timeout: 10000 });
    await loginButton.click();
    
    // Verify navigation occurred
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/login\/consumer$/);
  });
});

