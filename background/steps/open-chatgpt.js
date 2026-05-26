(function attachBackgroundStep1(root, factory) {
  root.MultiPageBackgroundStep1 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep1Module() {
  const STEP1_COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'paypal.com',
    'stripe.com',
    'checkout.stripe.com',
    'meiguodizhi.com',
    'mail-api.yuecheng.shop',
    'yuecheng.shop',
  ];
  const STEP1_COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://pay.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
    'https://openai.com',
    'https://www.paypal.com',
    'https://paypal.com',
    'https://checkout.stripe.com',
    'https://www.meiguodizhi.com',
    'https://meiguodizhi.com',
    'https://mail-api.yuecheng.shop',
  ];

  function normalizeCookieDomainForStep1(domain) {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function shouldClearStep1Cookie(cookie) {
    const domain = normalizeCookieDomainForStep1(cookie?.domain);
    if (!domain) return false;
    return STEP1_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target || domain.endsWith(`.${target}`)
    ));
  }

  function buildStep1CookieRemovalUrl(cookie) {
    const host = normalizeCookieDomainForStep1(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  function getStep1ErrorMessage(error) {
    return error?.message || String(error || '未知错误');
  }

  async function collectStep1Cookies(chromeApi) {
    if (!chromeApi.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearStep1Cookie(cookie)) continue;
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeStep1Cookie(chromeApi, cookie) {
    const details = {
      url: buildStep1CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:step1] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getStep1ErrorMessage(error),
      });
      return false;
    }
  }

  async function clearOpenAiCookies(chromeApi, options = {}) {
    const addLog = typeof options.addLog === 'function' ? options.addLog : async () => {};
    const label = String(options.label || '步骤 1').trim() || '步骤 1';
    const actionLabel = String(options.actionLabel || '打开 ChatGPT 官网前').trim() || '打开 ChatGPT 官网前';
    if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) {
      await addLog(`${label}：当前浏览器不支持 cookies API，跳过 ChatGPT / OpenAI cookies 清理。`, 'warn');
      return { removedCount: 0, skipped: true };
    }

    await addLog(`${label}：${actionLabel}清理 ChatGPT / OpenAI cookies...`, 'info');
    const cookies = await collectStep1Cookies(chromeApi);
    let removedCount = 0;
    for (const cookie of cookies) {
      if (await removeStep1Cookie(chromeApi, cookie)) {
        removedCount += 1;
      }
    }

    if (chromeApi.browsingData?.removeCookies) {
      try {
        await chromeApi.browsingData.removeCookies({
          since: 0,
          origins: STEP1_COOKIE_CLEAR_ORIGINS,
        });
      } catch (error) {
        await addLog(`${label}：browsingData 补扫 cookies 失败：${getStep1ErrorMessage(error)}`, 'warn');
      }
    }

    await addLog(`${label}：已清理 ${removedCount} 个 ChatGPT / OpenAI cookies。`, 'ok');
    return { removedCount, skipped: false };
  }

  function createStep1Executor(deps = {}) {
    const {
      addLog,
      chrome: chromeApi = globalThis.chrome,
      completeNodeFromBackground,
      openSignupEntryTab,
    } = deps;

    async function clearOpenAiCookiesBeforeStep1() {
      return clearOpenAiCookies(chromeApi, {
        addLog,
        label: '步骤 1',
        actionLabel: '打开 ChatGPT 官网前',
      });
    }

    async function executeStep1() {
      await clearOpenAiCookiesBeforeStep1();
      await addLog('步骤 1：正在打开 ChatGPT 官网...');
      await openSignupEntryTab(1);
      await completeNodeFromBackground('open-chatgpt', {});
    }

    return { executeStep1 };
  }

  return {
    clearOpenAiCookies,
    createStep1Executor,
  };
});
