(function (global) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 15000;

  function isGoogleAppsScriptUrl(value) {
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/i.test(String(value || '').trim());
  }

  function getApiUrl(configuredUrl) {
    const configured = String(configuredUrl || '').trim();
    const saved = String(global.localStorage.getItem('gasApiUrl') || '').trim();

    // The deployed URL in api-config.js is authoritative. This prevents an old
    // or accidental localStorage value from sending API calls to an HTML page.
    if (isGoogleAppsScriptUrl(configured)) return configured.replace(/\/$/, '');
    if (isGoogleAppsScriptUrl(saved)) return saved.replace(/\/$/, '');
    return '';
  }

  function actionUrl(apiUrl, action) {
    const url = new URL(apiUrl);
    url.searchParams.set('action', action);
    return url.toString();
  }

  async function requestJson(url, options, settings) {
    const fetchOptions = Object.assign({}, options || {});
    const requestSettings = settings || {};
    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const retries = Number.isInteger(requestSettings.retries)
      ? Math.max(requestSettings.retries, 0)
      : method === 'GET' ? 2 : 0;
    const timeoutMs = Number(requestSettings.timeoutMs || DEFAULT_TIMEOUT_MS);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeoutId = controller
        ? global.setTimeout(function () { controller.abort(); }, timeoutMs)
        : null;

      try {
        const response = await global.fetch(url, Object.assign({
          cache: 'no-store',
          redirect: 'follow'
        }, fetchOptions, controller ? { signal: controller.signal } : {}));
        const responseText = await response.text();
        const trimmedText = responseText.trim();

        if (!response.ok) {
          throw new Error('API ตอบกลับ HTTP ' + response.status);
        }
        if (!trimmedText || trimmedText.charAt(0) === '<') {
          throw new Error('API ตอบกลับเป็นหน้าเว็บแทนข้อมูล กรุณารีเฟรชแล้วลองใหม่');
        }

        try {
          return JSON.parse(trimmedText);
        } catch (parseError) {
          throw new Error('รูปแบบข้อมูลจาก API ไม่ถูกต้อง กรุณาลองใหม่');
        }
      } catch (error) {
        lastError = error && error.name === 'AbortError'
          ? new Error('API ใช้เวลาตอบกลับนานเกินไป กรุณาลองใหม่')
          : error;
        if (attempt < retries) {
          await new Promise(function (resolve) {
            global.setTimeout(resolve, 350 * (attempt + 1));
          });
        }
      } finally {
        if (timeoutId) global.clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error('เชื่อมต่อ API ไม่สำเร็จ');
  }

  global.AttendanceApi = {
    actionUrl: actionUrl,
    getApiUrl: getApiUrl,
    requestJson: requestJson
  };
})(window);
