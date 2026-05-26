const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep8Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'fetch-login-code.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep8;
}

for (const emailGenerator of ['cloudflare-temp-email', 'cloudmail']) {
  test(`bind-email auto-generates missing ${emailGenerator} address for phone signup flow`, async () => {
    const step8Module = loadStep8Module();
    const sendCalls = [];
    const completionPayloads = [];
    const persistedEmails = [];
    const logMessages = [];
    let currentState = {
      nodeId: 'bind-email',
      oauthUrl: 'https://auth.openai.com/oauth/authorize?client_id=test',
      accountIdentifierType: 'phone',
      accountIdentifier: '+15550001111',
      signupPhoneNumber: '+15550001111',
      phoneVerificationEnabled: true,
      mailProvider: emailGenerator === 'cloudmail' ? 'cloudmail' : 'cloudflare-temp-email',
      emailGenerator,
      email: '',
      registrationEmailState: null,
    };

    const executor = step8Module.createStep8Executor({
      addLog: async (message) => {
        logMessages.push(String(message || ''));
      },
      chrome: {
        tabs: {
          update: async () => {},
        },
      },
      completeNodeFromBackground: async (_nodeId, payload) => {
        completionPayloads.push(payload);
      },
      getOAuthFlowStepTimeoutMs: async (fallbackMs) => fallbackMs,
      getState: async () => currentState,
      getTabId: async () => 123,
      resolveSignupEmailForFlow: async (state, options = {}) => {
        assert.equal(state.accountIdentifierType, 'phone');
        assert.equal(state.email, '');
        assert.equal(options.preserveAccountIdentity, true);
        return `auto-${emailGenerator}@example.com`;
      },
      persistRegistrationEmailState: async (_state, email, options = {}) => {
        persistedEmails.push({ email, options });
        currentState = {
          ...currentState,
          email,
          registrationEmailState: {
            current: email,
          },
        };
      },
      sendToContentScriptResilient: async (_source, message) => {
        sendCalls.push(message);
        if (message.type === 'GET_LOGIN_AUTH_STATE') {
          return {
            state: 'add_email_page',
            url: 'https://auth.openai.com/add-email',
          };
        }
        if (message.type === 'SUBMIT_ADD_EMAIL') {
          return {
            displayedEmail: `auto-${emailGenerator}@example.com`,
            url: 'https://auth.openai.com/u/login/email-verification',
          };
        }
        throw new Error(`unexpected message type: ${message.type}`);
      },
      setState: async (updates) => {
        currentState = {
          ...currentState,
          ...updates,
        };
      },
    });

    await executor.executeBindEmail(currentState);

    assert.equal(sendCalls.length, 2);
    assert.equal(sendCalls[1].type, 'SUBMIT_ADD_EMAIL');
    assert.equal(sendCalls[1].payload.email, `auto-${emailGenerator}@example.com`);

    assert.equal(persistedEmails.length, 1);
    assert.equal(persistedEmails[0].email, `auto-${emailGenerator}@example.com`);
    assert.equal(persistedEmails[0].options.preserveAccountIdentity, true);
    assert.equal(persistedEmails[0].options.source, 'bind_email');

    assert.equal(completionPayloads.length, 1);
    assert.equal(completionPayloads[0].bindEmailSubmitted, true);
    assert.equal(completionPayloads[0].email, `auto-${emailGenerator}@example.com`);
    assert.equal(completionPayloads[0].step8VerificationTargetEmail, `auto-${emailGenerator}@example.com`);

    assert.ok(logMessages.some((message) => message.includes(`auto-${emailGenerator}@example.com`)));
  });
}
