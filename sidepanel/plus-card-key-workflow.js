// sidepanel/plus-card-key-workflow.js — Plus 卡密独立工作流第一阶段
(function attachPlusCardKeyWorkflow(root) {
  const STORAGE_KEY = 'plusCardKeyWorkflowState';
  const CARD_SITE_URL = 'https://plus.keria.cc.cd/';

  const selectors = {
    textarea: 'input-plus-card-key-list',
    importButton: 'btn-plus-card-key-import',
    startAutoButton: 'btn-plus-card-key-start-auto',
    stopAutoButton: 'btn-plus-card-key-stop-auto',
    exchangeButton: 'btn-plus-card-key-exchange',
    fetchCodeButton: 'btn-plus-card-key-fetch-code',
    openSiteButton: 'btn-plus-card-key-open-site',
    clearButton: 'btn-plus-card-key-clear',
    summary: 'plus-card-key-summary',
    current: 'plus-card-key-current',
    list: 'plus-card-key-list',
  };

  let state = {
    entries: [],
    currentId: '',
    running: false,
    currentEntry: null,
    lastError: '',
    failures: [],
  };
  let busy = false;
  let autoRunLoopActive = false;
  let waitingBackgroundFlow = null;
  const AUTO_SKIP_STATUSES = new Set(['code_received', 'skipped', 'import_pending']);

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function normalizeCardKey(value = '') {
    return normalizeString(value).replace(/\s+/g, '').toUpperCase();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function buildEntry(cardKey) {
    const normalized = normalizeCardKey(cardKey);
    return {
      id: `plus-card:${normalized}`,
      cardKey: normalized,
      email: '',
      mailSecret: '',
      code: '',
      status: 'pending',
      error: '',
      updatedAt: Date.now(),
    };
  }

  function normalizeEntry(entry) {
    const cardKey = normalizeCardKey(entry?.cardKey || entry?.key || entry);
    if (!cardKey) return null;
    return {
      ...buildEntry(cardKey),
      id: normalizeString(entry?.id) || `plus-card:${cardKey}`,
      email: normalizeString(entry?.email),
      mailSecret: normalizeString(entry?.mailSecret || entry?.secret),
      code: normalizeString(entry?.code),
      status: normalizeString(entry?.status) || 'pending',
      error: normalizeString(entry?.error),
      updatedAt: Math.max(0, Number(entry?.updatedAt) || 0) || Date.now(),
    };
  }

  function normalizeState(value = {}) {
    const entries = [];
    const seen = new Set();
    (Array.isArray(value?.entries) ? value.entries : []).forEach((item) => {
      const entry = normalizeEntry(item);
      if (!entry || seen.has(entry.cardKey)) return;
      seen.add(entry.cardKey);
      entries.push(entry);
    });
    const currentId = normalizeString(value?.currentId);
    const currentEntry = normalizeEntry(value?.currentEntry) || null;
    const failures = (Array.isArray(value?.failures) ? value.failures : [])
      .map((item) => ({
        cardKey: normalizeCardKey(item?.cardKey),
        email: normalizeString(item?.email),
        error: normalizeString(item?.error),
        at: Math.max(0, Number(item?.at) || 0),
      }))
      .filter((item) => item.cardKey && item.error)
      .slice(-50);
    return {
      entries,
      currentId: entries.some((entry) => entry.id === currentId) ? currentId : (entries[0]?.id || ''),
      running: Boolean(value?.running),
      currentEntry,
      lastError: normalizeString(value?.lastError),
      failures,
    };
  }

  function getCurrentEntry() {
    return state.entries.find((entry) => entry.id === state.currentId) || state.entries[0] || null;
  }

  function getNextRunnableEntryFromEntries(entries = [], currentId = '') {
    const list = Array.isArray(entries) ? entries : [];
    const current = list.find((entry) => entry?.id === currentId);
    if (current && !AUTO_SKIP_STATUSES.has(current.status)) return current;
    return list.find((entry) => entry && !AUTO_SKIP_STATUSES.has(entry.status)) || null;
  }

  function getRetryStatusForSelectedEntry(entry = {}) {
    if (entry?.status !== 'import_pending') return null;
    return entry.email ? 'exchanged' : 'pending';
  }

  function getNextRunnableEntry() {
    return getNextRunnableEntryFromEntries(state.entries, state.currentId);
  }

  async function saveState() {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function loadState() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    state = normalizeState(data?.[STORAGE_KEY]);
    render();
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    [
      selectors.importButton,
      selectors.startAutoButton,
      selectors.exchangeButton,
      selectors.fetchCodeButton,
      selectors.openSiteButton,
      selectors.clearButton,
    ].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = busy || state.running;
    });
    const stopButton = $(selectors.stopAutoButton);
    if (stopButton) stopButton.disabled = !state.running;
    const startButton = $(selectors.startAutoButton);
    if (startButton) startButton.disabled = busy || state.running || !state.entries.length;
  }

  function getStatusText(status = '') {
    switch (status) {
      case 'exchanged': return '已换邮箱';
      case 'code_received': return '已取码';
      case 'running': return '自动处理中';
      case 'failed': return '失败';
      case 'paused': return '已暂停待重试';
      case 'import_pending': return '导入待重试';
      case 'skipped': return '已跳过';
      default: return '待处理';
    }
  }

  function getSummaryText() {
    const total = state.entries.length;
    const exchanged = state.entries.filter((entry) => entry.email).length;
    const coded = state.entries.filter((entry) => entry.code).length;
    const failed = state.failures.length;
    const prefix = state.running ? '自动运行中，' : '';
    return total
      ? `${prefix}共 ${total} 个卡密，已换邮箱 ${exchanged} 个，已取码 ${coded} 个，失败 ${failed} 个。${state.lastError ? `最近失败：${state.lastError}` : ''}`
      : `${prefix}${state.lastError ? `队列为空。最近失败：${state.lastError}` : '未导入卡密。'}`;
  }

  function render() {
    const summary = $(selectors.summary);
    const current = $(selectors.current);
    const list = $(selectors.list);
    const currentEntry = getCurrentEntry();

    if (summary) summary.textContent = getSummaryText();
    if (current) {
      current.textContent = currentEntry
        ? `当前：${currentEntry.cardKey}${currentEntry.email ? ` / ${currentEntry.email}` : ''}${currentEntry.code ? ` / 验证码 ${currentEntry.code}` : ''}`
        : '当前：无';
    }
    setBusy(busy);
    if (!list) return;

    list.innerHTML = '';
    state.entries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'plus-card-key-item';
      item.dataset.entryId = entry.id;
      const isCurrent = entry.id === state.currentId;
      item.innerHTML = `
        <div class="section-mini-header">
          <div class="section-mini-copy">
            <span class="data-value mono${isCurrent ? ' has-value' : ''}">${escapeHtml(entry.cardKey)}${isCurrent ? '（当前）' : ''}</span>
            <span class="data-value">${escapeHtml(getStatusText(entry.status))}${entry.error ? `：${escapeHtml(entry.error)}` : ''}</span>
          </div>
          <div class="section-mini-actions">
            <button class="btn btn-ghost btn-xs" type="button" data-action="select"${state.running ? ' disabled' : ''}>设为当前</button>
            <button class="btn btn-ghost btn-xs" type="button" data-action="skip"${state.running ? ' disabled' : ''}>跳过</button>
          </div>
        </div>
        <div class="data-value mono">邮箱：${escapeHtml(entry.email || '未换出')}</div>
        <div class="data-value mono">秘钥：${escapeHtml(entry.mailSecret || '未换出')}</div>
        <div class="data-value mono">验证码：${escapeHtml(entry.code || '未获取')}</div>
      `;
      list.appendChild(item);
    });
  }

  async function importCardKeys() {
    const textarea = $(selectors.textarea);
    const raw = textarea?.value || '';
    const cardKeys = raw
      .split(/[\r\n]+/)
      .map(normalizeCardKey)
      .filter(Boolean);
    if (!cardKeys.length) {
      showWorkflowToast('请先粘贴卡密清单。', 'warn');
      return;
    }

    const existingByKey = new Map(state.entries.map((entry) => [entry.cardKey, entry]));
    cardKeys.forEach((cardKey) => {
      if (!existingByKey.has(cardKey)) {
        existingByKey.set(cardKey, buildEntry(cardKey));
      }
    });
    state.entries = [...existingByKey.values()];
    if (!state.currentId && state.entries[0]) {
      state.currentId = state.entries[0].id;
    }
    await saveState();
    render();
    showWorkflowToast(`已导入 ${cardKeys.length} 行卡密。`, 'success');
  }

  async function clearQueue() {
    if (state.entries.length && !confirm('确认清空 Plus 卡密队列？')) return;
    state = { entries: [], currentId: '', running: false, currentEntry: null, lastError: '', failures: [] };
    await saveState();
    render();
  }

  function updateEntry(entryId, patch = {}) {
    state.entries = state.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      return {
        ...entry,
        ...patch,
        updatedAt: Date.now(),
      };
    });
  }

  function selectNextPending() {
    const next = getNextRunnableEntry();
    state.currentId = next?.id || state.entries[0]?.id || '';
  }

  function removeEntry(entryId) {
    state.entries = state.entries.filter((entry) => entry.id !== entryId);
    if (state.currentId === entryId) {
      state.currentId = state.entries[0]?.id || '';
    }
  }

  function recordFailure(entry, errorMessage) {
    const failure = {
      cardKey: entry?.cardKey || '',
      email: entry?.email || '',
      error: normalizeString(errorMessage) || '未知错误',
      at: Date.now(),
    };
    state.failures = [...(state.failures || []), failure].slice(-50);
    state.lastError = failure.error;
  }

  function classifyPlusCardKeyFailure(errorMessage = '') {
    const message = normalizeString(errorMessage);
    const mentionsSub2ApiImport = /SUB2API 请求(?:失败|超时)|SUB2API[\s\S]*(?:Failed to fetch|failed to fetch|network\s*error|fetch\s+failed|load\s+failed|timeout|超时)|\/api\/v1\/(?:auth|admin)\//i.test(message);
    const hasTransientImportSignal = /Failed to fetch|failed to fetch|network\s*error|fetch\s+failed|load\s+failed|timeout|timed\s*out|超时|connection\s+refused|connection\s+reset|unexpected\s+eof|temporarily\s+unavailable|502|503|504/i.test(message);
    const isSub2ApiTransientImportFailure = mentionsSub2ApiImport
      && hasTransientImportSignal
      && !/SUB2API.*(?:缺少|尚未配置|未配置|登录失败|回调交换)|尚未配置 SUB2API|缺少 SUB2API|state 与步骤|目标分组 ID 无效/i.test(message);
    if (isSub2ApiTransientImportFailure) {
      return {
        removeEntry: false,
        stopQueue: false,
        status: 'import_pending',
        reason: 'sub2api_transient',
      };
    }

    const preservePatterns = [
      /用户停止|已停止|stop(?:ped)?|cancel(?:led)?|abort/i,
      /网络|network|failed to fetch|timeout|超时|timed out|net::|err_/i,
      /cloudflare|cf|安全验证|人机验证/i,
      /no window with id|自动任务窗口已不可用|窗口已关闭|tab.*closed|标签页已关闭/i,
      /后台.*空闲.*超时|等待后台.*超时|终态事件超时|流程.*未空闲/i,
      /取码站.*(?:超时|未找到|加载|不可访问)|页面.*(?:加载|未就绪|未找到)/i,
      /service worker|extension context invalidated|receiving end does not exist/i,
    ];
    if (preservePatterns.some((pattern) => pattern.test(message))) {
      return {
        removeEntry: false,
        stopQueue: true,
        status: 'paused',
        reason: 'transient',
      };
    }

    const removePatterns = [
      /卡密.*(?:无效|错误|不存在|已使用|已兑换|失效|过期)/i,
      /invalid.*(?:card|key|code)|card.*(?:invalid|used|expired)/i,
      /验证码.*(?:被页面拒绝|错误|无效)|invalid.*verification.*code/i,
      /SUB2API.*(?:缺少|尚未配置|未配置|登录失败|回调交换)|尚未配置 SUB2API/i,
      /手机号.*(?:绑定失败|验证失败)|phone.*(?:verification|bind).*failed/i,
      /无法继续自动授权|当前流程无法继续自动授权/i,
    ];
    return {
      removeEntry: removePatterns.some((pattern) => pattern.test(message)),
      stopQueue: false,
      status: 'failed',
      reason: 'confirmed',
    };
  }

  function throwIfAutoStopped() {
    if (!state.running) {
      throw new Error('用户停止 Plus 卡密自动流程。');
    }
  }

  function showWorkflowToast(message, type = 'info') {
    if (typeof root.showToast === 'function') {
      root.showToast(message, type);
      return;
    }
    console.log('[PlusCardKey]', message);
  }

  async function ensureIncognitoAccess() {
    if (!chrome?.extension?.isAllowedIncognitoAccess) {
      return;
    }
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    if (!allowed) {
      throw new Error('插件尚未允许在无痕模式下运行，请先在 Chrome 扩展详情页开启“允许在无痕模式下运行”。');
    }
  }

  async function focusTab(tab) {
    if (!tab?.id) return;
    if (Number.isInteger(tab.windowId) && tab.windowId > 0 && chrome?.windows?.update) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(tab.id, { active: true });
  }

  async function createIncognitoCardSiteTab(options = {}) {
    await ensureIncognitoAccess();
    if (!chrome?.windows?.create) {
      throw new Error('当前运行环境不支持创建无痕取码站窗口。');
    }
    const win = await chrome.windows.create({
      url: CARD_SITE_URL,
      incognito: true,
      focused: Boolean(options.focused),
      type: 'normal',
    });
    const tab = Array.isArray(win?.tabs)
      ? win.tabs.find((candidate) => candidate?.id)
      : null;
    if (!tab?.id) {
      throw new Error('已创建无痕窗口，但未找到取码站标签页。');
    }
    return tab;
  }

  async function getCardSiteTab(options = {}) {
    const shouldFocus = Boolean(options.focus);
    async function waitForTabReady(tabId, timeoutMs = 30000) {
      if (!tabId || !chrome?.tabs?.onUpdated || !chrome?.tabs?.get) {
        throw new Error('无法等待卡密取码站标签页加载。');
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
        };
        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(value);
        };
        const listener = (updatedTabId, changeInfo, tab) => {
          if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
          settle(resolve, tab);
        };
        const timer = setTimeout(() => {
          settle(reject, new Error('卡密取码站加载超时，请确认页面可访问后重试。'));
        }, timeoutMs);

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            settle(reject, new Error(chrome.runtime.lastError.message || '读取卡密取码站标签页失败。'));
            return;
          }
          if (tab?.status === 'complete') {
            settle(resolve, tab);
          }
        });
      });
    }

    await ensureIncognitoAccess();
    const siteTabs = await chrome.tabs.query({ url: '*://plus.keria.cc.cd/*' });
    const incognitoTab = siteTabs.find((tab) => tab?.id && tab.incognito);
    if (incognitoTab?.id) {
      if (shouldFocus) {
        await focusTab(incognitoTab);
      }
      return incognitoTab.status === 'complete' ? incognitoTab : waitForTabReady(incognitoTab.id);
    }

    const created = await createIncognitoCardSiteTab({ focused: shouldFocus });
    return waitForTabReady(created?.id);
  }

  async function reloadCardSiteTab(tab, timeoutMs = 30000) {
    if (!tab?.id || !chrome?.tabs?.reload || !chrome?.tabs?.onUpdated || !chrome?.tabs?.get) {
      throw new Error('无法刷新卡密取码站标签页。');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
      };
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const listener = (updatedTabId, changeInfo, updatedTab) => {
        if (updatedTabId !== tab.id || changeInfo.status !== 'complete') return;
        settle(resolve, updatedTab);
      };
      const timer = setTimeout(() => {
        settle(reject, new Error('刷新卡密取码站超时，请确认页面可访问后重试。'));
      }, timeoutMs);

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.reload(tab.id, {}, () => {
        if (chrome.runtime.lastError) {
          settle(reject, new Error(chrome.runtime.lastError.message || '刷新卡密取码站失败。'));
          return;
        }
        chrome.tabs.get(tab.id, (reloadedTab) => {
          if (chrome.runtime.lastError) {
            settle(reject, new Error(chrome.runtime.lastError.message || '读取刷新后的卡密取码站失败。'));
            return;
          }
          if (reloadedTab?.status === 'complete') {
            settle(resolve, reloadedTab);
          }
        });
      });
    });
  }

  async function executeOnCardSite(functionName, args = []) {
    const tab = await getCardSiteTab();
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cardSiteInjectedRunner,
      args: [functionName, args],
    });
    if (result?.error) throw new Error(result.error);
    return result || {};
  }

  async function executeOnCardSiteWithPageRefresh(functionName, args = [], options = {}) {
    const maxPageAttempts = Number(options.maxPageAttempts) === 0
      ? Infinity
      : Math.max(1, Math.floor(Number(options.maxPageAttempts) || 3));
    const requireRunning = Boolean(options.requireRunning);
    const actionLabel = normalizeString(options.actionLabel)
      || (functionName === 'fetchCode' ? '邮箱取码' : '换出邮箱');
    let lastError = null;
    for (let attempt = 1; attempt <= maxPageAttempts; attempt += 1) {
      if (requireRunning) throwIfAutoStopped();
      const tab = await getCardSiteTab();
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: cardSiteInjectedRunner,
          args: [functionName, args],
        });
        if (result?.error) throw new Error(result.error);
        return result || {};
      } catch (error) {
        lastError = error;
        if (!/failed to fetch|网络|请求失败|换出邮箱超时|未识别到邮箱|未识别到新的邮箱秘钥|邮箱取码超时|未识别到验证码|未返回有效验证码/i.test(error?.message || String(error))) {
          throw error;
        }
        if (attempt >= maxPageAttempts) break;
        if (requireRunning) throwIfAutoStopped();
        const attemptText = Number.isFinite(maxPageAttempts)
          ? `${attempt}/${maxPageAttempts}`
          : `第 ${attempt} 轮`;
        updateEntry(state.currentId, {
          status: 'running',
          error: `卡密取码站${actionLabel}失败，正在刷新页面后重试（${attemptText}）：${error?.message || error}`,
        });
        await saveState();
        render();
        await reloadCardSiteTab(tab).catch(async () => {
          await delay(1500);
        });
        await delay(1500);
      }
    }
    throw lastError || new Error(`卡密取码站${actionLabel}失败。`);
  }

  async function exchangeCurrentEmail() {
    const entry = getCurrentEntry();
    if (!entry) {
      showWorkflowToast('请先导入卡密。', 'warn');
      return;
    }
    setBusy(true);
    try {
      updateEntry(entry.id, { status: 'pending', error: '' });
      render();
      state.currentId = entry.id;
      const result = await executeOnCardSiteWithPageRefresh('exchange', [entry.cardKey], {
        maxPageAttempts: 3,
        requireRunning: false,
      });
      updateEntry(entry.id, {
        email: result.email || '',
        mailSecret: result.mailSecret || '',
        status: 'exchanged',
        error: '',
      });
      await saveState();
      render();
      showWorkflowToast(`已换出邮箱：${result.email}`, 'success');
    } catch (error) {
      updateEntry(entry.id, { status: 'failed', error: error?.message || String(error) });
      await saveState();
      render();
      showWorkflowToast(error?.message || '换出邮箱失败。', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exchangeCardKey(entry) {
    updateEntry(entry.id, { status: 'running', error: '' });
    state.currentId = entry.id;
    state.currentEntry = entry;
    await saveState();
    render();
    const result = await executeOnCardSiteWithPageRefresh('exchange', [entry.cardKey], {
      maxPageAttempts: 0,
      requireRunning: true,
    });
    const email = normalizeString(result.email);
    if (!email) {
      throw new Error('卡密已提交，但未换出邮箱。');
    }
    updateEntry(entry.id, {
      email,
      mailSecret: normalizeString(result.mailSecret),
      status: 'exchanged',
      error: '',
    });
    state.currentEntry = {
      ...entry,
      email,
      mailSecret: normalizeString(result.mailSecret),
      status: 'exchanged',
      error: '',
    };
    await saveState();
    render();
    return state.currentEntry;
  }

  function getPlusWorkflowFailureFromState(flowState = {}) {
    const summaries = Array.isArray(flowState?.autoRunRoundSummaries) ? flowState.autoRunRoundSummaries : [];
    const failedSummary = summaries.find((summary) => String(summary?.status || '') === 'failed');
    if (failedSummary?.finalFailureReason) return failedSummary.finalFailureReason;
    const statuses = flowState?.nodeStatuses || {};
    const failedNode = Object.keys(statuses).find((nodeId) => statuses[nodeId] === 'failed');
    if (failedNode) return `节点 ${failedNode} 失败`;
    return '后台流程失败或被停止。';
  }

  async function getBackgroundState() {
    const result = await chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'plus-card-key-workflow' });
    if (result?.error) throw new Error(result.error);
    return result || {};
  }

  async function waitForBackgroundIdle(timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const flowState = await getBackgroundState();
      const phase = normalizeString(flowState?.autoRunPhase).toLowerCase();
      const locked = Boolean(flowState?.autoRunning)
        && ['running', 'waiting_step', 'retrying', 'waiting_interval', 'waiting_email', 'scheduled'].includes(phase);
      const runningNode = Object.values(flowState?.nodeStatuses || {})
        .some((status) => normalizeString(status).toLowerCase() === 'running');
      if (!locked && !runningNode) {
        return flowState;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('等待后台自动流程停止超时。');
  }

  function settleWaitingBackgroundFlow(message) {
    if (!waitingBackgroundFlow) return;
    if (message?.type === 'PLUS_CARD_KEY_WORKFLOW_DONE' || message?.type === 'PLUS_CARD_KEY_WORKFLOW_FAILED') {
      const waiter = waitingBackgroundFlow;
      waitingBackgroundFlow = null;
      clearTimeout(waiter.timer);
      if (message.type === 'PLUS_CARD_KEY_WORKFLOW_DONE') {
        waiter.resolve(message.payload || {});
        return;
      }
      waiter.reject(new Error(normalizeString(message?.payload?.error) || '后台 Plus 卡密工作流失败。'));
      return;
    }
    if (message?.type !== 'AUTO_RUN_STATUS') return;
    const phase = String(message?.payload?.phase || '').trim().toLowerCase();
    if (!['complete', 'stopped', 'idle'].includes(phase)) return;
    const waiter = waitingBackgroundFlow;
    waitingBackgroundFlow = null;
    clearTimeout(waiter.timer);
    getBackgroundState()
      .then((flowState) => {
        const workflowStartedAt = Number(flowState?.plusCardKeyWorkflowStartedAt) || 0;
        const messageSessionId = Number(message?.payload?.sessionId) || 0;
        const shouldWaitForExplicitPlusEvent = phase !== 'idle'
          && flowState?.plusCardKeyWorkflow
          && (workflowStartedAt > 0 || messageSessionId > 0);
        if (!shouldWaitForExplicitPlusEvent) {
          return flowState;
        }
        waitingBackgroundFlow = waiter;
        waiter.timer = setTimeout(() => {
          if (waitingBackgroundFlow !== waiter) return;
          waitingBackgroundFlow = null;
          waiter.reject(new Error('等待后台 Plus 卡密终态事件超时。'));
        }, 30000);
        return null;
      })
      .then((flowState) => {
        if (!flowState) return;
        if (waitingBackgroundFlow === waiter) {
          waitingBackgroundFlow = null;
        }
        clearTimeout(waiter.timer);
        return flowState;
      })
      .then((flowState) => {
        if (!flowState) return;
        if (!flowState?.plusCardKeyWorkflow && phase === 'idle') {
          waiter.reject(new Error('后台流程已空闲，但未找到 Plus 卡密工作流上下文。'));
          return;
        }
        if (phase === 'complete') {
          waiter.resolve(flowState);
          return;
        }
        waiter.reject(new Error(getPlusWorkflowFailureFromState(flowState)));
      })
      .catch((error) => waiter.reject(error));
  }

  function waitUntilBackgroundFlowCompletesOrFails(timeoutMs = 20 * 60 * 1000) {
    if (waitingBackgroundFlow) {
      waitingBackgroundFlow.reject(new Error('已有 Plus 卡密后台流程等待中。'));
      clearTimeout(waitingBackgroundFlow.timer);
      waitingBackgroundFlow = null;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiter = waitingBackgroundFlow;
        waitingBackgroundFlow = null;
        if (waiter) {
          waiter.reject(new Error('等待后台 Plus 卡密工作流完成超时。'));
        }
      }, timeoutMs);
      waitingBackgroundFlow = { resolve, reject, timer };
    });
  }

  async function startBackgroundWorkflow(entry) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const automationWindowId = Number(activeTab?.windowId);
    const response = await chrome.runtime.sendMessage({
      type: 'START_PLUS_CARD_KEY_WORKFLOW',
      source: 'sidepanel',
      payload: {
        cardKey: entry.cardKey,
        email: entry.email,
        mailSecret: entry.mailSecret,
        ...(Number.isInteger(automationWindowId) && automationWindowId > 0 ? { automationWindowId } : {}),
      },
    });
    if (response?.error) throw new Error(response.error);
    if (response?.ok === false) throw new Error('后台拒绝启动 Plus 卡密工作流。');
  }

  async function runNextPlusCardKey() {
    if (!state.running || autoRunLoopActive) return;
    autoRunLoopActive = true;
    try {
      while (state.running) {
        const entry = getNextRunnableEntry();
        if (!entry) {
          const pendingImports = state.entries.filter((item) => item.status === 'import_pending').length;
          state.running = false;
          state.currentEntry = null;
          await saveState();
          render();
          showWorkflowToast(
            pendingImports
              ? `Plus 卡密队列暂无可继续处理项，剩余 ${pendingImports} 个待重试导入。`
              : 'Plus 卡密队列已处理完成。',
            pendingImports ? 'warn' : 'success'
          );
          break;
        }
        state.currentId = entry.id;

        let finalError = '';
        let activeEntry = entry;
        let shouldRemoveEntry = true;
        try {
          const exchanged = entry.email ? entry : await exchangeCardKey(entry);
          activeEntry = exchanged;
          throwIfAutoStopped();
          updateEntry(entry.id, { status: 'running', error: '' });
          state.currentEntry = exchanged;
          await saveState();
          render();
          await startBackgroundWorkflow(exchanged);
          await waitUntilBackgroundFlowCompletesOrFails();
          showWorkflowToast(`Plus 卡密已完成并导入：${exchanged.email}`, 'success', 2600);
        } catch (error) {
          finalError = error?.message || String(error);
          const failure = classifyPlusCardKeyFailure(finalError);
          shouldRemoveEntry = Boolean(failure.removeEntry);
          if (shouldRemoveEntry) {
            recordFailure(activeEntry, finalError);
            showWorkflowToast(`Plus 卡密确认失败，已从队列移除：${finalError}`, 'error', 3600);
          } else {
            state.running = !failure.stopQueue;
            state.currentEntry = null;
            state.lastError = finalError;
            updateEntry(entry.id, {
              status: failure.status || 'paused',
              error: finalError,
            });
            if (failure.stopQueue) {
              state.currentId = entry.id;
              showWorkflowToast(`Plus 卡密已保留并暂停，稍后可重试：${finalError}`, 'warn', 4200);
            } else {
              const next = state.entries.find((item) => item.id !== entry.id && !AUTO_SKIP_STATUSES.has(item.status));
              state.currentId = next?.id || entry.id;
              showWorkflowToast(`SUB2API 导入临时失败，已保留当前卡密并继续下一个：${finalError}`, 'warn', 4200);
            }
          }
        } finally {
          if (shouldRemoveEntry) {
            removeEntry(entry.id);
          }
          state.currentEntry = null;
          if (!state.entries.length) {
            state.currentId = '';
          }
          await saveState();
          render();
          await waitForBackgroundIdle().catch(() => {});
        }
      }
    } finally {
      autoRunLoopActive = false;
      if (state.running && !state.entries.length) {
        state.running = false;
        state.currentEntry = null;
        await saveState();
        render();
      }
    }
  }

  async function startAutoRun() {
    if (!state.entries.length) {
      showWorkflowToast('请先导入卡密。', 'warn');
      return;
    }
    if (state.running) return;
    state.running = true;
    state.lastError = '';
    await saveState();
    render();
    runNextPlusCardKey().catch(async (error) => {
      state.running = false;
      state.currentEntry = null;
      state.lastError = error?.message || String(error);
      await saveState();
      render();
      showWorkflowToast(state.lastError || 'Plus 卡密自动流程异常停止。', 'error');
    });
  }

  async function stopAutoRun() {
    state.running = false;
    state.currentEntry = null;
    await saveState();
    render();
    if (waitingBackgroundFlow) {
      waitingBackgroundFlow.reject(new Error('用户停止 Plus 卡密自动流程。'));
      clearTimeout(waitingBackgroundFlow.timer);
      waitingBackgroundFlow = null;
    }
    await chrome.runtime.sendMessage({ type: 'STOP_FLOW', source: 'sidepanel', payload: {} }).catch(() => {});
    showWorkflowToast('已停止 Plus 卡密自动流程。', 'warn');
  }

  async function fetchCurrentCode() {
    const entry = getCurrentEntry();
    if (!entry) {
      showWorkflowToast('请先导入卡密。', 'warn');
      return;
    }
    setBusy(true);
    try {
      updateEntry(entry.id, { error: '' });
      render();
      state.currentId = entry.id;
      const result = await executeOnCardSiteWithPageRefresh('fetchCode', [], {
        maxPageAttempts: 3,
        requireRunning: false,
        actionLabel: '邮箱取码',
      });
      updateEntry(entry.id, {
        code: result.code || '',
        status: 'code_received',
        error: '',
      });
      selectNextPending();
      await saveState();
      render();
      showWorkflowToast(`已获取验证码：${result.code}`, 'success');
    } catch (error) {
      updateEntry(entry.id, { status: 'failed', error: error?.message || String(error) });
      await saveState();
      render();
      showWorkflowToast(error?.message || '邮箱取码失败。', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function openCardSite() {
    const tab = await getCardSiteTab({ focus: true });
    await focusTab(tab);
  }

  function bindEvents() {
    $(selectors.importButton)?.addEventListener('click', importCardKeys);
    $(selectors.startAutoButton)?.addEventListener('click', startAutoRun);
    $(selectors.stopAutoButton)?.addEventListener('click', stopAutoRun);
    $(selectors.exchangeButton)?.addEventListener('click', exchangeCurrentEmail);
    $(selectors.fetchCodeButton)?.addEventListener('click', fetchCurrentCode);
    $(selectors.openSiteButton)?.addEventListener('click', openCardSite);
    $(selectors.clearButton)?.addEventListener('click', clearQueue);
    $(selectors.list)?.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button[data-action]');
      if (!button) return;
      const item = button.closest('[data-entry-id]');
      const entryId = item?.dataset?.entryId || '';
      const entry = state.entries.find((candidate) => candidate.id === entryId);
      if (!entry) return;
      const action = button.dataset.action;
      if (action === 'select') {
        state.currentId = entry.id;
        const retryStatus = getRetryStatusForSelectedEntry(entry);
        if (retryStatus) {
          updateEntry(entry.id, { status: retryStatus, error: '' });
        }
      } else if (action === 'skip') {
        updateEntry(entry.id, { status: 'skipped', error: '' });
        selectNextPending();
      }
      await saveState();
      render();
    });
  }

  function cardSiteInjectedRunner(functionName, args) {
    const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const CODE_PATTERN = /(?:验证码|verification\s*code|code)[\s:：是为-]*([0-9](?:[\s-]?[0-9]){3,7})/i;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value = '') => String(value || '').trim();

    function isVisible(element) {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function getText(element) {
      return normalize(element?.innerText || element?.textContent || element?.value || '');
    }

    function findClickableByText(pattern) {
      const elements = [...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a')];
      return elements.find((element) => isVisible(element) && pattern.test(getText(element))) || null;
    }

    function findCardKeyInput() {
      const textareas = [...document.querySelectorAll('textarea')].filter(isVisible);
      if (textareas[0]) return textareas[0];
      const inputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"])')].filter(isVisible);
      return inputs.find((input) => /卡密|密钥|秘钥|key/i.test(input.placeholder || input.name || input.id || '')) || inputs[0] || null;
    }

    function getFieldLabel(element) {
      const parts = [
        element?.placeholder,
        element?.name,
        element?.id,
        element?.getAttribute?.('aria-label'),
      ];
      const label = element?.labels?.[0]?.innerText || element?.closest?.('label')?.innerText || '';
      if (label) parts.push(label);
      return normalize(parts.filter(Boolean).join(' '));
    }

    function getVisibleTextFields() {
      return [...document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea')]
        .filter(isVisible);
    }

    function getFieldValue(element) {
      return normalize(element?.value || '');
    }

    function findEmailField(cardKeyInput = null) {
      const fields = getVisibleTextFields().filter((field) => field !== cardKeyInput);
      const labeledEmailField = fields.find((field) => /邮箱|email|mail/i.test(getFieldLabel(field)));
      return labeledEmailField
        || fields.find((field) => EMAIL_PATTERN.test(getFieldValue(field)))
        || null;
    }

    function findSecretField(cardKeyInput = null, emailField = null) {
      const fields = getVisibleTextFields().filter((field) => field !== cardKeyInput && field !== emailField);
      return fields.find((field) => /秘钥|密钥|secret|key/i.test(getFieldLabel(field)) && /^[A-Z0-9]{8,}$/i.test(getFieldValue(field)))
        || fields.find((field) => /^[A-Z0-9]{8,}$/i.test(getFieldValue(field)) && !EMAIL_PATTERN.test(getFieldValue(field)))
        || null;
    }

    function setNativeValue(element, value) {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function extractEmail(cardKeyInput = null, previousEmail = '') {
      const emailField = findEmailField(cardKeyInput);
      const fieldEmail = normalize(getFieldValue(emailField).match(EMAIL_PATTERN)?.[0] || '');
      if (fieldEmail && fieldEmail !== previousEmail) {
        return fieldEmail;
      }
      return '';
    }

    function extractMailSecret(email = '', cardKeyInput = null, previousSecret = '') {
      const emailField = findEmailField(cardKeyInput);
      const secretField = findSecretField(cardKeyInput, emailField);
      const fieldSecret = getFieldValue(secretField);
      if (fieldSecret && fieldSecret !== previousSecret && fieldSecret !== email && !EMAIL_PATTERN.test(fieldSecret)) {
        return fieldSecret;
      }
      const values = getVisibleTextFields()
        .filter((input) => input !== cardKeyInput && input !== emailField)
        .map(getFieldValue)
        .filter(Boolean)
        .filter((value) => value !== email && value !== previousSecret && !EMAIL_PATTERN.test(value));
      return values.find((value) => /^[A-Z0-9]{8,}$/i.test(value)) || '';
    }

    function clearPreviousExchangeOutputs(cardKeyInput = null) {
      const emailField = findEmailField(cardKeyInput);
      const secretField = findSecretField(cardKeyInput, emailField);
      const previousEmail = normalize(getFieldValue(emailField).match(EMAIL_PATTERN)?.[0] || '');
      const previousSecret = getFieldValue(secretField);
      if (emailField) setNativeValue(emailField, '');
      if (secretField) setNativeValue(secretField, '');
      return { previousEmail, previousSecret };
    }

    function getCurrentExchangeSnapshot(cardKeyInput = null) {
      const emailField = findEmailField(cardKeyInput);
      const secretField = findSecretField(cardKeyInput, emailField);
      return {
        email: normalize(getFieldValue(emailField).match(EMAIL_PATTERN)?.[0] || ''),
        mailSecret: getFieldValue(secretField),
      };
    }

    function extractCode() {
      const text = normalize(document.body.innerText).replace(/\s+/g, ' ');
      const keywordMatch = text.match(CODE_PATTERN);
      if (keywordMatch?.[1]) return keywordMatch[1].replace(/\D+/g, '');
      const looseMatch = text.match(/\b(\d{4,8})\b/);
      return looseMatch?.[1] || '';
    }

    function hasTransientCardSiteError() {
      const text = normalize(document.body.innerText || '').replace(/\s+/g, ' ');
      return /failed\s+to\s+fetch|network\s*error|请求失败|网络错误|加载失败|fetch\s+failed/i.test(text);
    }

    function extractConfirmedCardError() {
      const text = normalize(document.body.innerText || '').replace(/\s+/g, ' ');
      const match = text.match(/卡密[^。；\n]*(?:无效|错误|不存在|已使用|已兑换|失效|过期)|(?:invalid|used|expired)[^。；\n]*(?:card|key|code)/i);
      return match?.[0] || '';
    }

    async function waitFor(check, timeoutMs, errorMessage, options = {}) {
      const start = Date.now();
      const pollMs = Math.max(1, Number(options.pollMs) || 300);
      while (Date.now() - start < timeoutMs) {
        const confirmedCardError = extractConfirmedCardError();
        if (confirmedCardError) {
          throw new Error(confirmedCardError);
        }
        if (options.abortOnTransientError && hasTransientCardSiteError()) {
          throw new Error(options.transientErrorMessage || '卡密取码站请求失败：Failed to fetch');
        }
        const value = check();
        if (value) return value;
        await sleep(pollMs);
      }
      throw new Error(errorMessage);
    }

    async function exchange(cardKey) {
      const options = (args && typeof args[1] === 'object' && args[1]) || {};
      const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || 5));
      const settleMs = Math.max(0, Math.floor(Number(options.settleMs) || 1200));
      const clickTimeoutMs = Math.max(1000, Math.floor(Number(options.clickTimeoutMs) || 6000));
      const retryDelayMs = Math.max(0, Math.floor(Number(options.retryDelayMs) || 1800));
      const pollMs = Math.max(1, Math.floor(Number(options.pollMs) || 300));
      const input = findCardKeyInput();
      if (!input) throw new Error('未找到卡密输入框。');
      const before = getCurrentExchangeSnapshot(input);
      const cleared = clearPreviousExchangeOutputs(input);
      const previousEmail = before.email || cleared.previousEmail;
      const previousSecret = before.mailSecret || cleared.previousSecret;
      setNativeValue(input, cardKey);
      const button = findClickableByText(/换出邮箱|换出.*秘钥|换出.*密钥|兑换|提取/i);
      if (!button) throw new Error('未找到“换出邮箱秘钥”按钮。');
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        clearPreviousExchangeOutputs(input);
        setNativeValue(input, cardKey);
        button.click();
        await sleep(settleMs);
        try {
          const email = await waitFor(
            () => extractEmail(input, previousEmail),
            clickTimeoutMs,
            previousEmail
              ? `换出邮箱超时，页面仍停留在上一轮邮箱：${previousEmail}`
              : '换出邮箱超时，未识别到邮箱地址。',
            { abortOnTransientError: true, pollMs }
          );
          const mailSecret = await waitFor(
            () => extractMailSecret(email, input, previousSecret),
            clickTimeoutMs,
            '已识别邮箱，但未识别到新的邮箱秘钥。',
            { abortOnTransientError: true, pollMs }
          );
          return { email, mailSecret };
        } catch (error) {
          lastError = error;
          if (extractConfirmedCardError()) {
            throw error;
          }
          if (!/failed to fetch|请求失败|网络错误|换出邮箱超时|未识别到邮箱|未识别到新的邮箱秘钥/i.test(error?.message || String(error))) {
            throw error;
          }
          if (attempt >= maxAttempts) break;
          await sleep(retryDelayMs);
        }
      }
      throw lastError || new Error('卡密取码站换出失败。');
    }

    async function fetchCode() {
      const options = (args && typeof args[0] === 'object' && args[0]) || {};
      const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || 5));
      const settleMs = Math.max(0, Math.floor(Number(options.settleMs) || 1200));
      const clickTimeoutMs = Math.max(1000, Math.floor(Number(options.clickTimeoutMs) || 6000));
      const retryDelayMs = Math.max(0, Math.floor(Number(options.retryDelayMs) || 1800));
      const pollMs = Math.max(1, Math.floor(Number(options.pollMs) || 300));
      const button = findClickableByText(/邮箱取码|取码|获取验证码/i);
      if (!button) throw new Error('未找到“邮箱取码”按钮。');
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        button.click();
        await sleep(settleMs);
        try {
          const code = await waitFor(
            extractCode,
            clickTimeoutMs,
            '邮箱取码超时，未识别到验证码。',
            {
              abortOnTransientError: true,
              pollMs,
              transientErrorMessage: '卡密取码站邮箱取码请求失败：Failed to fetch',
            }
          );
          return { code };
        } catch (error) {
          lastError = error;
          if (!/failed to fetch|请求失败|网络错误|邮箱取码超时|未识别到验证码/i.test(error?.message || String(error))) {
            throw error;
          }
          if (attempt >= maxAttempts) break;
          await sleep(retryDelayMs);
        }
      }
      throw lastError || new Error('卡密取码站邮箱取码失败。');
    }

    return Promise.resolve()
      .then(() => {
        if (functionName === 'exchange') return exchange(args[0]);
        if (functionName === 'fetchCode') return fetchCode();
        throw new Error(`未知 Plus 卡密页面动作：${functionName}`);
      })
      .catch((error) => ({ error: error?.message || String(error) }));
  }

  function init() {
    if (!$(selectors.importButton)) return;
    bindEvents();
    chrome.runtime.onMessage.addListener(settleWaitingBackgroundFlow);
    loadState().catch((error) => {
      console.warn('[PlusCardKey] load failed', error);
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  root.PlusCardKeyWorkflow = {
    ...(root.PlusCardKeyWorkflow || {}),
    classifyFailure: classifyPlusCardKeyFailure,
    _test: {
      cardSiteInjectedRunner,
      createIncognitoCardSiteTab,
      getNextRunnableEntryFromEntries,
      getRetryStatusForSelectedEntry,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
