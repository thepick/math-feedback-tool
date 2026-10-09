const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).join('\n').replace(/\binit\(\);\s*$/, '');

function app({ cachedUser, cachedToken, expired = false, configured = true, loaded = true } = {}) {
  const storage = new Map([
    ['mft_students', '["Student A"]'],
    ['mft_portfolio', '{"Student A":{"sessions":[{"score":80}]}}'],
    ['mft_settings', JSON.stringify({ googleClientId: configured ? 'existing-client.apps.googleusercontent.com' : '' })],
  ]);
  if (cachedUser) storage.set('mft_google_user', JSON.stringify(cachedUser));
  if (cachedToken) {
    storage.set('mft_drive_access_token', cachedToken);
    storage.set('mft_drive_access_token_expiry', String(Date.now() + (expired ? -1000 : 3600000)));
  }
  if (cachedUser || cachedToken) storage.set('mft_google_connected', 'true');
  const elements = new Map();
  const elementsFor = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {} }, value: '', textContent: '' });
    return elements.get(id);
  };
  const calls = { requests: [], reads: [], writes: [], timers: [] };
  const context = {
    console, Date, Number, JSON, Set, Map, URL, Blob,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    document: { getElementById: elementsFor },
    location: { hash: '', href: 'https://thepick.github.io/math-feedback-tool/', origin: 'https://thepick.github.io', pathname: '/math-feedback-tool/' },
    setTimeout: (...args) => calls.timers.push(args), clearTimeout() {},
    setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => {
      calls.reads.push({ url, options });
      return { ok: true, json: async () => ({ id: 'account-a', email: 'a@example.com', name: 'Teacher A' }) };
    },
  };
  if (loaded) context.google = { accounts: { oauth2: {
    initTokenClient: config => {
      calls.config = config;
      return { requestAccessToken: options => calls.requests.push(options) };
    },
    hasGrantedAllScopes: (response, ...scopes) => scopes.every(scope => response.scope.split(' ').includes(scope)),
  } } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  context.loadSettingsFromLocalStorage();
  context.loadSettingsFromDrive = () => calls.reads.push('settings');
  context.loadPortfolioFromDrive = () => calls.reads.push('portfolio');
  context.ensureDriveFolder = () => calls.writes.push('folder access');
  return { context, storage, calls, elements };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = context => ({ access_token: 'new-token', expires_in: 3600, scope: context.GOOGLE_DRIVE_SCOPE });
const user = { id: 'account-a', email: 'a@example.com', name: 'Teacher A' };
const preserved = storage => [storage.get('mft_students'), storage.get('mft_portfolio'), storage.get('mft_settings')];

test('GIS uses the saved client and same scopes without navigating away', async () => {
  const { context, storage, calls } = app();
  const before = preserved(storage);
  context.handleGoogleSignIn();
  assert.equal(calls.config.client_id, 'existing-client.apps.googleusercontent.com');
  assert.equal(calls.config.scope, 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
  assert.equal(context.location.href, 'https://thepick.github.io/math-feedback-tool/');
  calls.config.callback(response(context));
  await flush();
  assert.equal(storage.get('mft_drive_access_token'), 'new-token');
  assert.equal(storage.get('mft_google_connected'), 'true');
  assert.equal(context.googleUser.id, user.id);
  assert.equal(calls.reads[0].options.headers.Authorization, 'Bearer new-token');
  assert.ok(calls.reads.includes('settings') && calls.reads.includes('portfolio'));
  assert.deepEqual(preserved(storage), before);
});

test('existing valid token and cached account remain connected', () => {
  const { context, calls } = app({ cachedUser: user, cachedToken: 'old-token' });
  context.restoreGoogleStateFromStorage();
  assert.equal(context.driveAccessToken, 'old-token');
  assert.equal(context.googleUser.id, user.id);
  assert.equal(calls.requests.length, 0);
});

test('expired connection does not redirect or erase progress and offers reconnect', () => {
  const { context, storage, calls, elements } = app({ cachedUser: user, cachedToken: 'old-token', expired: true });
  const before = preserved(storage);
  context.restoreGoogleStateFromStorage();
  context.manualSaveToDrive();
  assert.equal(context.driveAccessToken, null);
  assert.equal(calls.timers.length, 0);
  assert.equal(calls.requests.length, 0);
  assert.equal(calls.writes.length, 0);
  assert.equal(elements.get('googleSignInBtn').style.display, '');
  assert.deepEqual(preserved(storage), before);
});

test('expiry during an open session prevents automatic writes', () => {
  const { context, storage, calls } = app({ cachedUser: user, cachedToken: 'old-token' });
  context.restoreGoogleStateFromStorage();
  storage.set('mft_drive_access_token_expiry', '1');
  context.saveSettingsToDrive();
  assert.equal(context.driveAccessToken, null);
  assert.equal(calls.writes.length, 0);
});

for (const failure of ['denied', 'partial scopes', 'popup closed', 'invalid expiry']) {
  test(failure + ' preserves local progress without starting Drive access', async () => {
    const { context, storage, calls, elements } = app();
    const before = preserved(storage);
    context.handleGoogleSignIn();
    if (failure === 'denied') calls.config.callback({ error: 'access_denied' });
    if (failure === 'partial scopes') calls.config.callback({ ...response(context), scope: 'https://www.googleapis.com/auth/userinfo.email' });
    if (failure === 'popup closed') calls.config.error_callback({ type: 'popup_closed' });
    if (failure === 'invalid expiry') calls.config.callback({ ...response(context), expires_in: 'invalid' });
    await flush();
    assert.equal(context.googleAuthPending, false);
    assert.equal(context.driveAccessToken, null);
    assert.equal(calls.reads.length, 0);
    assert.equal(calls.writes.length, 0);
    assert.ok(elements.get('driveSyncText').textContent);
    assert.deepEqual(preserved(storage), before);
    context.handleGoogleSignIn();
    assert.equal(calls.requests.length, 2);
  });
}

test('account mismatch cannot load or save another account over the roster', async () => {
  const { context, storage, calls, elements } = app({ cachedUser: user });
  context.fetch = async () => ({ ok: true, json: async () => ({ id: 'account-b', email: 'b@example.com' }) });
  const before = preserved(storage);
  context.handleGoogleSignIn();
  calls.config.callback(response(context));
  await flush();
  assert.equal(context.driveAccessToken, null);
  assert.equal(calls.reads.length, 0);
  assert.equal(elements.get('driveSyncText').textContent, 'Sign out before switching Google accounts');
  assert.deepEqual(preserved(storage), before);
});

test('failed account verification never loads Drive data', async () => {
  const { context, calls } = app();
  context.fetch = async () => ({ ok: false });
  context.handleGoogleSignIn();
  calls.config.callback(response(context));
  await flush();
  assert.equal(context.driveAccessToken, null);
  assert.equal(context.googleAuthPending, false);
  assert.equal(calls.reads.length, 0);
});

test('double click starts one request and sign-out ignores its late result', async () => {
  const { context, storage, calls } = app();
  const before = preserved(storage);
  context.handleGoogleSignIn();
  context.handleGoogleSignIn();
  assert.equal(calls.requests.length, 1);
  context.handleGoogleSignOut();
  calls.config.callback(response(context));
  await flush();
  assert.equal(context.driveAccessToken, null);
  assert.equal(calls.reads.length, 0);
  assert.deepEqual(preserved(storage), before);
});

test('sign-out while account verification is pending ignores the late response', async () => {
  const { context, storage, calls } = app();
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  context.handleGoogleSignIn();
  calls.config.callback(response(context));
  context.handleGoogleSignOut();
  finish({ ok: true, json: async () => user });
  await flush();
  assert.equal(storage.get('mft_google_connected'), undefined);
  assert.equal(context.driveAccessToken, null);
  assert.equal(calls.reads.length, 0);
});

test('legacy redirect return can still finish during rollout', () => {
  const { context, storage } = app();
  context.location.hash = '#access_token=old-return-token&expires_in=3600';
  context.checkHashForOAuthTokens();
  assert.equal(storage.get('mft_drive_access_token'), 'old-return-token');
  assert.equal(context.location.hash, '');
});

for (const options of [{ configured: false }, { loaded: false }]) {
  test('missing client or unavailable GIS leaves local work intact ' + JSON.stringify(options), () => {
    const { context, storage, calls } = app(options);
    const before = preserved(storage);
    context.handleGoogleSignIn();
    assert.equal(context.googleAuthPending, false);
    assert.equal(calls.requests.length, 0);
    assert.deepEqual(preserved(storage), before);
  });
}
