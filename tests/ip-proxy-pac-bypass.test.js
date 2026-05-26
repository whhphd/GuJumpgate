const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadIpProxyCoreForTest() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'background', 'ip-proxy-core.js'),
    'utf8'
  );
  const context = {
    console,
    Map,
    Set,
    Promise,
    URL,
    DEFAULT_IP_PROXY_PROTOCOL: 'http',
    IP_PROXY_PROTOCOL_VALUES: ['http', 'https', 'socks4', 'socks5'],
    IP_PROXY_TARGET_HOST_PATTERNS: ['openai.com', '*.openai.com'],
    IP_PROXY_BYPASS_LIST: ['<local>', 'localhost', '127.0.0.1'],
    IP_PROXY_FORCE_DIRECT_HOST_PATTERNS: [],
    IP_PROXY_FORCE_DIRECT_FALLBACK: 'PROXY 127.0.0.1:65535',
    IP_PROXY_ROUTE_ALL_TRAFFIC: true,
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}
globalThis.__ipProxyCoreForTest = {
  buildIpProxyPacScriptWithOptions,
  buildIpProxyControlPlaneDirectBypassHostPatterns:
    typeof buildIpProxyControlPlaneDirectBypassHostPatterns === 'function'
      ? buildIpProxyControlPlaneDirectBypassHostPatterns
      : undefined,
};`, context);
  return context.__ipProxyCoreForTest;
}

function shExpMatch(value, pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(value);
}

function evaluatePac(pacScript, host) {
  const context = {
    shExpMatch,
    dnsDomainIs: (value, suffix) => String(value).endsWith(String(suffix)),
    isInNet: () => false,
    result: null,
  };
  vm.runInNewContext(`${pacScript}
result = FindProxyForURL("https://${host}/", "${host}");`, context);
  return context.result;
}

test('PAC routes Plus card site and SUB2API control-plane hosts directly', () => {
  const {
    buildIpProxyPacScriptWithOptions,
    buildIpProxyControlPlaneDirectBypassHostPatterns,
  } = loadIpProxyCoreForTest();

  assert.equal(typeof buildIpProxyControlPlaneDirectBypassHostPatterns, 'function');
  const directBypassHostPatterns = buildIpProxyControlPlaneDirectBypassHostPatterns({
    sub2apiUrl: 'https://sub.callai.one',
  });
  const pac = buildIpProxyPacScriptWithOptions(
    { protocol: 'http', host: 'proxy.example.test', port: 8080 },
    { directBypassHostPatterns, forceDirectFallback: 'DIRECT' }
  );

  assert.equal(evaluatePac(pac, 'plus.keria.cc.cd'), 'DIRECT');
  assert.equal(evaluatePac(pac, 'sub.callai.one'), 'DIRECT');
  assert.equal(evaluatePac(pac, 'auth.openai.com'), 'PROXY proxy.example.test:8080');
  assert.equal(evaluatePac(pac, 'example.com'), 'PROXY proxy.example.test:8080');
});

test('SUB2API direct bypass host is derived from configured URL only', () => {
  const { buildIpProxyControlPlaneDirectBypassHostPatterns } = loadIpProxyCoreForTest();

  assert.deepEqual(
    Array.from(buildIpProxyControlPlaneDirectBypassHostPatterns({
      sub2apiUrl: 'sub.example.com/api/v1',
    })),
    ['plus.keria.cc.cd', 'sub.example.com']
  );
});
