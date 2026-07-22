const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class RangeMock {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValue(value) {
    this.setValues([[value]]);
    return this;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset)
      )
    );
  }

  setValues(values) {
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset++) {
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset++) {
        this.sheet.setCell(
          this.row + rowOffset,
          this.column + columnOffset,
          values[rowOffset][columnOffset]
        );
      }
    }
    return this;
  }
}

class SheetMock {
  constructor(rows = []) {
    this.rows = rows.map(row => [...row]);
  }

  appendRow(row) {
    this.rows.push([...row]);
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getCell(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

  getRange(rowOrA1, column, rowCount, columnCount) {
    if (typeof rowOrA1 === 'string') {
      const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(rowOrA1);
      if (!match) throw new Error(`Unsupported A1 range: ${rowOrA1}`);
      const startColumn = columnNumber(match[1]);
      const startRow = Number(match[2]);
      const endColumn = match[3] ? columnNumber(match[3]) : startColumn;
      const endRow = match[4] ? Number(match[4]) : startRow;
      return new RangeMock(this, startRow, startColumn, endRow - startRow + 1, endColumn - startColumn + 1);
    }
    return new RangeMock(this, rowOrA1, column, rowCount || 1, columnCount || 1);
  }

  getDataRange() {
    return new RangeMock(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  clearContents() {
    this.rows.length = 0;
  }

  setColumnWidth() {}
}

function columnNumber(letters) {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function createAttendanceContext() {
  const sheets = new Map([
    ['Users', new SheetMock([
      ['Name', 'Face Descriptor', 'Registered At'],
      ['สมชาย ใจดี', '[0.1,0.2,0.3]', '2026-07-21T00:00:00.000Z']
    ])],
    ['Config', new SheetMock([
      ['Parameter', 'Value'],
      ['Target Latitude', 13.7563],
      ['Target Longitude', 100.5018],
      ['Allowed Radius (KM)', 0.1]
    ])]
  ]);
  const properties = new Map();
  const cache = new Map();
  let uuidCounter = 0;

  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
    insertSheet(name) {
      const sheet = new SheetMock();
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) ?? null
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.get(key) ?? null,
        put: (key, value) => cache.set(key, String(value)),
        remove: key => cache.delete(key)
      })
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
      formatDate: (_date, _zone, pattern) => pattern === 'd/M/yyyy' ? '21/7/2026' : '08:30:15'
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    UrlFetchApp: {
      fetch: () => { throw new Error('DRY_RUN must not call LINE'); }
    }
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'code.gs' });
  return { context, sheets };
}

test('logAttendance writes verified IN record and records DRY_RUN LINE status', () => {
  const { context, sheets } = createAttendanceContext();
  const requestId = '123e4567-e89b-12d3-a456-426614174000';

  const result = context.logAttendance('สมชาย ใจดี', 13.7563, 100.5018, 'IN', 0.2, requestId);

  assert.equal(result.success, true);
  assert.equal(result.attendanceType, 'IN');
  assert.equal(result.notificationStatus, 'DRY_RUN');

  const attendanceRows = sheets.get('Attendance').rows;
  assert.equal(attendanceRows.length, 2);
  assert.deepEqual(attendanceRows[0], [
    'Request ID', 'Name', 'Type', 'Time', 'Date', 'Timestamp ISO',
    'Latitude', 'Longitude', 'Google Map Link', 'Source', 'Verification Status', 'LINE Status'
  ]);
  assert.equal(attendanceRows[1][0], requestId);
  assert.equal(attendanceRows[1][2], 'IN');
  assert.equal(attendanceRows[1][9], 'FACE_SCAN_WEB');
  assert.equal(attendanceRows[1][10], 'CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED');
  assert.equal(attendanceRows[1][11], 'DRY_RUN');
});

test('logAttendance rejects a location outside the configured radius', () => {
  const { context, sheets } = createAttendanceContext();

  assert.throws(
    () => context.logAttendance(
      'สมชาย ใจดี',
      14.7563,
      101.5018,
      'OUT',
      0.2,
      '223e4567-e89b-12d3-a456-426614174000'
    ),
    /อยู่นอกพื้นที่ลงเวลาที่กำหนด/
  );
  assert.equal(sheets.has('Attendance'), false);
});

test('logAttendance treats the same request ID as idempotent', () => {
  const { context, sheets } = createAttendanceContext();
  const requestId = '323e4567-e89b-12d3-a456-426614174000';

  context.logAttendance('สมชาย ใจดี', 13.7563, 100.5018, 'OUT', 0.2, requestId);
  const duplicate = context.logAttendance('สมชาย ใจดี', 13.7563, 100.5018, 'OUT', 0.2, requestId);

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.attendanceType, 'OUT');
  assert.equal(sheets.get('Attendance').rows.length, 2);
});
