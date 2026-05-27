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
const {
  getNextRunnableEntryFromEntries,
  getRetryStatusForSelectedEntry,
} = globalThis.PlusCardKeyWorkflow._test;

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
  ]) {
    assert.deepEqual(classifyFailure(message), {
      removeEntry: false,
      stopQueue: true,
      status: 'paused',
      reason: 'transient',
    });
  }
});

test('plus card key SUB2API transient import failures are deferred without stopping queue', () => {
  assert.deepEqual(
    classifyFailure('SUB2API 请求失败：/api/v1/admin/openai/exchange-code。请检查 SUB2API 地址、网络、代理或服务状态。原始错误：Failed to fetch'),
    {
      removeEntry: false,
      stopQueue: false,
      status: 'import_pending',
      reason: 'sub2api_transient',
    }
  );
});

test('plus card key import pending entries are skipped by auto queue until selected for retry', () => {
  const entries = [
    { id: 'card-1', status: 'import_pending', email: 'done@example.com' },
    { id: 'card-2', status: 'pending', email: '' },
  ];

  assert.equal(getNextRunnableEntryFromEntries(entries, 'card-1')?.id, 'card-2');
  assert.equal(getRetryStatusForSelectedEntry(entries[0]), 'exchanged');
  assert.equal(getRetryStatusForSelectedEntry({ id: 'card-3', status: 'pending' }), null);
});

