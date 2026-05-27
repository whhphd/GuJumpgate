const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/chatgpt-api.js');

function createState(overrides = {}) {
  return {
    chatGptApiSmsPoolText: [
      '628111111111----https://example.test/api/sms/1',
      '628222222222----https://example.test/api/sms/2',
    ].join('\n'),
    chatGptApiSmsPoolUsage: {},
    chatGptApiSmsPoolAutoDisableEnabled: true,
    chatGptApiCurrentSmsEntry: null,
    ...overrides,
  };
}

function createProviderWithState(initialState, overrides = {}) {
  let state = { ...initialState };
  const provider = globalThis.PhoneSmsChatGptApiProvider.createProvider({
    fetchImpl: overrides.fetchImpl || (async () => ({
      ok: true,
      text: async () => JSON.stringify({ message: 'verification code 123456' }),
    })),
    random: overrides.random || Math.random,
    getState: async () => state,
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    addLog: async () => {},
  });
  return {
    provider,
    getState: () => state,
  };
}

test('ChatGPT API provider picks the least-used enabled pool entry', async () => {
  const initialState = createState({
    chatGptApiSmsPoolUsage: {
      '628111111111----https://example.test/api/sms/1': {
        useCount: 3,
        usedAt: 10,
        enabled: true,
      },
      '628222222222----https://example.test/api/sms/2': {
        useCount: 1,
        usedAt: 20,
        enabled: true,
      },
    },
  });
  const { provider, getState } = createProviderWithState(initialState);

  const activation = await provider.requestActivation(getState());

  assert.equal(activation.provider, 'chatgpt-api');
  assert.equal(activation.phoneNumber, '628222222222');
  assert.equal(activation.activationId, '628222222222----https://example.test/api/sms/2');
  assert.equal(activation.countryId, 6);
  assert.equal(activation.countryLabel, 'Indonesia');
  assert.equal(getState().chatGptApiCurrentSmsEntry.phone, '628222222222');
  assert.equal(getState().chatGptApiSmsPoolUsage[activation.activationId].useCount, 2);
});

test('ChatGPT API provider randomly picks among least-used enabled pool entries', async () => {
  const initialState = createState({
    chatGptApiSmsPoolUsage: {
      '628111111111----https://example.test/api/sms/1': {
        useCount: 0,
        usedAt: 10,
        enabled: true,
      },
      '628222222222----https://example.test/api/sms/2': {
        useCount: 0,
        usedAt: 20,
        enabled: true,
      },
    },
  });
  const { provider } = createProviderWithState(initialState, { random: () => 0.75 });

  const activation = await provider.requestActivation(initialState);

  assert.equal(activation.activationId, '628222222222----https://example.test/api/sms/2');
  assert.equal(activation.phoneNumber, '628222222222');
});

test('ChatGPT API provider keeps +1 country code and infers USA for 11-digit numbers', async () => {
  const initialState = createState({
    chatGptApiSmsPoolText: '17198279624----https://example.test/api/sms/us',
  });
  const { provider } = createProviderWithState(initialState);

  const activation = await provider.requestActivation(initialState);

  assert.equal(activation.phoneNumber, '17198279624');
  assert.equal(activation.countryId, 187);
  assert.equal(activation.countryLabel, 'USA');
});

test('ChatGPT API provider extracts Chinese OpenAI verification code response', () => {
  assert.equal(
    globalThis.PhoneSmsChatGptApiProvider.extractVerificationCode('YES|您的 OpenAI 验证代码是：302995|2026-05-26 23:41:31'),
    '302995'
  );
});

test('ChatGPT API provider skips disabled pool entries', async () => {
  const disabledKey = '628111111111----https://example.test/api/sms/1';
  const enabledKey = '628222222222----https://example.test/api/sms/2';
  const initialState = createState({
    chatGptApiSmsPoolUsage: {
      [disabledKey]: {
        useCount: 0,
        usedAt: 0,
        enabled: false,
        disabledReason: '号码被目标站拒绝',
      },
      [enabledKey]: {
        useCount: 5,
        usedAt: 20,
        enabled: true,
      },
    },
  });
  const { provider } = createProviderWithState(initialState);

  const activation = await provider.requestActivation(initialState);

  assert.equal(activation.activationId, enabledKey);
  assert.equal(activation.phoneNumber, '628222222222');
});

