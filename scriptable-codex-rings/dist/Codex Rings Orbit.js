// Variables used by Scriptable.
// icon-color: teal; icon-glyph: chart-pie;
// Pure iPhone. Credentials: Keychain only. Cache: local normalized usage only.
// Internal backend compatibility and login must be verified on the iPhone.

const UsageCore = (() => {
  const messages = {
    AUTH: '登录已失效', NEED_LOGIN: '请先在 Scriptable 登录',
    BLOCKED: '请求被拦截，请打开官方用量页', RATE_LIMIT: '请求过于频繁，稍后再试',
    FORMAT: '用量数据格式已变化', SESSION: '未取得登录凭证，请尝试手动导入',
    API_KEY: '需要网页登录凭证，不能使用 API Key', STORAGE: '手机本地存储失败',
    NETWORK: '网络请求失败'
  };
  function failure(code) { return new Error(code); }
  function safeError(error) { return messages[error && error.message] || messages.NETWORK; }
  function number(value) { return typeof value === 'number' && Number.isFinite(value); }
  function validWindow(w) {
    return w === null || (w && number(w.remaining) && w.remaining >= 0 && w.remaining <= 100 &&
      number(w.resetsAt) && w.resetsAt > 0 && w.resetsAt < 8640000000000000 &&
      number(w.seconds) && w.seconds > 0);
  }
  function planName(value) { return ['plus', 'pro', 'free', 'team', 'business', 'enterprise', 'edu'].includes(value) ? value : 'account'; }
  function readWindow(w) {
    if (w == null) return null;
    if (!number(w.used_percent) || w.used_percent < 0 || w.used_percent > 100 ||
        !number(w.limit_window_seconds) || w.limit_window_seconds <= 0 ||
        !number(w.reset_at) || w.reset_at <= 0) throw failure('FORMAT');
    const result = { remaining: 100 - w.used_percent, resetsAt: w.reset_at * 1000, seconds: w.limit_window_seconds };
    if (!validWindow(result)) throw failure('FORMAT');
    return result;
  }
  function normalize(payload, now = Date.now()) {
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'rate_limit')) throw failure('FORMAT');
    const limit = payload.rate_limit;
    if (limit !== null && (!limit || typeof limit !== 'object' || Array.isArray(limit) ||
      (!Object.prototype.hasOwnProperty.call(limit, 'primary_window') &&
       !Object.prototype.hasOwnProperty.call(limit, 'secondary_window')))) throw failure('FORMAT');
    return { version: 1, plan: planName(payload.plan_type), fetchedAt: now,
      short: readWindow(limit && limit.primary_window), week: readWindow(limit && limit.secondary_window) };
  }
  function windowView(w, now = Date.now()) {
    if (!w) return { label: '额度', percent: null, pending: false, missing: true, resetsAt: null };
    const label = w.seconds === 604800 ? '每周' : w.seconds % 3600 === 0 ? `${w.seconds / 3600} 小时` : `${Math.round(w.seconds / 60)} 分钟`;
    return { label, percent: w.resetsAt <= now ? null : w.remaining,
      pending: w.resetsAt <= now, missing: false, resetsAt: w.resetsAt };
  }
  function isStale(snapshot, now = Date.now()) {
    return !snapshot || !number(snapshot.fetchedAt) || now - snapshot.fetchedAt > 30 * 60 * 1000 || snapshot.fetchedAt - now > 5 * 60 * 1000;
  }
  function sanitizeSnapshot(s) {
    if (!s || s.version !== 1 || !number(s.fetchedAt) || s.fetchedAt <= 0 || !validWindow(s.short) || !validWindow(s.week)) return null;
    const copy = w => w === null ? null : { remaining: w.remaining, resetsAt: w.resetsAt, seconds: w.seconds };
    return { version: 1, plan: planName(s.plan), fetchedAt: s.fetchedAt, short: copy(s.short), week: copy(s.week) };
  }
  function tokenAccount(token) {
    try {
      const part = token.split('.')[1];
      if (!part || typeof Data === 'undefined') return '';
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(Data.fromBase64String(b64 + '='.repeat((4 - b64.length % 4) % 4)).toRawString());
      return claims['https://api.openai.com/auth'].chatgpt_account_id || '';
    } catch (_) { return ''; }
  }
  function credentialsFromInput(input) {
    let token = String(input || '').trim(); let accountId = '';
    if (token.startsWith('{')) {
      let session;
      try { session = JSON.parse(token); } catch (_) { throw failure('SESSION'); }
      token = session.accessToken || session.access_token || '';
      accountId = session.accountId || (session.account && session.account.id) || '';
    }
    if (typeof token !== 'string') throw failure('SESSION');
    token = token.replace(/^Bearer\s+/i, '').trim();
    if (token.startsWith('sk-')) throw failure('API_KEY');
    if (!token || /\s/.test(token) || token.length > 65536) throw failure('SESSION');
    accountId = accountId || tokenAccount(token);
    if (typeof accountId !== 'string' || /[\s\r\n]/.test(accountId) || accountId.length > 256) throw failure('SESSION');
    return { accessToken: token, accountId };
  }
  return { failure, safeError, normalize, windowView, isStale, sanitizeSnapshot, credentialsFromInput };
})();

