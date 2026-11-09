/**
 * Renderer i18n — English is the default language; Simplified Chinese is an
 * opt-in switch (persisted in localStorage, overridable with ?lang=zh for
 * documentation screenshots). Static HTML is translated via data-i18n
 * attributes; dynamic modules call t() and re-render on `forge:langchange`.
 */

export type Lang = 'en' | 'zh';

const en = {
  'app.title': 'GameAsset Forge',
  'app.subtitle': 'Deterministic 2D asset pipeline',
  'app.badge': 'LOCAL-FIRST',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.zh': '简体中文',

  'toolbar.groupFiles': 'File',
  'toolbar.groupTools': 'Tools',
  'toolbar.groupView': 'View',
  'toolbar.open': 'Open',
  'toolbar.openTitle': 'Open PNG sprite sheets…',
  'toolbar.newPreset': 'New',
  'toolbar.newPresetTitle': 'Reset preset to defaults',
  'toolbar.loadPreset': 'Load',
  'toolbar.loadPresetTitle': 'Load a preset JSON file',
  'toolbar.savePreset': 'Save',
  'toolbar.savePresetTitle': 'Save the current preset as JSON',
  'toolbar.select': 'Select',
  'toolbar.selectTitle': 'Select sprites (V)',
  'toolbar.pan': 'Pan',
  'toolbar.panTitle': 'Pan (P, middle-drag or shift-drag)',
  'toolbar.rect': 'Add Rect',
  'toolbar.rectTitle': 'Draw manual rectangles (R)',
  'toolbar.fit': 'Fit',
  'toolbar.fitTitle': 'Fit image to view',
  'toolbar.zoom100': '100%',
  'toolbar.zoom100Title': 'Reset zoom to 100%',
  'toolbar.undo': 'Undo',
  'toolbar.undoTitle': 'Undo the last edit (Ctrl+Z)',
  'toolbar.export': 'Export',
  'toolbar.exportTitle': 'Export atlas, manifest and engine resources',
  'toolbar.viewLabel': 'Preview',

  'view.before': 'Before · Source',
  'view.after': 'After · Atlas',

  'tab.pipeline': 'Pipeline',
  'tab.quality': 'Quality',
  'tab.ai': 'AI Assistant',
  'tab.editor': 'Editor',

  'panel.assets': 'Assets',
  'panel.properties': 'Properties',
  'panel.log': 'Log',
  'assets.dropHint': 'Drop PNG files anywhere in the window',
  'assets.empty': 'No assets loaded yet',
  'assets.emptyHint': 'Use Open… or drag a sprite sheet here',

  'canvas.emptyTitle': 'Your canvas is ready',
  'canvas.emptyHint': 'Drop a PNG sprite sheet to start slicing, packing and exporting.',
  'canvas.shortcuts': 'V Select   ·   P Pan   ·   R Rect   ·   Scroll Zoom',
  'canvas.hudSource': 'SOURCE',
  'canvas.hudAtlas': 'ATLAS',
  'canvas.page': 'Page',

  'prop.detection': 'Detection',
  'prop.trim': 'Trim',
  'prop.resize': 'Resize',
  'prop.margins': 'Margins',
  'prop.pivot': 'Pivot',
  'prop.atlas': 'Atlas',
  'prop.export': 'Export',
  'prop.selection': 'Selection',
  'prop.nothingSelected': 'Nothing selected — click a sprite on the canvas.',
  'prop.spriteUnavailable': 'Sprite unavailable',
  'prop.deleteRect': 'Delete rect',
  'prop.manualNote': 'note: {count} manual rect(s) exist but detect mode is not manual',
  'prop.padding': 'padding (px)',
  'prop.bleed': 'bleed (px)',
  'prop.godot': 'godot .tres',
  'prop.unity': 'unity importer',

  'assets.meta': '{w}x{h} · {n} sprites',
  'assets.pending': '{w}x{h} · …',
  'assets.noAlpha': ' · no alpha',
  'assets.error': 'error: {message}',

  'quality.analyze': 'Analyze',
  'quality.exportReport': 'Export Report',
  'quality.empty': 'Run Analyze to inspect the loaded assets.',
  'quality.summary': '{assets} asset(s) · {warnings} warning(s)',
  'quality.good': '✓ Good',
  'quality.rulesTitle': 'Deterministic rules',
  'quality.rulesHint':
    'Five checks run locally over every loaded asset. Detection first, suggestion second — nothing is modified without your confirmation.',
  'quality.ruleNaming': 'naming_convention — non-descriptive filenames',
  'quality.ruleTransparency': 'transparent_area — mostly-unused canvas',
  'quality.ruleSize': 'size_mismatch — inconsistent frame sizes within a group',
  'quality.ruleDuplicate': 'duplicate_frames — exact hash + dHash 8×8 near matches',
  'quality.rulePivot': 'pivot_check — pivots away from bottom-center',

  'ai.banner':
    'Mock provider — every analysis runs locally and no data leaves this machine. Cloud providers upload images to third-party services and must be explicitly enabled via ai.config.json (CLI).',
  'ai.analyze': 'Analyze with AI',
  'ai.provider': 'provider: mock (local)',
  'ai.noAssets': 'no assets loaded',
  'ai.noSuggestions': 'No suggestions — load assets and run Analyze.',
  'ai.apply': 'Apply',
  'ai.ignore': 'Ignore',
  'ai.status.applied': 'applied',
  'ai.status.ignored': 'ignored',
  'ai.rename': 'Rename to {name}',
  'ai.setPivot': 'Set pivot to ({x}, {y})',
  'ai.templates': 'Animation templates: {list}',
  'ai.summary': '{assets} asset(s) · {n} suggestion(s)',

  'editor.propose': 'Propose Layers',
  'editor.exportForge': 'Export .forge',
  'editor.undo': 'Undo',
  'editor.brushAdd': 'Brush +',
  'editor.brushErase': 'Brush −',
  'editor.summary': '{n} layer(s) · active: {active}',
  'editor.noLayers': 'No layers yet — click Propose Layers.',
  'editor.noSource': 'editor: no assets loaded',
  'editor.nothingToExport': 'editor: nothing to export',
  'editor.proposals': 'editor: {n} layer proposal(s)',
  'editor.nothingToUndo': 'editor: nothing to undo',
  'editor.undone': 'editor: undo',

  'log.clear': 'Clear',
  'log.toggle': 'Toggle log',
  'status.assets': 'Assets',
  'status.sprites': 'Sprites',
  'status.pages': 'Pages',
  'status.ready': 'Ready',
  'status.noAssets': 'No assets',
  'status.offline': 'Offline',
  'status.version': 'v0.1.0',

  'log.ready': 'GameAsset Forge ready — drop PNG files or use Open',
  'log.loaded': 'loaded {name} ({w}x{h}{alpha})',
  'log.loadFailed': 'failed to load {name}: {message}',
  'log.previewError': 'preview: {message}',
  'log.analysisFailed': 'analysis failed: {message}',
  'log.manualRectAdded': 'manual rect added ({w}x{h}) — detect mode is now manual',
  'log.qualityDone': 'quality analysis: {warnings} warning(s) across {assets} asset(s)',
  'log.qualityNeedRun': 'quality report: run Analyze first',
  'log.qualityExported': 'quality report exported → {dir}',
  'log.aiDone': 'ai assistant: {n} suggestion(s) from {assets} asset(s) (mock, local)',
  'log.suggestionApplied': 'suggestion applied: {text}',
  'log.exportNothing': 'export: nothing to export (no preview result)',
  'log.exported': 'exported {n} page(s) + atlas.json → {dir}',
  'log.exportedTres': 'exported {name}_spriteframes.tres',
  'log.exportedUnity': 'exported GameAssetForgeImporter.cs',
  'log.exportFailed': 'export failed: {message}',
  'log.presetLoaded': 'preset loaded: {name}',
  'log.presetLoadFailed': 'preset load failed: {message}',
  'log.presetSaved': 'preset saved: {name}',
  'log.presetReset': 'preset reset to defaults',
  'log.undoNothing': 'undo: nothing to undo',
  'log.forgeExported': '.forge exported',
  'log.language': 'language switched to {lang}',
} as const;