test('ChatGPT API provider keeps entry enabled until more than three polling failures', async () => {
  const key = '628111111111----https://example.test/api/sms/1';
  const initialState = createState({
    chatGptApiSmsPoolText: key,
    chatGptApiSmsPoolUsage: {
      [key]: {
        useCount: 1,
        usedAt: 10,
        enabled: true,
        failureCount: 2,
      },
    },
    chatGptApiCurrentSmsEntry: {
      key,
      phone: '628111111111',
      verificationUrl: 'https://example.test/api/sms/1',
    },
  });
  const { provider, getState } = createProviderWithState(initialState, {
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ message: 'waiting for sms' }),
    }),
  });

  await assert.rejects(
    () => provider.pollActivationCode(getState(), {
      activationId: key,
      phoneNumber: '628111111111',
      provider: 'chatgpt-api',
    }, {
      timeoutMs: 10,
      intervalMs: 1,
      maxRounds: 1,
    }),
    /PHONE_CODE_TIMEOUT::/
  );

  const usage = getState().chatGptApiSmsPoolUsage[key];
  assert.equal(usage.failureCount, 3);
  assert.equal(usage.enabled, true);
});

test('ChatGPT API provider disables entry after fourth polling failure', async () => {
  const key = '628111111111----https://example.test/api/sms/1';
  const initialState = createState({
    chatGptApiSmsPoolText: key,
    chatGptApiSmsPoolUsage: {
      [key]: {
        useCount: 1,
        usedAt: 10,
        enabled: true,
        failureCount: 3,
      },
    },
    chatGptApiCurrentSmsEntry: {
      key,
      phone: '628111111111',
      verificationUrl: 'https://example.test/api/sms/1',
    },
  });
  const { provider, getState } = createProviderWithState(initialState, {
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({ message: 'waiting for sms' }),
    }),
  });

  await assert.rejects(
    () => provider.pollActivationCode(getState(), {
      activationId: key,
      phoneNumber: '628111111111',
      provider: 'chatgpt-api',
    }, {
      timeoutMs: 10,
      intervalMs: 1,
      maxRounds: 1,
    }),
    /PHONE_CODE_TIMEOUT::/
  );

  const usage = getState().chatGptApiSmsPoolUsage[key];
  assert.equal(usage.failureCount, 4);
  assert.equal(usage.enabled, false);
  assert.match(usage.disabledReason, /等待手机验证码超时|暂未返回有效验证码|waiting/i);
});

test('ChatGPT API provider cancellation does not count as polling failure', async () => {
  const key = '628111111111----https://example.test/api/sms/1';
  const initialState = createState({
    chatGptApiSmsPoolText: key,
    chatGptApiSmsPoolUsage: {
      [key]: {
        useCount: 1,
        usedAt: 10,
        enabled: true,
        failureCount: 2,
      },
    },
    chatGptApiCurrentSmsEntry: {
      key,
      phone: '628111111111',
      verificationUrl: 'https://example.test/api/sms/1',
    },
  });
  const { provider, getState } = createProviderWithState(initialState);

  const result = await provider.cancelActivation(getState(), {
    activationId: key,
    phoneNumber: '628111111111',
    provider: 'chatgpt-api',
  });

  const usage = getState().chatGptApiSmsPoolUsage[key];
  assert.equal(result, 'CANCELLED');
  assert.equal(usage.failureCount, 2);
  assert.equal(usage.enabled, true);
  assert.equal(getState().chatGptApiCurrentSmsEntry, null);
});

test('ChatGPT API provider ban force-disables rejected entries', async () => {
  const key = '628111111111----https://example.test/api/sms/1';
  const initialState = createState({
    chatGptApiSmsPoolText: key,
    chatGptApiSmsPoolUsage: {
      [key]: {
        useCount: 1,
        usedAt: 10,
        enabled: true,
        failureCount: 0,
      },
    },
    chatGptApiCurrentSmsEntry: {
      key,
      phone: '628111111111',
      verificationUrl: 'https://example.test/api/sms/1',
    },
  });
  const { provider, getState } = createProviderWithState(initialState);

  const result = await provider.banActivation(getState(), {
    activationId: key,
    phoneNumber: '628111111111',
    provider: 'chatgpt-api',
  });

  const usage = getState().chatGptApiSmsPoolUsage[key];
  assert.equal(result, 'BANNED');
  assert.equal(usage.failureCount, 1);
  assert.equal(usage.enabled, false);
  assert.equal(usage.disabledReason, '号码被目标站拒绝');
  assert.equal(getState().chatGptApiCurrentSmsEntry, null);
});
