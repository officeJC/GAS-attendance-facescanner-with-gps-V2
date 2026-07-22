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

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row + rowOffset - 1]?.[this.column + columnOffset - 1] ?? ''
      )
    );
  }
}

class SheetMock {
  constructor(rows) {
    this.rows = rows.map(row => [...row]);
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  }

  getDataRange() {
    return new RangeMock(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
}

function formatBangkok(dateValue, timeZoneOrPattern, maybePattern) {
  const pattern = maybePattern || timeZoneOrPattern;
  const date = new Date(dateValue);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value])
  );
  if (pattern === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (pattern === 'HH:mm:ss') return `${parts.hour}:${parts.minute}:${parts.second}`;
  if (pattern === 'd') return String(Number(parts.day));
  if (pattern === 'M') return String(Number(parts.month));
  if (pattern === 'yyyy') return parts.year;
  if (pattern === 'd/M/yyyy') return `${Number(parts.day)}/${Number(parts.month)}/${parts.year}`;
  throw new Error(`Unsupported date pattern: ${pattern}`);
}

function attendanceRow(name, type, timestampIso, source = 'FACE_SCAN_WEB', verificationStatus = 'CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED') {
  return [
    `${name}-${type}-${timestampIso}`,
    name,
    type,
    formatBangkok(timestampIso, 'HH:mm:ss'),
    formatBangkok(timestampIso, 'd/M/yyyy'),
    timestampIso,
    13.7563,
    100.5018,
    'https://www.google.com/maps?q=13.7563,100.5018',
    source,
    verificationStatus,
    'DRY_RUN',
    ''
  ];
}

function createDashboardContext(extraAttendanceRows = []) {
  const sheets = new Map([
    ['Users', new SheetMock([
      ['Name', 'Face Descriptor', 'Registered At', 'Active'],
      ['สมชาย ใจดี', '[0.1,0.2]', '2020-07-01T03:00:00.000Z', true],
      ['สมหญิง ใจงาม', '[0.3,0.4]', '2020-07-01T03:00:00.000Z', true]
    ])],
    ['Attendance', new SheetMock([
      [
        'Request ID', 'Name', 'Type', 'Time', 'Date', 'Timestamp ISO',
        'Latitude', 'Longitude', 'Google Map Link', 'Source', 'Verification Status', 'LINE Status',
        'Work Duration'
      ],
      ...extraAttendanceRows
    ])]
  ]);
  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
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
    Utilities: { formatDate: formatBangkok }
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'code.gs' });
  context.requireAdminSession_ = sessionToken => {
    if (sessionToken !== 'valid-session') throw new Error('ไม่มีสิทธิ์ใช้งานหรือ Session หมดอายุ');
    return { sub: 'admin' };
  };
  return context;
}

test('dashboard calculates baseline, late, early leave, and no-data day off', () => {
  const context = createDashboardContext([
    attendanceRow('สมชาย ใจดี', 'IN', '2020-07-20T01:45:00.000Z'),
    attendanceRow('สมชาย ใจดี', 'OUT', '2020-07-20T09:30:00.000Z')
  ]);

  const result = context.getAttendanceDashboard('day', '2020-07-20', 'valid-session');

  assert.equal(result.success, true);
  assert.equal(result.policy.baselineMinutesPerWorkDay, 540);
  assert.equal(result.summary.employeeCount, 2);
  assert.equal(result.summary.workDays, 1);
  assert.equal(result.summary.dayOffDays, 1);
  assert.equal(result.summary.lateCount, 1);
  assert.equal(result.summary.earlyLeaveCount, 1);
  assert.equal(result.summary.totalWorkedMinutes, 465);
  assert.equal(result.summary.baselineMinutes, 540);
  assert.equal(result.summary.varianceMinutes, -75);
  assert.deepEqual(JSON.parse(JSON.stringify(result.lateEmployees)), [{ name: 'สมชาย ใจดี', count: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.earlyLeaveEmployees)), [{ name: 'สมชาย ใจดี', count: 1 }]);

  const present = result.daily.find(item => item.name === 'สมชาย ใจดี');
  const dayOff = result.daily.find(item => item.name === 'สมหญิง ใจงาม');
  assert.equal(present.status, 'PRESENT');
  assert.equal(present.checkIn, '08:45:00');
  assert.equal(present.checkOut, '16:30:00');
  assert.equal(present.workedMinutes, 465);
  assert.equal(present.late, true);
  assert.equal(present.earlyLeave, true);
  assert.equal(dayOff.status, 'DAY_OFF');
  assert.equal(dayOff.verificationStatus, 'NO_ATTENDANCE_RECORD_FOUND');
});

test('dashboard supports calendar day, Monday-Sunday week, and month ranges', () => {
  const context = createDashboardContext();

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.resolveDashboardRange_('day', '2020-07-22'))),
    { startDate: '2020-07-22', endDate: '2020-07-22' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.resolveDashboardRange_('week', '2020-07-22'))),
    { startDate: '2020-07-20', endDate: '2020-07-26' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.resolveDashboardRange_('month', '2020-07-22'))),
    { startDate: '2020-07-01', endDate: '2020-07-31' }
  );
});

test('dashboard excludes unverified attendance and requires an admin session', () => {
  const context = createDashboardContext([
    attendanceRow('สมชาย ใจดี', 'IN', '2020-07-21T01:00:00.000Z', 'LEGACY_ATTENDANCE_SHEET', 'UNVERIFIED_LEGACY_RECORD'),
    attendanceRow('สมชาย ใจดี', 'OUT', '2020-07-21T10:00:00.000Z', 'LEGACY_ATTENDANCE_SHEET', 'UNVERIFIED_LEGACY_RECORD')
  ]);

  assert.throws(
    () => context.getAttendanceDashboard('day', '2020-07-21', ''),
    /ไม่มีสิทธิ์ใช้งาน/
  );
  const result = context.getAttendanceDashboard('day', '2020-07-21', 'valid-session');
  assert.equal(result.summary.workDays, 0);
  assert.equal(result.summary.dayOffDays, 2);
  assert.equal(result.metadata.ignoredUnverifiedRecords, 2);
});
