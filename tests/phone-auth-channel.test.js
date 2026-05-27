const assert = require('node:assert/strict');
const test = require('node:test');

globalThis.self = globalThis;

require('../content/phone-auth.js');

function createElementStub({
  tagName = 'button',
  text = '',
  value = '',
  type = '',
  role = '',
  name = '',
  autocomplete = '',
  disabled = false,
  selected = false,
  onClick = null,
} = {}) {
  const attributes = new Map();
  if (type) attributes.set('type', type);
  if (role) attributes.set('role', role);
  if (name) attributes.set('name', name);
  if (autocomplete) attributes.set('autocomplete', autocomplete);
  if (selected) attributes.set('aria-checked', 'true');
  const element = {
    tagName: tagName.toUpperCase(),
    textContent: text,
    innerText: text,
    value,
    disabled,
    options: [],
    selectedIndex: -1,
    getAttribute(attribute) {
      return attributes.get(attribute) || '';
    },
    setAttribute(attribute, nextValue) {
      attributes.set(attribute, String(nextValue));
    },
    getBoundingClientRect() {
      return { width: 100, height: 24 };
    },
    dispatchEvent() {},
    click() {
      if (typeof onClick === 'function') onClick.call(this);
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return element;
}

function createPhoneAuthHarness({ channelOrder }) {
  let selectedChannel = 'whatsapp';
  let submitted = false;
  const events = [];
  const phoneInput = createElementStub({ tagName: 'input', type: 'tel' });
  const hiddenInput = createElementStub({ tagName: 'input', name: 'phoneNumber' });
  const submitButton = createElementStub({
    text: '继续',
    type: 'submit',
    onClick() {
      submitted = true;
    },
  });
  const countrySelect = createElementStub({ tagName: 'select' });
  const countryOption = createElementStub({ tagName: 'option', text: 'United States (+1)', value: 'US' });
  countrySelect.options = [countryOption];
  countrySelect.selectedIndex = 0;
  countrySelect.value = 'US';

  const channelButtons = channelOrder.map((channel) => createElementStub({
    text: channel === 'sms' ? 'Text Message' : 'WhatsApp',
    role: 'radio',
    selected: channel === selectedChannel,
    onClick() {
      selectedChannel = channel;
      channelButtons.forEach((button) => button.setAttribute('aria-checked', 'false'));
      this.setAttribute('aria-checked', 'true');
    },
  }));

  const form = {
    querySelector(selector) {
      if (selector === 'select') return countrySelect;
      if (/input\[type="tel"\]/.test(selector)) return phoneInput;
      if (/input\[name="phoneNumber"\]/.test(selector)) return hiddenInput;
      return null;
    },
    querySelectorAll(selector) {
      if (/button\[type="submit"\]/.test(selector)) return [submitButton];
      if (/button/.test(selector) || /\[role="radio"\]/.test(selector)) {
        return [...channelButtons, submitButton];
      }
      return [];
    },
  };

  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  globalThis.location = { href: 'https://auth.openai.com/add-phone', pathname: '/add-phone' };
  globalThis.document = {
    title: '',
    body: { textContent: '' },
    querySelector(selector) {
      if (/form\[action\*="\/add-phone"/i.test(selector)) return form;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const helpers = globalThis.MultiPagePhoneAuth.createPhoneAuthHelpers({
    fillInput(input, nextValue) {
      input.value = nextValue;
    },
    getActionText(element) {
      return [element?.textContent, element?.value, element?.getAttribute?.('aria-label'), element?.getAttribute?.('title')]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    getPageTextSnapshot() {
      return '';
    },
    getVerificationErrorText() {
      return '';
    },
    humanPause: async () => {},
    isActionEnabled(element) {
      return Boolean(element) && !element.disabled;
    },
    isAddPhonePageReady() {
      return true;
    },
    isConsentReady() {
      return false;
    },
    isPhoneVerificationPageReady() {
      return submitted;
    },
    isVisibleElement(element) {
      return Boolean(element);
    },
    performOperationWithDelay: async (metadata, operation) => {
      events.push(metadata);
      return operation();
    },
    simulateClick(element) {
      element.click();
    },
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => phoneInput,
  });

  return {
    cleanup() {
      globalThis.document = originalDocument;
      globalThis.location = originalLocation;
    },
    getSelectedChannel() {
      return selectedChannel;
    },
    helpers,
    events,
  };
}

test('phone auth selects SMS when Text Message is on the left', async () => {
  const harness = createPhoneAuthHarness({ channelOrder: ['sms', 'whatsapp'] });
  try {
    await harness.helpers.submitPhoneNumber({
      countryLabel: 'United States',
      phoneNumber: '+14155552671',
    });
    assert.equal(harness.getSelectedChannel(), 'sms');
    assert.ok(harness.events.some((event) => event.label === 'phone-channel-sms'));
  } finally {
    harness.cleanup();
  }
});

test('phone auth selects SMS when Text Message is on the right', async () => {
  const harness = createPhoneAuthHarness({ channelOrder: ['whatsapp', 'sms'] });
  try {
    await harness.helpers.submitPhoneNumber({
      countryLabel: 'United States',
      phoneNumber: '+14155552671',
    });
    assert.equal(harness.getSelectedChannel(), 'sms');
    assert.ok(harness.events.some((event) => event.label === 'phone-channel-sms'));
  } finally {
    harness.cleanup();
  }
});

test('phone auth refuses to continue when only WhatsApp is available', async () => {
  const harness = createPhoneAuthHarness({ channelOrder: ['whatsapp'] });
  try {
    await assert.rejects(
      () => harness.helpers.submitPhoneNumber({
        countryLabel: 'United States',
        phoneNumber: '+14155552671',
      }),
      /短信|SMS|Text Message/i
    );
  } finally {
    harness.cleanup();
  }
});
