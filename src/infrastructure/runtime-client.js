(function initRuntimeClient(global) {
  var root = global.AITranslate = global.AITranslate || {};
  var Logger = root.Logger;

  function sendMessage(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          Logger.warn("runtime-client", "runtime message failed", {
            error: chrome.runtime.lastError.message,
            messageType: message && message.type
          });
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { ok: false, error: "empty_response" });
      });
    });
  }

  root.RuntimeClient = {
    sendMessage: sendMessage
  };
})(globalThis);