export type TranslationKey = keyof typeof en;

/** Compile-time guarantee: every English key has a Chinese translation. */
const zh: Record<TranslationKey, string> = {
  'app.title': 'GameAsset Forge',
  'app.subtitle': '确定性 2D 资源流水线',
  'app.badge': '本地优先',
  'lang.label': '语言',
  'lang.en': 'English',
  'lang.zh': '简体中文',

  'toolbar.groupFiles': '文件',
  'toolbar.groupTools': '工具',
  'toolbar.groupView': '视图',
  'toolbar.open': '打开',
  'toolbar.openTitle': '打开 PNG 精灵图…',
  'toolbar.newPreset': '新建',
  'toolbar.newPresetTitle': '将预设重置为默认值',
  'toolbar.loadPreset': '加载',
  'toolbar.loadPresetTitle': '加载预设 JSON 文件',
  'toolbar.savePreset': '保存',
  'toolbar.savePresetTitle': '将当前预设保存为 JSON',
  'toolbar.select': '选择',
  'toolbar.selectTitle': '选择精灵 (V)',
  'toolbar.pan': '平移',
  'toolbar.panTitle': '平移 (P、中键拖动或 Shift 拖动)',
  'toolbar.rect': '添加矩形',
  'toolbar.rectTitle': '绘制手动矩形 (R)',
  'toolbar.fit': '适应',
  'toolbar.fitTitle': '使图像适应视图',
  'toolbar.zoom100': '100%',
  'toolbar.zoom100Title': '将缩放重置为 100%',
  'toolbar.undo': '撤销',
  'toolbar.undoTitle': '撤销上一次编辑 (Ctrl+Z)',
  'toolbar.export': '导出',
  'toolbar.exportTitle': '导出图集、清单与引擎资源',
  'toolbar.viewLabel': '预览',

  'view.before': '处理前 · 源图',
  'view.after': '处理后 · 图集',

  'tab.pipeline': '流水线',
  'tab.quality': '质量检测',
  'tab.ai': 'AI 助手',
  'tab.editor': '编辑器',

  'panel.assets': '资源',
  'panel.properties': '属性',
  'panel.log': '日志',
  'assets.dropHint': '可将 PNG 文件拖放到窗口任意位置',
  'assets.empty': '尚未加载资源',
  'assets.emptyHint': '点击「打开」或将精灵图拖到此处',

  'canvas.emptyTitle': '画布已就绪',
  'canvas.emptyHint': '拖入一张 PNG 精灵图，即可开始切分、打包与导出。',
  'canvas.shortcuts': 'V 选择 · P 平移 · R 矩形 · 滚轮缩放',
  'canvas.hudSource': '源图',
  'canvas.hudAtlas': '图集',
  'canvas.page': '页',

  'prop.detection': '检测',
  'prop.trim': '裁剪',
  'prop.resize': '缩放',
  'prop.margins': '边距',
  'prop.pivot': '锚点',
  'prop.atlas': '图集',
  'prop.export': '导出',
  'prop.selection': '选区',
  'prop.nothingSelected': '未选择任何对象 — 请点击画布上的精灵。',
  'prop.spriteUnavailable': '精灵不可用',
  'prop.deleteRect': '删除矩形',
  'prop.manualNote': '提示：存在 {count} 个手动矩形，但检测模式不是 manual',
  'prop.padding': '内边距 (px)',
  'prop.bleed': '边缘扩色 (px)',
  'prop.godot': 'godot .tres',
  'prop.unity': 'unity 导入器',

  'assets.meta': '{w}x{h} · {n} 个精灵',
  'assets.pending': '{w}x{h} · …',
  'assets.noAlpha': ' · 无 Alpha',
  'assets.error': '错误：{message}',

  'quality.analyze': '分析',
  'quality.exportReport': '导出报告',
  'quality.empty': '点击「分析」检查已加载的资源。',
  'quality.summary': '{assets} 个资源 · {warnings} 条警告',
  'quality.good': '✓ 良好',
  'quality.rulesTitle': '确定性检测规则',
  'quality.rulesHint':
    '五条规则在本地对已加载资源执行检查。先检测、后建议 — 未经确认不会修改任何文件。',
  'quality.ruleNaming': '命名规范 — 文件名缺乏描述性',
  'quality.ruleTransparency': '透明区域 — 画布利用率过低',
  'quality.ruleSize': '尺寸不一致 — 同一动画组内帧大小不一致',
  'quality.ruleDuplicate': '重复帧 — 精确哈希 + dHash 8×8 近似匹配',
  'quality.rulePivot': '锚点检查 — 锚点偏离底部中心',

  'ai.banner':
    '模拟提供者 — 所有分析均在本地运行，数据不会离开本机。云端提供者会把图像上传到第三方服务，必须通过 ai.config.json（命令行）显式启用。',
  'ai.analyze': '使用 AI 分析',
  'ai.provider': '提供者：mock（本地）',
  'ai.noAssets': '尚未加载资源',
  'ai.noSuggestions': '暂无建议 — 请加载资源后点击「分析」。',
  'ai.apply': '应用',
  'ai.ignore': '忽略',
  'ai.status.applied': '已应用',
  'ai.status.ignored': '已忽略',
  'ai.rename': '重命名为 {name}',
  'ai.setPivot': '将锚点设为 ({x}, {y})',
  'ai.templates': '动画模板：{list}',
  'ai.summary': '{assets} 个资源 · {n} 条建议',

  'editor.propose': '生成图层',
  'editor.exportForge': '导出 .forge',
  'editor.undo': '撤销',
  'editor.brushAdd': '画笔 +',
  'editor.brushErase': '画笔 −',
  'editor.summary': '{n} 个图层 · 当前：{active}',
  'editor.noLayers': '暂无图层 — 请点击「生成图层」。',
  'editor.noSource': '编辑器：尚未加载资源',
  'editor.nothingToExport': '编辑器：没有可导出的内容',
  'editor.proposals': '编辑器：生成了 {n} 个图层建议',
  'editor.nothingToUndo': '编辑器：没有可撤销的操作',
  'editor.undone': '编辑器：已撤销',

  'log.clear': '清空',
  'log.toggle': '展开/收起日志',
  'status.assets': '资源',
  'status.sprites': '精灵',
  'status.pages': '页数',
  'status.ready': '就绪',
  'status.noAssets': '暂无资源',
  'status.offline': '离线',
  'status.version': 'v0.1.0',

  'log.ready': 'GameAsset Forge 已就绪 — 可拖入 PNG 文件或点击「打开」',
  'log.loaded': '已加载 {name}（{w}x{h}{alpha}）',
  'log.loadFailed': '加载 {name} 失败：{message}',
  'log.previewError': '预览：{message}',
  'log.analysisFailed': '分析失败：{message}',
  'log.manualRectAdded': '已添加手动矩形（{w}x{h}）— 检测模式已切换为 manual',
  'log.qualityDone': '质量分析：{assets} 个资源中共 {warnings} 条警告',
  'log.qualityNeedRun': '质量报告：请先运行「分析」',
  'log.qualityExported': '质量报告已导出 → {dir}',
  'log.aiDone': 'AI 助手：从 {assets} 个资源生成 {n} 条建议（mock，本地）',
  'log.suggestionApplied': '已应用建议：{text}',
  'log.exportNothing': '导出：没有可导出的内容（尚无预览结果）',
  'log.exported': '已导出 {n} 页 + atlas.json → {dir}',
  'log.exportedTres': '已导出 {name}_spriteframes.tres',
  'log.exportedUnity': '已导出 GameAssetForgeImporter.cs',
  'log.exportFailed': '导出失败：{message}',
  'log.presetLoaded': '已加载预设：{name}',
  'log.presetLoadFailed': '预设加载失败：{message}',
  'log.presetSaved': '已保存预设：{name}',
  'log.presetReset': '预设已重置为默认值',
  'log.undoNothing': '撤销：没有可撤销的操作',
  'log.forgeExported': '已导出 .forge 文件',
  'log.language': '语言已切换为 {lang}',
};

