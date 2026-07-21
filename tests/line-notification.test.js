const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createContext(initialProperties = {}) {
  const properties = new Map(Object.entries(initialProperties));
  const sheets = new Map();
  const fetchCalls = [];

  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
    insertSheet(name) {
      const rows = [];
      const sheet = {
        rows,
        appendRow(row) {
          rows.push([...row]);
        }
      };
      sheets.set(name, sheet);
      return sheet;
    }
  };

  const context = vm.createContext({
    console,
    JSON,
    Math,
    Date,
    Error,
    String,
    Boolean,
    Number,
    Array,
    isFinite,
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return spreadsheet;
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return properties.has(key) ? properties.get(key) : null;
          }
        };
      }
    },
    UrlFetchApp: {
      fetch(url, options) {
        fetchCalls.push({ url, options });
        return {
          getResponseCode() {
            return 200;
          },
          getContentText() {
            return '{}';
          }
        };
      }
    }
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'code.gs' });
  return { context, fetchCalls, sheets };
}

function attendanceRecord(type = 'IN') {
  return {
    requestId: '123e4567-e89b-12d3-a456-426614174000',
    name: 'สมชาย ใจดี',
    attendanceType: type,
    time: '08:30:15',
    date: '21/7/2026',
    mapLink: 'https://www.google.com/maps?q=13.7563,100.5018',
    verificationStatus: 'CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED'
  };
}

test('LINE notification defaults to DRY_RUN and performs no external request', () => {
  const { context, fetchCalls, sheets } = createContext();

  const result = context.sendLineAttendanceNotification_(attendanceRecord());

  assert.equal(result.status, 'DRY_RUN');
  assert.equal(fetchCalls.length, 0);
  assert.equal(sheets.get('AuditLog').rows.at(-1)[4], 'DRY_RUN');
});

test('LINE notification requires explicit approval when DRY_RUN is disabled', () => {
  const { context, fetchCalls } = createContext({
    LINE_DRY_RUN: 'false',
    LINE_SEND_APPROVED: 'false',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    LINE_TARGET_ID: 'C123'
  });

  const result = context.sendLineAttendanceNotification_(attendanceRecord('OUT'));

  assert.equal(result.status, 'BLOCKED_APPROVAL_REQUIRED');
  assert.equal(fetchCalls.length, 0);
});

test('approved LINE notification sends a push message without exposing config', () => {
  const { context, fetchCalls } = createContext({
    LINE_DRY_RUN: 'false',
    LINE_SEND_APPROVED: 'true',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    LINE_TARGET_ID: 'C123'
  });

  const result = context.sendLineAttendanceNotification_(attendanceRecord('OUT'));

  assert.equal(result.status, 'SENT');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(fetchCalls[0].options.headers['X-Line-Retry-Key'], attendanceRecord().requestId);

  const payload = JSON.parse(fetchCalls[0].options.payload);
  assert.equal(payload.to, 'C123');
  assert.match(payload.messages[0].text, /แจ้งสแกนออกงาน/);
  assert.match(payload.messages[0].text, /สมชาย ใจดี/);
  assert.match(payload.messages[0].text, /แผนที่:/);

});
