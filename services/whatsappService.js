const DEFAULT_VERSION = 'v23.0';

function formatIndianMobileNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return '91' + digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  throw new Error('Enter a valid 10-digit Indian mobile number.');
}
function validateWhatsAppNumber(value) { try { formatIndianMobileNumber(value); return true; } catch { return false; } }
function safeMetaError(payload, status) {
  const error = payload && payload.error;
  const code = error?.code != null ? String(error.code) : '';
  const subcode = error?.error_subcode != null ? String(error.error_subcode) : '';
  const message = error?.message ? String(error.message) : 'Meta WhatsApp request failed';
  const details = error?.error_data?.details ? String(error.error_data.details) : '';
  const safeParts = [code ? 'Meta code #' + code : '', subcode ? 'subcode ' + subcode : '', message, details, status ? 'HTTP ' + status : ''].filter(Boolean);
  const result = new Error(safeParts.join(' | '));
  result.metaCode = code; result.metaSubcode = subcode; result.httpStatus = status || null;
  return result;
}

function configValue(config, key, envKey) { return String(process.env[envKey] || config[key] || '').trim(); }
function normalizedConfig(config = {}) {
  return {
    accessToken: configValue(config, 'accessToken', 'WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: configValue(config, 'phoneNumberId', 'WHATSAPP_PHONE_NUMBER_ID'),
    wabaId: configValue(config, 'wabaId', 'WHATSAPP_WABA_ID'),
    verifyToken: configValue(config, 'verifyToken', 'WHATSAPP_VERIFY_TOKEN'),
    graphApiVersion: configValue(config, 'graphApiVersion', 'META_GRAPH_API_VERSION') || DEFAULT_VERSION,
    mode: String(config.mode || process.env.WHATSAPP_MODE || 'TEST').toUpperCase(),
    graphBaseUrl: process.env.NODE_ENV === 'test' && process.env.META_GRAPH_BASE_URL ? String(process.env.META_GRAPH_BASE_URL).replace(/\/+$/, '') : 'https://graph.facebook.com'
  };
}
async function graphRequest(config, path, options = {}) {
  const cfg = normalizedConfig(config);
  if (!cfg.accessToken) throw new Error('Meta Access Token is not configured.');
  const response = await fetch(cfg.graphBaseUrl + '/' + cfg.graphApiVersion + '/' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + cfg.accessToken, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw safeMetaError(payload, response.status);
  if (payload && typeof payload === 'object') Object.defineProperty(payload, '_metaHttpStatus', { value: response.status, enumerable: false });
  return payload;
}
async function sendTextMessage(config, recipient, text) {
  const cfg = normalizedConfig(config), to = formatIndianMobileNumber(recipient);
  if (!cfg.phoneNumberId) throw new Error('Phone Number ID is not configured.');
  return graphRequest(cfg, cfg.phoneNumberId + '/messages', { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: String(text || '').trim() } }) });
}
async function sendTemplateMessage(config, recipient, templateName, components = [], languageCode) {
  const cfg = normalizedConfig(config), to = formatIndianMobileNumber(recipient);
  if (!cfg.phoneNumberId) throw new Error('Phone Number ID is not configured.');
  if (!String(templateName || '').trim()) throw new Error('A Meta-approved template name is required.');
  if (!String(languageCode || '').trim()) throw new Error('A Meta template language code is required.');
  return graphRequest(cfg, cfg.phoneNumberId + '/messages', { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: String(templateName).trim(), language: { code: languageCode }, components } }) });
}
async function getWhatsAppApiStatus(config) {
  const cfg = normalizedConfig(config);
  if (!cfg.accessToken || !cfg.phoneNumberId || !cfg.wabaId) return { status: 'Not Connected', configured: false, mode: cfg.mode, error: 'Access Token, Phone Number ID, and WABA ID are required.' };
  try {
    const [phone, waba, wabaPhones] = await Promise.all([
      graphRequest(cfg, cfg.phoneNumberId + '?fields=id,display_phone_number,verified_name,quality_rating'),
      graphRequest(cfg, cfg.wabaId + '?fields=id,name'),
      graphRequest(cfg, cfg.wabaId + '/phone_numbers?fields=id,display_phone_number,verified_name')
    ]);
    const accountMatch = Array.isArray(wabaPhones.data) && wabaPhones.data.some(item => String(item.id) === String(cfg.phoneNumberId));
    if (!accountMatch) throw new Error('Configured Phone Number ID is not registered under configured WABA ID.');
    return { status: 'Connected', configured: true, accountMatch, mode: cfg.mode, phone: phone.display_phone_number || '', verifiedName: phone.verified_name || '', qualityRating: phone.quality_rating || '', wabaName: waba.name || '', wabaId: waba.id || '' };
  } catch (error) { return { status: 'Error', configured: true, mode: cfg.mode, error: error.message }; }
}
async function getTemplateStatus(config, templateName) {
  const cfg = normalizedConfig(config);
  if (!cfg.wabaId) throw new Error('WABA ID is not configured.');
  const query = new URLSearchParams({ name: String(templateName || '').trim(), fields: 'name,status,language' });
  const response = await graphRequest(cfg, cfg.wabaId + '/message_templates?' + query.toString());
  return Array.isArray(response.data) ? response.data : [];
}
module.exports = { formatIndianMobileNumber, validateWhatsAppNumber, normalizedConfig, sendTextMessage, sendTemplateMessage, getWhatsAppApiStatus, getTemplateStatus };

