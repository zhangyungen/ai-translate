(function initConstants(global) {
  var root = global.AITranslate = global.AITranslate || {};

  root.Constants = {
    API: {
      BASE_URL: "https://transmart.qq.com/api/imt",
      FN_SUPPORT_LANG: "support_lang",
      FN_TEXT_ANALYSIS: "text_analysis",
      FN_TRANSLATE_BLOCK: "auto_translation_block",
      RET_CODE_SUCCESS: 0,
      RET_CODE_BUSY: 2002
    },
    CACHE: {
      LANGUAGE_LIST_KEY: "language_list_cache",
      LANGUAGE_LIST_TTL_MS: 24 * 60 * 60 * 1000,
      TRANSLATION_CACHE_KEY: "translation_cache_v1",
      TRANSLATION_CACHE_MAX_ENTRIES: 1000
    },
    MESSAGE: {
      GATEWAY_REQUEST: "gateway_request",
      TOGGLE_PAGE_TRANSLATE: "toggle_page_translate",
      TOGGLE_READING_MODE: "toggle_reading_mode",
      GET_PAGE_STATE: "get_page_state",
      GET_TAB_STATE: "get_tab_state",
      UPDATE_OPTIONS: "update_options"
    },
    STORAGE: {
      OPTIONS_KEY: "options_v1"
    },
    UI: {
      HOVER_DELAY_MS: 300,
      MAX_TEXTAREA_LENGTH: 500,
      MAX_PAGE_NODES: 5000,
      PAGE_TRANSLATE_CONCURRENCY: 4,
      PAGE_MODE_BATCH_SIZE: 24,
      SCROLL_TRANSLATE_DEBOUNCE_MS: 180,
      VIEWPORT_MARGIN_PX: 240,
      READING_MODE_BATCH_SIZE: 24
    },
    DEFAULTS: {
      SOURCE_LANG: "auto",
      TARGET_LANG: "zh",
      PAGE_SOURCE_LANG: "auto",
      AUTO_TRANSLATE_FOREIGN_PAGE: true,
      READING_MODE: false,
      PAGE_TRANSLATE: false
    }
  };
})(globalThis);
