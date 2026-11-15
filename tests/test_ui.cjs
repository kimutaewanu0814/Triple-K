// Node.js 기본 모듈만 사용하는 브라우저 로직 테스트. 실제 DOM/Flask 검증과는 별개다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');
assert.ok(html.indexOf('class="support-banner"') < html.indexOf('id="task-form"'));
assert.ok(html.includes('class="header-support" href="#support"'));
assert.ok(html.includes('<footer><a href="#support">'));
assert.ok(html.includes('id="support"'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.maxLength = 1000; }
  set innerHTML(_) { throw new Error('Unsafe HTML assignment'); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes.flatMap(node => node.tag === 'fragment' ? node.children : [node]); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll() { return this.children.flatMap(node => [node, ...node.querySelectorAll()]).filter(node => node.tag === 'button' && node.dataset.refine); }
}
const storage = new Map([['first-step-walks-v1', '{"2026-11-08":4,"2026-11-09":2}']]);
let calls = [];
let nextResponse;
function loadPage(localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)}) {
  const nodes = new Map([['#walk-storage-message', Object.assign(new Node(), {hidden:true})]]);
  const document = {
    querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); },
    createElement: tag => new Node(tag),
    createDocumentFragment: () => new Node('fragment'),
    createTextNode: value => Object.assign(new Node('text'), {textContent:value}),
  };
  const context = vm.createContext({document, window:new Node(), localStorage, console, setTimeout, clearTimeout, AbortController,
    fetch: (...args) => { calls.push(args); return nextResponse(...args); },
  });
  vm.runInContext(script, context);
  return context;
}
const context = loadPage();
const run = source => vm.runInContext(source, context);
const get = selector => context.document.querySelector(selector);
const walkRows = (page = context.document) => page.querySelector('#walk-chart').children.map(
  item => item.children[0].children.map(cell => cell.textContent));
const walkSummary = () => walkRows()[0][1];
const roundSummary = () => get('#round-summary').textContent;
const completion = index => get('#cards').children[index].children[5].children;
const valid = {steps:Array.from({length:3}, (_, i) => ({title:`행동 ${i + 1}`, description:'자료 열기', minutes:2, completion_criteria:'자료가 열림'})), feedback:'작게 시작해도 괜찮아요.'};
const ok = data => ({ok:true, json:async () => data});

