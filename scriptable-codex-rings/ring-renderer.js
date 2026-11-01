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
