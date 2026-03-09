(function initBackground(global) {
  var Constants = {
    API_URL: "https://transmart.qq.com/api/imt",
    STORAGE_OPTIONS_KEY: "options_v1",
    STORAGE_LANGUAGE_LIST_KEY: "language_list_cache",
    LANGUAGE_LIST_TTL_MS: 24 * 60 * 60 * 1000,
    MESSAGE_GATEWAY_REQUEST: "gateway_request",
    MESSAGE_TOGGLE_PAGE_TRANSLATE: "toggle_page_translate",
    MESSAGE_TOGGLE_READING_MODE: "toggle_reading_mode",
    MESSAGE_GET_PAGE_STATE: "get_page_state",
    MESSAGE_GET_TAB_STATE: "get_tab_state",
    MESSAGE_UPDATE_OPTIONS: "update_options"
  };

  var DefaultOptions = {
    sourceLang: "auto",
    targetLang: "zh",
    pageSourceLang: "auto",
    autoTranslateForeignPage: true,
    readingMode: false,
    pageTranslate: false
  };

  var pageStateByTabId = {};

  function warn(message, details) {
    console.warn("[AITranslate][warn]", {
      message: message,
      details: details || null,
      timestamp: new Date().toISOString()
    });
  }

  function computeClientKey() {
    return ("tencent_transmart_crx_" + global.btoa(global.navigator.userAgent)).slice(0, 100);
  }

  async function fetchImt(payload) {
    var body = payload || {};
    body.header = body.header || {};
    if (!body.header.client_key) {
      body.header.client_key = computeClientKey();
    }

    var response = await fetch(Constants.API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      warn("IMT response not ok", { status: response.status });
    }

    return response.json();
  }

  function getOptions() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get([Constants.STORAGE_OPTIONS_KEY], function (result) {
        var options = result[Constants.STORAGE_OPTIONS_KEY] || {};
        resolve(Object.assign({}, DefaultOptions, options));
      });
    });
  }

  function setOptions(nextOptions) {
    return new Promise(function (resolve) {
      chrome.storage.sync.set({
        options_v1: nextOptions
      }, function () {
        resolve(nextOptions);
      });
    });
  }

  function getLanguageListFromCache() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([Constants.STORAGE_LANGUAGE_LIST_KEY], function (result) {
        resolve(result[Constants.STORAGE_LANGUAGE_LIST_KEY] || null);
      });
    });
  }

  function setLanguageListCache(cache) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({
        language_list_cache: cache
      }, function () {
        resolve(cache);
      });
    });
  }

  async function getSupportedLanguages() {
    var cached = await getLanguageListFromCache();
    var now = Date.now();
    if (cached && cached.updatedAt && now - cached.updatedAt < Constants.LANGUAGE_LIST_TTL_MS) {
      return cached.list || [];
    }

    var result = await fetchImt({
      header: {
        fn: "support_lang"
      }
    });

    if (!result || !Array.isArray(result.full_lang_pair)) {
      warn("support_lang response invalid, use stale cache", { hasCached: Boolean(cached) });
      return cached && Array.isArray(cached.list) ? cached.list : [];
    }

    await setLanguageListCache({
      list: result.full_lang_pair,
      updatedAt: now
    });

    return result.full_lang_pair;
  }

  function setTabState(tabId, patch) {
    var prev = pageStateByTabId[tabId] || {
      pageTranslate: false,
      readingMode: false
    };
    pageStateByTabId[tabId] = Object.assign({}, prev, patch);
    return pageStateByTabId[tabId];
  }

  function ensureContextMenus() {
    chrome.contextMenus.removeAll(function () {
      chrome.contextMenus.create({
        id: "ai-translate-toggle-page",
        title: "开启/关闭整页翻译",
        contexts: ["all"]
      });
      chrome.contextMenus.create({
        id: "ai-translate-toggle-reading",
        title: "开启/关闭阅读模式",
        contexts: ["all"]
      });
      chrome.contextMenus.create({
        id: "ai-translate-selection",
        title: "翻译选中文本",
        contexts: ["selection"]
      });
    });
  }

  function sendToTab(tabId, message) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        if (chrome.runtime.lastError) {
          warn("sendMessage failed", { message: chrome.runtime.lastError.message, tabId: tabId });
        }
        resolve(response);
      });
    });
  }

  chrome.runtime.onInstalled.addListener(function () {
    ensureContextMenus();
  });

  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (!tab || typeof tab.id !== "number") {
      warn("context menu tab invalid", { info: info });
      return;
    }

    if (info.menuItemId === "ai-translate-toggle-page") {
      sendToTab(tab.id, { type: Constants.MESSAGE_TOGGLE_PAGE_TRANSLATE });
      return;
    }

    if (info.menuItemId === "ai-translate-toggle-reading") {
      sendToTab(tab.id, { type: Constants.MESSAGE_TOGGLE_READING_MODE });
      return;
    }

    if (info.menuItemId === "ai-translate-selection") {
      sendToTab(tab.id, { type: "translate_selection_now" });
    }
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    if (pageStateByTabId[tabId]) {
      delete pageStateByTabId[tabId];
    }
  });

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    (async function handle() {
      if (!request || !request.type) {
        return sendResponse({ ok: false, error: "invalid_request" });
      }

      if (request.type === Constants.MESSAGE_GATEWAY_REQUEST) {
        try {
          if (request.payload && request.payload.header && request.payload.header.fn === "support_lang") {
            var langs = await getSupportedLanguages();
            return sendResponse({ ok: true, data: { full_lang_pair: langs } });
          }

          var data = await fetchImt(request.payload);
          return sendResponse({ ok: true, data: data });
        } catch (error) {
          warn("gateway request failed", { error: String(error) });
          return sendResponse({ ok: false, error: String(error) });
        }
      }

      if (request.type === Constants.MESSAGE_UPDATE_OPTIONS) {
        var merged = Object.assign({}, await getOptions(), request.payload || {});
        await setOptions(merged);
        return sendResponse({ ok: true, data: merged });
      }

      if (request.type === "get_options") {
        return sendResponse({ ok: true, data: await getOptions() });
      }

      if (request.type === Constants.MESSAGE_GET_PAGE_STATE) {
        var tabId = sender && sender.tab ? sender.tab.id : -1;
        return sendResponse({ ok: true, data: pageStateByTabId[tabId] || { pageTranslate: false, readingMode: false } });
      }

      if (request.type === Constants.MESSAGE_GET_TAB_STATE) {
        var requestTabId = typeof request.tabId === "number" ? request.tabId : -1;
        return sendResponse({ ok: true, data: pageStateByTabId[requestTabId] || { pageTranslate: false, readingMode: false } });
      }

      if (request.type === "set_page_state") {
        var stateTabId = sender && sender.tab ? sender.tab.id : -1;
        return sendResponse({ ok: true, data: setTabState(stateTabId, request.payload || {}) });
      }

      return sendResponse({ ok: false, error: "unknown_message" });
    })();

    return true;
  });
})(globalThis);
