const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '..', 'ring-renderer.js');
function renderSource() {
  return fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
}
function load() {
  const context = { module: { exports: {} }, console, Math, Date };
  vm.runInNewContext(renderSource(), context);
  return context.module.exports;
}
test('percentage geometry starts at twelve and follows remaining value clockwise', () => {
  const r = load(); assert.equal(typeof r.arcPoints, 'function');
  const p = r.arcPoints(50, 40, 25);
  assert.equal(p.length > 2, true);
  assert.ok(Math.abs(p[0].x - 50) < 1e-8);
  assert.ok(Math.abs(p[0].y - 10) < 1e-8);
  assert.ok(Math.abs(p.at(-1).x - 90) < 1e-8);
  assert.ok(Math.abs(p.at(-1).y - 50) < 1e-8);
});
test('zero and missing percentages draw no progress, full value draws full ring', () => {
  const r = load(); assert.equal(typeof r.arcPoints, 'function');
  assert.equal(r.arcPoints(50, 40, 0).length, 0);
  assert.equal(r.arcPoints(50, 40, null).length, 0);
  assert.ok(r.arcPoints(50, 40, 100).length > 30);
});
test('expired windows never appear as fresh counts or misleading countdowns', () => {
  const r = load(); assert.equal(typeof r.ringInfo, 'function');
  const now = 1800000000000;
  const info = r.ringInfo({remaining:25,seconds:18000,resetsAt:now-1}, now, '5 小时');
  assert.equal(info.value, '—'); assert.equal(info.progress, null); assert.equal(info.reset, '已到期 · 待刷新');
  const missing = r.ringInfo(null, now, '每周');
  assert.equal(missing.value, '—'); assert.equal(missing.progress, null); assert.equal(missing.reset, '暂无额度');
});
test('the rings show service-provided remaining amounts without fabricating a reset', () => {
  const r = load(); assert.equal(typeof r.ringInfo, 'function');
  const now = 1800000000000;
  const info = r.ringInfo({remaining:35,seconds:604800,resetsAt:now+1000}, now, '每周');
  assert.equal(info.value, '35%'); assert.equal(info.progress, 35); assert.equal(info.label, '每周');
});

test('side by side circles are drawn at readable size', () => {
  const render = renderSource();
  const context = { module: {exports:{}}, Math, Date,
    DrawContext: class { setLineWidth(){} setStrokeColor(){} strokeEllipse(){} addPath(){} strokePath(){} setTextAlignedCenter(){} setTextColor(){} setFont(){} drawTextInRect(){} getImage(){return {width:this.size.width}} },
    Size: class { constructor(width,height){this.width=width;this.height=height} },
    Rect: class {}, Color: class {}, Point: class {}, Path: class { move(){} addLine(){} },
    Font: {boldSystemFont:()=>({}), mediumSystemFont:()=>({})}
  };
  vm.runInNewContext(render,context);
  const image = context.duoImage({progress:25,value:'25%',label:'5 小时'},{});
  assert.equal(image.width,88);
});
