(function initTranslationGateway(global) {
  var root = global.AITranslate = global.AITranslate || {};
  var Constants = root.Constants;
  var Logger = root.Logger;
  var RuntimeClient = root.RuntimeClient;

  async function gatewayRequest(payload) {
    var response = await RuntimeClient.sendMessage({
      type: Constants.MESSAGE.GATEWAY_REQUEST,
      payload: payload
    });

    if (!response.ok) {
      Logger.warn("translation-gateway", "gateway request failed", response);
      return null;
    }

    return response.data;
  }

  async function detectLanguage(text) {
    var data = await gatewayRequest({
      header: { fn: Constants.API.FN_TEXT_ANALYSIS },
      text: text
    });

    if (!data || !data.language) {
      Logger.warn("translation-gateway", "detect language fallback to auto");
      return "auto";
    }

    return data.language;
  }

  async function translateBlock(sourceLang, targetLang, text) {
    var data = await gatewayRequest({
      header: { fn: Constants.API.FN_TRANSLATE_BLOCK },
      source: { lang: sourceLang, text_block: text },
      target: { lang: targetLang }
    });

    var translated = extractTranslatedText(data);
    if (!translated) {
      Logger.warn("translation-gateway", "translate block response invalid", {
        sourceLang: sourceLang,
        targetLang: targetLang,
        responseType: data ? typeof data : "null"
      });
      return null;
    }

    return translated;
  }

  function normalizeCandidateText(value) {
    if (typeof value === "string") {
      var trimmed = value.trim();
      return trimmed || null;
    }

    if (Array.isArray(value)) {
      var joined = value
        .map(function (item) { return typeof item === "string" ? item.trim() : ""; })
        .filter(Boolean)
        .join(" ");
      return joined || null;
    }

    return null;
  }

  function extractTranslatedText(data) {
    if (!data) {
      return null;
    }

    var direct = normalizeCandidateText(data);
    if (direct) {
      return direct;
    }

    var candidates = [
      data.auto_translation,
      data.translation,
      data.target_text,
      data.translated_text,
      data.text,
      data.dst,
      data.result
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var normalized = normalizeCandidateText(candidates[i]);
      if (normalized) {
        return normalized;
      }
    }

    if (data.auto_translation && typeof data.auto_translation === "object") {
      var nested = normalizeCandidateText(data.auto_translation.text || data.auto_translation.text_block);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  async function getSupportedLanguages() {
    var data = await gatewayRequest({
      header: { fn: Constants.API.FN_SUPPORT_LANG }
    });

    if (!data || !Array.isArray(data.full_lang_pair)) {
      Logger.warn("translation-gateway", "supported languages response invalid");
      return [];
    }

    return data.full_lang_pair;
  }

  root.TranslationGateway = {
    gatewayRequest: gatewayRequest,
    detectLanguage: detectLanguage,
    translateBlock: translateBlock,
    getSupportedLanguages: getSupportedLanguages
  };
})(globalThis);
