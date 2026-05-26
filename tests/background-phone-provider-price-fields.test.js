const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/phone-verification-flow.js');

function createHelpers(overrides = {}) {
  return globalThis.MultiPageBackgroundPhoneVerification.createPhoneVerificationHelpers({
    addLog: overrides.addLog || (async () => {}),
    fetchImpl: overrides.fetchImpl,
    getState: overrides.getState || (async () => ({})),
    setState: overrides.setState || (async () => {}),
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
  });
}

test('SMSPool activation uses SMSPool price fields instead of HeroSMS price fields', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.1': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:sp-1:15551234567',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smspool',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.06',
    smsPoolApiKey: 'sms-pool-key',
    smsPoolCountryId: 1,
    smsPoolCountryLabel: 'USA',
    smsPoolMaxPrice: '0.08',
    smsPoolServiceCode: '671',
  });

  assert.equal(activation.provider, 'smspool');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.08');
});

test('Hero-like fallback providers use their own price fields', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.12': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:grizzly-1:15557654321',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'grizzlysms',
    heroSmsApiKey: 'hero-key',
    heroSmsMaxPrice: '0.05',
    grizzlySmsApiKey: 'grizzly-key',
    grizzlySmsCountryId: 1,
    grizzlySmsCountryLabel: 'USA',
    grizzlySmsMaxPrice: '0.09',
    grizzlySmsServiceCode: 'dr',
  });

  assert.equal(activation.provider, 'grizzlysms');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.09');
});
