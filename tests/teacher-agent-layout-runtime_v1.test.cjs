const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../apps/web/js/interactive-learning.js'), 'utf8');
const mount = source.slice(source.indexOf('  function mountTeacherAgent(item)'), source.indexOf('  function initAnimation(item)'));

function fixture(active = true) {
  const frames = [], observers = [], timers = new Map();
  let bottom = 420, timerId = 0;
  function element() {
    const events = {};
    const classes = new Set();
    return { hidden: false, style: { removeProperty(key) { delete this[key]; } }, dataset: {}, events,
      classList: { add: (...keys) => keys.forEach(key => classes.add(key)), remove: (...keys) => keys.forEach(key => classes.delete(key)), contains: key => classes.has(key) },
      setAttribute() {}, append() {}, remove() { this.removed = true; }, focus() {},
      querySelector: () => ({}), addEventListener(name, fn) { events[name] = fn; }, removeEventListener(name) { delete events[name]; } };
  }
  const video = element();
  video.getBoundingClientRect = () => ({ bottom });
  const reference = element();
  reference.querySelectorAll = () => [video];
  reference.getBoundingClientRect = () => ({ bottom });
  const wordBar = { getBoundingClientRect: () => ({ top: 204 - app.scrollTop, bottom: 248 - app.scrollTop }) };
  const host = { querySelector: selector => selector === '.interactive-hero-card' ? wordBar : reference };
  const header = { getBoundingClientRect: () => ({ top: 0, bottom: 64, height: 64 }) };
  const screen = { style: {}, classList: { contains: () => active }, querySelector: () => header };
  const app = element();
  app.scrollTop = 0;
  app.clientHeight = 844;
  app.scrollHeight = 1600;
  app.getBoundingClientRect = () => ({ top: 0, bottom: 844 });
  const nodes = [];
  const document = {
    getElementById(id) { return { 'screen-interactive-learning': screen, 'interactive-learning-content': host, app, 'build-badge': { getBoundingClientRect: () => ({ top: 820 }) } }[id]; },
    querySelectorAll: () => [], createElement: element,
    body: { append(...items) { nodes.push(...items); } }
  };
  const state = { locale: 'zh', teacherHistory: [], teacherHistoryIndex: null };
  const log = {scrollTop:0, scrollHeight:900};
  const TeacherAgent = { render: (panel, options) => {
    panel.querySelector = () => log;
    return { history: options.history, notify(text) { options.history.push({text, proactive:true}); }, replaceScoreFeedback(result) { options.history.push({scoreFeedback:true}); }, destroy() {} };
  } };
  const window = { TeacherAgent, addEventListener() {}, removeEventListener() {} };
  const context = { state, document, window, TeacherAgent, innerHeight: 844, getComputedStyle: () => ({ display: 'block' }),
    requestAnimationFrame: fn => frames.push(fn),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    ResizeObserver: class { constructor(fn) { this.callback = fn; observers.push(this); } observe() {} disconnect() {} } };
  vm.createContext(context);
  vm.runInContext(mount, context);
  const flush = () => { while (frames.length) frames.shift()(); };
  return { context, state, nodes, reference, app, timers, observers, flush, setBottom: value => { bottom = value; } };
}

test('background initialization on splash never mounts a coach', () => {
  const f = fixture(false);
  vm.runInContext('mountTeacherAgent({index:1})', f.context);
  f.flush();
  assert.equal(f.nodes.length, 0);
});

test('automatic and manual opening share media-safe geometry after delayed metadata', () => {
  const f = fixture();
  vm.runInContext('mountTeacherAgent({index:1})', f.context);
  const [launcher, panel] = f.nodes;
  assert.equal(panel.hidden, true);
  f.flush();
  assert.equal(panel.style.top, '436px');
  assert.equal(panel.style.height, '376px');
  assert.equal(f.app.scrollTop, 132);
    assert.equal(204 - f.app.scrollTop, 64 + 8);
  f.setBottom(610);
  f.reference.events.loadedmetadata();
  f.flush();
  assert.equal(panel.style.top, '626px');
  assert.equal(panel.style.height, '186px');
  launcher.events.click();
  assert.equal(panel.hidden, true);
  launcher.events.click();
  f.flush();
  assert.equal(panel.style.top, '626px');
  assert.equal(panel.style.height, '186px');
  f.setBottom(900);
  f.observers[0].callback();
  f.flush();
  assert.equal(panel.style.height, '0px');
  assert.ok(parseFloat(panel.style.top) >= 900);
});

test('short and long word pages keep the current word bar fully visible at the top without drift', () => {
  for (const height of [900, 2400]) {
    const f = fixture();
    f.app.scrollHeight = height;
    vm.runInContext('mountTeacherAgent({index:1})', f.context);
    f.flush();
    assert.equal(f.app.scrollTop, 132);
    assert.equal(204 - f.app.scrollTop, 64 + 8);
    f.nodes[0].events.click();
    f.nodes[0].events.click();
    f.flush();
    assert.equal(f.app.scrollTop, 132);
    assert.equal(204 - f.app.scrollTop, 64 + 8);
  }
});

test('every proactive notification reopens at the latest message and resets inactivity timeout', () => {
  const f = fixture();
  vm.runInContext('mountTeacherAgent({index:1})', f.context);
  f.flush();
  const [launcher, panel] = f.nodes;
  launcher.events.click();
  assert.equal(panel.hidden, true);
  f.state.teacherNotify('new capture tip');
  f.flush();
  assert.equal(panel.hidden, false);
  const log = panel.querySelector('[data-log]');
  assert.equal(log.scrollTop, log.scrollHeight);
  const firstTimer = [...f.timers.keys()][0];
  panel.events.input();
  assert.equal(f.timers.has(firstTimer), false);
  assert.equal(f.timers.size, 1);
  [...f.timers.values()][0]();
  assert.equal(panel.hidden, true);
  f.state.teacherShowScore({score:87,score_valid:true});
  f.flush();
  assert.equal(panel.hidden, false);
});

test('cleanup prevents queued frames and old timeout from reopening a coach', () => {
  const f = fixture();
  vm.runInContext('mountTeacherAgent({index:1})', f.context);
  f.state.teacherCleanup();
  f.flush();
  assert.equal(f.timers.size, 0);
  assert.equal(f.nodes[1].hidden, true);
  assert.equal(f.nodes[1].removed, true);
});
