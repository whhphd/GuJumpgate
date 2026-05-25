const assert = require('node:assert/strict');
const test = require('node:test');

require('../data/step-definitions.js');

function getStepKeys(options = {}) {
  return globalThis.MultiPageStepDefinitions.getSteps({
    activeFlowId: 'openai',
    plusModeEnabled: true,
    plusPaymentMethod: 'paypal',
    plusHostedCheckoutIsFinalStep: true,
    plusAccountAccessStrategy: 'oauth',
    signupMethod: 'email',
    ...options,
  }).map((step) => step.key);
}

test('hosted checkout OAuth tail verifies phone before confirming OAuth', () => {
  const keys = getStepKeys();

  assert.deepEqual(keys.slice(-5), [
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'confirm-oauth',
    'platform-verify',
  ]);
});
