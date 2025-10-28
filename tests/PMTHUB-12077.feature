Feature: Login
  As a consumer user
  I want to login to the application
  So that I can access my account securely

  Background:
    Given I am on the consumer login page "https://www.iqa018.com/dbank/live/app/login/consumer"

  Scenario: Successful login with username, password and MFA verification
    Given I am on the login page
    When I enter username "test18"
    And I enter password "test123"
    And I click the "Login" button
    Then I should see the MFA verification page
    When I click the "Text Me" button
    And I enter verification code "0000"
    And I register my private device
    Then I should be successfully logged in
    And the device should be registered

