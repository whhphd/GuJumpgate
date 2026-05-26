const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/message-router.js');

test('plus card workflow startup clears stale browser tab registry', async () => {
  let state = {
    tabRegistry: {
      'signup-page': {
        tabId: 858873234,
        ready: true,
      },
    },
    sourceLastUrls: {
      'signup-page': 'https://auth.openai.com/oauth/authorize?old=1',
    },
    signupTabId: 858873234,
    plusCheckoutTabId: 111,
    paypalTabId: 222,
    gopayTabId: 333,
    nodeStatuses: {},
  };
  const setStateCalls = [];
  const startAutoRunCalls = [];

  const router = globalThis.MultiPageBackgroundMessageRouter.createMessageRouter({
    addLog: async () => {},
    clearOpenAiCookiesForPlusCardKeyWorkflow: async () => {},
    clearStopRequest: () => {},
    ensureManualInteractionAllowed: async () => state,
    getPendingAutoRunTimerPlan: () => null,
    getState: async () => state,
    resetState: async () => {
      state = {};
    },
    setState: async (updates) => {
      setStateCalls.push(updates);
      state = {
        ...state,
        ...updates,
      };
    },
    startAutoRunLoop: (...args) => startAutoRunCalls.push(args),
    validateAutoRunStart: () => ({ ok: true, errors: [] }),
  });

  const result = await router.handleMessage({
    type: 'START_PLUS_CARD_KEY_WORKFLOW',
    source: 'test',
    payload: {
      cardKey: 'CARD-1',
      email: 'fresh@example.com',
      mailSecret: 'secret-1',
    },
  }, {});

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(state.tabRegistry, {});
  assert.deepEqual(state.sourceLastUrls, {});
  assert.equal(state.signupTabId, null);
  assert.equal(state.plusCheckoutTabId, null);
  assert.equal(state.paypalTabId, null);
  assert.equal(state.gopayTabId, null);
  assert.equal(state.email, 'fresh@example.com');
  assert.equal(startAutoRunCalls.length, 1);
  assert.equal(startAutoRunCalls[0][1].mode, 'continue');

  const workflowStatePatch = setStateCalls.find((updates) => updates.plusCardKeyWorkflow);
  assert.ok(workflowStatePatch);
  assert.deepEqual(workflowStatePatch.tabRegistry, {});
});
