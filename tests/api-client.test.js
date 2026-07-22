const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createApiClient(fetchImplementation, savedUrl = '') {
  const browserWindow = {
    AbortController,
    URL,
    clearTimeout,
    fetch: fetchImplementation,
    localStorage: {
      getItem: key => key === 'gasApiUrl' ? savedUrl : null
    },
    setTimeout
  };
  const context = vm.createContext({
    AbortController,
    Error,
    JSON,
    Number,
    Promise,
    String,
    URL,
    window: browserWindow
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'api-client.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'js/api-client.js' });
  return browserWindow.AttendanceApi;
}

test('configured Apps Script URL overrides a stale saved URL', () => {
  const client = createApiClient(async () => {}, 'https://example.netlify.app/');
  const configured = 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec';

  assert.equal(client.getApiUrl(configured), configured);
});

test('GET request retries an HTML response and returns JSON', async () => {
  let requestCount = 0;
  const client = createApiClient(async () => {
    requestCount++;
    if (requestCount === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => '<!DOCTYPE html><title>Temporary error</title>'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '{"success":true}'
    };
  });

  const result = await client.requestJson('https://script.google.com/macros/s/ID/exec');

  assert.equal(result.success, true);
  assert.equal(requestCount, 2);
});

test('HTML response becomes a user-friendly error instead of a JSON syntax error', async () => {
  const client = createApiClient(async () => ({
    ok: true,
    status: 200,
    text: async () => '<!DOCTYPE html><title>Sign in</title>'
  }));

  await assert.rejects(
    client.requestJson('https://script.google.com/macros/s/ID/exec', {}, { retries: 0 }),
    /หน้าเว็บแทนข้อมูล/
  );
});
