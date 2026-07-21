# 🏢 Face Scan Attendance

> ระบบบันทึกเวลาเข้า / ออกงานด้วยการสแกนใบหน้า + GPS Geofencing พร้อมแจ้ง LINE Bot
> Deploy บน Netlify · ข้อมูลเก็บใน Google Sheets · ไม่ต้องการ Server

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![face-api.js](https://img.shields.io/badge/face--api.js-v0.22.2-blueviolet)
![Netlify](https://img.shields.io/badge/deploy-Netlify-00C7B7)
![Google Sheets](https://img.shields.io/badge/database-Google%20Sheets-34A853)

---

## ✨ คุณสมบัติ

| Feature | รายละเอียด |
|---------|-----------|
| 📷 **Face Recognition** | จดจำใบหน้าด้วย face-api.js (SSD MobileNet + FaceNet) ค่า threshold 0.45 |
| 📍 **GPS Geofencing** | ตรวจสอบตำแหน่งด้วยสูตร Haversine กำหนดรัศมีได้อิสระ |
| ↔️ **เข้า / ออกงาน** | เลือกบันทึกเข้างานหรือออกงานหลังระบบจับคู่ใบหน้า |
| 💬 **LINE Bot** | แจ้งสแกนเข้า / ออกงานผ่าน LINE Messaging API พร้อม DRY_RUN และ approval flag |
| 🔐 **Admin Login** | ป้องกันหน้า Settings และการลงทะเบียนใบหน้าด้วย signed session, salted password hash และ rate limit |
| 📊 **Google Sheets** | บันทึกข้อมูลพนักงาน / ประวัติเข้า-ออกงาน / สถานะตรวจสอบ / สถานะ LINE |
| 🌐 **Static Hosting** | Frontend เป็น HTML/CSS/JS ล้วน Deploy Netlify ได้ทันที |
| 📱 **Mobile-First** | ออกแบบสำหรับการใช้งานบนมือถือ responsive ทุกขนาดจอ |
| 🌙 **Dark Glassmorphism UI** | ดีไซน์ modern dark theme พร้อม animation |

---

## 🏗️ สถาปัตยกรรมระบบ

```
┌─────────────────────────┐   fetch() (HTTPS REST JSON)   ┌──────────────────────────┐   R/W   ┌──────────────────┐
│   Netlify Static Site   │ ───────────────────────────▶  │  Google Apps Script      │ ──────▶ │  Google Sheets   │
│                         │                               │  Web App (REST API)      │         │                  │
│  index.html   (เมนู)    │   GET  ?action=getConfig      │                          │         │  📋 Users        │
│  register.html (ลงทะ)   │   GET  ?action=getKnownFaces  │  doGet(e)  → read        │         │  📋 Attendance   │
│  scan.html    (สแกน)    │   POST action=registerUser    │  doPost(e) → write       │         │  📋 Config       │
│  config.html  (ตั้งค่า) │   POST action=logAttendance   │                          │         │                  │
└─────────────────────────┘   POST action=saveConfig      └──────────────────────────┘         └──────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Face AI | [face-api.js](https://github.com/justadudewhohacks/face-api.js) v0.22.2 |
| Backend API | Google Apps Script Web App |
| Database | Google Sheets |
| Hosting | Netlify (Static) |
| Font | Sarabun (Google Fonts) |

---

## 📁 โครงสร้างไฟล์

```
facescanner v2/
├── index.html          ← หน้าเมนูหลัก
├── register.html       ← ลงทะเบียนใบหน้าพนักงาน
├── scan.html           ← สแกนใบหน้าเพื่อเข้า / ออกงาน
├── config.html         ← ตั้งค่า GPS จุดเช็คอิน + API URL
├── js/
│   └── api-config.js   ← ไฟล์เก็บ GAS Web App URL (แก้ไขก่อน Deploy)
├── code.gs             ← Google Apps Script — คัดลอกไปวางใน GAS Editor
└── netlify.toml        ← Netlify build configuration
```

---

## 🚀 วิธีติดตั้งและใช้งาน

### Step 1 — ตั้งค่า Google Sheets & Apps Script

1. สร้าง **Google Sheets** ใหม่ (ไม่ต้องสร้าง sheet เพิ่ม ระบบจะสร้างให้อัตโนมัติ)
2. ไปที่ **Extensions → Apps Script**
3. ลบโค้ดเดิมออก แล้ว **วางเนื้อหาจากไฟล์ `code.gs`** ทั้งหมด
4. คลิก **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. กด **Deploy** แล้วคัดลอก **Web App URL** ที่ได้

> ⚠️ หาก script ขอสิทธิ์ access Google Sheets ให้กด **Allow** ทุกรายการ

---

### Step 2 — แก้ไข `js/api-config.js`

เปิดไฟล์ `js/api-config.js` แล้วแทนที่ URL ด้วย URL ที่ได้จาก Step 1:

```javascript
const GAS_API_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec';
```

### Step 2.1 — ตั้งค่าผู้ดูแลระบบ

การแก้ไข GPS, การดูสถานะ LINE Bot และการลงทะเบียนใบหน้าต้องผ่านการล็อกอินผู้ดูแล โดยตรวจสิทธิ์ซ้ำที่ Google Apps Script ฝั่งเซิร์ฟเวอร์

1. ไปที่ **Apps Script → Project Settings → Script Properties**
2. เพิ่มค่าชั่วคราวสองรายการ:

| Property | ตัวอย่าง | หมายเหตุ |
|----------|----------|----------|
| `ADMIN_USERNAME` | `admin` | 3-64 ตัว ใช้ตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง |
| `ADMIN_BOOTSTRAP_PASSWORD` | รหัสผ่านยาวอย่างน้อย 12 ตัว | ใช้ครั้งเดียวและห้ามใส่ในไฟล์โค้ด |
| `AUTH_SESSION_TTL_MINUTES` | `60` | ไม่บังคับ กำหนดได้ 5-480 นาที |

3. กลับไป Apps Script Editor เลือกฟังก์ชัน `initializeAdminLogin` แล้วกด **Run** หนึ่งครั้ง
4. ตรวจ Script Properties ว่า `ADMIN_BOOTSTRAP_PASSWORD` ถูกลบ และมีค่าต่อไปนี้เพิ่มขึ้น:
   - `ADMIN_PASSWORD_SALT`
   - `ADMIN_PASSWORD_HASH`
   - `AUTH_SESSION_SECRET`
   - `AUTH_REVOKED_BEFORE`
5. Deploy Apps Script เป็น **New version**

> เมื่อต้องการเปลี่ยนรหัสผ่าน ให้เพิ่ม `ADMIN_BOOTSTRAP_PASSWORD` ค่าใหม่ แล้ว Run `initializeAdminLogin` อีกครั้ง ระบบจะ hash รหัสใหม่ ลบรหัสชั่วคราว และยกเลิก session เก่าทั้งหมด

ระบบจำกัดการลองรหัสผิด 5 ครั้งต่อชื่อผู้ใช้เป็นเวลา 15 นาที และ session หมดอายุใน 60 นาทีโดยค่าเริ่มต้น

### Step 2.2 — ตั้งค่า LINE Bot อย่างปลอดภัย

ระบบนี้ใช้ **LINE Messaging API (push message)** และไม่ใช้ LINE Notify โดยเก็บ token ไว้ใน Script Properties ฝั่ง Google Apps Script เท่านั้น

1. สร้าง LINE Official Account และเปิดใช้งาน Messaging API
2. ออก Channel access token และนำ Bot เข้าห้อง/กลุ่มปลายทาง
3. หา `userId`, `groupId` หรือ `roomId` ของผู้รับจาก webhook event
4. ไปที่ **Apps Script → Project Settings → Script Properties** แล้วเพิ่มค่า:

| Property | ค่าเริ่มต้น / ตัวอย่าง | หมายเหตุ |
|----------|------------------------|----------|
| `LINE_CHANNEL_ACCESS_TOKEN` | token จาก LINE Developers | ห้ามใส่ในไฟล์หรือหน้าเว็บ |
| `LINE_TARGET_ID` | `U...`, `C...` หรือ `R...` | user / group / room ID |
| `LINE_DRY_RUN` | `true` | ค่าเริ่มต้นต้องเป็น `true` เพื่อไม่ส่งจริง |
| `LINE_SEND_APPROVED` | `false` | ต้องอนุมัติก่อนเปิดส่งจริง |

5. ทดสอบสแกนหนึ่งครั้ง แล้วตรวจคอลัมน์ `LINE Status` และชีต `AuditLog` ว่าเป็น `DRY_RUN`
6. เมื่อตรวจข้อความและผู้รับถูกต้องแล้ว จึงเปลี่ยน `LINE_DRY_RUN=false` และ `LINE_SEND_APPROVED=true`

> การส่งจริงจะเกิดขึ้นต่อเมื่อกำหนด token/ผู้รับครบ, ปิด DRY_RUN และเปิด approval flag แล้วเท่านั้น

เอกสารอ้างอิง: [Send messages — LINE Developers](https://developers.line.biz/en/docs/messaging-api/sending-messages/)

---

### Step 3 — Deploy ขึ้น Netlify

**วิธีที่ 1 — Drag & Drop (ง่ายที่สุด)**
1. ไปที่ [app.netlify.com/drop](https://app.netlify.com/drop)
2. ลาก folder `facescanner v2` ทั้งโฟลเดอร์ไปวาง
3. รอสักครู่ → ได้ URL ทันที เช่น `https://amazing-site-123.netlify.app`

**วิธีที่ 2 — GitHub + Auto Deploy**
1. Push โค้ดขึ้น GitHub repository
2. ไปที่ [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
3. เลือก GitHub repo → Netlify จะ auto deploy ทุกครั้งที่ push

---

### Step 4 — ตั้งค่าระบบครั้งแรก

1. เปิด `https://your-site.netlify.app/config.html`
2. กรอก GAS URL, `ADMIN_USERNAME` และรหัสผ่านผู้ดูแล
3. เมื่อล็อกอินสำเร็จ ตรวจสอบว่า **GAS URL** ถูกต้อง
4. กด **"ดึงตำแหน่งปัจจุบัน"** หรือกรอก Latitude / Longitude ของจุดเช็คอิน
5. ระบุ **รัศมี** ที่ยอมรับ (หน่วย: กิโลเมตร) เช่น `0.1` คือ 100 เมตร
6. กด **"บันทึกการตั้งค่าทั้งหมด"**

---

## 📖 วิธีใช้งาน

### 👤 ลงทะเบียนพนักงานใหม่ — `/register.html`

1. ล็อกอินผู้ดูแลผ่าน `/config.html` ในแท็บเดียวกันก่อน
2. เปิด `/register.html` หาก session หมดอายุ ระบบจะส่งกลับไปหน้าล็อกอิน
3. กรอกชื่อ-นามสกุลพนักงาน
4. มองกล้อง **ตรงๆ** แล้วกด **"บันทึกใบหน้า"** (ครั้งที่ 1)
5. **หันซ้ายเล็กน้อย** กด **"บันทึกเพิ่ม"** (ครั้งที่ 2)
6. **หันขวาเล็กน้อย** กด **"บันทึกเพิ่ม"** (ครั้งที่ 3)

> 💡 บันทึกอย่างน้อย 3 มุมเพื่อความแม่นยำสูงสุด

---

### 📷 สแกนเข้า / ออกงาน — `/scan.html`

```
เปิดหน้า scan.html
       ↓
ระบบตรวจสอบ GPS → อยู่ในรัศมีที่กำหนด?
       ↓ ใช่
โหลด AI Model (face-api.js)
       ↓
โหลดฐานข้อมูลพนักงานจาก Google Sheets
       ↓
กด "แตะเพื่อเริ่มสแกน" → กล้องเปิด
       ↓
ระบบสแกนทุก 500ms → พบใบหน้าตรงกัน?
       ↓ ใช่ (distance < 0.45)
แสดง Modal ยืนยัน — เลือก "ยืนยันเข้างาน" หรือ "ยืนยันออกงาน"
       ↓
ตรวจชื่อและ GPS ซ้ำฝั่ง Apps Script
       ↓
บันทึกใน Google Sheets + ส่งแจ้ง LINE Bot ตามโหมดที่ตั้งไว้
```

---

### 📊 ดูรายงานการเข้า / ออกงาน

เปิด **Google Sheets** → sheet **"Attendance"**

| Request ID | Name | Type | Time | Date | Timestamp ISO | Latitude | Longitude | Google Map Link | Source | Verification Status | LINE Status |
|------------|------|------|------|------|---------------|----------|-----------|-----------------|--------|---------------------|-------------|
| UUID | สมชาย ใจดี | IN | 08:30:15 | 1/3/2026 | ISO 8601 | 13.7563 | 100.5018 | Google Maps | FACE_SCAN_WEB | CLIENT_FACE_MATCH_AND_SERVER_GPS_VALIDATED | SENT |

---

## 🗄️ โครงสร้าง Google Sheets

ระบบสร้าง 4 sheets อัตโนมัติเมื่อใช้งานครั้งแรก:

### 📋 Users — ข้อมูลพนักงาน

| Column A | Column B | Column C |
|----------|----------|----------|
| Name | Face Descriptor (JSON array 128D) | Registered At |

### 📋 Attendance — ประวัติเข้า / ออกงาน

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Request ID | Name | Type | Time | Date | Timestamp ISO | Latitude | Longitude | Google Map Link | Source | Verification Status | LINE Status |

เมื่อบันทึกรายการใหม่ครั้งแรก ระบบจะย้ายข้อมูล Attendance รูปแบบเดิมให้อัตโนมัติ โดยกำหนด `Type=IN`, `Source=LEGACY_ATTENDANCE_SHEET` และ `Verification Status=UNVERIFIED_LEGACY_RECORD` เพื่อไม่ตีความข้อมูลเก่าเป็นข้อเท็จจริงที่ยืนยันแล้ว

### 📋 Config — การตั้งค่า GPS

| Parameter | Value |
|-----------|-------|
| Target Latitude | 13.7563 |
| Target Longitude | 100.5018 |
| Allowed Radius (KM) | 0.1 |

### 📋 AuditLog — ประวัติการทำรายการสำคัญ

เก็บเวลาแบบ ISO 8601, action, actor, target, outcome และรายละเอียดของการลงทะเบียนใบหน้า การบันทึกเวลา การแก้ GPS และการส่ง LINE โดยไม่บันทึก Channel access token

---

## ⚙️ การปรับแต่งค่า

### ปรับความเข้มงวดการจดจำใบหน้า

เปิดไฟล์ `scan.html` แก้ไขค่า `MATCH_THRESHOLD`:

```javascript
const MATCH_THRESHOLD = 0.45; // ค่าต่ำ = เข้มงวดขึ้น | ค่าสูง = หลวมขึ้น
```

| ค่า | ความหมาย |
|-----|---------|
| `0.35` | เข้มงวดมาก — แนะนำถ้าต้องการความปลอดภัยสูง |
| `0.45` | **ค่า default** — สมดุลระหว่างความแม่นยำและความสะดวก |
| `0.55` | หลวมกว่า — แนะนำถ้ากล้องคุณภาพต่ำหรือแสงน้อย |

### ปิดการตรวจสอบ GPS

ไปที่ `/config.html` แล้วใส่ค่า **รัศมี = `0`** → ระบบจะข้ามการตรวจสอบตำแหน่ง

---

## 🌐 Browser Compatibility

| Browser | รองรับ |
|---------|--------|
| Chrome 80+ | ✅ |
| Safari 14+ (iOS) | ✅ |
| Firefox 75+ | ✅ |
| Edge 80+ | ✅ |

> ⚠️ ต้องเข้าผ่าน **HTTPS** เท่านั้น (Netlify ให้ HTTPS อัตโนมัติ) เพื่อให้ `getUserMedia()` และ Geolocation API ทำงานได้

---

## ❓ Troubleshooting

| ปัญหา | วิธีแก้ไข |
|-------|---------|
| กล้องไม่เปิด | ตรวจสอบว่าเข้าผ่าน HTTPS และให้สิทธิ์ Camera ใน Browser |
| GPS ไม่ทำงาน | เปิดการแชร์ Location ใน Browser Settings |
| `เชื่อมต่อ API ไม่ได้` | ตรวจสอบ GAS URL ใน `js/api-config.js` และ config.html |
| `ไม่พบใบหน้า` | แสงต้องเพียงพอ มองตรงกล้อง ไม่มีอะไรบัง |
| `ความเหมือน: ต่ำ` | ลงทะเบียนใบหน้าเพิ่มในหลายมุมมากขึ้น |
| CORS Error | ตรวจสอบว่า GAS Deploy เป็น "Anyone" access |

---

## 📄 License

MIT License — ใช้งานได้อิสระ แก้ไขและ redistribute ได้

---

<div align="center">
  <sub>Built with ❤️ · face-api.js · Google Apps Script · Netlify</sub>
</div>
