const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadScripts(context, scripts) {
  scripts.forEach((scriptPath) => {
    const abs = path.join(ROOT, scriptPath);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, context, { filename: scriptPath });
  });
}

function buildContext() {
  const responses = [];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    globalThis: null,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, cb) {
          responses.push(message);
          if (message.type === 'gateway_request') {
            const fn = message.payload && message.payload.header && message.payload.header.fn;
            if (fn === 'text_analysis') {
              return cb({ ok: true, data: { language: 'en' } });
            }
            if (fn === 'auto_translation_block') {
              const textBlock = message.payload && message.payload.source && message.payload.source.text_block;
              if (textBlock === '__array_case__') {
                return cb({ ok: true, data: { auto_translation: ['数组翻译A', '数组翻译B'] } });
              }
              if (textBlock === '__nested_case__') {
                return cb({ ok: true, data: { auto_translation: { text: '对象翻译' } } });
              }
              return cb({ ok: true, data: { auto_translation: '测试翻译' } });
            }
            if (fn === 'support_lang') {
              return cb({ ok: true, data: { full_lang_pair: [{ source: { code: 'en' }, target_list: [{ code: 'zh' }] }] } });
            }
          }
          cb({ ok: true, data: {} });
        }
      }
    }
  });
  context.globalThis = context;
  context.__messages = responses;
  return context;
}

function runDomainTests() {
  const context = buildContext();
  loadScripts(context, [
    'src/shared/constants.js',
    'src/shared/logger.js',
    'src/domain/segmenter.js',
    'src/domain/difficult-phrase.js',
    'src/infrastructure/runtime-client.js',
    'src/infrastructure/translation-gateway.js'
  ]);

  const root = context.AITranslate;
  assert(root, 'AITranslate root missing');

  const segmented = root.Segmenter.toDelimitedText('Hello world. This is a long sentence for testing!', '||||');
  assert(segmented.includes('||||'), 'segment delimiter missing');

  const englishProtected = root.Segmenter.segmentText('Dr. Smith moved to the U.S. in 2024. The value is 3.14 and stable.');
  assert(Array.isArray(englishProtected) && englishProtected.length >= 2, 'english segmentation failed');
  assert(englishProtected.join(' ').includes('U.S.'), 'abbreviation protection failed');
  assert(englishProtected.join(' ').includes('3.14'), 'decimal protection failed');

  const chineseSplit = root.Segmenter.segmentText('VideoLingo 可以做断句优化。它能提升字幕可读性！同时减少长句阅读压力？');
  assert(Array.isArray(chineseSplit) && chineseSplit.length >= 3, 'chinese punctuation split failed');

  const csdnSample = 'VideoLingo 是一款面向字幕处理的开源工具，支持语音识别、断句、翻译与对齐。本文介绍其工作流，并说明如何把长句切分为可读片段，提高字幕质量和阅读体验。';
  const csdnDelimited = root.Segmenter.toDelimitedText(csdnSample, '  |  ');
  assert(csdnDelimited.includes('  |  '), 'csdn sample delimiter split failed');

  const perfInput = new Array(25).fill(csdnSample).join(' ');
  var start = Date.now();
  for (var i = 0; i < 300; i += 1) {
    root.Segmenter.segmentText(perfInput);
  }
  var elapsed = Date.now() - start;
  assert(elapsed < 1500, 'segmenter performance regression');

  const candidates = root.DifficultPhrase.extractCandidates('spectacular spectacular basketball astonishingly innovation');
  assert(Array.isArray(candidates), 'candidates not array');
  assert(candidates.length > 0, 'candidates should not be empty');

  const zhCandidates = root.DifficultPhrase.extractCandidates('该方案提升了字幕阅读体验与分句稳定性，同时减少重复展示问题。');
  assert(Array.isArray(zhCandidates), 'zh candidates not array');
  assert(zhCandidates.length > 0, 'zh candidates should not be empty');

  return root.TranslationGateway.detectLanguage('test')
    .then((lang) => {
      assert(lang === 'en', 'detectLanguage failed');
      return root.TranslationGateway.translateBlock('en', 'zh', 'hello');
    })
    .then((translated) => {
      assert(translated === '测试翻译', 'translateBlock failed');
      return root.TranslationGateway.translateBlock('en', 'zh', '__array_case__');
    })
    .then((translatedFromArray) => {
      assert(translatedFromArray === '数组翻译A 数组翻译B', 'translateBlock array fallback failed');
      return root.TranslationGateway.translateBlock('en', 'zh', '__nested_case__');
    })
    .then((translatedFromObject) => {
      assert(translatedFromObject === '对象翻译', 'translateBlock nested fallback failed');
      return root.TranslationGateway.getSupportedLanguages();
    })
    .then((langs) => {
      assert(Array.isArray(langs) && langs.length === 1, 'getSupportedLanguages failed');
      assert(context.__messages.length >= 3, 'runtime messages not sent');
    });
}

function runPackageArtifactChecks() {
  const distDir = path.join(ROOT, 'dist');
  const unpackedDir = path.join(distDir, 'unpacked');
  if (!fs.existsSync(unpackedDir)) {
    return;
  }

  const manifestPath = path.join(unpackedDir, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'unpacked manifest missing');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.manifest_version === 3, 'manifest version invalid');
}

function runContentRuleChecks() {
  const contentPath = path.join(ROOT, 'src/content/content.js');
  assert(fs.existsSync(contentPath), 'content script missing');
  const source = fs.readFileSync(contentPath, 'utf8');

  assert(
    source.includes("function isHeaderFooterContext(element)"),
    'header/footer context detector missing'
  );

  assert(
    source.includes("header a") &&
      source.includes("nav a") &&
      source.includes("footer a") &&
      source.includes("[role='contentinfo'] a"),
    'header/footer candidate selectors missing'
  );

  assert(
    source.includes("var minLength = isHeaderFooterContext(element) ? 2 : 12;"),
    'header/footer short text threshold rule missing'
  );

  assert(
    source.includes("function applyManualLanguagePreference(payload)"),
    'manual language preference handler missing'
  );

  assert(
    source.includes("await applyManualLanguagePreference(request.payload || {});"),
    'toggle handlers missing manual language preference apply'
  );

  const popupPath = path.join(ROOT, 'src/popup/popup.js');
  assert(fs.existsSync(popupPath), 'popup script missing');
  const popupSource = fs.readFileSync(popupPath, 'utf8');
  assert(
    popupSource.includes("sendMessageToActiveTab(Constants.MESSAGE.TOGGLE_PAGE_TRANSLATE, {") &&
      popupSource.includes("sendMessageToActiveTab(Constants.MESSAGE.TOGGLE_READING_MODE, {"),
    'popup toggle message missing language payload'
  );
}

runDomainTests()
  .then(() => {
    runContentRuleChecks();
    runPackageArtifactChecks();
    console.log('Self-test passed');
  })
  .catch((error) => {
    console.error('Self-test failed:', error.message);
    process.exit(1);
  });
