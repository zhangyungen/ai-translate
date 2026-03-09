(function initSegmenter(global) {
  var root = global.AITranslate = global.AITranslate || {};

  var DOT_TOKEN = "__AI_DOT__";

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function protectSpecialDots(text) {
    var normalized = text;
    var abbrList = [
      "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Sr.", "Jr.", "St.", "No.",
      "e.g.", "i.e.", "etc.", "vs.", "U.S.", "U.K.", "Ph.D.", "M.S.", "B.S."
    ];

    normalized = normalized.replace(/(\d)\.(\d)/g, "$1" + DOT_TOKEN + "$2");
    normalized = normalized.replace(/([A-Za-z])\.([A-Za-z])/g, "$1" + DOT_TOKEN + "$2");

    for (var i = 0; i < abbrList.length; i += 1) {
      var abbr = abbrList[i];
      var escaped = abbr.replace(/\./g, "\\.");
      var tokenized = abbr.replace(/\./g, DOT_TOKEN);
      normalized = normalized.replace(new RegExp(escaped, "g"), tokenized);
    }

    return normalized;
  }

  function restoreSpecialDots(text) {
    return String(text || "").replace(new RegExp(DOT_TOKEN, "g"), ".");
  }

  function splitByPrimaryPunctuation(text) {
    var pieces = [];
    var buffer = "";
    var chars = String(text || "");
    var hardStop = {
      "。": true,
      "！": true,
      "？": true,
      ".": true,
      "!": true,
      "?": true,
      ";": true,
      "；": true
    };

    for (var i = 0; i < chars.length; i += 1) {
      var ch = chars[i];
      buffer += ch;
      if (hardStop[ch]) {
        while (i + 1 < chars.length && /["')\]”’]/.test(chars[i + 1])) {
          i += 1;
          buffer += chars[i];
        }
        pieces.push(buffer.trim());
        buffer = "";
      }
    }

    if (buffer.trim()) {
      pieces.push(buffer.trim());
    }

    return pieces.filter(Boolean);
  }

  function splitLongSentence(sentence, maxLen) {
    if (sentence.length <= maxLen) {
      return [sentence];
    }

    var chunks = [];
    var parts = sentence.split(/([,，、:：])/);
    var buffer = "";

    for (var i = 0; i < parts.length; i += 1) {
      var token = parts[i];
      if (!token) {
        continue;
      }
      var next = buffer + token;
      if (next.length > maxLen && buffer) {
        chunks.push(buffer);
        buffer = token;
      } else {
        buffer = next;
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }

    chunks = chunks.filter(Boolean).map(function (item) {
      return item.trim();
    });

    var finalChunks = [];
    for (var c = 0; c < chunks.length; c += 1) {
      var block = chunks[c];
      if (block.length <= maxLen) {
        finalChunks.push(block);
        continue;
      }

      var words = block.split(/\s+/);
      var wordBuf = "";
      for (var w = 0; w < words.length; w += 1) {
        var nextWord = wordBuf ? (wordBuf + " " + words[w]) : words[w];
        if (nextWord.length > maxLen && wordBuf) {
          finalChunks.push(wordBuf);
          wordBuf = words[w];
        } else {
          wordBuf = nextWord;
        }
      }
      if (wordBuf) {
        finalChunks.push(wordBuf);
      }
    }

    return finalChunks.filter(Boolean);
  }

  function mergeTooShortSegments(segments, minLen) {
    if (!segments || !segments.length) {
      return [];
    }

    var merged = [];
    for (var i = 0; i < segments.length; i += 1) {
      var current = String(segments[i] || "").trim();
      if (!current) {
        continue;
      }
      var prev = merged.length ? merged[merged.length - 1] : "";
      var currentHasStop = /[。！？.!?；;]["')\]”’]?$/.test(current);
      var prevHasStop = /[。！？.!?；;]["')\]”’]?$/.test(prev);

      if (current.length < minLen && merged.length && !currentHasStop && !prevHasStop) {
        merged[merged.length - 1] += " " + current;
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function segmentText(text) {
    var raw = normalizeText(text);
    if (!raw) {
      return [];
    }

    var protectedText = protectSpecialDots(raw);
    var sentences = splitByPrimaryPunctuation(protectedText);
    var segments = [];

    for (var i = 0; i < sentences.length; i += 1) {
      var restored = restoreSpecialDots(sentences[i]);
      var sub = splitLongSentence(restored, 120);
      segments = segments.concat(sub);
    }

    return mergeTooShortSegments(segments.filter(Boolean), 18);
  }

  root.Segmenter = {
    segmentText: segmentText,
    toDelimitedText: function (text, delimiter) {
      var pieces = segmentText(text);
      return pieces.join(delimiter || "  |  ");
    }
  };
})(globalThis);
