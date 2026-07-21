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

test('scan page offers explicit check-in and check-out actions', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'scan.html'), 'utf8');
  assert.match(html, /confirmAttendance\('IN'\)/);
  assert.match(html, /confirmAttendance\('OUT'\)/);
  assert.match(html, /faceDistance:\s*currentFaceDistance/);
  assert.match(html, /requestId:\s*currentRequestId/);
});

test('config page shows safe LINE Bot configuration status', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'config.html'), 'utf8');
  assert.match(html, /action:\s*'getLineBotStatus'/);
  assert.match(html, /action:\s*'loginAdmin'/);
  assert.match(html, /action:\s*'validateAdminSession'/);
  assert.match(html, /sessionStorage\.setItem\(AUTH_TOKEN_KEY/);
  assert.doesNotMatch(html, /LINE_CHANNEL_ACCESS_TOKEN\s*=/);
});

test('registration page requires and forwards an admin session', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'register.html'), 'utf8');
  assert.match(html, /action:\s*'validateAdminSession'/);
  assert.match(html, /sessionToken:\s*adminSessionToken/);
  assert.match(html, /config\.html\?returnTo=register\.html/);
});
