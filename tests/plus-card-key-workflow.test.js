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

const classifyFailure = globalThis.PlusCardKeyWorkflow.classifyFailure;

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
