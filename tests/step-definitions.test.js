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

test('plus card-key workflow starts from OAuth tail and never runs checkout or session import', () => {
  const steps = globalThis.MultiPageStepDefinitions.getSteps({
    activeFlowId: 'openai',
    panelMode: 'sub2api',
    plusModeEnabled: true,
    plusCardKeyWorkflow: true,
    signupMethod: 'email',
  });
  const keys = steps.map((step) => step.key);

  assert.deepEqual(keys, [
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'confirm-oauth',
    'platform-verify',
  ]);
  assert.deepEqual(steps.map((step) => step.id), [7, 8, 9, 10, 11]);
  assert.equal(keys.some((key) => key.includes('checkout')), false);
  assert.equal(keys.includes('sub2api-session-import'), false);
});