export const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, zh };

let currentLang: Lang = 'en';

export function getLang(): Lang {
  return currentLang;
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  let text: string = dictionaries[currentLang][key] ?? en[key] ?? key;
  if (vars !== undefined) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export const LANGUAGE_EVENT = 'forge:langchange';

export function setLang(lang: Lang, persist = true): void {
  currentLang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (persist) {
    try {
      localStorage.setItem('gaf.lang', lang);
    } catch {
      // localStorage can be unavailable in restricted contexts; ignore.
    }
  }
  applyStaticTranslations();
  document.dispatchEvent(new CustomEvent<Lang>(LANGUAGE_EVENT, { detail: lang }));
}

export function applyStaticTranslations(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n as TranslationKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle as TranslationKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((element) => {
    (element as HTMLInputElement).placeholder = t(
      element.dataset.i18nPlaceholder as TranslationKey,
    );
  });
}

/** URL (?lang=en|zh) wins over the persisted preference; English is default. */
export function initI18n(): Lang {
  let fromUrl: string | null = null;
  let stored: string | null = null;
  try {
    fromUrl = new URLSearchParams(location.search).get('lang');
    stored = localStorage.getItem('gaf.lang');
  } catch {
    // Keep the English default when browser storage APIs are blocked.
  }
  const lang: Lang = fromUrl === 'zh' || fromUrl === 'en' ? fromUrl : stored === 'zh' ? 'zh' : 'en';
  setLang(lang, false);
  return lang;
}
