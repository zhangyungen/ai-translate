# AI Translate Chrome Extension

## 功能
- 任意语言翻译为任意语言（默认优先英译中）。
- 整页翻译开关（可恢复原文）。
- 整页翻译支持“看到哪里翻译到哪里”（滚动视口增量翻译）并缓存翻译结果。
- 阅读模式：
  - 原文分段断句（使用 `  |  ` 作为分隔符展示）。
  - 难词/低频词预翻译提示。
  - 悬停 0.3 秒或选中后自动显示译文。
- 阅读模式与整页翻译互斥，切换时会自动关闭另一模式并重新翻译。
- 腾讯接口兼容机制：
  - endpoint: `https://transmart.qq.com/api/imt`
  - `client_key`: `("tencent_transmart_crx_" + btoa(navigator.userAgent)).slice(0,100)`
  - 语言列表缓存自动续期（24h TTL）。

## 本地检查
```bash
npm run check
```

## 自我测试
```bash
npm run self-test
```

## 一键打包（可直接安装到 Chrome）
```bash
npm run package
```

打包后会生成：
- `dist/unpacked`（直接用于“加载已解压扩展程序”）
- `dist/ai-translate-extension-YYYYMMDD-HHMMSS.zip`

## 安装到 Chrome
1. 打开 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/unpacked`

> Chrome 开发者安装是“加载已解压目录”，zip 需先解压后加载。
