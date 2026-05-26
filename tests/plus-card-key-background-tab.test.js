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

test('plus card key site window is created unfocused for automatic background actions', async () => {
  let createProperties = null;
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    extension: {
      isAllowedIncognitoAccess: async () => true,
    },
    windows: {
      create: async (properties) => {
        createProperties = properties;
        return { tabs: [{ id: 101, windowId: 7 }] };
      },
    },
  };

  try {
    const tab = await globalThis.PlusCardKeyWorkflow._test.createIncognitoCardSiteTab();

    assert.equal(tab.id, 101);
    assert.equal(createProperties.incognito, true);
    assert.equal(createProperties.focused, false);
    assert.equal(createProperties.url, 'https://plus.keria.cc.cd/');
  } finally {
    globalThis.chrome = originalChrome;
  }
});
