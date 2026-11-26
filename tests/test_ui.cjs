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
globalThis.CustomEvent ??= class { constructor(type, options) { this.type = type; this.detail = options.detail; } };

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.maxLength = 1000; }
  set innerHTML(_) { throw new Error('Unsafe HTML assignment'); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
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
function loadPage(localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}, firebaseConfig = null) {
  const nodes = new Map([['#walk-storage-message', Object.assign(new Node(), {hidden:true})]]);
  nodes.set('#resume-panel', Object.assign(new Node(), {dataset:{config:JSON.stringify(firebaseConfig)}}));
  const document = {
    querySelector: selector => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); },
    createElement: tag => new Node(tag),
    createDocumentFragment: () => new Node('fragment'),
    createTextNode: value => Object.assign(new Node('text'), {textContent:value}),
  };
  const context = vm.createContext({document, window:new Node(), localStorage, console, setTimeout, clearTimeout, AbortController, CustomEvent,
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
  const reflection = get('#cards').children[0].children[6];
  const [summary, , answer, hint] = reflection.children;
  answer.value = 'easier';
  answer.listeners.change();
  assert.match(hint.textContent, /그 부분부터/);
  assert.equal(roundSummary(), '0개 완료 / 3개 · 0%');
  assert.equal(walkSummary(), '6걸음');
  assert.equal(storage.has('first-step-walks-v2'), false);
  reflection.open = true;
  answer.value = 'skip';
  answer.listeners.change();
  assert.equal(reflection.open, false);
  assert.equal(answer.value, '');
  assert.equal(summary.focused, true);
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
  completion(0)[0].listeners.click();
  storage.set('other-site-setting', 'keep');
  context.window.confirm = () => false;
  get('#clear-walk-history').listeners.click();
  assert.equal(walkSummary(), '10걸음');
  context.window.confirm = () => true;
  get('#clear-walk-history').listeners.click();
  assert.equal(walkSummary(), '0걸음');
  assert.equal(roundSummary(), '0개 완료 / 3개 · 0%');
  assert.equal(completion(0)[2].hidden, true);
  assert.equal(storage.has('first-step-walks-v1'), false);
  assert.equal(storage.has('first-step-walks-v2'), false);
  assert.equal(storage.get('other-site-setting'), 'keep');
  const afterClear = loadPage().document;
  afterClear.querySelector('#open-walk-history').listeners.click();
  assert.equal(walkRows(afterClear)[0][1], '0걸음');
  completion(0)[0].listeners.click();
  assert.equal(walkSummary(), '1걸음');

  let emitted;
  context.window.addEventListener('first-step:save-resume', event => { emitted = event.detail; });
  get('#cards').children[0].children[7].listeners.click();
  assert.equal(emitted.task, '복구');
  assert.equal(emitted.title, valid.steps[0].title);
  // 저장 행동의 원래 할 일을 사용하며 입력창이나 현재 결과의 할 일과 섞지 않는다.
  let refineDone;
  await context.window.dispatchEvent(new CustomEvent('first-step:refine-resume', {detail:{
    task:'저장한 보고서', step:valid.steps[2], isCurrent:() => true, done:value => { refineDone = value; },
  }}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refineDone, true);
  assert.equal(calls.at(-1)[0], '/api/refine');
  assert.equal(JSON.parse(calls.at(-1)[1].body).task, '저장한 보고서');
  assert.equal(JSON.parse(calls.at(-1)[1].body).step.title, '행동 3');
  const savedResult = get('#cards').children;
  await run("requestSteps('/api/refine', {task:'취소된 계정', step:{title:'이전 행동'}}, '이전 행동', () => false)");
  assert.equal(get('#cards').children, savedResult);

  // 모두 완료한 라운드에서만 사용자가 선택해 다음 행동 3개를 요청한다.
  const roundStorage = new Map();
  const roundPage = loadPage({getItem:key => roundStorage.get(key) ?? null,
    setItem:(key, value) => roundStorage.set(key, value), removeItem:key => roundStorage.delete(key)});
  const roundGet = selector => roundPage.document.querySelector(selector);
  const roundCompletion = index => roundGet('#cards').children[index].children[5].children;
  const nextButton = roundGet('#continue-round');
  roundPage.data = valid;
  vm.runInContext("render(data, '이어갈 보고서')", roundPage);
  assert.equal(nextButton.hidden, true);
  const beforeComplete = calls.length;
  for (let i = 0; i < 3; i++) roundCompletion(i)[0].listeners.click();
  assert.equal(calls.length, beforeComplete); // 완료만으로 API를 호출하지 않는다.
  assert.equal(nextButton.hidden, false);
  roundCompletion(2)[2].listeners.click();
  assert.equal(nextButton.hidden, true);
  await nextButton.listeners.click();
  assert.equal(calls.length, beforeComplete);
  roundCompletion(2)[0].listeners.click();
  const completedCards = roundGet('#cards').children;
  nextResponse = () => new Promise(done => { resolve = done; });
  const nextRound = nextButton.listeners.click();
  assert.equal(nextButton.disabled, true);
  assert.match(nextButton.textContent, /찾고 있어요/);
  assert.equal(calls.at(-1)[0], '/api/continue');
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), {task:'이어갈 보고서', completed_steps:valid.steps});
  await nextButton.listeners.click();
  assert.equal(calls.length, beforeComplete + 1);
  resolve({ok:false, json:async () => ({error:{message:'다시 시도해 주세요.'}})});
  await nextRound;
  assert.equal(roundGet('#cards').children, completedCards);
  assert.equal(roundGet('#round-progress').value, 3);
  assert.equal(nextButton.hidden, false);
  assert.equal(nextButton.disabled, false);
  nextResponse = async () => { const error = new Error(); error.name = 'AbortError'; throw error; };
  await nextButton.listeners.click();
  assert.equal(roundGet('#cards').children, completedCards);
  assert.equal(nextButton.disabled, false);
  nextResponse = async () => ok(valid);
  await nextButton.listeners.click();
  assert.notEqual(roundGet('#cards').children, completedCards);
  assert.equal(roundGet('#round-progress').value, 0);
  assert.equal(nextButton.hidden, true);
  assert.match(roundGet('#context').textContent, /완료한 행동 3개에서 이어갈/);
  assert.equal(JSON.parse(roundStorage.get('first-step-walks-v2')).tasks['이어갈 보고서'], 3);
  // 요청 도중 완료 취소 또는 계정 전환 시 오래된 다음 행동을 표시하지 않는다.
  for (let i = 0; i < 3; i++) roundCompletion(i)[0].listeners.click();
  const finalCards = roundGet('#cards').children;
  nextResponse = () => new Promise(done => { resolve = done; });
  const cancelledRound = nextButton.listeners.click();
  roundCompletion(0)[2].listeners.click();
  resolve(ok(valid));
  await cancelledRound;
  assert.equal(roundGet('#cards').children, finalCards);
  roundCompletion(0)[0].listeners.click();
  const changedAccountRound = nextButton.listeners.click();
  roundPage.window.dispatchEvent(new CustomEvent('first-step:account-changed', {detail:{uid:'other', projectId:'test', label:'다른 계정'}}));
  resolve(ok(valid));
  await changedAccountRound;
  assert.equal(roundGet('#cards').children, finalCards);
  assert.equal(nextButton.hidden, true);
  nextResponse = async () => ok(valid);

  // 인증 확인 전에는 브라우저 공통 기록이 잠깐 노출되거나 잘못 기록되지 않는다.
  let failRead = false;
  const accountStorage = {
    getItem:key => { if (failRead) throw new Error('Unavailable'); return storage.get(key) ?? null; },
    setItem:(key, value) => storage.set(key, value),
    removeItem:key => storage.delete(key),
  };
  const accountPage = loadPage(accountStorage, {projectId:'test-project'});
  const accountGet = selector => accountPage.document.querySelector(selector);
  const accountRun = code => vm.runInContext(code, accountPage);
  const switchAccount = (uid, label = uid) => accountPage.window.dispatchEvent(new CustomEvent('first-step:account-changed',
    {detail:{uid, projectId:'test-project', label}}));
  const accountCompletion = () => accountGet('#cards').children[0].children[5].children;
  const accountTotal = () => walkRows(accountPage.document)[0][1];
  const accountKey = uid => `first-step-walks-v3:test-project:${uid}`;
  const preservedGuest = storage.get('first-step-walks-v2');
  accountPage.testResult = valid;
  accountRun("render(testResult, '계정별 보고서')");
  accountGet('#open-walk-history').listeners.click();
  assert.equal(accountTotal(), '0걸음');
  assert.equal(accountCompletion()[0].disabled, true);
  accountCompletion()[0].listeners.click();
  assert.equal(storage.get('first-step-walks-v2'), preservedGuest);
  switchAccount('a', 'a@example.test');
  assert.equal(accountTotal(), '0걸음');
  assert.equal(accountCompletion()[0].disabled, false);
  accountCompletion()[0].listeners.click();
  assert.equal(accountTotal(), '1걸음');
  assert.deepEqual(JSON.parse(storage.get(accountKey('a'))), {previous:0, tasks:{'계정별 보고서':1}});
  switchAccount('b', 'b@example.test');
  assert.equal(accountTotal(), '0걸음');
  assert.equal(accountGet('#round-summary').textContent, '0개 완료 / 3개 · 0%');
  assert.equal(accountCompletion()[2].hidden, true);
  accountCompletion()[2].listeners.click();
  assert.equal(storage.has(accountKey('b')), false);
  accountCompletion()[0].listeners.click();
  assert.equal(accountTotal(), '1걸음');
  switchAccount('b', '새 표시 이름');
  assert.equal(accountCompletion()[0].hidden, true); // 같은 계정의 재알림은 완료 표시를 지우지 않는다.
  switchAccount('a', '<img src=x>');
  assert.equal(accountTotal(), '1걸음');
  assert.equal(accountGet('#walk-account').textContent, '이 브라우저의 계정별 기록: <img src=x>');
  accountPage.window.dispatchEvent({type:'storage', key:accountKey('b'), newValue:null});
  assert.equal(accountTotal(), '1걸음');
  const preservedB = storage.get(accountKey('b'));
  accountPage.window.confirm = () => true;
  accountGet('#clear-walk-history').listeners.click();
  assert.equal(accountTotal(), '0걸음');
  assert.equal(storage.has(accountKey('a')), false);
  assert.equal(storage.get(accountKey('b')), preservedB);
  assert.equal(storage.get('first-step-walks-v2'), preservedGuest);
  switchAccount('b');
  failRead = true;
  switchAccount('c');
  assert.equal(accountTotal(), '0걸음');
  assert.equal(accountGet('#walk-storage-message').hidden, false);
  failRead = false;
  switchAccount(null);
  assert.equal(accountTotal(), '1걸음'); // 기존 공통 기록은 어떤 로그인 계정에도 자동 합산하지 않는다.
  const accountReload = loadPage(accountStorage, {projectId:'test-project'});
  accountReload.window.dispatchEvent(new CustomEvent('first-step:account-changed',
    {detail:{uid:'b', projectId:'test-project', label:'b@example.test'}}));
  accountReload.document.querySelector('#open-walk-history').listeners.click();
  assert.equal(walkRows(accountReload.document)[0][1], '1걸음');

  const moduleText = fs.readFileSync(path.join(__dirname, '../static/resume.js'), 'utf8');
  const {setupResume} = await import('data:text/javascript;base64,' + Buffer.from(moduleText).toString('base64'));
  const syncNodes = new Map();
  const syncDocument = {
    querySelector(selector) {
      if (!syncNodes.has(selector)) syncNodes.set(selector, new Node());
      return syncNodes.get(selector);
    },
  };
  const syncGet = selector => syncDocument.querySelector(selector);
  const syncEvents = new Node();
  let notifiedAccount;
  syncEvents.addEventListener('first-step:account-changed', event => { notifiedAccount = event.detail; });
  syncGet('#resume-panel').dataset.config = '{}';
  syncGet('#sync-settings').querySelector = () => new Node();
  let authChanged, snapshotChanged, snapshotFailed, saved, stopped;
  let serverRecord = null;
  const snapshot = (data = serverRecord, metadata = {fromCache:false, hasPendingWrites:false}) =>
    ({exists:() => Boolean(data), data:() => data, metadata});
  const sdk = {
    initializeApp: () => ({}), getAuth: () => ({}), getFirestore: () => ({}),
    onAuthStateChanged: (_, callback) => { authChanged = callback; },
    doc: (_, collection, uid) => ({collection, uid}),
    onSnapshot: (_, options, callback, failure) => {
      assert.equal(options.includeMetadataChanges, true);
      snapshotChanged = callback;
      snapshotFailed = failure;
      return () => { stopped = true; };
    },
    setDoc: async (ref, step) => { saved = {ref, step}; },
    deleteDoc: async () => { saved = null; },
    runTransaction: async (_, callback) => {
      await callback({get:async () => snapshot(),
        update: (ref, changes) => { serverRecord = {...serverRecord, ...changes}; saved = {ref, step:serverRecord}; },
        delete: () => { saved = serverRecord = null; },
      });
      snapshotChanged(snapshot());
    },
  };
  await setupResume(syncDocument, syncEvents, async () => sdk);
  sdk.GoogleAuthProvider = class {};
  for (const [code, expected] of [
    ['auth/unauthorized-domain', /승인된 도메인/],
    ['auth/operation-not-allowed', /Google 로그인을 켜/],
    ['auth/popup-blocked', /팝업을 차단/],
  ]) {
    sdk.signInWithPopup = async () => { throw {code}; };
    await syncGet('#sync-login').listeners.click();
    assert.match(syncGet('#sync-status').textContent, expected);
    assert.equal(syncGet('#sync-login').disabled, false);
  }
  const saveResume = syncEvents.listeners['first-step:save-resume'];
  saveResume({detail: valid.steps[0]});
  assert.equal(syncGet('#sync-settings').open, true);
  assert.equal(saved, undefined);
  authChanged({uid: 'account-a', displayName:'사용자', email:'a@example.test'});
  assert.equal(notifiedAccount.uid, 'account-a');
  assert.match(syncGet('#sync-account').textContent, /사용자.*a@example.test/);
  await saveResume({detail: {...valid.steps[0], task: '보고서'}});
  await saveResume({detail: {...valid.steps[1], task: '보고서'}});
  assert.deepEqual(saved, {ref:{collection:'firstStepResume', uid:'account-a'}, step:{...valid.steps[1], task:'보고서', completed:false}});
  assert.match(syncGet('#sync-status').textContent, /서버에 저장했어요/);
  const setDoc = sdk.setDoc;
  let finishSave;
  sdk.setDoc = () => new Promise(resolve => { finishSave = resolve; });
  const saving = saveResume({detail:{...valid.steps[1], task:'보고서'}});
  assert.match(syncGet('#sync-status').textContent, /서버에 저장 중/);
  assert.equal(syncGet('#resume-complete').disabled, true);
  finishSave();
  await saving;
  sdk.setDoc = async () => { throw new Error('test-only-private-error'); };
  await saveResume({detail:{...valid.steps[0], task:'보고서'}});
  assert.match(syncGet('#sync-status').textContent, /저장하지 못했어요/);
  assert.doesNotMatch(syncGet('#sync-status').textContent, /test-only-private-error/);
  sdk.setDoc = setDoc;
  sdk.setDoc = async () => { throw {code:'permission-denied'}; };
  await saveResume({detail:{...valid.steps[0], task:'보고서'}});
  assert.match(syncGet('#sync-status').textContent, /firestore.rules.*permission-denied/);
  snapshotChanged(snapshot(null));
  assert.match(syncGet('#sync-status').textContent, /저장 권한이 거부/);
  assert.doesNotMatch(syncGet('#sync-status').textContent, /저장한 행동이 없/);
  sdk.setDoc = setDoc;
  await saveResume({detail:{...valid.steps[1], task:'보고서'}});
  assert.match(syncGet('#sync-status').textContent, /서버에 저장했어요/);
  const oldSnapshot = snapshotChanged;
  serverRecord = saved.step;
  oldSnapshot(snapshot());
  assert.equal(syncGet('#resume-title').textContent, valid.steps[1].title);
  assert.equal(syncGet('#resume-refine').disabled, false);
  assert.match(syncGet('#resume-task').textContent, /보고서/);
  let completedEvents = 0;
  syncEvents.addEventListener('first-step:resume-completed', event => {
    assert.equal(event.detail.task, '보고서'); completedEvents++;
  });
  await syncGet('#resume-complete').listeners.click();
  await syncGet('#resume-complete').listeners.click();
  assert.equal(completedEvents, 1);
  assert.equal(serverRecord.completed, true);
  assert.equal(syncGet('#resume-complete').hidden, true);
  let selected;
  syncEvents.addEventListener('first-step:refine-resume', event => {
    selected = event.detail;
    assert.equal(selected.isCurrent(), true);
    selected.done(true);
  });
  await syncGet('#resume-refine').listeners.click();
  assert.deepEqual(selected.step, valid.steps[1]);
  assert.equal(selected.task, '보고서');
  assert.match(syncGet('#sync-status').textContent, /다시 저장/);
  syncEvents.addEventListener('first-step:refine-resume', event => event.detail.done(false));
  await syncGet('#resume-refine').listeners.click();
  assert.equal(syncGet('#resume-card').hidden, false);
  assert.equal(syncGet('#resume-refine').disabled, false);
  assert.match(syncGet('#sync-status').textContent, /표시하지 못했어요/);
  // 원래 할 일이 없는 기존 저장 행동도 완료하거나 할 일을 연결할 수 있다.
  serverRecord = {...valid.steps[0]};
  snapshotChanged(snapshot());
  assert.equal(syncGet('#resume-legacy').hidden, false);
  assert.equal(syncGet('#resume-refine').disabled, true);
  syncGet('#resume-task-input').value = ' ';
  await syncGet('#resume-link-task').listeners.click();
  assert.equal(serverRecord.task, undefined);
  syncGet('#resume-task-input').value = '이전 보고서';
  await syncGet('#resume-link-task').listeners.click();
  assert.equal(serverRecord.task, '이전 보고서');
  assert.equal(syncGet('#resume-refine').disabled, false);
  // 다른 기기의 완료를 감지하면 중복 기록하지 않는다.
  serverRecord = {...serverRecord, completed:true};
  await syncGet('#resume-complete').listeners.click();
  assert.equal(completedEvents, 1);
  assert.match(syncGet('#sync-status').textContent, /저장한 행동이 바뀌었거나/);
  snapshotChanged(snapshot());
  snapshotChanged(snapshot(serverRecord, {fromCache:true, hasPendingWrites:false}));
  assert.equal(syncGet('#resume-refine').disabled, true);
  assert.match(syncGet('#sync-status').textContent, /저장한 행동이 바뀌었거나/);
  await saveResume({detail:{...valid.steps[0], task:'이전 보고서'}});
  snapshotChanged(snapshot(serverRecord, {fromCache:true, hasPendingWrites:false}));
  assert.match(syncGet('#sync-status').textContent, /서버 연결/);
  snapshotChanged(snapshot());
  await syncGet('#resume-remove').listeners.click();
  assert.equal(saved, null);
  assert.equal(syncGet('#resume-card').hidden, true);
  // 계정 전환 뒤에는 이전 구독이나 완료 콜백이 새 계정 상태를 바꾸지 않는다.
  authChanged({uid:'account-b', email:'b@example.test'});
  oldSnapshot(snapshot({...valid.steps[0], task:'다른 할 일'}));
  assert.equal(syncGet('#resume-card').hidden, true);
  assert.match(syncGet('#sync-account').textContent, /b@example.test/);
  assert.equal(selected.isCurrent(), false);
  authChanged(null);
  assert.equal(notifiedAccount.uid, null);
  oldSnapshot(snapshot(valid.steps[1]));
  assert.equal(stopped, true);
  assert.equal(syncGet('#resume-card').hidden, true);
  assert.match(syncGet('#sync-account').textContent, /로그인하지 않았어요/);
  console.log('PASS: resume task payload, completion transaction, legacy task linking, refine success/failure, pending/failed save, cache state, account isolation, deletion and sign-out');
  console.log('PASS: JS syntax, prominent support links, blank/long input, duplicate prevention, loading, 3-card render, safe text, refine/advance targets, both difficulty buttons, API errors, invalid response, timeout recovery');
  console.log('PASS: history popup, horizontal bars, reflection and skip without counting, confirmed deletion of both history versions, completion reset, reload, empty and unavailable storage');
  console.log('PASS: account-scoped history, auth startup privacy, switch and logout, isolated deletion, completion reset, failed storage isolation, reload and auth notifications');
  console.log('PASS: round continuation visibility, all three completed actions, duplicate prevention, failure/timeout recovery, progress reset, history retention and stale response rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
