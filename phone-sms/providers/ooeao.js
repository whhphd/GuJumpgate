// phone-sms/providers/ooeao.js — ooeao 接码平台适配层
// 形态特殊：用户提前买好「手机号 + 固定查询 URL」组成号码池；
// 不像 HeroSMS / 5sim 那样调下单接口购买号码，因此本 provider 只做：
//   1) 把号码池字符串解析成 [{ phoneNumber, verificationUrl, successfulUses, maxUses }]
//   2) requestActivation：选一个未满 maxUses 的号码
//   3) pollActivationCode：定时 GET verificationUrl，从返回文本中抽取验证码
(function attachOoeaoProvider(root, factory) {
  root.PhoneSmsOoeaoProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOoeaoProviderModule() {
  const PROVIDER_ID = 'ooeao';
  const PROVIDER_LABEL = 'ooeao';
  const DEFAULT_MAX_USES = 3;
  const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_POLL_INTERVAL_MS = 5000;
  const DEFAULT_POLL_TIMEOUT_MS = 180000;

  // 兼容多种分隔符：连写、空格、tab、逗号、竖线、分号、冒号、`----`、`---`、`--`。
  // 直到遇到 http(s) 才算 URL 起点；号码段允许 + 或 00 前缀，长度按 7~16 位。
  const POOL_LINE_PATTERN = /^\s*(?:tel:)?\s*(\+?\d{7,16}|00\d{6,15})\s*(?:[-_*=,;:|/\s]+|。|、)?\s*(https?:\/\/\S+)\s*$/i;
  // 关键词在前：`验证代码：050849`、`security code is 201412`
  const VERIFICATION_CODE_AFTER_KEYWORD = /(?:验证代码|验证码|security\s*code|verification\s*code|code)[\s::是为]*([0-9](?:[\s-]?[0-9]){3,7})/i;
  // 关键词在后：`PayPal: 1 2 3 4 5 6 is your security code`
  const VERIFICATION_CODE_BEFORE_KEYWORD = /([0-9](?:[\s-]?[0-9]){3,7})\s*(?:is\s+your\s+)?(?:security|verification)?\s*code/i;
  const FALLBACK_DIGIT_PATTERN = /\b(\d{4,8})\b/;

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function normalizePhoneNumber(value = '') {
    const trimmed = normalizeString(value);
    if (!trimmed) {
      return '';
    }
    if (trimmed.startsWith('+')) {
      const digits = trimmed.slice(1).replace(/\D+/g, '');
      return digits ? `+${digits}` : '';
    }
    if (trimmed.startsWith('00')) {
      const digits = trimmed.slice(2).replace(/\D+/g, '');
      return digits ? `+${digits}` : '';
    }
    const digits = trimmed.replace(/\D+/g, '');
    if (!digits) {
      return '';
    }
    return `+${digits}`;
  }

  function normalizeUrl(value = '') {
    const trimmed = normalizeString(value);
    if (!trimmed) {
      return '';
    }
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function normalizeUseCount(value, fallback = 0) {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric) || numeric < 0) {
      return fallback;
    }
    return numeric;
  }

  function normalizeMaxUses(value, fallback = DEFAULT_MAX_USES) {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric) || numeric < 1) {
      return fallback;
    }
    return numeric;
  }

  function buildActivationId(phoneNumber, verificationUrl) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const normalizedUrl = normalizeUrl(verificationUrl);
    if (!normalizedPhone || !normalizedUrl) {
      return '';
    }
    // ooeao 没有平台侧 activationId，本地用 “号码@URL” 唯一定位一条记录。
    return `ooeao:${normalizedPhone}@${normalizedUrl}`;
  }

  function parsePoolLine(rawLine) {
    const line = normalizeString(rawLine);
    if (!line || line.startsWith('#')) {
      return null;
    }
    const match = line.match(POOL_LINE_PATTERN);
    if (!match) {
      return null;
    }
    const phoneNumber = normalizePhoneNumber(match[1]);
    const verificationUrl = normalizeUrl(match[2]);
    if (!phoneNumber || !verificationUrl) {
      return null;
    }
    return { phoneNumber, verificationUrl };
  }

  function parsePoolText(text = '', options = {}) {
    const lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    const entries = [];
    const seen = new Set();
    const maxUses = normalizeMaxUses(options.maxUses, DEFAULT_MAX_USES);
    for (const rawLine of lines) {
      const parsed = parsePoolLine(rawLine);
      if (!parsed) {
        continue;
      }
      const key = buildActivationId(parsed.phoneNumber, parsed.verificationUrl);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        provider: PROVIDER_ID,
        activationId: key,
        phoneNumber: parsed.phoneNumber,
        verificationUrl: parsed.verificationUrl,
        successfulUses: 0,
        consecutiveFailures: 0,
        maxUses,
      });
    }
    return entries;
  }

  function normalizePoolEntry(entry, options = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }
    const phoneNumber = normalizePhoneNumber(
      entry.phoneNumber ?? entry.phone ?? entry.number
    );
    const verificationUrl = normalizeUrl(
      entry.verificationUrl ?? entry.url ?? entry.smsUrl
    );
    if (!phoneNumber || !verificationUrl) {
      return null;
    }
    const maxUses = normalizeMaxUses(entry.maxUses ?? options.maxUses, DEFAULT_MAX_USES);
    const successfulUses = Math.min(
      maxUses,
      normalizeUseCount(entry.successfulUses, 0)
    );
    const consecutiveFailures = normalizeUseCount(entry.consecutiveFailures, 0);
    return {
      provider: PROVIDER_ID,
      activationId: buildActivationId(phoneNumber, verificationUrl),
      phoneNumber,
      verificationUrl,
      successfulUses,
      consecutiveFailures,
      maxUses,
    };
  }

  function normalizePool(value, options = {}) {
    const source = Array.isArray(value) ? value : [];
    const entries = [];
    const seen = new Set();
    for (const item of source) {
      const normalized = normalizePoolEntry(item, options);
      if (!normalized || seen.has(normalized.activationId)) {
        continue;
      }
      seen.add(normalized.activationId);
      entries.push(normalized);
    }
    return entries;
  }

  function isAvailable(entry) {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const max = normalizeMaxUses(entry.maxUses, DEFAULT_MAX_USES);
    const used = normalizeUseCount(entry.successfulUses, 0);
    return used < max;
  }

  function pickAvailable(pool, options = {}) {
    const blocked = new Set(
      (Array.isArray(options.blockedActivationIds) ? options.blockedActivationIds : [])
        .map((id) => normalizeString(id))
        .filter(Boolean)
    );
    return normalizePool(pool).find((entry) => isAvailable(entry) && !blocked.has(entry.activationId)) || null;
  }

  function extractVerificationCode(rawText = '') {
    const text = String(rawText || '');
    if (!text) {
      return '';
    }
    const tryMatch = (pattern) => {
      const matched = text.match(pattern);
      if (!matched?.[1]) {
        return '';
      }
      const digits = String(matched[1]).replace(/\D+/g, '');
      return digits.length >= 4 && digits.length <= 8 ? digits : '';
    };
    return tryMatch(VERIFICATION_CODE_AFTER_KEYWORD)
      || tryMatch(VERIFICATION_CODE_BEFORE_KEYWORD)
      || (text.match(FALLBACK_DIGIT_PATTERN)?.[1] || '');
  }

  function markUseSucceeded(entry) {
    const normalized = normalizePoolEntry(entry);
    if (!normalized) {
      return null;
    }
    return {
      ...normalized,
      consecutiveFailures: 0,
      successfulUses: Math.min(
        normalized.maxUses,
        normalizeUseCount(normalized.successfulUses, 0) + 1
      ),
    };
  }

  // 接不到码或本轮失败时调用：累计失败，到阈值就把号码用满直接淘汰，下次 pickAvailable 不再选。
  function markUseFailed(entry, options = {}) {
    const normalized = normalizePoolEntry(entry);
    if (!normalized) {
      return null;
    }
    const threshold = Math.max(1, Math.floor(Number(options.maxConsecutiveFailures) || DEFAULT_MAX_CONSECUTIVE_FAILURES));
    const nextFailures = normalizeUseCount(normalized.consecutiveFailures, 0) + 1;
    if (nextFailures >= threshold) {
      return {
        ...normalized,
        consecutiveFailures: nextFailures,
        successfulUses: normalized.maxUses,
      };
    }
    return {
      ...normalized,
      consecutiveFailures: nextFailures,
    };
  }

  function applyPoolUpdate(pool, updatedEntry) {
    const list = normalizePool(pool);
    const updated = normalizePoolEntry(updatedEntry);
    if (!updated) {
      return list;
    }
    const idx = list.findIndex((entry) => entry.activationId === updated.activationId);
    if (idx === -1) {
      return [...list, updated];
    }
    const next = list.slice();
    next[idx] = updated;
    return next;
  }

  async function requestActivation(state = {}, options = {}, deps = {}) {
    const pool = normalizePool(state?.ooeaoPool ?? options?.pool ?? []);
    const activation = pickAvailable(pool, options);
    if (!activation) {
      throw new Error('ooeao 号码池中已没有可用号码（或全部达到接码上限）。请先在侧边栏导入号码。');
    }
    if (typeof deps.addLog === 'function') {
      await deps.addLog(
        `ooeao 已选择号码 ${activation.phoneNumber}（已使用 ${activation.successfulUses}/${activation.maxUses}）。`,
        'info'
      );
    }
    return activation;
  }

  async function fetchVerificationText(activation, options = {}, deps = {}) {
    const fetchImpl = deps.fetchImpl
      || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) {
      throw new Error('ooeao 网络请求实现不可用。');
    }
    const url = normalizeUrl(activation?.verificationUrl);
    if (!url) {
      throw new Error('ooeao 当前号码缺少验证码查询 URL。');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(1000, Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        signal: controller?.signal,
        cache: 'no-store',
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(`ooeao 查询验证码失败：HTTP ${response.status}`);
        error.status = response.status;
        error.payload = text;
        throw error;
      }
      return String(text || '');
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('ooeao 查询验证码超时。');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const normalized = normalizePoolEntry(activation);
    if (!normalized) {
      throw new Error('缺少 ooeao 接码订单。');
    }
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_POLL_TIMEOUT_MS);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_POLL_INTERVAL_MS);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';

    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) {
        break;
      }
      if (typeof deps.throwIfStopped === 'function') {
        deps.throwIfStopped();
      }
      pollCount += 1;
      let text = '';
      try {
        text = await fetchVerificationText(normalized, options, deps);
      } catch (error) {
        if (typeof options.onPollError === 'function') {
          await options.onPollError({
            activation: normalized,
            error,
            pollCount,
            elapsedMs: Date.now() - start,
            timeoutMs,
          });
        }
        // 网络错误暂不直接结束，按现有 HeroSMS 策略继续轮询直至超时。
        if (typeof deps.sleepWithStop === 'function') {
          await deps.sleepWithStop(intervalMs);
        }
        continue;
      }
      lastResponse = text.replace(/\s+/g, ' ').trim();
      const code = extractVerificationCode(text);
      if (code) {
        return code;
      }
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({
          activation: normalized,
          elapsedMs: Date.now() - start,
          pollCount,
          statusText: lastResponse,
          timeoutMs,
        });
      }
      if (typeof deps.sleepWithStop === 'function') {
        await deps.sleepWithStop(intervalMs);
      }
    }

    const suffix = lastResponse ? ` ooeao 最后状态：${lastResponse.slice(0, 200)}` : '';
    throw new Error(`PHONE_CODE_TIMEOUT::等待 ooeao 验证码超时。${suffix}`);
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      addLog: deps.addLog,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    return {
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      defaultMaxUses: DEFAULT_MAX_USES,
      defaultMaxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
      parsePoolText,
      normalizePool: (value) => normalizePool(value),
      normalizePoolEntry: (entry, options) => normalizePoolEntry(entry, options),
      pickAvailable: (pool, options) => pickAvailable(pool, options),
      isAvailable,
      buildActivationId,
      extractVerificationCode,
      markUseSucceeded,
      markUseFailed,
      applyPoolUpdate,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      // ooeao 没有买号/取消/拉黑接口，留空操作以兼容现有调用。
      finishActivation: async () => '',
      cancelActivation: async () => '',
      banActivation: async () => '',
    };
  }

  return {
    PROVIDER_ID,
    PROVIDER_LABEL,
    DEFAULT_MAX_USES,
    DEFAULT_MAX_CONSECUTIVE_FAILURES,
    parsePoolText,
    normalizePool,
    normalizePoolEntry,
    pickAvailable,
    isAvailable,
    buildActivationId,
    extractVerificationCode,
    markUseSucceeded,
    markUseFailed,
    applyPoolUpdate,
    createProvider,
  };
});
