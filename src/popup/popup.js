(function initPopup(global) {
  var root = global.AITranslate;
  var Constants = root.Constants;
  var Logger = root.Logger || {
    warn: function (scope, message, details) {
      console.warn("[AITranslate][popup-fallback]", { scope: scope, message: message, details: details || null });
    }
  };
  var RuntimeClient = root.RuntimeClient;
  var TranslationGateway = root.TranslationGateway;

  function safeWarn(scope, message, details) {
    if (Logger && typeof Logger.warn === "function") {
      Logger.warn(scope, message, details);
      return;
    }
    throw new Error("Logger.warn is unavailable in popup context");
  }

  var sourceSelect = document.getElementById("sourceLang");
  var targetSelect = document.getElementById("targetLang");
  var sourceText = document.getElementById("sourceText");
  var resultText = document.getElementById("resultText");
  var counter = document.getElementById("counter");
  var modeStatus = document.getElementById("modeStatus");

  var languagePairs = [];
  var options = null;
  var translateTimer = null;
  var statusTimer = null;

  function findPair(sourceLang) {
    for (var i = 0; i < languagePairs.length; i += 1) {
      if (languagePairs[i].source && languagePairs[i].source.code === sourceLang) {
        return languagePairs[i];
      }
    }
    return null;
  }

  function toOption(code, name) {
    var option = document.createElement("option");
    option.value = code;
    option.textContent = name || code;
    return option;
  }

  function renderSourceOptions() {
    sourceSelect.innerHTML = "";
    sourceSelect.appendChild(toOption("auto", "自动选择"));

    for (var i = 0; i < languagePairs.length; i += 1) {
      var source = languagePairs[i].source;
      sourceSelect.appendChild(toOption(source.code, source.chn_name || source.eng_name || source.code));
    }
  }

  function hasTargetValue(value) {
    for (var i = 0; i < targetSelect.options.length; i += 1) {
      if (targetSelect.options[i].value === value) {
        return true;
      }
    }
    return false;
  }

  function ensureTargetOption(code, name) {
    if (hasTargetValue(code)) {
      return;
    }
    targetSelect.appendChild(toOption(code, name));
  }

  function renderTargetOptions() {
    var sourceCode = sourceSelect.value === "auto" ? "en" : sourceSelect.value;
    var shouldExcludeSameLang = sourceSelect.value !== "auto";
    var pair = findPair(sourceCode);
    targetSelect.innerHTML = "";

    var fallback = [toOption("zh", "中文"), toOption("en", "English")];
    if (!pair || !Array.isArray(pair.target_list) || pair.target_list.length === 0) {
      fallback.forEach(function (item) {
        targetSelect.appendChild(item);
      });
      targetSelect.value = options.targetLang || Constants.DEFAULTS.TARGET_LANG;
      return;
    }

    pair.target_list.forEach(function (target) {
      if (!shouldExcludeSameLang || target.code !== sourceCode) {
        targetSelect.appendChild(toOption(target.code, target.chn_name || target.eng_name || target.code));
      }
    });

    // Keep core language options available in target list even when gateway payload is partial.
    ensureTargetOption("zh", "中文");
    ensureTargetOption("en", "English");

    if (hasTargetValue(options.targetLang)) {
      targetSelect.value = options.targetLang;
    } else {
      targetSelect.value = Constants.DEFAULTS.TARGET_LANG;
    }
  }

  async function translateInput() {
    var text = sourceText.value.trim();
    if (!text) {
      resultText.textContent = "";
      return;
    }

    resultText.textContent = "翻译中...";

    var translated = await TranslationGateway.translateBlock(sourceSelect.value, targetSelect.value, text);
    if (!translated) {
      resultText.textContent = "翻译失败，请重试";
      return;
    }

    resultText.textContent = translated;
  }

  function debounceTranslate() {
    if (translateTimer) {
      clearTimeout(translateTimer);
    }

    translateTimer = setTimeout(function () {
      translateInput();
    }, 240);
  }

  function showStatus(text) {
    if (statusTimer) {
      clearTimeout(statusTimer);
    }
    resultText.textContent = text;
    statusTimer = setTimeout(function () {
      if (resultText.textContent === text) {
        resultText.textContent = "";
      }
    }, 1800);
  }

  function renderModeStatus(stateInfo) {
    var label = "无";
    if (stateInfo && stateInfo.readingMode) {
      label = "阅读模式";
    }
    if (stateInfo && stateInfo.pageTranslate) {
      label = "整页翻译";
    }
    modeStatus.textContent = "当前功能：" + label;
  }

  async function refreshModeStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
      if (!tabs || !tabs[0] || typeof tabs[0].id !== "number") {
        renderModeStatus(null);
        return;
      }

      var response = await RuntimeClient.sendMessage({
        type: Constants.MESSAGE.GET_TAB_STATE,
        tabId: tabs[0].id
      });

      if (!response.ok) {
        Logger.warn("popup", "refresh mode status failed", response);
        renderModeStatus(null);
        return;
      }

      renderModeStatus(response.data);
    });
  }

  function sendMessageToActiveTab(messageType, payload) {
    function isInjectableUrl(url) {
      var value = String(url || "");
      if (!value) {
        return false;
      }
      if (value.indexOf("chrome://") === 0) {
        return false;
      }
      if (value.indexOf("chrome-extension://") === 0) {
        return false;
      }
      if (value.indexOf("edge://") === 0) {
        return false;
      }
      if (value.indexOf("about:") === 0) {
        return false;
      }
      return true;
    }

    function injectContentAssets(tabId) {
      return new Promise(function (resolve) {
        chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ["src/content/content.css"]
        }, function () {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [
              "src/shared/constants.js",
              "src/shared/logger.js",
              "src/domain/segmenter.js",
              "src/domain/difficult-phrase.js",
              "src/infrastructure/runtime-client.js",
              "src/infrastructure/translation-gateway.js",
              "src/content/content.js"
            ]
          }, function () {
            if (chrome.runtime.lastError) {
              Logger.warn("popup", "inject content assets failed", {
                error: chrome.runtime.lastError.message,
                tabId: tabId
              });
              resolve(false);
              return;
            }
            resolve(true);
          });
        });
      });
    }

    function sendToTab(tabId, retryInject) {
      return new Promise(function (resolve) {
        chrome.tabs.sendMessage(tabId, { type: messageType, payload: payload || {} }, async function (response) {
          if (!chrome.runtime.lastError) {
            resolve(response || { ok: true });
            return;
          }

          var errorMessage = chrome.runtime.lastError.message || "";
          safeWarn("popup", "send to content failed", {
            error: String(errorMessage || ""),
            tabId: tabId,
            type: messageType
          });

          if (!retryInject || errorMessage.indexOf("Receiving end does not exist") < 0) {
            showStatus("当前页面不支持该操作");
            resolve({ ok: false, reason: "no_receiver" });
            return;
          }

          var injected = await injectContentAssets(tabId);
          if (!injected) {
            showStatus("页面脚本注入失败，请刷新页面重试");
            resolve({ ok: false, reason: "inject_failed" });
            return;
          }

          var retryResult = await sendToTab(tabId, false);
          resolve(retryResult);
        });
      });
    }

    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0] || typeof tabs[0].id !== "number") {
        Logger.warn("popup", "send to tab failed, active tab not found");
        showStatus("当前标签页不可用");
        resolve({ ok: false, reason: "tab_not_found" });
        return;
      }

      var tabId = tabs[0].id;
      if (!isInjectableUrl(tabs[0].url)) {
        showStatus("当前页面不支持该操作");
        resolve({ ok: false, reason: "non_injectable_page" });
        return;
      }

      sendToTab(tabId, true).then(resolve);
    });
    });
  }

  async function persistOptions() {
    options.sourceLang = sourceSelect.value;
    options.targetLang = targetSelect.value;

    var response = await RuntimeClient.sendMessage({
      type: Constants.MESSAGE.UPDATE_OPTIONS,
      payload: options
    });

    if (!response.ok) {
      Logger.warn("popup", "persist options failed", response);
    }
  }

  async function bootstrap() {
    var optionsResult = await RuntimeClient.sendMessage({ type: "get_options" });
    options = optionsResult.ok ? optionsResult.data : Object.assign({}, Constants.DEFAULTS);

    languagePairs = await TranslationGateway.getSupportedLanguages();

    renderSourceOptions();
    sourceSelect.value = options.sourceLang || Constants.DEFAULTS.SOURCE_LANG;
    renderTargetOptions();

    counter.textContent = "0/" + Constants.UI.MAX_TEXTAREA_LENGTH;
    await refreshModeStatus();
  }

  sourceSelect.addEventListener("change", async function () {
    renderTargetOptions();
    await persistOptions();
    debounceTranslate();
  });

  targetSelect.addEventListener("change", async function () {
    await persistOptions();
    debounceTranslate();
  });

  document.getElementById("swapBtn").addEventListener("click", async function () {
    if (sourceSelect.value === "auto") {
      sourceSelect.value = targetSelect.value;
    } else {
      var currentSource = sourceSelect.value;
      sourceSelect.value = targetSelect.value;
      renderTargetOptions();
      if (hasTargetValue(currentSource)) {
        targetSelect.value = currentSource;
      }
    }

    await persistOptions();
    debounceTranslate();
  });

  sourceText.addEventListener("input", function () {
    counter.textContent = sourceText.value.length + "/" + Constants.UI.MAX_TEXTAREA_LENGTH;
    debounceTranslate();
  });

  document.getElementById("togglePage").addEventListener("click", async function () {
    var response = await sendMessageToActiveTab(Constants.MESSAGE.TOGGLE_PAGE_TRANSLATE, {
      sourceLang: sourceSelect.value,
      targetLang: targetSelect.value
    });
    if (response && response.ok) {
      renderModeStatus(response);
      return;
    }
    await refreshModeStatus();
  });

  document.getElementById("toggleReading").addEventListener("click", async function () {
    var response = await sendMessageToActiveTab(Constants.MESSAGE.TOGGLE_READING_MODE, {
      sourceLang: sourceSelect.value,
      targetLang: targetSelect.value
    });
    if (response && response.ok) {
      renderModeStatus(response);
      return;
    }
    await refreshModeStatus();
  });

  document.getElementById("openWeb").addEventListener("click", function () {
    chrome.tabs.create({ url: "https://transmart.qq.com" });
  });

  bootstrap();
})(globalThis);