(async () => {
  get('#task-form').listeners.submit({preventDefault(){}});
  assert.equal(calls.length, 0);
  assert.equal(get('#task').attrs['aria-invalid'], 'true');
  get('#task').value = '가'.repeat(1001);
  get('#task-form').listeners.submit({preventDefault(){}});
  assert.equal(calls.length, 0);

  let resolve;
  nextResponse = () => new Promise(done => { resolve = done; });
  const pending = run("requestSteps('/api/split', {task:'보고서'})");
  assert.equal(get('#submit').disabled, true);
  await run("requestSteps('/api/split', {task:'중복'})");
  assert.equal(calls.length, 1);
  const injection = structuredClone(valid);
  injection.steps[0].title = '<img src=x onerror=alert(1)>';
  resolve(ok(injection));
  await pending;
  assert.equal(get('#cards').children.length, 3);
  assert.equal(get('#cards').children[0].children[1].textContent, injection.steps[0].title);
  assert.equal(get('#submit').disabled, false);
  assert.equal(get('#result-title').focused, true);
  assert.equal(get('#cards').children[0].children[4].children[1].disabled, false);
  assert.equal(roundSummary(), '0개 완료 / 3개 · 0%');
  get('#open-walk-history').listeners.click();
  assert.equal(get('#walk-history').open, true);
  assert.deepEqual(walkRows(), [['그동안 걸어간 총 걸음 수', '6걸음'], ['이전 기록 (할 일 이름 없음)', '6걸음']]);
  const [complete, , cancel] = completion(0);
  complete.listeners.click();
  complete.listeners.click();
  completion(1)[0].listeners.click();
  assert.equal(roundSummary(), '2개 완료 / 3개 · 67%');
  assert.equal(get('#round-progress').value, 2);
  assert.equal(walkSummary(), '8걸음');
  assert.deepEqual(walkRows()[1], ['보고서', '2걸음']);
  assert.equal(get('#walk-chart').children[1].children[1].children[0].style.width, '25%');
  cancel.listeners.click();
  cancel.listeners.click();
  assert.equal(roundSummary(), '1개 완료 / 3개 · 33%');
  assert.equal(walkSummary(), '7걸음');
  assert.deepEqual(JSON.parse(storage.get('first-step-walks-v2')), {previous:6, tasks:{보고서:1}});

  nextResponse = async () => ok(valid);
  await get('#cards').children[1].children[4].children[0].listeners.click();
  const [url, options] = calls.at(-1);
  assert.equal(url, '/api/refine');
  assert.equal(JSON.parse(options.body).step.title, '행동 2');
  assert.match(get('#context').textContent, /행동 2/);
  assert.equal(roundSummary(), '0개 완료 / 3개 · 0%');
  complete.listeners.click();
  assert.equal(walkSummary(), '7걸음');
  completion(0)[0].listeners.click();
  assert.equal(JSON.parse(options.body).task, '보고서');

  nextResponse = () => new Promise(done => { resolve = done; });
  const advance = get('#cards').children[0].children[4].children[1].listeners.click();
  assert.equal(calls.at(-1)[0], '/api/advance');
  assert.equal(JSON.parse(calls.at(-1)[1].body).step.title, '행동 1');
  assert.equal(JSON.parse(calls.at(-1)[1].body).task, '보고서');
  assert.match(get('#status').textContent, /행동 1.*다음 행동/);
  get('#cards').querySelectorAll().forEach(button => assert.equal(button.disabled, true));
  const callCount = calls.length;
  await get('#cards').children[1].children[4].children[1].listeners.click();
  assert.equal(calls.length, callCount);
  resolve(ok(valid));
  await advance;
  assert.match(get('#context').textContent, /행동 1.*조금 더 도전적인 다음 행동/);
  assert.equal(roundSummary(), '0개 완료 / 3개 · 0%');
  assert.deepEqual(walkRows()[1], ['보고서', '2걸음']);
  const reloaded = loadPage().document;
  reloaded.querySelector('#open-walk-history').listeners.click();
  assert.deepEqual(walkRows(reloaded), walkRows());
  assert.equal(reloaded.querySelector('#cards').children.length, 0);
  const empty = loadPage({getItem: () => null}).document;
  empty.querySelector('#open-walk-history').listeners.click();
  assert.equal(empty.querySelector('#walk-empty').hidden, false);
  const unavailable = loadPage({getItem: () => { throw new Error('Unavailable'); }}).document;
  assert.equal(unavailable.querySelector('#walk-storage-message').hidden, false);
  get('#cards').querySelectorAll().forEach(button => assert.equal(button.disabled, false));

  const previousCards = get('#cards').children;
  completion(0)[0].listeners.click();
  nextResponse = async () => ({ok:false, json:async () => ({error:{message:'잠시 후 다시 시도해 주세요.'}})});
  await get('#cards').children[0].children[4].children[1].listeners.click();
  assert.equal(get('#error').hidden, false);
  assert.equal(get('#cards').children, previousCards);
  assert.equal(roundSummary(), '1개 완료 / 3개 · 33%');
  assert.equal(walkSummary(), '9걸음');
  assert.equal(get('#submit').disabled, false);
  assert.equal(get('#task').disabled, false);
  get('#cards').querySelectorAll().forEach(button => assert.equal(button.disabled, false));

  nextResponse = async () => ok({...valid, steps:valid.steps.slice(0, 2)});
  await run("requestSteps('/api/split', {task:'잘못된 결과'})");
  assert.equal(get('#cards').children, previousCards);

  nextResponse = async () => { const error = new Error(); error.name = 'AbortError'; throw error; };
  await run("requestSteps('/api/split', {task:'시간 초과'})");
  assert.match(get('#error').textContent, /응답 시간/);
  assert.equal(get('#submit').disabled, false);

  nextResponse = async () => ok(valid);
  await run("requestSteps('/api/split', {task:'복구'})");
  assert.equal(get('#error').hidden, true);
  assert.equal(get('#cards').children.length, 3);
  completion(0)[0].listeners.click();
  assert.deepEqual(walkRows(), [['그동안 걸어간 총 걸음 수', '10걸음'], ['보고서', '3걸음'], ['복구', '1걸음'], ['이전 기록 (할 일 이름 없음)', '6걸음']]);
  completion(0)[2].listeners.click();
  assert.equal(walkRows().some(([title]) => title === '복구'), false);
  console.log('PASS: JS syntax, prominent support links, blank/long input, duplicate prevention, loading, 3-card render, safe text, refine/advance targets, both difficulty buttons, API errors, invalid response, timeout recovery');
  console.log('PASS: history popup, horizontal bars, legacy counts, completion, duplicate protection, cancellation, task rows, difficulty resets, reload, empty and unavailable storage');
})().catch(error => { console.error(error); process.exitCode = 1; });
