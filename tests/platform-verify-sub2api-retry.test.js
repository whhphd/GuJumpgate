const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.self = globalThis;

require('../background/steps/platform-verify.js');

test('plus card platform verify retries SUB2API login fetch failures with same callback', async () => {
  const logs = [];
  const completed = [];
  let attempts = 0;
  const executor = globalThis.MultiPageBackgroundStep10.createStep10Executor({
    addLog: async (message, level, options) => logs.push({ message, level, options }),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
    createSub2ApiApi: () => ({
      submitOpenAiCallback: async (state, options) => {
        attempts += 1;
        assert.equal(state.localhostUrl, 'http://localhost:1455/auth/callback?code=code-1&state=state-1');
        assert.equal(options.timeoutMs, 10000);
        assert.equal(options.createTimeoutMs, 10000);
        if (attempts < 3) {
          throw new Error('SUB2API 请求失败：/api/v1/auth/login。请检查 SUB2API 地址、网络、代理或服务状态。原始错误：Failed to fetch');
        }
        return {
          localhostUrl: state.localhostUrl,
          verifiedStatus: 'SUB2API 已创建账号 #42',
        };
      },
    }),
    getPanelMode: () => 'sub2api',
    isLocalhostOAuthCallbackUrl: (url) => /^http:\/\/localhost:1455\/auth\/callback\?/.test(url),
    normalizeSub2ApiUrl: (value) => value,
    SUB2API_STEP9_RESPONSE_TIMEOUT_MS: 120000,
  });

  await executor.executeStep10({
    nodeId: 'platform-verify',
    panelMode: 'sub2api',
    plusCardKeyWorkflow: true,
    localhostUrl: 'http://localhost:1455/auth/callback?code=code-1&state=state-1',
    sub2apiSessionId: 'session-1',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'secret',
    sub2apiUrl: 'https://sub.example.com',
  });

  assert.equal(attempts, 3);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].nodeId, 'platform-verify');
  assert.equal(completed[0].payload.verifiedStatus, 'SUB2API 已创建账号 #42');
  assert.equal(logs.some((item) => /重试 2\/5/.test(item.message)), true);
});
