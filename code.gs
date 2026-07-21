// ============================================================
//  GOOGLE APPS SCRIPT — REST API Backend
//  วิธีใช้: Deploy > New deployment > Web App
//           Execute as: Me | Who has access: Anyone
// ============================================================

const APP_TIME_ZONE = 'Asia/Bangkok';
const FACE_MATCH_THRESHOLD = 0.45;
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const ADMIN_SESSION_VERSION = 1;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_LOCK_SECONDS = 900;
const ATTENDANCE_HEADERS = [
  'Request ID',
  'Name',
  'Type',
  'Time',
  'Date',
  'Timestamp ISO',
  'Latitude',
  'Longitude',
  'Google Map Link',
  'Source',
  'Verification Status',
  'LINE Status'
];

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';

  try {
    if (action === 'getConfig') return jsonResponse_(getConfig());
    if (action === 'getKnownFaces') return jsonResponse_(getKnownFaces());
    return jsonResponse_({ success: false, error: 'Unknown action: ' + action });
  } catch (error) {
    return jsonResponse_({ success: false, error: getErrorMessage_(error) });
  }
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (error) {
    return jsonResponse_({ success: false, error: 'Invalid JSON body' });
  }

  try {
    const action = data.action;
    if (action === 'loginAdmin') {
      return jsonResponse_(loginAdmin(data.username, data.password));
    }
    if (action === 'validateAdminSession') {
      return jsonResponse_(validateAdminSession(data.sessionToken));
    }
    if (action === 'getLineBotStatus') {
      return jsonResponse_(getLineBotStatus(data.sessionToken));
    }
    if (action === 'registerUser') {
      return jsonResponse_(registerUser(data.name, data.faceDescriptor, data.sessionToken));
    }
    if (action === 'logAttendance') {
      return jsonResponse_(logAttendance(
        data.name,
        data.lat,
        data.lng,
        data.attendanceType,
        data.faceDistance,
        data.requestId
      ));
    }
    if (action === 'saveConfig') {
      return jsonResponse_(saveConfig(data.lat, data.lng, data.radius, data.sessionToken));
    }
    return jsonResponse_({ success: false, error: 'Unknown action: ' + action });
  } catch (error) {
    return jsonResponse_({ success: false, error: getErrorMessage_(error) });
  }
}

function jsonResponse_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getErrorMessage_(error) {
  return error && error.message ? error.message : String(error);
}

// --- ระบบยืนยันตัวตนผู้ดูแล ---
// วิธีเริ่มต้น:
// 1) ตั้ง ADMIN_USERNAME และ ADMIN_BOOTSTRAP_PASSWORD ใน Script Properties
// 2) Run ฟังก์ชัน initializeAdminLogin() จาก Apps Script Editor หนึ่งครั้ง
// ฟังก์ชันจะสร้าง salted hash และลบ ADMIN_BOOTSTRAP_PASSWORD ให้อัตโนมัติ
function initializeAdminLogin() {
  const properties = PropertiesService.getScriptProperties();
  const username = String(properties.getProperty('ADMIN_USERNAME') || '').trim();
  const bootstrapPassword = String(properties.getProperty('ADMIN_BOOTSTRAP_PASSWORD') || '');

  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error('ADMIN_USERNAME ต้องยาว 3-64 ตัว และใช้ตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง');
  }
  if (bootstrapPassword.length < 12) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD ต้องยาวอย่างน้อย 12 ตัวอักษร');
  }

  const salt = Utilities.getUuid() + Utilities.getUuid();
  const passwordHash = hashPassword_(bootstrapPassword, salt);
  const sessionSecret = properties.getProperty('AUTH_SESSION_SECRET') ||
    Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();

  properties.setProperties({
    ADMIN_PASSWORD_SALT: salt,
    ADMIN_PASSWORD_HASH: passwordHash,
    AUTH_SESSION_SECRET: sessionSecret,
    AUTH_REVOKED_BEFORE: String(Date.now())
  }, false);
  properties.deleteProperty('ADMIN_BOOTSTRAP_PASSWORD');

  appendAuditLog_('ADMIN_CREDENTIALS_INITIALIZED', username, 'SUCCESS', {
    source: 'APPS_SCRIPT_EDITOR',
    bootstrapPasswordDeleted: true
  });
  return 'ตั้งค่าผู้ดูแลเรียบร้อย และลบรหัสผ่านเริ่มต้นแล้ว';
}

