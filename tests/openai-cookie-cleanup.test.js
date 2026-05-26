const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.self = globalThis;

require('../background/steps/open-chatgpt.js');

test('OpenAI cookie cleanup preserves plus card key site cookies', async () => {
  const removed = [];
  const browsingDataOrigins = [];
  const logs = [];
  const cookies = [
    { domain: '.auth.openai.com', path: '/', name: 'auth-cookie', storeId: '0' },
    { domain: '.chatgpt.com', path: '/', name: 'chat-cookie', storeId: '0' },
    { domain: '.plus.keria.cc.cd', path: '/', name: 'plus-card-cookie', storeId: '0' },
  ];
  const chromeApi = {
    cookies: {
      getAllCookieStores: async () => [{ id: '0' }],
      getAll: async () => cookies,
      remove: async (details) => {
        removed.push(details);
        return details;
      },
    },
    browsingData: {
      removeCookies: async (details) => {
        browsingDataOrigins.push(...(details.origins || []));
      },
    },
  };

  const result = await globalThis.MultiPageBackgroundStep1.clearOpenAiCookies(chromeApi, {
    addLog: async (message, type) => logs.push({ message, type }),
    label: 'Plus 卡密工作流',
    actionLabel: 'OAuth 登录前',
  });

  assert.equal(result.skipped, false);
  assert.equal(result.removedCount, 2);
  assert.deepEqual(
    removed.map((item) => item.name).sort(),
    ['auth-cookie', 'chat-cookie']
  );
  assert.equal(removed.some((item) => item.name === 'plus-card-cookie'), false);
  assert.equal(browsingDataOrigins.includes('https://auth.openai.com'), true);
  assert.equal(browsingDataOrigins.includes('https://chatgpt.com'), true);
  assert.equal(browsingDataOrigins.includes('https://plus.keria.cc.cd'), false);
  assert.equal(logs.some((item) => /OAuth 登录前清理 ChatGPT \/ OpenAI cookies/.test(item.message)), true);
});
