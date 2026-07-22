const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');

for (const fileName of ['index.html', 'register.html', 'scan.html', 'config.html']) {
  test(`${fileName} inline JavaScript has valid syntax`, () => {
    const html = fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .filter(match => !/\ssrc\s*=/.test(match[0]));

    assert.ok(scripts.length > 0, `ไม่พบ inline script ใน ${fileName}`);
    scripts.forEach((match, index) => {
      new vm.Script(match[1], { filename: `${fileName}:inline-script-${index + 1}` });
    });
  });
}

test('shared API client has valid JavaScript syntax', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'js', 'api-client.js'), 'utf8');
  new vm.Script(source, { filename: 'js/api-client.js' });
});

test('scan page offers explicit check-in and check-out actions', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'scan.html'), 'utf8');
  assert.match(html, /confirmAttendance\('IN'\)/);
  assert.match(html, /confirmAttendance\('OUT'\)/);
  assert.match(html, /faceDistance:\s*currentFaceDistance/);
  assert.match(html, /requestId:\s*currentRequestId/);
  assert.match(html, /tinyFaceDetector\.loadFromUri/);
  assert.match(html, /setTimeout\(runScanIteration/);
  assert.doesNotMatch(html, /setInterval\(async/);
  assert.match(html, /AttendanceApi\.requestJson/);
});

test('config page shows safe LINE Bot configuration status', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'config.html'), 'utf8');
  assert.match(html, /action:\s*'getLineBotStatus'/);
  assert.match(html, /action:\s*'loginAdmin'/);
  assert.match(html, /action:\s*'validateAdminSession'/);
  assert.match(html, /sessionStorage\.setItem\(AUTH_TOKEN_KEY/);
  assert.doesNotMatch(html, /LINE_CHANNEL_ACCESS_TOKEN\s*=/);
});

test('admin can control and share the employee registration window', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'config.html'), 'utf8');
  assert.match(html, /action:\s*'setRegistrationMode'/);
  assert.match(html, /actionUrl\(apiUrl,\s*'getRegistrationStatus'\)/);
  assert.match(html, /id="registrationUrl"/);
  assert.match(html, /copyRegistrationLink/);
});

test('registration page is no-login and checks the public registration window', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'register.html'), 'utf8');
  assert.match(html, /actionUrl\(API_URL,\s*'getRegistrationStatus'\)/);
  assert.match(html, /action:\s*'registerUser'/);
  assert.doesNotMatch(html, /validateAdminSession/);
  assert.doesNotMatch(html, /adminSessionToken/);
  assert.doesNotMatch(html, /returnTo=register\.html/);
});
