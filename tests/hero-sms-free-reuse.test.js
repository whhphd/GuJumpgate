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

test('HeroSMS auto free reuse accepts waiting resend status with old V2 code', async () => {
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'setStatus') {
        assert.equal(parsed.searchParams.get('status'), '3');
        return {
          ok: true,
          text: async () => 'ACCESS_RETRY_GET',
        };
      }
      if (action === 'getStatusV2') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            verificationType: 0,
            sms: {
              dateTime: '2026-05-27 19:11:14',
              code: '383403',
              text: 'Ваш проверочный код OpenAI: 383403',
            },
            call: null,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const prepared = await helpers.prepareFreeReusablePhoneActivation({
    heroSmsApiKey: 'hero-key',
    phoneSmsProvider: 'hero-sms',
  }, {
    activationId: 'hero-activation-1',
    phoneNumber: '5527992637970',
    provider: 'hero-sms',
    countryId: 73,
    statusAction: 'getStatusV2',
    successfulUses: 1,
    maxUses: 3,
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.activation.source, 'free-auto-reuse');
  assert.equal(prepared.activation.ignoreExistingCode, '383403');
});

test('HeroSMS polling ignores old free reuse code and waits for a new one', async () => {
  let pollCount = 0;
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getStatusV2') {
        pollCount += 1;
        return {
          ok: true,
          text: async () => JSON.stringify({
            verificationType: 0,
            sms: {
              code: pollCount === 1 ? '383403' : '918274',
              text: pollCount === 1
                ? 'Ваш проверочный код OpenAI: 383403'
                : 'Ваш проверочный код OpenAI: 918274',
            },
            call: null,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const code = await helpers.pollPhoneActivationCode({
    heroSmsApiKey: 'hero-key',
    phoneSmsProvider: 'hero-sms',
  }, {
    activationId: 'hero-activation-1',
    phoneNumber: '5527992637970',
    provider: 'hero-sms',
    countryId: 73,
    statusAction: 'getStatusV2',
    ignoreExistingCode: '383403',
  }, {
    timeoutMs: 1000,
    intervalMs: 1,
  });

  assert.equal(code, '918274');
  assert.equal(pollCount, 2);
});
