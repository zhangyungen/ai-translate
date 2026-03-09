(function initLogger(global) {
  var root = global.AITranslate = global.AITranslate || {};

  function baseLog(level, scope, message, details) {
    var payload = {
      level: level,
      scope: scope,
      message: message,
      details: details || null,
      timestamp: new Date().toISOString()
    };

    if (level === "warn") {
      console.warn("[AITranslate]", payload);
      return;
    }

    if (level === "error") {
      console.error("[AITranslate]", payload);
      return;
    }

    console.log("[AITranslate]", payload);
  }

  root.Logger = {
    info: function (scope, message, details) {
      baseLog("info", scope, message, details);
    },
    warn: function (scope, message, details) {
      baseLog("warn", scope, message, details);
    },
    error: function (scope, message, details) {
      baseLog("error", scope, message, details);
    }
  };
})(globalThis);
