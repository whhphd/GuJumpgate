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

test('HeroSMS activation tries price tiers from low to high without fixed price', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices' || action === 'getPricesExtended') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            '0.2348': { count: 1, physicalCount: 1 },
            '0.115': { count: 1, physicalCount: 1 },
            '0.2942': { count: 1, physicalCount: 1 },
          }),
        };
      }
      if (action === 'getNumberV2') {
        getNumberUrls.push(parsed);
        if (getNumberUrls.length === 1) {
          return {
            ok: true,
            text: async () => 'NO_NUMBERS',
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'hero-1',
            phoneNumber: '15550001111',
            activationCost: 0.2348,
            countryCode: 1,
          }),
        };
      }
      if (action === 'getNumber') {
        return {
          ok: true,
          text: async () => 'NO_NUMBERS',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 151,
    heroSmsCountryLabel: 'Chile',
    heroSmsMaxPrice: '0.5',
  });

  assert.equal(activation.provider, 'hero-sms');
  assert.equal(getNumberUrls.length, 2);
  assert.deepEqual(getNumberUrls.map((url) => url.searchParams.get('maxPrice')), ['0.115', '0.2348']);
  assert.equal(getNumberUrls[0].searchParams.has('fixedPrice'), false);
  assert.equal(getNumberUrls[1].searchParams.has('fixedPrice'), false);
  assert.equal(activation.price, 0.2348);
});


test('HeroSMS activation uses available price tier without fixed price', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices' || action === 'getPricesExtended') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.025': { count: 1, physicalCount: 1 } }),
        };
      }
      if (action === 'getNumberV2') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'hero-1',
            phoneNumber: '15550001111',
            activationCost: 0.025,
            countryCode: 1,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 151,
    heroSmsCountryLabel: 'Chile',
    heroSmsMaxPrice: '0.5',
  });

  assert.equal(activation.provider, 'hero-sms');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('action'), 'getNumberV2');
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.025');
  assert.equal(getNumberUrls[0].searchParams.has('fixedPrice'), false);
  assert.equal(activation.price, 0.025);
});

test('HeroSMS activation expands max price incrementally up to configured limit', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices' || action === 'getPricesExtended') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.045': { count: 1, physicalCount: 1 } }),
        };
      }
      if (action === 'getNumberV2') {
        getNumberUrls.push(parsed);
        if (getNumberUrls.length < 5) {
          return {
            ok: true,
            text: async () => 'NO_NUMBERS',
          };
        }
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'hero-1',
            phoneNumber: '15550001111',
            activationCost: 0.115,
            countryCode: 1,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 73,
    heroSmsCountryLabel: 'Brazil',
    heroSmsMaxPrice: '0.5',
  });

  assert.equal(activation.provider, 'hero-sms');
  assert.deepEqual(
    getNumberUrls.map((url) => url.searchParams.get('maxPrice')),
    ['0.045', '0.0563', '0.0704', '0.088', '0.11']
  );
  assert.equal(getNumberUrls.some((url) => url.searchParams.has('fixedPrice')), false);
  assert.equal(activation.price, 0.115);
  assert.equal(activation.attemptedMaxPrice, 0.11);
});
test('HeroSMS activation falls back to configured max price when tiers are below min price', async () => {
  const getNumberUrls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices' || action === 'getPricesExtended') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.045': { count: 1, physicalCount: 1 } }),
        };
      }
      if (action === 'getNumberV2') {
        getNumberUrls.push(parsed);
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'hero-1',
            phoneNumber: '15550001111',
            activationCost: 0.08,
            countryCode: 1,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 73,
    heroSmsCountryLabel: 'Brazil',
    heroSmsMinPrice: '0.05',
    heroSmsMaxPrice: '0.5',
  });

  assert.equal(activation.provider, 'hero-sms');
  assert.equal(getNumberUrls.length, 1);
  assert.equal(getNumberUrls[0].searchParams.get('maxPrice'), '0.0625');
  assert.equal(getNumberUrls[0].searchParams.has('fixedPrice'), false);
  assert.equal(activation.price, 0.08);
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
