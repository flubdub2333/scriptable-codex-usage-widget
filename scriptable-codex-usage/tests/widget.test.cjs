const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Minimal adapter for documented Scriptable UI calls. This checks execution and
// output semantics, not iOS pixel layout or WebView/network compatibility.
async function runWidget({ configured = true, status = 200, expired = false, family = 'medium', cachedAt = null, tap = false } = {}) {
  const texts = []; const barColors = []; let widget; let completed = false; let requests = 0;
  class Stack {
    addStack() { return new Stack(); }
    addText(text) { texts.push(String(text)); return {}; }
    addDate() { return { applyRelativeStyle() {} }; }
    addImage() { return {}; }
    addSpacer() {} setPadding() {} centerAlignContent() {} layoutVertically() {} layoutHorizontally() {}
  }
  class ListWidget extends Stack {}
  class DrawContext {
    setFillColor(color) { barColors.push(color.hex); } fillRect() {} getImage() { return {}; }
  }
  class Color { constructor(hex) { this.hex = hex; } }
  class Size { constructor(width, height) { this.width = width; this.height = height; } }
  class Rect { constructor() {} }
  class DateFormatter { string(d) { return d.toISOString().slice(11, 16); } }
  const Font = { boldSystemFont: () => ({}), mediumSystemFont: () => ({}), systemFont: () => ({}) };
  const keys = new Map(configured ? [['pizai.scriptable.codex-usage.credentials.v1', JSON.stringify({ accessToken: 'test-token', cacheId: 'test-cache' })]] : []);
  const files = new Map();
  if (cachedAt) files.set('/local/codex-usage-cache-v1.json', JSON.stringify({ cacheId: 'test-cache', snapshot: {
    version: 1, plan: 'plus', fetchedAt: cachedAt,
    short: { remaining: 25, seconds: 18000, resetsAt: Date.now() + 3600000 },
    week: { remaining: 88, seconds: 604800, resetsAt: Date.now() + 86400000 }
  } }));
  const fm = { documentsDirectory: () => '/local', joinPath: (a, b) => a + '/' + b,
    fileExists: p => files.has(p), readString: p => files.get(p), writeString: (p, s) => files.set(p, s) };
  class Request {
    constructor() { requests++; this.response = { statusCode: status }; }
    async loadString() { return JSON.stringify({ plan_type: 'plus', rate_limit: {
      primary_window: { used_percent: 75, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600) },
      secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 }
    } }); }
  }
  class Alert { constructor() { throw new Error('Widget must not show login UI'); } }
  class WebView { constructor() { throw new Error('Widget must not open WebView'); } }
  const environment = { config: { runsInWidget: !tap, widgetFamily: family }, args: { queryParameters: tap ? { refresh: '1' } : {} }, ListWidget, DrawContext,
    Color, Size, Rect, DateFormatter, Font, Request, Alert, WebView,
    FileManager: { local: () => fm }, Keychain: { contains: k => keys.has(k), get: k => keys.get(k), set: (k, v) => keys.set(k, v) },
    Script: { name: () => 'Codex Usage', setWidget: w => { widget = w; }, complete: () => { completed = true; } }
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'Codex Usage.js'), 'utf8');
  await new AsyncFunction(...Object.keys(environment), source)(...Object.values(environment));
  return { texts, barColors, widget, completed, requests };
}

test('standalone widget entry point shows real normalized percentages and completes', async () => {
  const result = await runWidget();
  assert.equal(result.completed, true);
  assert.ok(result.texts.includes('25%'));
  assert.ok(result.texts.includes('88%'));
  assert.equal(result.widget.url, 'scriptable:///run?scriptName=Codex%20Usage&refresh=1');
});

test('widget tap with saved credentials refreshes without a menu or preview', async () => {
  const result = await runWidget({ tap: true });
  assert.equal(result.completed, true);
  assert.equal(result.requests, 1);
  assert.equal(result.widget, undefined);
});

test('standalone widget has a setup state without opening interactive UI', async () => {
  const result = await runWidget({ configured: false });
  assert.ok(result.texts.includes('请先在 Scriptable 登录'));
  assert.equal(result.completed, true);
});

test('standalone widget reports expired windows as pending instead of old percentages', async () => {
  const result = await runWidget({ expired: true });
  assert.equal(result.texts.includes('25%'), false);
  assert.ok(result.texts.includes('已到重置点 · 待刷新'));
});

test('small widget executes with both quota windows', async () => {
  const result = await runWidget({ family: 'small' });
  assert.ok(result.texts.includes('25% 剩余'));
  assert.ok(result.texts.includes('88% 剩余'));
});

test('medium bars use teal for five-hour and blue for weekly remaining', async () => {
  const result = await runWidget();
  assert.ok(result.barColors.includes('54DECC'));
  assert.ok(result.barColors.includes('82A8FF'));
});

test('old cached data keeps both the auth failure and stale cache label visible', async () => {
  const result = await runWidget({ status: 401, cachedAt: Date.now() - 3600000 });
  assert.ok(result.texts.some(t => t.startsWith('登录已失效 · 过期缓存')));
});