test('plus card key confirmed business failures remove current entry', () => {
  for (const message of [
    '卡密无效，请检查后重试。',
    '卡密已使用。',
    '验证码被页面拒绝：123456',
    '尚未配置 SUB2API 登录邮箱，请先在侧边栏填写。',
    '手机号绑定失败。',
    '步骤 8：Plus 卡密对应账号已被删除或停用：错误代码：account_deactivated',
    '身份验证错误：account deleted or disabled',
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

test('plus card exchange retries clicks when card site reports failed fetch', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  let bodyText = '页面旧文本 primacy-rations-1k+48k@icloud.com';
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: 'primacy-rations-1k+48k@icloud.com' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: 'OLDSECRET01' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      if (clickCount < 3) {
        bodyText = 'Error: Failed to fetch';
        emailField.value = 'primacy-rations-1k+48k@icloud.com';
        secretField.value = 'OLDSECRET01';
        return;
      }
      bodyText = '换出成功';
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
        get innerText() {
          return bodyText;
        },
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', [
      '29NE-BKLR-DAY4',
      { maxAttempts: 3, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 3);
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

test('plus card exchange retries when card site says card key is still empty', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  let bodyText = '';
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: '' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      assert.equal(cardField.value, '84KN-MH75-SBDL');
      if (clickCount === 1) {
        bodyText = '请输入卡密';
        return;
      }
      bodyText = '换出成功';
      emailField.value = 'pukka.15montane+ake@icloud.com';
      secretField.value = '22DECC1918DE3087';
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
        get innerText() {
          return bodyText;
        },
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', [
      '84KN-MH75-SBDL',
      { maxAttempts: 2, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 2);
    assert.deepEqual(result, {
      email: 'pukka.15montane+ake@icloud.com',
      mailSecret: '22DECC1918DE3087',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card exchange fills the labeled card field instead of a visible batch textarea', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  const batchTextarea = createFieldStub({ label: '兑换码列表', value: '' });
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: '' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      assert.equal(batchTextarea.value, '');
      assert.equal(cardField.value, '84KN-MH75-SBDL');
      emailField.value = 'pukka.15montane+ake@icloud.com';
      secretField.value = '22DECC1918DE3087';
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
        innerText: '邮箱取码 登录网页',
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        if (selector === 'textarea') return [batchTextarea, cardField];
        return [batchTextarea, cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', [
      '84KN-MH75-SBDL',
      { maxAttempts: 1, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 1);
    assert.deepEqual(result, {
      email: 'pukka.15montane+ake@icloud.com',
      mailSecret: '22DECC1918DE3087',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card context restore submits existing card before OAuth retry', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: '' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      assert.equal(cardField.value, 'U939-SJ5U-TW5M');
      emailField.value = 'pukka.15montane+82o@icloud.com';
      secretField.value = '22DECC1918DE3087';
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
        innerText: '',
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('restoreContext', [{
      cardKey: 'U939-SJ5U-TW5M',
      email: 'pukka.15montane+82o@icloud.com',
      mailSecret: '22DECC1918DE3087',
      options: {
        maxAttempts: 1,
        settleMs: 1,
        clickTimeoutMs: 5,
        retryDelayMs: 1,
        pollMs: 1,
      },
    }]);

    assert.equal(clickCount, 1);
    assert.deepEqual(result, {
      email: 'pukka.15montane+82o@icloud.com',
      mailSecret: '22DECC1918DE3087',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card context restore accepts the same email returned for the same card', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: 'U939-SJ5U-TW5M' });
  const emailField = createFieldStub({ label: '邮箱', value: 'pukka.15montane+82o@icloud.com' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '22DECC1918DE3087' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      assert.equal(cardField.value, 'U939-SJ5U-TW5M');
      emailField.value = 'pukka.15montane+82o@icloud.com';
      secretField.value = '22DECC1918DE3087';
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
        innerText: '',
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('restoreContext', [{
      cardKey: 'U939-SJ5U-TW5M',
      email: 'pukka.15montane+82o@icloud.com',
      mailSecret: '22DECC1918DE3087',
      options: {
        maxAttempts: 1,
        settleMs: 1,
        clickTimeoutMs: 5,
        retryDelayMs: 1,
        pollMs: 1,
      },
    }]);

    assert.equal(clickCount, 1);
    assert.deepEqual(result, {
      email: 'pukka.15montane+82o@icloud.com',
      mailSecret: '22DECC1918DE3087',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card exchange switches from batch pickup to email code panel before submitting card', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let activePanel = 'batch';
  let navClickCount = 0;
  let exchangeClickCount = 0;
  const batchTextarea = createFieldStub({ label: '兑换码列表', value: '' });
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: '' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '' });
  const emailCodeNav = {
    innerText: '邮箱取码 登录网页',
    getBoundingClientRect() {
      return { width: 100, height: 44 };
    },
    click() {
      navClickCount += 1;
      activePanel = 'email';
    },
  };
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      exchangeClickCount += 1;
      assert.equal(batchTextarea.value, '');
      assert.equal(cardField.value, 'U939-SJ5U-TW5M');
      emailField.value = 'pukka.15montane+82o@icloud.com';
      secretField.value = '22DECC1918DE3087';
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
        get innerText() {
          return activePanel === 'batch' ? '批量取件 兑换码列表' : '邮箱取码 登录网页';
        },
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) {
          return activePanel === 'batch' ? [emailCodeNav] : [emailCodeNav, exchangeButton];
        }
        if (selector === 'textarea') {
          return activePanel === 'batch' ? [batchTextarea] : [];
        }
        if (/^input/.test(selector)) {
          return activePanel === 'email' ? [cardField, emailField, secretField] : [];
        }
        return [];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', [
      'U939-SJ5U-TW5M',
      { maxAttempts: 1, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);

    assert.equal(navClickCount, 1);
    assert.equal(exchangeClickCount, 1);
    assert.equal(batchTextarea.value, '');
    assert.deepEqual(result, {
      email: 'pukka.15montane+82o@icloud.com',
      mailSecret: '22DECC1918DE3087',
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card exchange does not retry confirmed invalid card errors', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInputElement = globalThis.HTMLInputElement;
  const originalTextareaElement = globalThis.HTMLTextAreaElement;
  const originalEvent = globalThis.Event;

  let clickCount = 0;
  const cardField = createFieldStub({ label: '卡密换邮箱秘钥', value: '' });
  const emailField = createFieldStub({ label: '邮箱', value: '' });
  const secretField = createFieldStub({ label: '邮箱秘钥', value: '' });
  const exchangeButton = {
    innerText: '换出邮箱秘钥',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
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
        innerText: '卡密已使用，请更换卡密',
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [exchangeButton];
        return [cardField, emailField, secretField];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('exchange', [
      'USED-BKLR-DAY4',
      { maxAttempts: 3, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 1);
    assert.match(result.error, /卡密已使用/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.HTMLInputElement = originalInputElement;
    globalThis.HTMLTextAreaElement = originalTextareaElement;
    globalThis.Event = originalEvent;
  }
});

test('plus card fetch code retries clicks when card site reports failed fetch', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;

  let clickCount = 0;
  let bodyText = '验证码：111111';
  const fetchCodeButton = {
    innerText: '邮箱取码',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      if (clickCount < 3) {
        bodyText = '验证码：111111 Error: Failed to fetch';
        return;
      }
      bodyText = '验证码：335833';
    },
  };

  try {
    globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    globalThis.document = {
      body: {
        get innerText() {
          return bodyText;
        },
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [fetchCodeButton];
        return [];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('fetchCode', [
      { maxAttempts: 3, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 3);
    assert.deepEqual(result, { code: '335833' });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test('plus card fetch code ignores non-six-digit codes and retries', async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;

  let clickCount = 0;
  let bodyText = '验证码：1234';
  const fetchCodeButton = {
    innerText: '邮箱取码',
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    click() {
      clickCount += 1;
      if (clickCount === 1) {
        bodyText = '验证码：1234';
        return;
      }
      if (clickCount === 2) {
        bodyText = '验证码：12345678';
        return;
      }
      bodyText = '验证码：654321';
    },
  };

  try {
    globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    globalThis.document = {
      body: {
        get innerText() {
          return bodyText;
        },
      },
      querySelectorAll(selector) {
        if (/^button/.test(selector)) return [fetchCodeButton];
        return [];
      },
    };

    const result = await globalThis.PlusCardKeyWorkflow._test.cardSiteInjectedRunner('fetchCode', [
      { maxAttempts: 3, settleMs: 1, clickTimeoutMs: 5, retryDelayMs: 1, pollMs: 1 },
    ]);
    assert.equal(clickCount, 3);
    assert.deepEqual(result, { code: '654321' });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});
