const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function toUnsignedBytes(value) {
  return Array.from(value, byte => byte < 0 ? byte + 256 : byte);
}

function createAuthContext(initialProperties = {}) {
  const properties = new Map(Object.entries(initialProperties));
  const cache = new Map();
  const sheets = new Map();
  let uuidCounter = 0;

  const scriptProperties = {
    getProperty(key) {
      return properties.has(key) ? properties.get(key) : null;
    },
    setProperties(values) {
      Object.entries(values).forEach(([key, value]) => properties.set(key, String(value)));
      return this;
    },
    setProperty(key, value) {
      properties.set(key, String(value));
      return this;
    },
    deleteProperty(key) {
      properties.delete(key);
      return this;
    }
  };

  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
    insertSheet(name) {
      const sheet = {
        rows: [],
        appendRow(row) {
          this.rows.push([...row]);
        },
        getLastRow() {
          return this.rows.length;
        }
      };
      sheets.set(name, sheet);
      return sheet;
    }
  };

  const context = vm.createContext({
    JSON,
    Math,
    Date,
    Error,
    String,
    Boolean,
    Number,
    Array,
    isFinite,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    CacheService: {
      getScriptCache() {
        return {
          get: key => cache.get(key) ?? null,
          put: (key, value) => cache.set(key, String(value)),
          remove: key => cache.delete(key)
        };
      }
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()),
      computeHmacSha256Signature: (value, secret) => Array.from(
        crypto.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest()
      ),
      base64EncodeWebSafe: value => {
        const buffer = Array.isArray(value) || ArrayBuffer.isView(value)
          ? Buffer.from(toUnsignedBytes(value))
          : Buffer.from(String(value), 'utf8');
        return buffer.toString('base64url');
      },
      base64DecodeWebSafe: value => Array.from(Buffer.from(String(value), 'base64url')),
      newBlob: bytes => ({
        getDataAsString: () => Buffer.from(toUnsignedBytes(bytes)).toString('utf8')
      })
    }
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'code.gs' });
  return { context, properties, cache, sheets };
}

test('initializeAdminLogin hashes and deletes the bootstrap password', () => {
  const { context, properties, sheets } = createAuthContext({
    ADMIN_USERNAME: 'admin',
    ADMIN_BOOTSTRAP_PASSWORD: 'a-strong-password-123'
  });

  const message = context.initializeAdminLogin();

  assert.match(message, /ตั้งค่าผู้ดูแลเรียบร้อย/);
  assert.equal(properties.has('ADMIN_BOOTSTRAP_PASSWORD'), false);
  assert.ok(properties.get('ADMIN_PASSWORD_SALT'));
  assert.ok(properties.get('ADMIN_PASSWORD_HASH'));
  assert.ok(properties.get('AUTH_SESSION_SECRET'));
  assert.notEqual(properties.get('ADMIN_PASSWORD_HASH'), 'a-strong-password-123');
  assert.equal(sheets.get('AuditLog').rows.at(-1)[1], 'ADMIN_CREDENTIALS_INITIALIZED');
});

test('valid admin login creates a signed session for protected operations', () => {
  const { context } = createAuthContext({
    ADMIN_USERNAME: 'admin',
    ADMIN_BOOTSTRAP_PASSWORD: 'a-strong-password-123'
  });
  context.initializeAdminLogin();

  const login = context.loginAdmin('admin', 'a-strong-password-123');
  const validation = context.validateAdminSession(login.sessionToken);
  const lineStatus = context.getLineBotStatus(login.sessionToken);

  assert.equal(login.success, true);
  assert.equal(login.username, 'admin');
  assert.match(login.sessionToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(validation.authenticated, true);
  assert.equal(validation.username, 'admin');
  assert.deepEqual(JSON.parse(JSON.stringify(lineStatus)), {
    success: true,
    configured: false,
    dryRun: true,
    approved: false
  });
});

test('protected admin operations reject a missing session', () => {
  const { context } = createAuthContext();

  assert.throws(() => context.getLineBotStatus(''), /เข้าสู่ระบบผู้ดูแล/);
  assert.throws(() => context.saveConfig(13.7, 100.5, 0.1, ''), /เข้าสู่ระบบผู้ดูแล/);
  assert.throws(() => context.setRegistrationMode(true, 30, ''), /เข้าสู่ระบบผู้ดูแล/);
});

test('self registration is available only while an admin-opened window is active', () => {
  const { context, sheets } = createAuthContext({
    ADMIN_USERNAME: 'admin',
    ADMIN_BOOTSTRAP_PASSWORD: 'a-strong-password-123'
  });
  context.initializeAdminLogin();

  assert.equal(context.getRegistrationStatus().enabled, false);
  assert.throws(() => context.registerUser('Employee', [0.1]), /ปิดรับลงทะเบียน/);

  const login = context.loginAdmin('admin', 'a-strong-password-123');
  assert.throws(
    () => context.setRegistrationMode(true, 481, login.sessionToken),
    /5–480 นาที/
  );
  const opened = context.setRegistrationMode(true, 30, login.sessionToken);
  assert.equal(opened.enabled, true);
  assert.ok(opened.expiresAt);
  assert.equal(context.getRegistrationStatus().enabled, true);

  const registered = context.registerUser('Employee', [0.1, 0.2]);
  assert.equal(registered.success, true);
  assert.equal(sheets.get('Users').rows.length, 2);
  assert.equal(sheets.get('AuditLog').rows.at(-1)[1], 'USER_REGISTERED');

  context.setRegistrationMode(false, 30, login.sessionToken);
  assert.equal(context.getRegistrationStatus().enabled, false);
  assert.throws(() => context.registerUser('Another employee', [0.2]), /ปิดรับลงทะเบียน/);
});

test('admin login is rate limited after repeated failures', () => {
  const { context } = createAuthContext({
    ADMIN_USERNAME: 'admin',
    ADMIN_BOOTSTRAP_PASSWORD: 'a-strong-password-123'
  });
  context.initializeAdminLogin();

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.throws(() => context.loginAdmin('admin', 'wrong-password'), /ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง/);
  }
  assert.throws(() => context.loginAdmin('admin', 'wrong-password'), /พยายามเข้าสู่ระบบเกินกำหนด/);
});
