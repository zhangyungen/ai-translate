(function initContent(global) {
  if (global.__AI_TRANSLATE_CONTENT_READY__) {
    return;
  }
  global.__AI_TRANSLATE_CONTENT_READY__ = true;

  var root = global.AITranslate;
  var Constants = root.Constants;
  var Logger = root.Logger;
  var Segmenter = root.Segmenter;
  var DifficultPhrase = root.DifficultPhrase;
  var RuntimeClient = root.RuntimeClient;
  var TranslationGateway = root.TranslationGateway;

  var state = {
    options: null,
    pageTranslateEnabled: false,
    readingModeEnabled: false,
    pageSourceLang: "auto",
    pageTargetLang: "zh",
    detectedPageLang: "auto",
    pageProcessedKeyMap: {},
    lastPageInsertedText: "",
    lastPageInsertedElement: null,
    lastMainTranslatedResultText: "",
    lastMainTranslatedResultElement: null,
    noNeedTranslateHintShown: false,
    pageTranslationArtifacts: [],
    pageProcessedElements: new WeakSet(),
    readingArtifacts: [],
    readingProcessedElements: new WeakSet(),
    readingProcessedKeyMap: {},
    lastReadingInsertedByType: {
      segment: "",
      glossary: "",
      translation: ""
    },
    lastReadingInsertedElementByType: {
      segment: null,
      glossary: null,
      translation: null
    },
    hoverTimer: null,
    lastHoverKey: "",
    scrollHandler: null,
    resizeHandler: null,
    mutationObserver: null,
    pageProcessRunning: false,
    pageProcessPending: false,
    readingScrollHandler: null,
    readingResizeHandler: null,
    readingMutationObserver: null,
    readingProcessRunning: false,
    readingProcessPending: false,
    translationCacheMap: {},
    translationCacheOrder: [],
    cachePersistTimer: null
  };

  function normalizeLangCode(code) {
    var value = String(code || "").trim().toLowerCase();
    if (!value) {
      return "auto";
    }
    if (value === "auto") {
      return "auto";
    }
    if (value.indexOf("zh") === 0) {
      return "zh";
    }
    if (value.indexOf("en") === 0) {
      return "en";
    }
    return value.split("-")[0];
  }

  function detectPageLangFromDomHint() {
    var html = document.documentElement;
    if (!html) {
      return "auto";
    }

    var raw = html.getAttribute("lang") || html.lang || "";
    if (!raw) {
      return "auto";
    }
    return normalizeLangCode(raw);
  }

  function getBrowserPreferredLang() {
    var navLang = navigator.language || "en";
    var normalized = normalizeLangCode(navLang);
    if (!normalized || normalized === "auto") {
      return "en";
    }
    return normalized;
  }

  function chooseAutoTargetLang(pageLang) {
    var source = normalizeLangCode(pageLang);
    var preferred = getBrowserPreferredLang();

    if (source === "zh") {
      return "en";
    }
    if (source === "en") {
      return "zh";
    }

    if (preferred) {
      return preferred;
    }

    return "en";
  }

  function resolveManualLanguagePreference(rawSource, rawTarget, detectedSource) {
    var source = normalizeLangCode(rawSource);
    var target = normalizeLangCode(rawTarget);
    var effectiveSource = source === "auto" ? normalizeLangCode(detectedSource) : source;
    if (!effectiveSource) {
      effectiveSource = "auto";
    }

    var effectiveTarget = target;
    if (!effectiveTarget || effectiveTarget === "auto") {
      effectiveTarget = chooseAutoTargetLang(effectiveSource);
    }

    return {
      sourceLang: effectiveSource,
      targetLang: effectiveTarget
    };
  }

  function shouldSkipTranslationByLang(sourceLang, targetLang) {
    var source = normalizeLangCode(sourceLang);
    var target = normalizeLangCode(targetLang);
    if (!source || source === "auto" || !target || target === "auto") {
      return false;
    }
    return source === target;
  }

  function showNoNeedTranslateHint(sourceLang) {
    if (state.noNeedTranslateHintShown) {
      return;
    }
    state.noNeedTranslateHintShown = true;

    var banner = document.createElement("div");
    banner.className = "ai-translate-banner";
    banner.textContent = "检测到页面语言与目标语言同为 " + sourceLang + "，无需翻译。";

    var close = document.createElement("button");
    close.textContent = "关闭";
    close.addEventListener("click", function () {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    });

    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  async function getOptions() {
    var result = await RuntimeClient.sendMessage({ type: "get_options" });
    if (!result.ok) {
      Logger.warn("content", "get options failed");
      return Object.assign({}, Constants.DEFAULTS);
    }
    return Object.assign({}, Constants.DEFAULTS, result.data || {});
  }

  async function setPageState(patch) {
    await RuntimeClient.sendMessage({ type: "set_page_state", payload: patch });
  }

  async function loadTranslationCache() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([Constants.CACHE.TRANSLATION_CACHE_KEY], function (result) {
        var cached = result[Constants.CACHE.TRANSLATION_CACHE_KEY];
        if (!cached || typeof cached !== "object") {
          state.translationCacheMap = {};
          state.translationCacheOrder = [];
          return resolve();
        }

        state.translationCacheMap = cached.map && typeof cached.map === "object" ? cached.map : {};
        state.translationCacheOrder = Array.isArray(cached.order) ? cached.order.filter(function (key) {
          return typeof key === "string" && state.translationCacheMap[key];
        }) : Object.keys(state.translationCacheMap);
        resolve();
      });
    });
  }

  function schedulePersistCache() {
    if (state.cachePersistTimer) {
      clearTimeout(state.cachePersistTimer);
    }

    state.cachePersistTimer = setTimeout(function () {
      var payload = {
        map: state.translationCacheMap,
        order: state.translationCacheOrder
      };
      var next = {};
      next[Constants.CACHE.TRANSLATION_CACHE_KEY] = payload;
      chrome.storage.local.set(next, function () {
        if (chrome.runtime.lastError) {
          Logger.warn("content", "persist translation cache failed", { error: chrome.runtime.lastError.message });
        }
      });
    }, 300);
  }

  function touchCacheKey(cacheKey) {
    var index = state.translationCacheOrder.indexOf(cacheKey);
    if (index >= 0) {
      state.translationCacheOrder.splice(index, 1);
    }
    state.translationCacheOrder.push(cacheKey);

    var maxEntries = Constants.CACHE.TRANSLATION_CACHE_MAX_ENTRIES;
    while (state.translationCacheOrder.length > maxEntries) {
      var removed = state.translationCacheOrder.shift();
      delete state.translationCacheMap[removed];
    }
  }

  function buildCacheKey(sourceLang, targetLang, text) {
    return [sourceLang, targetLang, text].join("||");
  }

  async function translateBlockWithCache(sourceLang, targetLang, text) {
    var clean = String(text || "").trim();
    if (!clean) {
      return null;
    }

    var cacheKey = buildCacheKey(sourceLang, targetLang, clean);
    if (state.translationCacheMap[cacheKey]) {
      touchCacheKey(cacheKey);
      return state.translationCacheMap[cacheKey];
    }

    var translated = await TranslationGateway.translateBlock(sourceLang, targetLang, clean);
    if (!translated) {
      return null;
    }

    state.translationCacheMap[cacheKey] = translated;
    touchCacheKey(cacheKey);
    schedulePersistCache();
    return translated;
  }

  function isElementVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    var style = global.getComputedStyle ? global.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0)) {
      return false;
    }

    var rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      return false;
    }

    var margin = Constants.UI.VIEWPORT_MARGIN_PX;
    var viewTop = 0 - margin;
    var viewBottom = (global.innerHeight || document.documentElement.clientHeight || 0) + margin;
    return rect.bottom >= viewTop && rect.top <= viewBottom;
  }

  function isCodeLikeElement(element) {
    if (!element) {
      return false;
    }

    var cursor = element.nodeType === Node.ELEMENT_NODE ? element : element.parentElement;
    var depth = 0;
    while (cursor && depth <= 6) {
      var tag = (cursor.tagName || "").toLowerCase();
      if (tag === "pre" || tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt" || tag === "var" || tag === "textarea") {
        return true;
      }

      var className = String(cursor.className || "");
      if (className) {
        var lowerClass = className.toLowerCase();
        if (lowerClass.indexOf("code") >= 0 || lowerClass.indexOf("highlight") >= 0 || lowerClass.indexOf("hljs") >= 0 || lowerClass.indexOf("prism") >= 0) {
          return true;
        }
      }

      cursor = cursor.parentElement;
      depth += 1;
    }

    return false;
  }

  function removePageTranslationArtifacts() {
    var allBoxes = Array.prototype.slice.call(document.querySelectorAll(".ai-translate-page-box"));
    allBoxes.forEach(function (node) {
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    var translatedElements = Array.prototype.slice.call(document.querySelectorAll("[data-ai-translate-page-done='1']"));
    translatedElements.forEach(function (element) {
      element.removeAttribute("data-ai-translate-page-done");
    });

    state.pageTranslationArtifacts = [];
    state.pageProcessedElements = new WeakSet();
    state.pageProcessedKeyMap = {};
    state.lastPageInsertedText = "";
    state.lastPageInsertedElement = null;
    state.lastMainTranslatedResultText = "";
    state.lastMainTranslatedResultElement = null;
    state.pageProcessRunning = false;
    state.pageProcessPending = false;
  }

  function normalizePageInsertedText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeContextCompareText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function collectContextLines(element, maxLines) {
    if (!element) {
      return [];
    }

    var lines = [];
    var limit = maxLines || 5;
    var cursor = element;
    var back = 2;

    while (cursor && back > 0) {
      cursor = cursor.previousElementSibling;
      if (!cursor) {
        break;
      }
      if (cursor.closest && cursor.closest("[data-ai-translate-artifact='1']")) {
        continue;
      }
      var prevText = normalizeContextCompareText(cursor.innerText || "");
      if (!prevText) {
        continue;
      }
      lines.unshift(prevText);
      back -= 1;
    }

    var currentText = normalizeContextCompareText(element.innerText || "");
    if (currentText) {
      lines.push(currentText);
    }

    cursor = element;
    var forward = limit - lines.length;
    while (cursor && forward > 0) {
      cursor = cursor.nextElementSibling;
      if (!cursor) {
        break;
      }
      if (cursor.closest && cursor.closest("[data-ai-translate-artifact='1']")) {
        continue;
      }
      var nextText = normalizeContextCompareText(cursor.innerText || "");
      if (!nextText) {
        continue;
      }
      lines.push(nextText);
      forward -= 1;
    }

    return lines.slice(0, limit);
  }

  function shouldSkipTranslatedByContext(element, translatedText) {
    var normalizedTranslated = normalizeContextCompareText(translatedText);
    if (!normalizedTranslated) {
      return true;
    }

    var contextLines = collectContextLines(element, 5);
    for (var i = 0; i < contextLines.length; i += 1) {
      if (normalizeContextCompareText(contextLines[i]) === normalizedTranslated) {
        return true;
      }
    }

    return false;
  }

  function areElementsNested(elementA, elementB) {
    if (!elementA || !elementB) {
      return false;
    }
    if (elementA === elementB) {
      return true;
    }
    if (elementA.contains && elementA.contains(elementB)) {
      return true;
    }
    if (elementB.contains && elementB.contains(elementA)) {
      return true;
    }
    return false;
  }

  function shouldSkipPageInsert(element, translatedText) {
    var normalized = normalizePageInsertedText(translatedText);
    if (!normalized) {
      return true;
    }
    if (normalized !== state.lastPageInsertedText) {
      return false;
    }
    return !areElementsNested(element, state.lastPageInsertedElement);
  }

  function insertPageTranslationAfter(element, translatedText) {
    if (!element || shouldSkipPageInsert(element, translatedText)) {
      return null;
    }

    var box = document.createElement("div");
    box.className = "ai-translate-page-box";
    box.setAttribute("data-ai-translate-artifact", "1");
    box.textContent = translatedText;
    element.insertAdjacentElement("afterend", box);
    state.lastPageInsertedText = normalizePageInsertedText(translatedText);
    state.lastPageInsertedElement = element;
    state.pageTranslationArtifacts.push(box);
    return box;
  }

  function shouldSkipRepeatedMainTranslatedResult(element, translatedText) {
    var normalized = normalizeContextCompareText(translatedText);
    if (!normalized) {
      return true;
    }
    if (normalized !== state.lastMainTranslatedResultText) {
      return false;
    }
    return !areElementsNested(element, state.lastMainTranslatedResultElement);
  }

  function markMainTranslatedResult(element, translatedText) {
    state.lastMainTranslatedResultText = normalizeContextCompareText(translatedText);
    state.lastMainTranslatedResultElement = element || null;
  }

  function hasNestedPageTextBlock(element, onlyVisible) {
    if (!element || !element.querySelectorAll) {
      return false;
    }

    var nested = element.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th");
    for (var i = 0; i < nested.length; i += 1) {
      var node = nested[i];
      if (!node || node === element) {
        continue;
      }

      if (node.closest("[data-ai-translate-artifact='1'],.ai-translate-page-box,.ai-translate-reading-box,.ai-translate-reading-translation-box,.ai-translate-glossary,.ai-translate-hover-box,.ai-translate-selection-box,.ai-translate-banner")) {
        continue;
      }

      if (isCodeLikeElement(node)) {
        continue;
      }

      if (onlyVisible && !isElementVisible(node)) {
        continue;
      }

      var nestedText = String(node.innerText || "").replace(/\s+/g, " ").trim();
      if (nestedText.length >= 12) {
        return true;
      }
    }

    return false;
  }

  function hasMeaningfulDirectText(element, minLength) {
    if (!element || !element.childNodes) {
      return false;
    }
    var pieces = [];
    for (var i = 0; i < element.childNodes.length; i += 1) {
      var node = element.childNodes[i];
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        continue;
      }
      var part = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (part) {
        pieces.push(part);
      }
    }
    var joined = pieces.join(" ").trim();
    return joined.length >= (minLength || 2);
  }

  function isHeaderFooterContext(element) {
    if (!element || !element.closest) {
      return false;
    }
    return Boolean(element.closest("header,nav,footer,[role='banner'],[role='navigation'],[role='contentinfo']"));
  }

  function isSkippableHeaderFooterTag(element) {
    var tag = String((element && element.tagName) || "").toLowerCase();
    return tag === "script" ||
      tag === "style" ||
      tag === "noscript" ||
      tag === "svg" ||
      tag === "path" ||
      tag === "img" ||
      tag === "picture" ||
      tag === "video" ||
      tag === "audio" ||
      tag === "canvas" ||
      tag === "iframe" ||
      tag === "input" ||
      tag === "select" ||
      tag === "option" ||
      tag === "textarea";
  }

  function isHeaderFooterTextCandidate(element) {
    if (!element || !isHeaderFooterContext(element)) {
      return false;
    }

    if (isSkippableHeaderFooterTag(element) || isCodeLikeElement(element)) {
      return false;
    }

    var text = String(element.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) {
      return false;
    }

    for (var i = 0; i < element.children.length; i += 1) {
      var child = element.children[i];
      if (!child || isSkippableHeaderFooterTag(child)) {
        continue;
      }
      var childText = String(child.innerText || "").replace(/\s+/g, " ").trim();
      if (childText) {
        return false;
      }
    }

    return true;
  }

  function isGenericReadableTextCandidate(element, minLength) {
    if (!element || isHeaderFooterContext(element)) {
      return false;
    }

    if (isSkippableHeaderFooterTag(element) || isCodeLikeElement(element)) {
      return false;
    }

    var text = String(element.innerText || "").replace(/\s+/g, " ").trim();
    if (text.length < (minLength || 30)) {
      return false;
    }

    return true;
  }

  function collectPageTranslationCandidates(onlyVisible) {
    var mainSelectors = [
      "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figcaption", "td", "th",
      "header a", "header span", "header button", "header small",
      "nav a", "nav span", "nav button", "nav small",
      "footer a", "footer span", "footer button", "footer small",
      "[role='banner'] a", "[role='banner'] span", "[role='banner'] button", "[role='banner'] small",
      "[role='navigation'] a", "[role='navigation'] span", "[role='navigation'] button", "[role='navigation'] small",
      "[role='contentinfo'] a", "[role='contentinfo'] span", "[role='contentinfo'] button", "[role='contentinfo'] small"
    ].join(",");
    var contentContainerSelectors = [
      "article div", "article span",
      "main div", "main span",
      "section div", "section span"
    ].join(",");
    var headerFooterSelectors = [
      "header *", "nav *", "footer *",
      "[role='banner'] *", "[role='navigation'] *", "[role='contentinfo'] *"
    ].join(",");
    var elements = Array.prototype.slice.call(document.querySelectorAll(mainSelectors))
      .concat(Array.prototype.slice.call(document.querySelectorAll(contentContainerSelectors)))
      .concat(Array.prototype.slice.call(document.querySelectorAll(headerFooterSelectors)));
    var candidates = [];
    var seenElements = new WeakSet();

    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (!element || seenElements.has(element)) {
        continue;
      }
      seenElements.add(element);

      if (!element || state.pageProcessedElements.has(element)) {
        continue;
      }

      if (element.getAttribute("data-ai-translate-page-done") === "1") {
        continue;
      }

      var adjacent = element.nextElementSibling;
      if (adjacent && adjacent.classList && adjacent.classList.contains("ai-translate-page-box")) {
        element.setAttribute("data-ai-translate-page-done", "1");
        state.pageProcessedElements.add(element);
        continue;
      }

      if (element.closest(".ai-translate-page-box,.ai-translate-reading-box,.ai-translate-reading-translation-box,.ai-translate-glossary,.ai-translate-hover-box,.ai-translate-selection-box,.ai-translate-banner")) {
        continue;
      }

      if (isCodeLikeElement(element)) {
        continue;
      }

      if (isHeaderFooterContext(element) && !isHeaderFooterTextCandidate(element)) {
        continue;
      }
      if (!isHeaderFooterContext(element) && !element.matches(mainSelectors) && !isGenericReadableTextCandidate(element, 12)) {
        continue;
      }

      if (onlyVisible && !isElementVisible(element)) {
        continue;
      }

      var sourceText = String(element.innerText || "").replace(/\s+/g, " ").trim();
      var minLength = isHeaderFooterContext(element) ? 2 : 12;
      if (sourceText.length < minLength) {
        continue;
      }

      var key = buildReadingCandidateKey(element, sourceText);
      if (state.pageProcessedKeyMap[key]) {
        continue;
      }

      candidates.push({ element: element, text: sourceText, key: key });
      if (candidates.length >= Constants.UI.MAX_PAGE_NODES) {
        Logger.warn("content", "page translation candidate limit hit", { limit: Constants.UI.MAX_PAGE_NODES, onlyVisible: onlyVisible });
        break;
      }
    }

    return candidates;
  }

  async function detectPageSourceLangFromVisible() {
    var sampleItems = collectPageTranslationCandidates(true).slice(0, 8);
    var sample = sampleItems.map(function (item) {
      return item.text;
    }).join(" ");

    if (!sample) {
      return "auto";
    }

    return TranslationGateway.detectLanguage(sample);
  }

  async function ensurePageLanguageContext(forceRefresh) {
    if (!forceRefresh && state.pageSourceLang && state.pageSourceLang !== "auto" && state.pageTargetLang) {
      return;
    }

    var pageLang = detectPageLangFromDomHint();
    if (!pageLang || pageLang === "auto") {
      pageLang = normalizeLangCode(await detectPageSourceLangFromVisible());
    }

    if (!pageLang || pageLang === "auto") {
      pageLang = "auto";
    }

    state.detectedPageLang = pageLang;
    state.pageSourceLang = pageLang;
    state.pageTargetLang = chooseAutoTargetLang(pageLang);
  }

  async function applyManualLanguagePreference(payload) {
    var rawSource = payload && payload.sourceLang;
    var rawTarget = payload && payload.targetLang;
    if (!rawSource && !rawTarget) {
      return;
    }

    var detected = detectPageLangFromDomHint();
    if (!detected || detected === "auto") {
      detected = normalizeLangCode(await detectPageSourceLangFromVisible());
    }
    if (!detected) {
      detected = "auto";
    }

    var resolved = resolveManualLanguagePreference(rawSource, rawTarget, detected);
    state.detectedPageLang = detected;
    state.pageSourceLang = resolved.sourceLang;
    state.pageTargetLang = resolved.targetLang;
    state.noNeedTranslateHintShown = false;
  }

  async function renderPageTranslation(element, sourceText) {
    var sourceLang = state.pageSourceLang || "auto";
    var targetLang = state.pageTargetLang || chooseAutoTargetLang(sourceLang);
    if (shouldSkipTranslationByLang(sourceLang, targetLang)) {
      showNoNeedTranslateHint(sourceLang);
      return true;
    }
    var translated = await translateBlockWithCache(sourceLang, targetLang, sourceText);
    if (!translated) {
      return false;
    }
    if (shouldSkipRepeatedMainTranslatedResult(element, translated)) {
      return true;
    }
    if (shouldSkipTranslatedByContext(element, translated)) {
      return true;
    }
    if (shouldSkipPageInsert(element, translated)) {
      return true;
    }
    var inserted = insertPageTranslationAfter(element, translated);
    if (inserted) {
      markMainTranslatedResult(element, translated);
    }
    return true;
  }

  async function processVisiblePageCandidates() {
    if (!state.pageTranslateEnabled) {
      return;
    }
    if (state.pageProcessRunning) {
      state.pageProcessPending = true;
      return;
    }

    state.pageProcessRunning = true;
    state.pageProcessPending = false;
    try {
      await ensurePageLanguageContext(false);

      var candidates = collectPageTranslationCandidates(true);
      var maxBatch = Constants.UI.PAGE_MODE_BATCH_SIZE;
      for (var i = 0; i < candidates.length && i < maxBatch; i += 1) {
        var item = candidates[i];
        var handled = await renderPageTranslation(item.element, item.text);
        if (handled) {
          state.pageProcessedElements.add(item.element);
          state.pageProcessedKeyMap[item.key] = true;
          item.element.setAttribute("data-ai-translate-page-done", "1");
        }
      }
    } finally {
      state.pageProcessRunning = false;
    }

    if (state.pageProcessPending && state.pageTranslateEnabled) {
      state.pageProcessPending = false;
      await processVisiblePageCandidates();
    }
  }

  function unbindPageTranslateListeners() {
    if (state.scrollHandler) {
      global.removeEventListener("scroll", state.scrollHandler, { passive: true });
      state.scrollHandler = null;
    }

    if (state.resizeHandler) {
      global.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
  }

  function bindPageTranslateListeners() {
    var debouncedTranslate = debounce(function () {
      processVisiblePageCandidates();
    }, Constants.UI.SCROLL_TRANSLATE_DEBOUNCE_MS);

    state.scrollHandler = debouncedTranslate;
    state.resizeHandler = debouncedTranslate;

    global.addEventListener("scroll", state.scrollHandler, { passive: true });
    global.addEventListener("resize", state.resizeHandler);

    state.mutationObserver = new MutationObserver(function () {
      debouncedTranslate();
    });
    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function enablePageTranslate() {
    if (state.pageTranslateEnabled) {
      await processVisiblePageCandidates();
      return;
    }

    await ensurePageLanguageContext(true);
    if (shouldSkipTranslationByLang(state.pageSourceLang, state.pageTargetLang)) {
      showNoNeedTranslateHint(state.pageSourceLang);
      await setPageState({ pageTranslate: false, readingMode: false, activeMode: "none" });
      return;
    }
    state.pageTranslateEnabled = true;

    bindPageTranslateListeners();
    await processVisiblePageCandidates();
    await setPageState({ pageTranslate: true, readingMode: false, activeMode: "page_translate" });
  }

  async function disablePageTranslate() {
    unbindPageTranslateListeners();
    removePageTranslationArtifacts();
    state.pageTranslateEnabled = false;
    state.pageSourceLang = "auto";
    state.pageTargetLang = chooseAutoTargetLang("auto");
    state.detectedPageLang = "auto";
    state.noNeedTranslateHintShown = false;
    await setPageState({ pageTranslate: false, activeMode: state.readingModeEnabled ? "reading_mode" : "none" });
  }

  function removeReadingArtifacts() {
    state.readingArtifacts.forEach(function (node) {
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    state.readingArtifacts = [];
    var translatedElements = Array.prototype.slice.call(document.querySelectorAll("[data-ai-reading-done='1']"));
    translatedElements.forEach(function (element) {
      element.removeAttribute("data-ai-reading-done");
    });
    state.lastReadingInsertedByType = {
      segment: "",
      glossary: "",
      translation: ""
    };
    state.lastReadingInsertedElementByType = {
      segment: null,
      glossary: null,
      translation: null
    };
    state.lastMainTranslatedResultText = "";
    state.lastMainTranslatedResultElement = null;
  }

  function normalizeReadingInsertedText(type, text) {
    var normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    if (type === "segment") {
      return normalized.replace(/\s*\|\s*/g, "|");
    }

    if (type === "glossary") {
      return normalized
        .split("|")
        .map(function (item) { return item.trim(); })
        .filter(Boolean)
        .sort()
        .join("|");
    }

    return normalized;
  }

  function shouldSkipReadingInsert(type, anchor, nextText) {
    var normalized = normalizeReadingInsertedText(type, nextText);
    if (!normalized) {
      return true;
    }
    var last = state.lastReadingInsertedByType[type] || "";
    if (normalized !== last) {
      return false;
    }
    return !areElementsNested(anchor, state.lastReadingInsertedElementByType[type]);
  }

  function markReadingInsertedText(type, anchor, text) {
    state.lastReadingInsertedByType[type] = normalizeReadingInsertedText(type, text);
    state.lastReadingInsertedElementByType[type] = anchor || null;
  }

  function insertReadingArtifactAfter(anchor, className, text, dedupType) {
    var type = dedupType || "translation";
    if (!anchor || shouldSkipReadingInsert(type, anchor, text)) {
      return anchor;
    }

    var box = document.createElement("div");
    box.className = className;
    box.setAttribute("data-ai-translate-artifact", "1");
    box.textContent = text;
    anchor.insertAdjacentElement("afterend", box);
    state.readingArtifacts.push(box);
    markReadingInsertedText(type, anchor, text);
    return box;
  }

  function isReadingCandidateVisible(element) {
    if (!element || !element.getBoundingClientRect) {
      return false;
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    var style = global.getComputedStyle ? global.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0)) {
      return false;
    }

    var rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      return false;
    }

    var margin = Constants.UI.VIEWPORT_MARGIN_PX;
    var viewTop = 0 - margin;
    var viewBottom = (global.innerHeight || document.documentElement.clientHeight || 0) + margin;
    return rect.bottom >= viewTop && rect.top <= viewBottom;
  }

  function buildElementPositionKey(element) {
    var parts = [];
    var cursor = element;
    var depth = 0;

    while (cursor && cursor !== document.body && depth < 12) {
      var tag = (cursor.tagName || "node").toLowerCase();
      var index = 1;
      var sibling = cursor;
      while (sibling && sibling.previousElementSibling) {
        sibling = sibling.previousElementSibling;
        if ((sibling.tagName || "").toLowerCase() === tag) {
          index += 1;
        }
      }
      parts.push(tag + ":" + index);
      cursor = cursor.parentElement;
      depth += 1;
    }

    return parts.reverse().join(">");
  }

  function buildReadingCandidateKey(element, text) {
    var positionKey = buildElementPositionKey(element);
    var textKey = String(text || "").replace(/\s+/g, " ").trim().slice(0, 220);
    return positionKey + "||" + textKey;
  }

  function hasNestedReadingTextBlock(element, onlyVisible) {
    if (!element || !element.querySelectorAll) {
      return false;
    }

    var nested = element.querySelectorAll("p,li,h1,h2,h3,h4,blockquote");
    for (var i = 0; i < nested.length; i += 1) {
      var node = nested[i];
      if (!node || node === element) {
        continue;
      }

      if (node.closest(".ai-translate-reading-box,.ai-translate-reading-translation-box,.ai-translate-glossary,.ai-translate-hover-box,.ai-translate-selection-box")) {
        continue;
      }

      if (onlyVisible && !isReadingCandidateVisible(node)) {
        continue;
      }

      var nestedText = String(node.innerText || "").trim();
      if (nestedText.length >= 30) {
        return true;
      }
    }

    return false;
  }

  function countWords(text) {
    var clean = String(text || "").trim();
    if (!clean) {
      return 0;
    }
    var words = clean.match(/[A-Za-z0-9\u00C0-\u024F\u4E00-\u9FFF]+/g);
    return words ? words.length : 0;
  }

  function collectReadingCandidates(onlyVisible) {
    var readingMainSelectors = "p,li,h1,h2,h3,h4,blockquote";
    var readingContainerSelectors = [
      "article div", "article span",
      "main div", "main span",
      "section div", "section span"
    ].join(",");
    var headerFooterSelectors = [
      "header *", "nav *", "footer *",
      "[role='banner'] *", "[role='navigation'] *", "[role='contentinfo'] *"
    ].join(",");
    var elements = Array.prototype.slice.call(document.querySelectorAll(readingMainSelectors))
      .concat(Array.prototype.slice.call(document.querySelectorAll(readingContainerSelectors)))
      .concat(Array.prototype.slice.call(document.querySelectorAll(headerFooterSelectors)));
    var candidates = [];
    var seenElements = new WeakSet();

    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (!element || seenElements.has(element)) {
        continue;
      }
      seenElements.add(element);

      if (!element || state.readingProcessedElements.has(element)) {
        continue;
      }

      if (element.getAttribute("data-ai-reading-done") === "1") {
        continue;
      }

      if (element.closest(".ai-translate-reading-box,.ai-translate-reading-translation-box,.ai-translate-glossary,.ai-translate-hover-box,.ai-translate-selection-box")) {
        continue;
      }

      if (isCodeLikeElement(element)) {
        continue;
      }

      if (isHeaderFooterContext(element) && !isHeaderFooterTextCandidate(element)) {
        continue;
      }
      if (!isHeaderFooterContext(element) && !element.matches(readingMainSelectors) && !isGenericReadableTextCandidate(element, 30)) {
        continue;
      }

      var text = String(element.innerText || "").trim();
      var minLength = isHeaderFooterContext(element) ? 2 : 30;
      if (text.length < minLength) {
        continue;
      }

      if (onlyVisible && !isReadingCandidateVisible(element)) {
        continue;
      }

      var key = buildReadingCandidateKey(element, text);
      if (state.readingProcessedKeyMap[key]) {
        continue;
      }

      candidates.push({ element: element, text: text, key: key });
    }

    return candidates;
  }

  async function renderReadingHints(element, sourceText) {
    var anchor = element;
    var segmentText = "";
    if (countWords(sourceText) >= 3) {
      segmentText = Segmenter.toDelimitedText(sourceText, "  |  ");
    }
    if (segmentText) {
      anchor = insertReadingArtifactAfter(anchor, "ai-translate-reading-box", segmentText, "segment");
    }

    var sourceLang = state.pageSourceLang || "auto";
    if (sourceLang === "auto") {
      sourceLang = await TranslationGateway.detectLanguage(sourceText.slice(0, 180));
    }
    var targetLang = state.pageTargetLang || chooseAutoTargetLang(sourceLang);
    if (shouldSkipTranslationByLang(sourceLang, targetLang)) {
      showNoNeedTranslateHint(sourceLang);
      return true;
    }

    var difficult = DifficultPhrase.extractCandidates(sourceText);
    if (difficult.length) {
      var hintRows = [];
      var hintRowMap = {};
      for (var i = 0; i < difficult.length; i += 1) {
        var item = difficult[i];
        var translated = await translateBlockWithCache(sourceLang, targetLang, item);
        if (!translated) {
          continue;
        }
        var row = item + " -> " + translated;
        if (hintRowMap[row]) {
          continue;
        }
        hintRowMap[row] = true;
        hintRows.push(row);
      }

      if (hintRows.length) {
        var glossaryText = hintRows.join(" | ");
        if (!shouldSkipRepeatedMainTranslatedResult(element, glossaryText)) {
          var beforeGlossaryAnchor = anchor;
          anchor = insertReadingArtifactAfter(anchor, "ai-translate-glossary", glossaryText, "glossary");
          if (anchor !== beforeGlossaryAnchor) {
            markMainTranslatedResult(element, glossaryText);
          }
        }
      }
    }

    var paragraphTranslated = await translateBlockWithCache(sourceLang, targetLang, sourceText);
    if (!paragraphTranslated) {
      return false;
    }
    if (shouldSkipRepeatedMainTranslatedResult(element, paragraphTranslated)) {
      return true;
    }
    if (shouldSkipTranslatedByContext(element, paragraphTranslated)) {
      return true;
    }
    if (normalizeReadingInsertedText("segment", segmentText) === normalizeReadingInsertedText("segment", paragraphTranslated)) {
      return true;
    }
    var beforeTranslationAnchor = anchor;
    anchor = insertReadingArtifactAfter(anchor, "ai-translate-reading-translation-box", paragraphTranslated, "translation");
    if (anchor !== beforeTranslationAnchor) {
      markMainTranslatedResult(element, paragraphTranslated);
    }
    return true;
  }

  async function processVisibleReadingCandidates() {
    if (!state.readingModeEnabled) {
      return;
    }
    if (state.readingProcessRunning) {
      state.readingProcessPending = true;
      return;
    }

    state.readingProcessRunning = true;
    state.readingProcessPending = false;
    try {
      await ensurePageLanguageContext(false);

      var candidates = collectReadingCandidates(true);
      var maxBatch = Constants.UI.READING_MODE_BATCH_SIZE;
      for (var i = 0; i < candidates.length && i < maxBatch; i += 1) {
        var item = candidates[i];
        // Strict serial order per paragraph:
        // segmentation -> glossary -> paragraph translation.
        var handled = await renderReadingHints(item.element, item.text);
        if (handled) {
          state.readingProcessedElements.add(item.element);
          state.readingProcessedKeyMap[item.key] = true;
          item.element.setAttribute("data-ai-reading-done", "1");
        }
      }
    } finally {
      state.readingProcessRunning = false;
    }

    if (state.readingProcessPending && state.readingModeEnabled) {
      state.readingProcessPending = false;
      await processVisibleReadingCandidates();
    }
  }

  function bindReadingModeListeners() {
    var debounced = debounce(function () {
      processVisibleReadingCandidates();
    }, Constants.UI.SCROLL_TRANSLATE_DEBOUNCE_MS);

    state.readingScrollHandler = debounced;
    state.readingResizeHandler = debounced;

    global.addEventListener("scroll", state.readingScrollHandler, { passive: true });
    global.addEventListener("resize", state.readingResizeHandler);

    state.readingMutationObserver = new MutationObserver(function () {
      debounced();
    });
    state.readingMutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function unbindReadingModeListeners() {
    if (state.readingScrollHandler) {
      global.removeEventListener("scroll", state.readingScrollHandler);
      state.readingScrollHandler = null;
    }
    if (state.readingResizeHandler) {
      global.removeEventListener("resize", state.readingResizeHandler);
      state.readingResizeHandler = null;
    }
    if (state.readingMutationObserver) {
      state.readingMutationObserver.disconnect();
      state.readingMutationObserver = null;
    }
  }

  async function enableReadingMode() {
    removeReadingArtifacts();
    state.readingProcessedElements = new WeakSet();
    state.readingProcessedKeyMap = {};
    await ensurePageLanguageContext(true);
    if (shouldSkipTranslationByLang(state.pageSourceLang, state.pageTargetLang)) {
      showNoNeedTranslateHint(state.pageSourceLang);
      await setPageState({ readingMode: false, pageTranslate: false, activeMode: "none" });
      return;
    }
    state.readingModeEnabled = true;
    bindReadingModeListeners();
    await processVisibleReadingCandidates();
    await setPageState({ readingMode: true, pageTranslate: false, activeMode: "reading_mode" });
  }

  async function disableReadingMode() {
    unbindReadingModeListeners();
    removeReadingArtifacts();
    state.readingProcessedElements = new WeakSet();
    state.readingProcessedKeyMap = {};
    state.readingProcessRunning = false;
    state.readingProcessPending = false;
    state.readingModeEnabled = false;
    await setPageState({ readingMode: false, activeMode: state.pageTranslateEnabled ? "page_translate" : "none" });
  }

  async function togglePageTranslateMutual() {
    if (state.pageTranslateEnabled) {
      await disablePageTranslate();
      return;
    }

    if (state.readingModeEnabled) {
      await disableReadingMode();
    }

    await enablePageTranslate();
  }

  async function toggleReadingModeMutual() {
    if (state.readingModeEnabled) {
      await disableReadingMode();
      return;
    }

    if (state.pageTranslateEnabled) {
      await disablePageTranslate();
    }

    await enableReadingMode();
  }

  function getWordAtPoint(x, y) {
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }

    if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
      return "";
    }

    var text = range.startContainer.nodeValue || "";
    var offset = range.startOffset;
    var left = offset;
    var right = offset;

    while (left > 0 && /[a-zA-Z'-]/.test(text[left - 1])) {
      left -= 1;
    }
    while (right < text.length && /[a-zA-Z'-]/.test(text[right])) {
      right += 1;
    }

    return text.slice(left, right).trim();
  }

  function attachOrReplaceBox(selectorClass, hostElement, text) {
    var existing = hostElement.querySelector("." + selectorClass);
    if (existing) {
      existing.textContent = text;
      return existing;
    }

    var box = document.createElement("div");
    box.className = selectorClass;
    box.textContent = text;
    hostElement.appendChild(box);
    return box;
  }

  function isTranslateArtifactTarget(target) {
    if (!target || !target.closest) {
      return false;
    }

    return Boolean(target.closest("[data-ai-translate-artifact='1'],.ai-translate-page-box,.ai-translate-reading-box,.ai-translate-reading-translation-box,.ai-translate-glossary,.ai-translate-hover-box,.ai-translate-selection-box"));
  }

  function findTextHost(target) {
    if (!target || !target.closest) {
      return null;
    }
    if (isTranslateArtifactTarget(target)) {
      return null;
    }
    if (isCodeLikeElement(target)) {
      return null;
    }
    return target.closest("p,li,h1,h2,h3,h4,blockquote,article,section,div");
  }

  function isSelectionInCode(selection) {
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    var node = selection.getRangeAt(0).commonAncestorContainer;
    var checkElement = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentElement : null);
    return isCodeLikeElement(checkElement);
  }

  function bindHoverTranslation() {
    document.addEventListener("mousemove", function (event) {
      if (!state.readingModeEnabled) {
        return;
      }

      if (state.hoverTimer) {
        clearTimeout(state.hoverTimer);
      }

      var host = findTextHost(event.target);
      if (!host) {
        return;
      }

      state.hoverTimer = setTimeout(async function () {
        var word = getWordAtPoint(event.clientX, event.clientY);
        if (!word || word.length < 2) {
          return;
        }

        var hoverKey = host.tagName + ":" + word;
        if (hoverKey === state.lastHoverKey) {
          return;
        }

        var sourceLang = state.options.pageSourceLang || "auto";
        await ensurePageLanguageContext(false);
        sourceLang = state.pageSourceLang || sourceLang;
        if (sourceLang === "auto") {
          sourceLang = await TranslationGateway.detectLanguage(word);
        }

        var targetLang = state.pageTargetLang || chooseAutoTargetLang(sourceLang);
        if (shouldSkipTranslationByLang(sourceLang, targetLang)) {
          showNoNeedTranslateHint(sourceLang);
          return;
        }
        var translated = await translateBlockWithCache(sourceLang, targetLang, word);
        if (!translated) {
          return;
        }

        state.lastHoverKey = hoverKey;
        attachOrReplaceBox("ai-translate-hover-box", host, word + " -> " + translated);
      }, Constants.UI.HOVER_DELAY_MS);
    }, { passive: true });
  }

  function findSelectionHost() {
    var selection = global.getSelection ? global.getSelection() : null;
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    var range = selection.getRangeAt(0);
    var node = range.commonAncestorContainer;
    if (!node) {
      return null;
    }

    var element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return findTextHost(element);
  }

  function bindSelectionTranslation() {
    document.addEventListener("mouseup", async function () {
      if (!state.readingModeEnabled) {
        return;
      }

      var selection = global.getSelection ? global.getSelection() : null;
      if (selection && selection.rangeCount > 0) {
        var node = selection.getRangeAt(0).commonAncestorContainer;
        var checkElement = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentElement : null);
        if (checkElement && isTranslateArtifactTarget(checkElement)) {
          return;
        }
      }

      var selected = String(selection ? selection.toString() : "").trim();
      if (!selected || selected.length < 2 || selected.length > 140) {
        return;
      }

      var codeSelection = isSelectionInCode(selection);
      var allowCodeSelection = state.pageTranslateEnabled || state.readingModeEnabled;
      if (codeSelection && !allowCodeSelection) {
        return;
      }

      var sourceLang = state.options.pageSourceLang || "auto";
      await ensurePageLanguageContext(false);
      sourceLang = state.pageSourceLang || sourceLang;
      if (sourceLang === "auto") {
        sourceLang = await TranslationGateway.detectLanguage(selected);
      }

      var targetLang = state.pageTargetLang || chooseAutoTargetLang(sourceLang);
      if (shouldSkipTranslationByLang(sourceLang, targetLang)) {
        showNoNeedTranslateHint(sourceLang);
        return;
      }
      var translated = await translateBlockWithCache(sourceLang, targetLang, selected);
      if (!translated) {
        return;
      }

      var host = findSelectionHost() || document.body;
      attachOrReplaceBox("ai-translate-selection-box", host, selected + " -> " + translated);
    });
  }

  function showForeignLanguageBanner(sourceLang, nativeLang) {
    var banner = document.createElement("div");
    banner.className = "ai-translate-banner";
    banner.textContent = "检测到页面语言为 " + sourceLang + "，你的常用语言是 " + nativeLang + "。";

    var button = document.createElement("button");
    button.textContent = "立即翻译";
    button.addEventListener("click", async function () {
      await togglePageTranslateMutual();
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    });

    var close = document.createElement("button");
    close.textContent = "关闭";
    close.addEventListener("click", function () {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
    });

    banner.appendChild(button);
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  async function maybeSuggestAutoTranslate() {
    return;
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    (async function handle() {
      if (!request || !request.type) {
        return sendResponse({ ok: false });
      }

      if (request.type === Constants.MESSAGE.TOGGLE_PAGE_TRANSLATE) {
        await applyManualLanguagePreference(request.payload || {});
        await togglePageTranslateMutual();
        return sendResponse({
          ok: true,
          pageTranslate: state.pageTranslateEnabled,
          readingMode: state.readingModeEnabled,
          activeMode: state.pageTranslateEnabled ? "page_translate" : (state.readingModeEnabled ? "reading_mode" : "none")
        });
      }

      if (request.type === Constants.MESSAGE.TOGGLE_READING_MODE) {
        await applyManualLanguagePreference(request.payload || {});
        await toggleReadingModeMutual();
        return sendResponse({
          ok: true,
          pageTranslate: state.pageTranslateEnabled,
          readingMode: state.readingModeEnabled,
          activeMode: state.pageTranslateEnabled ? "page_translate" : (state.readingModeEnabled ? "reading_mode" : "none")
        });
      }

      if (request.type === "translate_selection_now") {
        var selected = String(global.getSelection ? global.getSelection().toString() : "").trim();
        if (!selected) {
          Logger.warn("content", "selection translate requested but no selected text");
          return sendResponse({ ok: false, reason: "empty_selection" });
        }
        var selection = global.getSelection ? global.getSelection() : null;
        var codeSelection = isSelectionInCode(selection);
        var allowCodeSelection = state.pageTranslateEnabled || state.readingModeEnabled;
        if (codeSelection && !allowCodeSelection) {
          return sendResponse({ ok: false, reason: "code_selection_blocked" });
        }

        var sourceLang = state.options.pageSourceLang || "auto";
        await ensurePageLanguageContext(false);
        sourceLang = state.pageSourceLang || sourceLang;
        if (sourceLang === "auto") {
          sourceLang = await TranslationGateway.detectLanguage(selected);
        }

        var targetLang = state.pageTargetLang || chooseAutoTargetLang(sourceLang);
        if (shouldSkipTranslationByLang(sourceLang, targetLang)) {
          showNoNeedTranslateHint(sourceLang);
          return sendResponse({ ok: false, reason: "no_need_translate" });
        }
        var translated = await translateBlockWithCache(sourceLang, targetLang, selected);
        if (!translated) {
          return sendResponse({ ok: false, reason: "translate_failed" });
        }

        alert(selected + "\n\n" + translated);
        return sendResponse({ ok: true });
      }

      return sendResponse({ ok: false, reason: "unknown_type" });
    })();

    return true;
  });

  async function bootstrap() {
    state.options = await getOptions();
    await loadTranslationCache();
    bindHoverTranslation();
    bindSelectionTranslation();
    await maybeSuggestAutoTranslate();
    await setPageState({ pageTranslate: false, readingMode: false, activeMode: "none" });
  }

  bootstrap();
})(globalThis);
