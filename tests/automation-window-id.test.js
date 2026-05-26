const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/tab-runtime.js');

test('automation window id normalization rejects Chrome placeholder window 0', () => {
  const runtime = globalThis.MultiPageBackgroundTabRuntime.createTabRuntime({});
  const normalize = runtime._test.normalizeAutomationWindowId;

  assert.equal(normalize(0), null);
  assert.equal(normalize('0'), null);
  assert.equal(normalize(-1), null);
  assert.equal(normalize(''), null);
  assert.equal(normalize(12), 12);
  assert.equal(normalize('12'), 12);
});

test('recoverable navigation retry schedule allows twenty refresh attempts', () => {
  const runtime = globalThis.MultiPageBackgroundTabRuntime.createTabRuntime({});
  const retryDelays = runtime._test.RECOVERABLE_NAVIGATION_RETRY_DELAYS_MS;

  assert.equal(retryDelays.length, 20);
  assert.deepEqual(retryDelays.slice(0, 3), [1500, 3000, 5000]);
  assert.equal(retryDelays.at(-1), 5000);
});
