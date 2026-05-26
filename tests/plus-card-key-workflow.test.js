const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.document = {
  readyState: 'loading',
  addEventListener() {},
  getElementById() {
    return null;
  },
};
globalThis.window = globalThis;
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener() {},
    },
  },
};

require('../sidepanel/plus-card-key-workflow.js');
require('../background/sub2api-api.js');

const classifyFailure = globalThis.PlusCardKeyWorkflow.classifyFailure;

function createFieldStub({
  value = '',
  label = '',
  placeholder = '',
  name = '',
  id = '',
} = {}) {
  const field = {
    value,
    placeholder,
    name,
    id,
    labels: label ? [{ innerText: label }] : [],
    getAttribute(attribute) {
      return attribute === 'aria-label' ? label : '';
    },
    closest(selector) {
      return selector === 'label' && label ? { innerText: label } : null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    dispatchEvent() {},
  };
  return field;
}

test('plus card key transient failures preserve current entry and pause queue', () => {
  for (const message of [
    '用户停止 Plus 卡密自动流程。',
    '自动任务窗口已不可用，请在目标 Chrome 窗口重新打开侧边栏并启动任务。 原因：No window with id: 0.',
    '等待后台 Plus 卡密工作流完成超时。',
    'Plus 卡密取码站邮箱取码超时，未识别到验证码。',
    'TypeError: Failed to fetch',
    'SUB2API 请求失败：/api/v1/admin/openai/exchange-code。请检查 SUB2API 地址、网络、代理或服务状态。原始错误：Failed to fetch',
  ]) {
    assert.deepEqual(classifyFailure(message), {
      removeEntry: false,
      stopQueue: true,
      status: 'paused',
      reason: 'transient',
    });
  }
});

test('plus card key confirmed business failures remove current entry', () => {
  for (const message of [
    '卡密无效，请检查后重试。',
    '卡密已使用。',
    '验证码被页面拒绝：123456',
    '尚未配置 SUB2API 登录邮箱，请先在侧边栏填写。',
    '手机号绑定失败。',
  ]) {
    assert.equal(classifyFailure(message).removeEntry, true);
    assert.equal(classifyFailure(message).stopQueue, false);
  }
});

test('sub2api fetch failures include endpoint context for plus card key retry classification', async () => {
  const api = globalThis.MultiPageBackgroundSub2ApiApi.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    fetchImpl: async (url) => {
      if (/\/api\/v1\/auth\/login$/.test(url)) {
        return new Response(JSON.stringify({ code: 0, data: { access_token: 'token' } }), { status: 200 });
      }
      throw new TypeError('Failed to fetch');
    },
  });

  await assert.rejects(
    () => api.submitOpenAiCallback({
      sub2apiUrl: 'https://sub.example.com',
      sub2apiEmail: 'admin@example.com',
      sub2apiPassword: 'secret',
      sub2apiSessionId: 'session-1',
      sub2apiOAuthState: 'state-1',
      sub2apiGroupId: 2,
      localhostUrl: 'http://localhost:1455/auth/callback?code=code-1&state=state-1',
    }),
    /SUB2API 请求失败：\/api\/v1\/admin\/openai\/exchange-code/
  );
});

test('plus card exchange reads the labeled email field instead of stale page text', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: 'stale-before@icloud.com' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: 'OLDSECRET01' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      emailField.value = 'primacy-rations-1k+di0@icloud.com';
      secretField.value = 'D3D54344E639E62C';
    },
  };

  try {
    globalThis.HTMLInputElement = function HTMLInputElement() {};
    globalThis.HTMLTextAreaElement = function HTMLTextAreaElement() {};
    globalThis.Event = function Event(type) {
      this.type = type;
    };
    globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    globalThis.document = {
      body: {
        innerText: '页面旧文本 primacy-rations-1k+48k@icloud.com',
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', ['29NE-BKLR-DAY4']);
    assert.deepEqual(result, {
      email: 'primacy-rations-1k+di0@icloud.com',
      mailSecret: 'D3D54344E639E62C',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});