const UsageRuntime = (() => {
  const key = 'pizai.scriptable.codex-usage.credentials.v1';
  const endpoint = 'https://chatgpt.com/backend-api/wham/usage';
  function file() {
    const fm = FileManager.local();
    return { fm, path: fm.joinPath(fm.documentsDirectory(), 'codex-usage-cache-v1.json') };
  }
  function credentials() {
    try {
      if (!Keychain.contains(key)) return null;
      const record = JSON.parse(Keychain.get(key));
      if (!record.cacheId || typeof record.cacheId !== 'string') return null;
      return { ...UsageCore.credentialsFromInput(JSON.stringify(record)), cacheId: record.cacheId };
    } catch (_) { return null; }
  }
  function readCache(cacheId) {
    try {
      const f = file();
      if (!f.fm.fileExists(f.path)) return null;
      const record = JSON.parse(f.fm.readString(f.path));
      return record.cacheId === cacheId ? UsageCore.sanitizeSnapshot(record.snapshot) : null;
    } catch (_) { return null; }
  }
  function writeCache(cacheId, snapshot) {
    const f = file();
    f.fm.writeString(f.path, JSON.stringify({ cacheId, snapshot }));
  }
  async function fetchUsage(auth, now = Date.now()) {
    const req = new Request(endpoint);
    req.method = 'GET'; req.timeoutInterval = 12;
    req.headers = { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json' };
    if (auth.accountId) req.headers['ChatGPT-Account-Id'] = auth.accountId;
    // Never forward a bearer token through a redirect, including to another origin.
    req.onRedirect = () => null;
    let text;
    try { text = await req.loadString(); } catch (_) { throw UsageCore.failure('NETWORK'); }
    const status = req.response && req.response.statusCode;
    if (status === 401) throw UsageCore.failure('AUTH');
    if (status === 403 || (status >= 300 && status < 400)) throw UsageCore.failure('BLOCKED');
    if (status === 429) throw UsageCore.failure('RATE_LIMIT');
    if (status !== 200) throw UsageCore.failure('NETWORK');
    if (text.trim().startsWith('<')) throw UsageCore.failure('BLOCKED');
    let data;
    try { data = JSON.parse(text); } catch (_) { throw UsageCore.failure('FORMAT'); }
    return UsageCore.normalize(data, now);
  }
  async function configure(input, now = Date.now()) {
    const auth = UsageCore.credentialsFromInput(JSON.stringify(input));
    const snapshot = await fetchUsage(auth, now);
    const record = { ...auth, cacheId: UUID.string() };
    try {
      // New cache ID prevents a failed write from exposing an old account's snapshot.
      Keychain.set(key, JSON.stringify(record));
      writeCache(record.cacheId, snapshot);
    } catch (_) { throw UsageCore.failure('STORAGE'); }
    return snapshot;
  }
  async function getState(now = Date.now()) {
    const auth = credentials();
    if (!auth) return { snapshot: null, cached: false, stale: true, error: 'NEED_LOGIN' };
    const cached = readCache(auth.cacheId);
    try {
      const snapshot = await fetchUsage(auth, now);
      try { writeCache(auth.cacheId, snapshot); }
      catch (_) { return { snapshot, cached: false, stale: false, error: 'STORAGE' }; }
      return { snapshot, cached: false, stale: false, error: null };
    } catch (error) {
      const code = ['AUTH', 'BLOCKED', 'RATE_LIMIT', 'FORMAT', 'NETWORK'].includes(error.message) ? error.message : 'NETWORK';
      return { snapshot: cached, cached: !!cached, stale: UsageCore.isStale(cached, now), error: code };
    }
  }
  return { credentials, configure, getState };
})();

async function usageAlert(title, message) {
  const alert = new Alert(); alert.title = title; alert.message = message;
  alert.addAction('好'); await alert.presentAlert();
}

async function loginInWebView() {
  await usageAlert('在官方网页登录', '请手动登录 ChatGPT，确认进入 Codex 用量页面后，点击网页窗口的“完成”返回。脚本会尝试读取当前会话并验证额度；不会保存密码。');
  const web = new WebView();
  try {
    await web.loadURL('https://chatgpt.com/codex/settings/usage');
    await web.present(true);
    const result = await web.evaluateJavaScript(`
      (async () => {
        try {
          if (location.origin !== 'https://chatgpt.com') return completion(JSON.stringify({error:'SESSION'}));
          const response = await fetch('https://chatgpt.com/api/auth/session', {credentials:'same-origin', redirect:'error', cache:'no-store'});
          if (!response.ok) return completion(JSON.stringify({error:'SESSION'}));
          const session = await response.json();
          if (!session.accessToken) return completion(JSON.stringify({error:'SESSION'}));
          let accountId = session.account && session.account.id || '';
          try {
            const part = session.accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
            const claims = JSON.parse(atob(part + '='.repeat((4-part.length%4)%4)));
            accountId = accountId || (claims['https://api.openai.com/auth'] || {}).chatgpt_account_id || '';
          } catch (_) {}
          completion(JSON.stringify({accessToken:session.accessToken, accountId}));
        } catch (_) { completion(JSON.stringify({error:'SESSION'})); }
      })();`, true);
    const session = JSON.parse(result);
    if (session.error) throw UsageCore.failure('SESSION');
    return UsageCore.credentialsFromInput(JSON.stringify(session));
  } catch (_) { throw UsageCore.failure('SESSION'); }
}

async function manualCredentials() {
  const alert = new Alert();
  alert.title = '导入手机上的登录凭证';
  alert.message = '在 iPhone Safari 登录 chatgpt.com，再访问 https://chatgpt.com/api/auth/session，复制页面 JSON，粘贴到下方安全输入框。也可以仅粘贴 accessToken。不要把内容发给任何人。';
  alert.addSecureTextField('会话 JSON 或 accessToken', '');
  alert.addTextField('Account ID（可选，多工作区时使用）', '');
  alert.addAction('验证并保存到 Keychain'); alert.addCancelAction('取消');
  if (await alert.presentAlert() < 0) return null;
  const auth = UsageCore.credentialsFromInput(alert.textFieldValue(0));
  const accountId = alert.textFieldValue(1).trim();
  if (accountId) return UsageCore.credentialsFromInput(JSON.stringify({ ...auth, accountId }));
  return auth;
}

function usageDate(ms, format = 'MM-dd HH:mm') {
  const formatter = new DateFormatter(); formatter.dateFormat = format;
  return formatter.string(new Date(ms));
}

function usageBar(percent, color, width) {
  const ctx = new DrawContext(); ctx.size = new Size(width, 5); ctx.opaque = false; ctx.respectScreenScale = true;
  ctx.setFillColor(new Color('253244')); ctx.fillRect(new Rect(0, 0, width, 5));
  if (percent !== null && percent > 0) {
    ctx.setFillColor(color); ctx.fillRect(new Rect(0, 0, width * percent / 100, 5));
  }
  return ctx.getImage();
}

const RING_STYLE = 'orbit';
// Shared rendering source. build.cjs assembles this into each standalone script.
function arcPoints(center, radius, percent) {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0) return [];
  const fraction = Math.min(100, percent) / 100;
  const steps = Math.max(2, Math.ceil(100 * fraction));
  const result = [];
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + 2 * Math.PI * fraction * i / steps;
    result.push({ x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) });
  }
  return result;
}
function ringInfo(window, now, fallback) {
  if (!window) return { label: fallback, value: '—', progress: null, reset: '暂无额度', resetsAt: null };
  const label = window.seconds === 604800 ? '每周' : window.seconds % 3600 === 0 ? `${window.seconds / 3600} 小时` : `${Math.round(window.seconds / 60)} 分钟`;
  if (window.resetsAt <= now) return { label, value: '—', progress: null, reset: '已到期 · 待刷新', resetsAt: window.resetsAt };
  return { label, value: `${Math.round(window.remaining)}%`, progress: window.remaining, reset: null, resetsAt: window.resetsAt };
}
function drawArc(ctx, center, radius, thickness, percent, color) {
  const track = new Color('293849');
  ctx.setLineWidth(thickness); ctx.setStrokeColor(track);
  ctx.strokeEllipse(new Rect(center - radius, center - radius, radius * 2, radius * 2));
  const points = arcPoints(center, radius, percent);
  if (points.length) {
    const path = new Path(); path.move(new Point(points[0].x, points[0].y));
    for (const p of points.slice(1)) path.addLine(new Point(p.x, p.y));
    ctx.addPath(path); ctx.setStrokeColor(color); ctx.strokePath();
  }
}
function textOnImage(ctx, text, y, height, font, color, width) {
  ctx.setTextAlignedCenter(); ctx.setTextColor(color); ctx.setFont(font);
  ctx.drawTextInRect(text, new Rect(0, y, width, height));
}
function duoImage(info, color) {
  const size = 88, ctx = new DrawContext(); ctx.size = new Size(size, size);
  ctx.opaque = false; ctx.respectScreenScale = true;
  drawArc(ctx, 44, 39, 7, info.progress, color);
  textOnImage(ctx, info.value, 26, 28, Font.boldSystemFont(21), new Color('F2F6FC'), size);
  textOnImage(ctx, info.label, 53, 14, Font.mediumSystemFont(9), new Color('A3B1C2'), size);
  return ctx.getImage();
}
function orbitImage(five, week, cyan, blue) {
  const size = 100, ctx = new DrawContext(); ctx.size = new Size(size, size);
  ctx.opaque = false; ctx.respectScreenScale = true;
  drawArc(ctx, 50, 44, 7, five.progress, cyan);
  drawArc(ctx, 50, 32, 7, week.progress, blue);
  textOnImage(ctx, '剩余', 34, 16, Font.mediumSystemFont(10), new Color('A3B1C2'), size);
  textOnImage(ctx, '用量', 50, 16, Font.mediumSystemFont(10), new Color('A3B1C2'), size);
  return ctx.getImage();
}
function ringReset(info) { return info.reset || `重置 ${usageDate(info.resetsAt, 'MM-dd HH:mm')}`; }
function renderUsage(state, now = Date.now()) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color('101925'); widget.setPadding(11, 14, 8, 14);
  widget.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&refresh=1`;
  widget.refreshAfterDate = new Date(now + 15 * 60 * 1000);
  const white = new Color('F2F6FC'), muted = new Color('A3B1C2'), cyan = new Color('54DECC'), blue = new Color('82A8FF');
  const header = widget.addStack(); header.centerAlignContent();
  const title = header.addText('Codex Usage'); title.font = Font.boldSystemFont(13); title.textColor = white;
  header.addSpacer();
  if (state.snapshot) { const plan = header.addText(state.snapshot.plan.toUpperCase()); plan.font = Font.mediumSystemFont(9); plan.textColor = muted; }
  widget.addSpacer(RING_STYLE === 'duo' ? 12 : 8);
  if (!state.snapshot) {
    const msg = widget.addText(UsageCore.safeError(new Error(state.error || 'NEED_LOGIN'))); msg.font = Font.mediumSystemFont(12); msg.textColor = muted;
    widget.addSpacer(); const hint = widget.addText('点击配置 / 重试'); hint.font = Font.systemFont(10); hint.textColor = cyan;
    return widget;
  }
  if (config.widgetFamily === 'small') {
    const hint = widget.addText('请使用中号组件'); hint.font = Font.systemFont(12); hint.textColor = muted;
    return widget;
  }
  const five = ringInfo(state.snapshot.short, now, '5 小时'), week = ringInfo(state.snapshot.week, now, '每周');
  const body = widget.addStack(); body.layoutHorizontally(); body.centerAlignContent();
  if (RING_STYLE === 'duo') {
    const addColumn = (info, color) => {
      const col = body.addStack(); col.layoutVertically(); col.size = new Size(128, 0);
      const imageRow = col.addStack(); imageRow.layoutHorizontally(); imageRow.size = new Size(128, 0);
      imageRow.addSpacer(); const img = imageRow.addImage(duoImage(info, color)); img.imageSize = new Size(88, 88); imageRow.addSpacer();
      col.addSpacer(2);
      const resetRow = col.addStack(); resetRow.layoutHorizontally(); resetRow.size = new Size(128, 0);
      resetRow.addSpacer(); const reset = resetRow.addText(ringReset(info)); reset.font = Font.systemFont(9); reset.textColor = muted; reset.lineLimit = 1; reset.minimumScaleFactor = 0.75; resetRow.addSpacer();
    };
    body.addSpacer(); addColumn(five, cyan); body.addSpacer(); addColumn(week, blue); body.addSpacer();
  } else {
    body.addSpacer(8);
    const img = body.addImage(orbitImage(five, week, cyan, blue)); img.imageSize = new Size(100, 100);
    body.addSpacer(18);
    const details = body.addStack(); details.layoutVertically();
    const addDetail = (info, color) => {
      const line = details.addStack(); line.size = new Size(170, 0); line.centerAlignContent();
      const text = line.addStack(); text.layoutVertically();
      const heading = text.addStack(); heading.centerAlignContent();
      const dot = heading.addText('● '); dot.font = Font.systemFont(8); dot.textColor = color;
      const label = heading.addText(info.label); label.font = Font.mediumSystemFont(10); label.textColor = muted;
      const reset = text.addText(ringReset(info)); reset.font = Font.systemFont(9); reset.textColor = muted; reset.lineLimit = 1; reset.minimumScaleFactor = 0.75;
      line.addSpacer(); const value = line.addText(info.value); value.font = Font.boldSystemFont(17); value.textColor = white;
    };
    addDetail(five, cyan); details.addSpacer(7); addDetail(week, blue); body.addSpacer();
  }
  widget.addSpacer();
  const status = state.error ? UsageCore.safeError(new Error(state.error)) : (state.stale ? '数据已过期' : '已更新');
  const cache = state.cached ? (state.stale ? ' · 过期缓存' : ' · 缓存') : '';
  const footerRow = widget.addStack(); footerRow.addSpacer();
  const footer = footerRow.addText(`${status}${cache} · ${usageDate(state.snapshot.fetchedAt, state.stale ? 'MM-dd HH:mm' : 'HH:mm')}`);
  footer.font = Font.systemFont(8); footer.textColor = state.error || state.stale ? new Color('FFA772') : muted; footer.lineLimit = 1; footer.minimumScaleFactor = 0.7;
  return widget;
}
if (typeof module !== 'undefined') module.exports = { arcPoints, ringInfo };

async function usageMain() {
  // A widget tap uses a separate URL-scheme parameter so it can refresh the
  // local cache without presenting the configuration menu or widget preview.
  // Scriptable still opens, and iOS decides when the home-screen widget redraws.
  if (!config.runsInWidget && typeof args !== 'undefined' && args.queryParameters &&
      args.queryParameters.refresh === '1' && UsageRuntime.credentials()) {
    await UsageRuntime.getState();
    Script.complete();
    return;
  }
  if (!config.runsInWidget) {
    const menu = new Alert(); menu.title = 'Codex Usage';
    menu.message = '仅在 iPhone 取数。凭证保存在 Keychain；失效时需重新登录。';
    menu.addAction('网页登录 / 重新登录');
    menu.addAction('手动导入登录凭证');
    menu.addAction('刷新并预览小组件');
    menu.addAction('打开官方用量页'); menu.addCancelAction('取消');
    const choice = await menu.presentSheet();
    if (choice < 0) { Script.complete(); return; }
    if (choice === 3) { await Safari.open('https://chatgpt.com/codex/settings/usage'); Script.complete(); return; }
    if (choice < 2) {
      try {
        const auth = choice === 0 ? await loginInWebView() : await manualCredentials();
        if (!auth) { Script.complete(); return; }
        await UsageRuntime.configure(auth);
      } catch (error) {
        await usageAlert('配置未完成', UsageCore.safeError(error) + '。可尝试手动导入；无需提供凭证给我。');
        Script.complete(); return;
      }
    }
  }
  const state = await UsageRuntime.getState();
  const widget = renderUsage(state);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

// Scriptable supports top-level await. Offline tests load these definitions without config.
if (typeof config !== 'undefined') await usageMain();
