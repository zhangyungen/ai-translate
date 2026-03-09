(function initDifficultPhrase(global) {
  var root = global.AITranslate = global.AITranslate || {};

  function normalizeEnglishWords(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-zA-Z\s'-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function extractEnglishCandidates(text) {
    var words = normalizeEnglishWords(text);
    var dict = {};
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      if (word.length < 8) {
        continue;
      }
      if (!dict[word]) {
        dict[word] = 0;
      }
      dict[word] += 1;
    }

    return Object.keys(dict)
      .sort(function (a, b) {
        if (dict[a] !== dict[b]) {
          return dict[b] - dict[a];
        }
        return b.length - a.length;
      })
      .slice(0, 5);
  }

  function extractChineseCandidates(text) {
    var raw = String(text || "");
    var chunks = raw.match(/[\u4e00-\u9fff]{2,12}/g) || [];
    var seen = {};
    var list = [];

    for (var i = 0; i < chunks.length; i += 1) {
      var chunk = chunks[i];
      if (!chunk) {
        continue;
      }

      if (chunk.length <= 6) {
        if (!seen[chunk]) {
          seen[chunk] = true;
          list.push(chunk);
        }
        continue;
      }

      // For longer contiguous Chinese chunks, take 4-char windows as glossary candidates.
      for (var j = 0; j <= chunk.length - 4; j += 2) {
        var part = chunk.slice(j, j + 4);
        if (!seen[part]) {
          seen[part] = true;
          list.push(part);
        }
      }
    }

    return list.slice(0, 5);
  }

  function extractCandidates(text) {
    var chinese = extractChineseCandidates(text);
    if (chinese.length) {
      return chinese;
    }
    return extractEnglishCandidates(text);
  }

  root.DifficultPhrase = {
    extractCandidates: extractCandidates
  };
})(globalThis);
