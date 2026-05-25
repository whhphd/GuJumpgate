const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/ooeao.js');

const ooeaoModule = globalThis.PhoneSmsOoeaoProvider;

test('parsePoolText accepts +number followed directly by URL', () => {
  const entries = ooeaoModule.parsePoolText(
    '+14129562571https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=b4165fff3241aea78f4111df65cd576a'
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].phoneNumber, '+14129562571');
  assert.equal(
    entries[0].verificationUrl,
    'https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=b4165fff3241aea78f4111df65cd576a'
  );
  assert.equal(entries[0].successfulUses, 0);
  assert.equal(entries[0].maxUses, 3);
});

test('parsePoolText accepts ---- separator from yuecheng provider', () => {
  const entries = ooeaoModule.parsePoolText(
    '+16507068865----https://mail-api.yuecheng.shop/adminapi/jsscript/smsInfo/ABC_sms?key=eca_tr_ENwZA7WKERnmw6fXUv6q4mwI'
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].phoneNumber, '+16507068865');
  assert.equal(
    entries[0].verificationUrl,
    'https://mail-api.yuecheng.shop/adminapi/jsscript/smsInfo/ABC_sms?key=eca_tr_ENwZA7WKERnmw6fXUv6q4mwI'
  );
});

test('parsePoolText accepts space, comma and pipe separators and dedupes', () => {
  const entries = ooeaoModule.parsePoolText([
    '+14129562571 https://example.test/sms?key=a',
    '+14129562572,https://example.test/sms?key=b',
    '+14129562573|https://example.test/sms?key=c',
    '# comment line should be ignored',
    '+14129562571 https://example.test/sms?key=a',
  ].join('\n'));

  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.phoneNumber), [
    '+14129562571',
    '+14129562572',
    '+14129562573',
  ]);
});

test('extractVerificationCode supports Chinese OpenAI sms text', () => {
  assert.equal(
    ooeaoModule.extractVerificationCode('yes|您的 OpenAI 验证代码是：050849'),
    '050849'
  );
});

test('extractVerificationCode supports PayPal English sms text', () => {
  assert.equal(
    ooeaoModule.extractVerificationCode(
      "yes|PayPal: 201412 is your security code. Don't share it."
    ),
    '201412'
  );
});

test('extractVerificationCode joins separated digit groups', () => {
  assert.equal(
    ooeaoModule.extractVerificationCode(
      "yes|PayPal: 1 2 3 4 5 6 is your security code."
    ),
    '123456'
  );
});

test('extractVerificationCode ignores waiting response expiry date', () => {
  assert.equal(
    ooeaoModule.extractVerificationCode('暂无短信|链接到期时间2026-06-02 23:59:59，续费请提前联系客服'),
    ''
  );
});

test('pickAvailable skips numbers that hit max uses', () => {
  const pool = ooeaoModule.normalizePool([
    {
      phoneNumber: '+14129562571',
      verificationUrl: 'https://example.test/sms?key=a',
      successfulUses: 3,
      maxUses: 3,
    },
    {
      phoneNumber: '+14129562572',
      verificationUrl: 'https://example.test/sms?key=b',
      successfulUses: 1,
      maxUses: 3,
    },
  ]);

  const picked = ooeaoModule.pickAvailable(pool);

  assert.ok(picked, 'expected an available activation');
  assert.equal(picked.phoneNumber, '+14129562572');
});

test('pickAvailable returns null when every number is exhausted', () => {
  const pool = ooeaoModule.normalizePool([
    {
      phoneNumber: '+14129562571',
      verificationUrl: 'https://example.test/sms?key=a',
      successfulUses: 3,
      maxUses: 3,
    },
  ]);

  assert.equal(ooeaoModule.pickAvailable(pool), null);
});

test('markUseSucceeded increments and clamps to maxUses', () => {
  const entry = ooeaoModule.normalizePoolEntry({
    phoneNumber: '+14129562571',
    verificationUrl: 'https://example.test/sms?key=a',
    successfulUses: 2,
    maxUses: 3,
  });

  const next = ooeaoModule.markUseSucceeded(entry);
  assert.equal(next.successfulUses, 3);

  const stillCapped = ooeaoModule.markUseSucceeded(next);
  assert.equal(stillCapped.successfulUses, 3);
});

test('markUseFailed counts consecutive misses and retires after threshold', () => {
  let entry = ooeaoModule.normalizePoolEntry({
    phoneNumber: '+14129562571',
    verificationUrl: 'https://example.test/sms?key=a',
    successfulUses: 0,
    maxUses: 3,
  });

  entry = ooeaoModule.markUseFailed(entry);
  assert.equal(entry.consecutiveFailures, 1);
  assert.equal(entry.successfulUses, 0);
  assert.equal(ooeaoModule.isAvailable(entry), true);

  entry = ooeaoModule.markUseFailed(entry);
  assert.equal(entry.consecutiveFailures, 2);
  assert.equal(ooeaoModule.isAvailable(entry), true);

  entry = ooeaoModule.markUseFailed(entry);
  assert.equal(entry.consecutiveFailures, 3);
  assert.equal(entry.successfulUses, 3);
  assert.equal(ooeaoModule.isAvailable(entry), false);
});

test('markUseSucceeded clears consecutive failures', () => {
  let entry = ooeaoModule.normalizePoolEntry({
    phoneNumber: '+14129562571',
    verificationUrl: 'https://example.test/sms?key=a',
    successfulUses: 0,
    consecutiveFailures: 2,
    maxUses: 3,
  });

  entry = ooeaoModule.markUseSucceeded(entry);
  assert.equal(entry.consecutiveFailures, 0);
  assert.equal(entry.successfulUses, 1);
});