function loginAdmin(username, password) {
  const normalizedUsername = String(username || '').trim();
  const rawPassword = String(password || '');
  const properties = PropertiesService.getScriptProperties();
  const configuredUsername = String(properties.getProperty('ADMIN_USERNAME') || '').trim();
  const passwordSalt = properties.getProperty('ADMIN_PASSWORD_SALT');
  const passwordHash = properties.getProperty('ADMIN_PASSWORD_HASH');
  const sessionSecret = properties.getProperty('AUTH_SESSION_SECRET');

  if (!configuredUsername || !passwordSalt || !passwordHash || !sessionSecret) {
    throw new Error('ระบบล็อกอินยังไม่ได้ตั้งค่า กรุณา Run initializeAdminLogin()');
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = getLoginAttemptKey_(normalizedUsername);
  const failedAttempts = Number(cache.get(attemptKey) || 0);
  if (failedAttempts >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    appendAuditLog_('ADMIN_LOGIN', normalizedUsername || 'UNKNOWN', 'RATE_LIMITED', {
      source: 'CONFIG_LOGIN'
    });
    throw new Error('พยายามเข้าสู่ระบบเกินกำหนด กรุณารอ 15 นาที');
  }

  const validUsername = constantTimeEquals_(normalizedUsername, configuredUsername);
  const submittedHash = hashPassword_(rawPassword, passwordSalt);
  const validPassword = constantTimeEquals_(submittedHash, passwordHash);
  if (!validUsername || !validPassword) {
    cache.put(attemptKey, String(failedAttempts + 1), ADMIN_LOGIN_LOCK_SECONDS);
    appendAuditLog_('ADMIN_LOGIN', normalizedUsername || 'UNKNOWN', 'FAILED', {
      source: 'CONFIG_LOGIN',
      reason: 'INVALID_CREDENTIALS'
    });
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  cache.remove(attemptKey);
  const nowMs = Date.now();
  const ttlMinutes = getAdminSessionTtlMinutes_();
  const payload = {
    v: ADMIN_SESSION_VERSION,
    sub: configuredUsername,
    role: 'ADMIN',
    iat: nowMs,
    exp: nowMs + ttlMinutes * 60 * 1000,
    jti: Utilities.getUuid()
  };
  const token = createSignedSessionToken_(payload, sessionSecret);

  appendAuditLog_('ADMIN_LOGIN', configuredUsername, 'SUCCESS', {
    source: 'CONFIG_LOGIN',
    sessionExpiresAt: new Date(payload.exp).toISOString()
  });
  return {
    success: true,
    sessionToken: token,
    username: configuredUsername,
    expiresAt: new Date(payload.exp).toISOString()
  };
}

function validateAdminSession(sessionToken) {
  const session = requireAdminSession_(sessionToken);
  return {
    success: true,
    authenticated: true,
    username: session.sub,
    expiresAt: new Date(session.exp).toISOString()
  };
}

function requireAdminSession_(sessionToken) {
  const token = String(sessionToken || '');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('กรุณาเข้าสู่ระบบผู้ดูแล');

  const properties = PropertiesService.getScriptProperties();
  const sessionSecret = properties.getProperty('AUTH_SESSION_SECRET');
  if (!sessionSecret) throw new Error('ระบบล็อกอินยังไม่ได้ตั้งค่า');

  const expectedSignature = signSessionPayload_(parts[0], sessionSecret);
  if (!constantTimeEquals_(parts[1], expectedSignature)) {
    throw new Error('Session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }

  let payload;
  try {
    const decodedBytes = Utilities.base64DecodeWebSafe(parts[0]);
    payload = JSON.parse(Utilities.newBlob(decodedBytes).getDataAsString('UTF-8'));
  } catch (error) {
    throw new Error('Session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  }

  const configuredUsername = String(properties.getProperty('ADMIN_USERNAME') || '').trim();
  const revokedBefore = Number(properties.getProperty('AUTH_REVOKED_BEFORE') || 0);
  if (
    payload.v !== ADMIN_SESSION_VERSION ||
    payload.role !== 'ADMIN' ||
    payload.sub !== configuredUsername ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= Date.now() ||
    payload.iat < revokedBefore
  ) {
    throw new Error('Session หมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่');
  }
  return payload;
}

function createSignedSessionToken_(payload, secret) {
  const encodedPayload = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload),
    Utilities.Charset.UTF_8
  ).replace(/=+$/g, '');
  return encodedPayload + '.' + signSessionPayload_(encodedPayload, secret);
}

function signSessionPayload_(encodedPayload, secret) {
  const signatureBytes = Utilities.computeHmacSha256Signature(encodedPayload, secret);
  return Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/g, '');
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + password,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (byte) {
    const unsignedByte = byte < 0 ? byte + 256 : byte;
    return unsignedByte.toString(16).padStart(2, '0');
  }).join('');
}

function constantTimeEquals_(left, right) {
  const leftValue = String(left || '');
  const rightValue = String(right || '');
  let difference = leftValue.length ^ rightValue.length;
  const maxLength = Math.max(leftValue.length, rightValue.length);
  for (let i = 0; i < maxLength; i++) {
    difference |= (leftValue.charCodeAt(i) || 0) ^ (rightValue.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function getLoginAttemptKey_(username) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(username || 'UNKNOWN').toLowerCase(),
    Utilities.Charset.UTF_8
  );
  return 'ADMIN_LOGIN_' + Utilities.base64EncodeWebSafe(digest).slice(0, 32);
}

function getAdminSessionTtlMinutes_() {
  const configured = Number(PropertiesService.getScriptProperties().getProperty('AUTH_SESSION_TTL_MINUTES') || 60);
  if (!isFinite(configured)) return 60;
  return Math.min(Math.max(Math.floor(configured), 5), 480);
}

// --- ส่วนจัดการใบหน้า (Users) ---
function registerUser(name, faceDescriptor, sessionToken) {
  const adminSession = requireAdminSession_(sessionToken);
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('กรุณาระบุชื่อพนักงาน');
  if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
    throw new Error('ไม่พบข้อมูลใบหน้าที่ถูกต้อง');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Users');
  if (!sheet) sheet = ss.insertSheet('Users');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Name', 'Face Descriptor', 'Registered At']);
  }

  sheet.appendRow([normalizedName, JSON.stringify(faceDescriptor), new Date()]);
  appendAuditLog_('USER_REGISTERED', normalizedName, 'SUCCESS', {
    source: 'FACE_REGISTRATION_WEB',
    verificationStatus: 'ADMIN_AUTHORIZED',
    adminUsername: adminSession.sub
  });
  return { success: true, message: 'บันทึกข้อมูลหน้าเรียบร้อย' };
}

function getKnownFaces() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Users');
  if (!sheet || sheet.getLastRow() === 0) return [];

  const data = sheet.getDataRange().getValues();
  const startIndex = isUsersHeaderRow_(data[0]) ? 1 : 0;
  const users = [];

  for (let i = startIndex; i < data.length; i++) {
    const name = data[i][0];
    const jsonStr = data[i][1];
    if (!name || !jsonStr) continue;
    try {
      users.push({ label: String(name), descriptor: JSON.parse(jsonStr) });
    } catch (error) {
      appendAuditLog_('USER_DESCRIPTOR_READ', String(name), 'INVALID_DESCRIPTOR', {
        sourceRow: i + 1
      });
    }
  }
  return users;
}

function isUsersHeaderRow_(row) {
  return row && String(row[0]).trim().toLowerCase() === 'name';
}

function isRegisteredUser_(name) {
  return getKnownFaces().some(function (user) {
    return user.label === name;
  });
}

// --- ส่วนบันทึกเวลา (Attendance) ---
function logAttendance(name, lat, lng, attendanceType, faceDistance, requestId) {
  const normalizedName = String(name || '').trim();
  const normalizedType = String(attendanceType || '').toUpperCase();
  const normalizedRequestId = String(requestId || Utilities.getUuid()).trim();
  const numericFaceDistance = toFiniteNumber_(faceDistance);

  if (!normalizedName) throw new Error('กรุณาระบุชื่อพนักงาน');
  if (normalizedType !== 'IN' && normalizedType !== 'OUT') {
    throw new Error('ประเภทการลงเวลาต้องเป็น IN หรือ OUT');
  }
  if (!/^[A-Za-z0-9-]{8,80}$/.test(normalizedRequestId)) {
    throw new Error('Request ID ไม่ถูกต้อง');
  }
  if (!isRegisteredUser_(normalizedName)) {
    throw new Error('ไม่พบพนักงานในทะเบียนใบหน้า');
  }
  if (numericFaceDistance === null || numericFaceDistance < 0 || numericFaceDistance >= FACE_MATCH_THRESHOLD) {
    throw new Error('ผลการจับคู่ใบหน้าไม่ผ่านเกณฑ์');
  }

  const location = validateAttendanceLocation_(lat, lng);
  const now = new Date();
  const dateStr = Utilities.formatDate(now, APP_TIME_ZONE, 'd/M/yyyy');
  const timeStr = Utilities.formatDate(now, APP_TIME_ZONE, 'HH:mm:ss');
  const mapLink = location.hasCoordinates
    ? 'https://www.google.com/maps?q=' + location.lat + ',' + location.lng
    : '';
  const verificationStatus = location.geofenceEnabled
    ? 'CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED'
    : 'CLIENT_FACE_MATCH_GPS_DISABLED';

  const record = {
    requestId: normalizedRequestId,
    name: normalizedName,
    attendanceType: normalizedType,
    time: timeStr,
    date: dateStr,
    timestampIso: now.toISOString(),
    lat: location.hasCoordinates ? location.lat : '-',
    lng: location.hasCoordinates ? location.lng : '-',
    mapLink: mapLink,
    source: 'FACE_SCAN_WEB',
    verificationStatus: verificationStatus
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let sheet;
  let rowNumber;
  try {
    sheet = ensureAttendanceSheet_();
    const existing = findAttendanceByRequestId_(sheet, normalizedRequestId);
    if (existing) {
      return {
        success: true,
        duplicate: true,
        attendanceType: existing.attendanceType,
        notificationStatus: existing.notificationStatus,
        message: 'รายการนี้ถูกบันทึกไว้แล้ว'
      };
    }

    sheet.appendRow([
      record.requestId,
      record.name,
      record.attendanceType,
      record.time,
      "'" + record.date,
      record.timestampIso,
      record.lat,
      record.lng,
      record.mapLink,
      record.source,
      record.verificationStatus,
      'PENDING'
    ]);
    rowNumber = sheet.getLastRow();
    appendAuditLog_('ATTENDANCE_CREATED', record.name, 'SUCCESS', {
      requestId: record.requestId,
      attendanceType: record.attendanceType,
      source: record.source,
      verificationStatus: record.verificationStatus
    });
  } finally {
    lock.releaseLock();
  }

  const notification = sendLineAttendanceNotification_(record);
  sheet.getRange(rowNumber, 12).setValue(notification.status);

  return {
    success: true,
    attendanceType: normalizedType,
    notificationStatus: notification.status,
    message: normalizedType === 'IN' ? 'บันทึกเวลาเข้างานสำเร็จ' : 'บันทึกเวลาออกงานสำเร็จ'
  };
}

function ensureAttendanceSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Attendance');
  if (!sheet) sheet = ss.insertSheet('Attendance');

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]);
  } else {
    const firstCell = String(sheet.getRange(1, 1).getValue()).trim();
    if (firstCell === 'Name') migrateLegacyAttendanceSheet_(sheet);
  }
  return sheet;
}

function migrateLegacyAttendanceSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const legacyRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 6).getValues() : [];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]);

  if (legacyRows.length === 0) return;
  const migratedRows = legacyRows.map(function (row) {
    return [
      Utilities.getUuid(),
      row[0],
      'IN',
      row[1],
      row[2],
      '',
      row[3],
      row[4],
      row[5],
      'LEGACY_ATTENDANCE_SHEET',
      'UNVERIFIED_LEGACY_RECORD',
      'NOT_APPLICABLE'
    ];
  });
  sheet.getRange(2, 1, migratedRows.length, ATTENDANCE_HEADERS.length).setValues(migratedRows);
  appendAuditLog_('ATTENDANCE_MIGRATED', 'Attendance', 'SUCCESS', {
    migratedRows: migratedRows.length,
    verificationStatus: 'UNVERIFIED_LEGACY_RECORD'
  });
}

function findAttendanceByRequestId_(sheet, requestId) {
  if (sheet.getLastRow() <= 1) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === requestId) {
      return {
        attendanceType: String(values[i][2]),
        notificationStatus: String(values[i][11])
      };
    }
  }
  return null;
}

function validateAttendanceLocation_(lat, lng) {
  const numericLat = toFiniteNumber_(lat);
  const numericLng = toFiniteNumber_(lng);
  const hasCoordinates = numericLat !== null && numericLng !== null;
  if (hasCoordinates && (numericLat < -90 || numericLat > 90 || numericLng < -180 || numericLng > 180)) {
    throw new Error('พิกัด GPS ไม่ถูกต้อง');
  }

  const config = getConfig();
  const geofenceEnabled = config.radius > 0 && !(config.lat === 0 && config.lng === 0);
  if (!geofenceEnabled) {
    return { hasCoordinates: hasCoordinates, lat: numericLat, lng: numericLng, geofenceEnabled: false };
  }
  if (!hasCoordinates) throw new Error('ไม่พบพิกัด GPS');

  const distanceKm = haversineKm_(numericLat, numericLng, config.lat, config.lng);
  if (distanceKm > config.radius) {
    throw new Error('อยู่นอกพื้นที่ลงเวลาที่กำหนด');
  }
  return { hasCoordinates: true, lat: numericLat, lng: numericLng, geofenceEnabled: true };
}

function toFiniteNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function haversineKm_(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const toRadians = function (degrees) { return degrees * Math.PI / 180; };
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- LINE Messaging API ---
function getLineBotStatus(sessionToken) {
  requireAdminSession_(sessionToken);
  const properties = PropertiesService.getScriptProperties();
  return {
    success: true,
    configured: Boolean(properties.getProperty('LINE_CHANNEL_ACCESS_TOKEN') && properties.getProperty('LINE_TARGET_ID')),
    dryRun: properties.getProperty('LINE_DRY_RUN') !== 'false',
    approved: properties.getProperty('LINE_SEND_APPROVED') === 'true'
  };
}

function sendLineAttendanceNotification_(record) {
  const properties = PropertiesService.getScriptProperties();
  const dryRun = properties.getProperty('LINE_DRY_RUN') !== 'false';
  const approved = properties.getProperty('LINE_SEND_APPROVED') === 'true';
  const token = properties.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const targetId = properties.getProperty('LINE_TARGET_ID');

  if (dryRun) return recordLineResult_(record, 'DRY_RUN', 'ไม่ได้ส่งข้อความจริง');
  if (!approved) return recordLineResult_(record, 'BLOCKED_APPROVAL_REQUIRED', 'ยังไม่ได้อนุมัติการส่งจริง');
  if (!token || !targetId) return recordLineResult_(record, 'NOT_CONFIGURED', 'ตั้งค่า LINE Bot ไม่ครบ');

  const payload = {
    to: targetId,
    messages: [{ type: 'text', text: buildLineAttendanceMessage_(record) }]
  };

  try {
    const response = UrlFetchApp.fetch(LINE_PUSH_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Line-Retry-Key': record.requestId
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const statusCode = response.getResponseCode();
    if (statusCode >= 200 && statusCode < 300) {
      return recordLineResult_(record, 'SENT', 'LINE Messaging API ตอบรับแล้ว');
    }
    return recordLineResult_(record, 'FAILED_' + statusCode, String(response.getContentText()).slice(0, 300));
  } catch (error) {
    return recordLineResult_(record, 'FAILED_EXCEPTION', getErrorMessage_(error).slice(0, 300));
  }
}

function buildLineAttendanceMessage_(record) {
  const isCheckIn = record.attendanceType === 'IN';
  const lines = [
    isCheckIn ? '🟢 แจ้งสแกนเข้างาน' : '🔴 แจ้งสแกนออกงาน',
    'ชื่อ: ' + record.name,
    'วันที่: ' + record.date,
    'เวลา: ' + record.time + ' น.',
    'ประเภท: ' + (isCheckIn ? 'เข้างาน' : 'ออกงาน'),
    'แหล่งข้อมูล: ระบบสแกนใบหน้า',
    'สถานะตรวจสอบ: ' + getVerificationLabel_(record.verificationStatus),
    'รหัสรายการ: ' + record.requestId
  ];
  if (record.mapLink) lines.push('แผนที่: ' + record.mapLink);
  return lines.join('\n');
}

function getVerificationLabel_(status) {
  if (status === 'CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED') {
    return 'จับคู่ใบหน้าฝั่งอุปกรณ์ และตรวจพิกัดฝั่งเซิร์ฟเวอร์แล้ว';
  }
  return 'จับคู่ใบหน้าฝั่งอุปกรณ์ (ปิดการจำกัด GPS)';
}

function recordLineResult_(record, status, detail) {
  appendAuditLog_('LINE_NOTIFICATION', record.name, status, {
    requestId: record.requestId,
    attendanceType: record.attendanceType,
    detail: detail
  });
  return { status: status };
}

// --- ส่วนจัดการ Config (GPS) ---
function saveConfig(lat, lng, radius, sessionToken) {
  const adminSession = requireAdminSession_(sessionToken);
  const numericLat = toFiniteNumber_(lat);
  const numericLng = toFiniteNumber_(lng);
  const numericRadius = toFiniteNumber_(radius);
  if (numericLat === null || numericLat < -90 || numericLat > 90) throw new Error('Latitude ไม่ถูกต้อง');
  if (numericLng === null || numericLng < -180 || numericLng > 180) throw new Error('Longitude ไม่ถูกต้อง');
  if (numericRadius === null || numericRadius < 0) throw new Error('รัศมีต้องไม่น้อยกว่า 0');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Config');
  if (!sheet) {
    sheet = ss.insertSheet('Config');
    sheet.getRange('A1:B1').setValues([['Parameter', 'Value']]);
    sheet.getRange('A2').setValue('Target Latitude');
    sheet.getRange('A3').setValue('Target Longitude');
    sheet.getRange('A4').setValue('Allowed Radius (KM)');
    sheet.setColumnWidth(1, 150);
  }

  sheet.getRange('B2').setValue(numericLat);
  sheet.getRange('B3').setValue(numericLng);
  sheet.getRange('B4').setValue(numericRadius);
  appendAuditLog_('GPS_CONFIG_UPDATED', 'Config', 'SUCCESS', {
    lat: numericLat,
    lng: numericLng,
    radiusKm: numericRadius,
    adminUsername: adminSession.sub
  });
  return { success: true, message: 'บันทึกการตั้งค่าลง Google Sheets เรียบร้อย' };
}

function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Config');
  const config = { lat: 0, lng: 0, radius: 0.5 };

  if (sheet) {
    const latVal = toFiniteNumber_(sheet.getRange('B2').getValue());
    const lngVal = toFiniteNumber_(sheet.getRange('B3').getValue());
    const radiusVal = toFiniteNumber_(sheet.getRange('B4').getValue());
    if (latVal !== null) config.lat = latVal;
    if (lngVal !== null) config.lng = lngVal;
    if (radiusVal !== null) config.radius = radiusVal;
  }
  return config;
}

// --- Audit Log ---
function appendAuditLog_(action, target, outcome, details) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('AuditLog');
  if (!sheet) {
    sheet = ss.insertSheet('AuditLog');
    sheet.appendRow(['Timestamp ISO', 'Action', 'Actor', 'Target', 'Outcome', 'Details']);
  }
  sheet.appendRow([
    new Date().toISOString(),
    action,
    'GAS_WEB_APP',
    target,
    outcome,
    JSON.stringify(details || {})
  ]);
}
