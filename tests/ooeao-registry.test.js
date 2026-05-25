const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/hero-sms.js');
require('../phone-sms/providers/five-sim.js');
require('../phone-sms/providers/ooeao.js');
require('../phone-sms/providers/registry.js');

const registry = globalThis.PhoneSmsProviderRegistry;
const ooeao = globalThis.PhoneSmsOoeaoProvider;

test('registry exposes ooeao provider id and label', () => {
  assert.equal(registry.PROVIDER_OOEAO, 'ooeao');
  assert.equal(registry.normalizeProviderId('ooeao'), 'ooeao');
  assert.equal(registry.getProviderLabel('ooeao'), 'ooeao');
});

test('ooeao stays out of the default fallback provider order', () => {
  assert.deepEqual(
    registry.DEFAULT_PROVIDER_ORDER.slice(),
    ['hero-sms', '5sim', 'nexsms']
  );
});

test('registry can build the ooeao provider via createProvider', () => {
  const provider = registry.createProvider('ooeao');
  assert.equal(provider.id, 'ooeao');
  assert.equal(typeof provider.requestActivation, 'function');
  assert.equal(typeof provider.pollActivationCode, 'function');
});

test('ooeao normalizePool round-trips successfulUses and dedupes', () => {
  const normalized = ooeao.normalizePool([
    {
      phoneNumber: '+14129562571',
      verificationUrl: 'https://example.test/sms?key=a',
      successfulUses: 4,
      maxUses: 3,
    },
    {
      phoneNumber: '+14129562571',
      verificationUrl: 'https://example.test/sms?key=a',
    },
    {
      phoneNumber: '+14129562572',
      verificationUrl: 'https://example.test/sms?key=b',
      successfulUses: 1,
    },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].successfulUses, 3);
  assert.equal(normalized[0].maxUses, 3);
  assert.equal(normalized[1].successfulUses, 1);
});
