const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.self = globalThis;

require('../background/steps/fetch-login-code.js');

test('background plus card key login code fetch retries failed fetch responses', async () => {
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

    const result = await globalThis.MultiPageBackgroundStep8._test.plusCardKeyFetchCodeInjectedRunner({
      maxAttempts: 3,
      settleMs: 1,
      clickTimeoutMs: 5,
      retryDelayMs: 1,
      pollMs: 1,
    });
    assert.equal(clickCount, 3);
    assert.deepEqual(result, { code: '335833' });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test('background plus card key login code fetch ignores non-six-digit codes and retries', async () => {
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

    const result = await globalThis.MultiPageBackgroundStep8._test.plusCardKeyFetchCodeInjectedRunner({
      maxAttempts: 3,
      settleMs: 1,
      clickTimeoutMs: 5,
      retryDelayMs: 1,
      pollMs: 1,
    });
    assert.equal(clickCount, 3);
    assert.deepEqual(result, { code: '654321' });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});
