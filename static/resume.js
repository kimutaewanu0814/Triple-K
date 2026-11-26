async function loadFirebase() {
  const base = 'https://www.gstatic.com/firebasejs/13.3.0';
  const modules = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  return Object.assign({}, ...modules);
}

export async function setupResume(document, events, load = loadFirebase) {
  const get = selector => document.querySelector(selector);
  const config = JSON.parse(get('#resume-panel').dataset.config);
  const settings = get('#sync-settings');
  const login = get('#sync-login');
  const logout = get('#sync-logout');
  const status = get('#sync-status');
  const card = get('#resume-card');
  const remove = get('#resume-remove');
  const complete = get('#resume-complete');
  const refine = get('#resume-refine');
  const linkTask = get('#resume-link-task');
  const account = get('#sync-account');
  let firebase;
  let auth;
  let db;
  let reference;
  let unsubscribe;
  let pending = false;
  let unavailable = false;
  let record = null;
  let aiBusy = false;
  let ready = false;
  let operationError = '';
  function notifyAccount(user) {
    events.dispatchEvent(new CustomEvent('first-step:account-changed', {detail:{
      uid:user?.uid ?? null, projectId:config?.projectId ?? '',
      label:user?.email || user?.displayName || user?.uid || '',
    }}));
  }

  const validText = (value, max) => typeof value === 'string' && value.trim() && Array.from(value).length <= max;
  function validRecord(value) {
    return value && validText(value.title, 120) && validText(value.description, 700) &&
      validText(value.completion_criteria, 400) && Number.isInteger(value.minutes) &&
      value.minutes >= 2 && value.minutes <= 5 &&
      (value.task === undefined || validText(value.task, 1000)) &&
      (value.completed === undefined || typeof value.completed === 'boolean');
  }
  const sameRecord = (a, b) => a && b && ['title', 'description', 'minutes', 'completion_criteria', 'task', 'completed']
    .every(key => a[key] === b[key]);
  const stepOnly = value => ({title:value.title, description:value.description,
    minutes:value.minutes, completion_criteria:value.completion_criteria});
  function updateButtons() {
    login.disabled = logout.disabled = pending;
    remove.disabled = complete.disabled = linkTask.disabled = pending || aiBusy || !ready;
    refine.disabled = pending || aiBusy || !ready || !record?.task;
    complete.hidden = Boolean(record?.completed);
    get('#resume-completed').hidden = !record?.completed;
  }

  function showStep(step) {
    if (!sameRecord(record, step)) get('#resume-task-input').value = '';
    record = step;
    card.hidden = !step;
    get('#resume-title').textContent = step?.title ?? '';
    get('#resume-description').textContent = step?.description ?? '';
    get('#resume-time').textContent = step ? `약 ${step.minutes}분` : '';
    get('#resume-criterion').textContent = step?.completion_criteria ?? '';
    get('#resume-task').textContent = step?.task ? `원래 할 일: ${step.task}` : '';
    get('#resume-legacy').hidden = !step || Boolean(step.task);
    updateButtons();
  }

  async function run(operation, errorMessage, successMessage = '', loadingMessage = '처리하고 있어요…') {
    if (pending) return;
    const startedAt = reference;
    operationError = '';
    pending = true;
    updateButtons();
    status.textContent = loadingMessage;
    try {
      const result = await operation();
      if (reference === startedAt && result !== false && successMessage) status.textContent = successMessage;
    } catch (error) {
      if (reference !== startedAt) return;
      const messages = {
        'auth/popup-closed-by-user': '로그인 창을 닫았어요.',
        'auth/popup-blocked': '브라우저에서 로그인 팝업을 차단했어요. 이 사이트의 팝업을 허용해 주세요.',
        'auth/unauthorized-domain': '현재 접속 주소가 Firebase 승인된 도메인에 등록되지 않았어요. Authentication → 설정 → 승인된 도메인에서 주소창의 호스트를 추가해 주세요.',
        'auth/operation-not-allowed': 'Firebase에서 Google 로그인을 켜 주세요. Authentication → 로그인 방법 → Google에서 설정할 수 있어요.',
        'auth/configuration-not-found': 'Firebase Authentication 설정을 찾지 못했어요. Firebase Console에서 Authentication을 시작하고 Google 로그인을 켜 주세요.',
        'auth/invalid-api-key': 'Firebase 웹 앱 API 키가 올바르지 않아요. 프로젝트 설정의 웹 앱 설정값과 .env를 확인해 주세요.',
        'auth/app-not-authorized': '이 사이트에서 Firebase 키를 사용할 수 없어요. Firebase 프로젝트와 API 키 제한 설정을 확인해 주세요.',
        'auth/network-request-failed': '로그인 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.',
        'auth/web-storage-unsupported': '로그인에 필요한 브라우저 저장소를 사용할 수 없어요. 사이트 데이터 허용 설정을 확인해 주세요.',
        'permission-denied': '저장 권한이 거부됐어요. Firebase Console의 Firestore Database → Rules에서 변경된 firestore.rules를 반영하고 게시한 뒤 다시 저장해 주세요.',
        'unauthenticated': '로그인 인증을 확인하지 못했어요. 로그아웃한 뒤 다시 로그인해 주세요.',
        'unavailable': '저장 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 저장해 주세요.',
        'failed-precondition': 'Firestore 설정을 확인해 주세요. 기본 데이터베이스가 준비되어 있는지 확인한 뒤 다시 시도해 주세요.',
      };
      const code = error?.code;
      const safeCode = typeof code === 'string' && (/^auth\/[a-z-]+$/.test(code) ||
        ['permission-denied', 'unauthenticated', 'unavailable', 'failed-precondition'].includes(code)) ? ` (${code})` : '';
      operationError = (messages[code] ?? errorMessage) + safeCode;
      status.textContent = operationError;
    } finally {
      pending = false;
      updateButtons();
    }
  }

  events.addEventListener('first-step:save-resume', event => {
    if (!reference) {
      settings.open = true;
      settings.querySelector('summary').focus();
      status.textContent = !config ? '기기 간 동기화가 아직 설정되지 않았어요.'
        : unavailable ? '동기화를 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요.'
        : login.hidden ? '동기화를 준비하는 중이에요. 잠시 후 다시 눌러 주세요.'
        : 'Google로 로그인한 뒤 저장할 행동에서 버튼을 다시 눌러 주세요.';
      return;
    }
    const {task} = event.detail;
    if (!validRecord(event.detail) || !validText(task, 1000)) {
      status.textContent = '저장할 행동과 원래 할 일을 확인하지 못했어요. 행동을 다시 만들어 주세요.';
      return;
    }
    const target = reference;
    return run(() => firebase.setDoc(target, {...stepOnly(event.detail), task, completed:false}),
      '행동을 저장하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
      '서버에 저장했어요. 같은 계정으로 로그인한 다른 기기에서도 볼 수 있어요.',
      '서버에 저장 중이에요. 연결이 끊기면 완료 확인까지 기다려 주세요…');
  });
  login.addEventListener('click', () => run(
    () => firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider()),
    '로그인하지 못했어요. 팝업 허용 여부를 확인하고 다시 시도해 주세요.'));
  logout.addEventListener('click', () => run(() => firebase.signOut(auth), '로그아웃하지 못했어요. 다시 시도해 주세요.'));
  remove.addEventListener('click', () => {
    if (reference && ready && !aiBusy) return changeRecord(null, '저장한 행동을 지웠어요.');
  });

  // 트랜잭션으로 다른 기기에서 교체·완료한 행동을 덮어쓰지 않는다.
  function changeRecord(changes, successMessage, onCommitted = () => {}) {
    const target = reference;
    const expected = record;
    if (!target || !expected || pending || !ready) return;
    return run(async () => {
      await firebase.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(target);
        if (reference !== target || !snapshot.exists() || !sameRecord(snapshot.data(), expected)) {
          throw new Error('changed-record');
        }
        if (changes === null) transaction.delete(target);
        else transaction.update(target, changes);
      });
      if (reference !== target) return false;
      onCommitted(expected);
    }, '저장한 행동이 바뀌었거나 서버에 연결하지 못했어요. 최신 행동과 연결 상태를 확인한 뒤 다시 시도해 주세요.',
    successMessage, '변경 내용을 서버에 저장하고 있어요…');
  }
  complete.addEventListener('click', () => {
    if (aiBusy || record?.completed) return;
    return changeRecord({completed:true}, '완료 표시를 서버에 저장했어요. 걸음 수는 이 브라우저에만 기록돼요.', previous => {
      events.dispatchEvent(new CustomEvent('first-step:resume-completed', {detail:{task:previous.task}}));
    });
  });
  linkTask.addEventListener('click', () => {
    if (aiBusy || record?.task) return;
    const task = get('#resume-task-input').value.trim();
    if (!validText(task, 1000)) {
      status.textContent = '원래 할 일을 1~1,000자로 적어 주세요.';
      return;
    }
    return changeRecord({task}, '원래 할 일을 연결해 서버에 저장했어요. 이제 어려워요를 사용할 수 있어요.');
  });
  refine.addEventListener('click', () => {
    if (pending || aiBusy || !ready || !record?.task) return;
    const target = reference;
    const selected = record;
    return run(() => new Promise(resolve => {
      events.dispatchEvent(new CustomEvent('first-step:refine-resume', {detail:{
        task:selected.task, step:stepOnly(selected),
        isCurrent:() => reference === target && sameRecord(record, selected),
        done: success => {
          if (reference === target) status.textContent = success
            ? '더 쉬운 행동 3개를 아래에 준비했어요. 이어서 할 행동을 고른 뒤 다시 저장해 주세요.'
            : '새 행동을 표시하지 못했어요. 아래 오류 안내와 저장한 행동을 확인해 주세요.';
          resolve(success);
        },
      }}));
    }), '행동을 조정하지 못했어요.', '', `‘${selected.title}’을 더 쉽게 나누고 있어요…`);
  });
  events.addEventListener('first-step:busy', event => { aiBusy = event.detail; updateButtons(); });

  if (!config) {
    notifyAccount(null);
    account.textContent = '기기 간 동기화가 아직 설정되지 않았어요.';
    settings.addEventListener('toggle', () => {
      if (settings.open) status.textContent = '기기 간 동기화가 아직 설정되지 않았어요.';
    });
    return;
  }
  try {
    firebase = await load();
    const app = firebase.initializeApp(config);
    auth = firebase.getAuth(app);
    db = firebase.getFirestore(app);
    firebase.onAuthStateChanged(auth, user => {
      unsubscribe?.();
      reference = null;
      operationError = '';
      ready = false;
      showStep(null);
      login.hidden = Boolean(user);
      logout.hidden = !user;
      account.textContent = user ? `로그인 계정: ${user.displayName ? user.displayName + ' · ' : ''}${user.email || user.uid}` : '로그인하지 않았어요.';
      notifyAccount(user);
      status.textContent = user ? '저장한 행동을 서버에서 확인하고 있어요…' : 'Google로 로그인하면 저장한 행동을 불러올 수 있어요.';
      if (!user) return;
      const ownRecord = firebase.doc(db, 'firstStepResume', user.uid);
      reference = ownRecord;
      unsubscribe = firebase.onSnapshot(ownRecord, {includeMetadataChanges:true}, snapshot => {
        if (reference !== ownRecord) return;
        const data = snapshot.exists() ? snapshot.data() : null;
        ready = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
        if (data && !validRecord(data)) {
          showStep(null);
          status.textContent = '저장한 행동의 형식을 확인하지 못했어요. 원래 카드에서 다시 저장해 주세요.';
          return;
        }
        showStep(data);
        if (pending) return;
        // 실패한 쓰기가 롤백된 빈 스냅샷이 실제 저장 오류 안내를 덮지 않게 한다.
        if (operationError) { status.textContent = operationError; return; }
        status.textContent = snapshot.metadata.hasPendingWrites ? '서버에 저장 중이에요…'
          : snapshot.metadata.fromCache ? '기기에 남아 있는 내용을 표시하고 있어요. 서버 연결 후 저장 상태를 확인할 수 있어요.'
          : data ? '서버에서 저장한 행동을 확인했어요.' : '이 계정에는 저장한 행동이 없어요.';
      }, () => {
        if (reference !== ownRecord) return;
        ready = false;
        showStep(null);
        status.textContent = '저장한 행동을 불러오지 못했어요.';
      });
    });
  } catch {
    unavailable = true;
    account.textContent = '로그인 상태를 확인하지 못했어요.';
    status.textContent = '동기화를 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요.';
  }
}

if (typeof document !== 'undefined') setupResume(document, window);
