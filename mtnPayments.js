'use strict';

const https = require('https');
const logger = require('./logger');
const crypto = require('crypto');

/**
 * MTN Mobile Money API wrapper
 * Handles Collections (Request Money) and Disbursements (Send Money)
 * Supports both Sandbox and Production with feature flag
 */

const USE_SANDBOX = (process.env.MTN_ENVIRONMENT || 'sandbox').toLowerCase() === 'sandbox';

const CONFIG = {
  sandbox: {
    baseUrl: 'https://sandbox.momodeveloper.mtn.com',
    collectionsApiUser: process.env.MTN_MOMO_COLLECTIONS_API_USER,
    collectionsSubKey: process.env.MTN_MOMO_COLLECTIONS_SUBSCRIPTION_KEY,
    disbursementsApiUser: process.env.MTN_MOMO_DISBURSEMENTS_API_USER,
    disbursementsSubKey: process.env.MTN_MOMO_DISBURSEMENTS_SUBSCRIPTION_KEY,
  },
  production: {
    baseUrl: process.env.MTN_API_BASE_URL || 'https://api.mtn.com',
    collectionsApiUser: process.env.MTN_MOMO_COLLECTIONS_API_USER_PROD,
    collectionsSubKey: process.env.MTN_MOMO_COLLECTIONS_SUBSCRIPTION_KEY_PROD,
    disbursementsApiUser: process.env.MTN_MOMO_DISBURSEMENTS_API_USER_PROD,
    disbursementsSubKey: process.env.MTN_MOMO_DISBURSEMENTS_SUBSCRIPTION_KEY_PROD,
  }
};

const env = USE_SANDBOX ? 'sandbox' : 'production';
const config = CONFIG[env];

logger.info('mtnPayments.initialized', { environment: env, baseUrl: config.baseUrl });

/**
 * Generate UUID v4 for idempotency
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Normalize phone number to MTN format (Zambia)
 * Accepts: +260761948460, 0761948460, 260761948460, 761948460
 * Returns: tel:+260761948460
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  
  try {
    let cleaned = String(phone).replace(/\D/g, ''); // Remove all non-digits
    
    // Handle Zambian numbers
    if (cleaned.length === 10 && cleaned.startsWith('9')) {
      // 0761948460 -> 260761948460
      cleaned = '260' + cleaned;
    } else if (cleaned.length === 12 && cleaned.startsWith('260')) {
      // Already correct: 260761948460
    } else if (cleaned.length === 9) {
      // 761948460 -> 260761948460
      cleaned = '260' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('260')) {
      // Also valid: 260 + 9 digit number
    } else {
      // Invalid format
      logger.warn('normalizePhoneNumber.invalid_format', { phone, cleaned, length: cleaned.length });
      return null;
    }
    
    const normalized = 'tel:+' + cleaned;
    logger.info('normalizePhoneNumber.success', { phone, normalized });
    return normalized;
  } catch (err) {
    logger.error('normalizePhoneNumber.error', { phone, message: err.message });
    return null;
  }
}

/**
 * Verify webhook signature from MTN
 */
function verifyWebhookSignature(signature, body, secret) {
  try {
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    return signature === expectedSig;
  } catch (err) {
    logger.warn('verifyWebhookSignature.error', { message: err.message });
    return false;
  }
}

/**
 * Make HTTPS request to MTN API
 */
function httpsRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(config.baseUrl + path);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 30000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, headers: res.headers, body: json });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });

      req.on('error', (err) => {
        logger.error('mtnPayments.httpsRequest.error', { method, path, message: err.message });
        reject(err);
      });

      req.on('timeout', () => {
        req.abort();
        reject(new Error('MTN API request timeout'));
      });

      if (body) {
        if (typeof body === 'string') {
          req.write(body);
        } else {
          req.write(JSON.stringify(body));
        }
      }
      req.end();
    } catch (err) {
      logger.error('httpsRequest.error', { method, path, message: err.message });
      reject(err);
    }
  });
}

/**
 * REQUEST MONEY (Collections API)
 * User receives a prompt on their phone to approve the payment
 */
async function requestMoney(phone, amount, externalId, description = 'Ka Ndeke Deposit') {
  try {
    // Normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      throw new Error('Invalid phone number format');
    }

    // Validate amount
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0 || numAmount > 10000) {
      throw new Error('Amount must be between 0.01 and 10000');
    }

    const transactionId = generateUUID();
    const timestamp = new Date().toISOString();

    const requestBody = {
      amount: String(numAmount),
      currency: 'ZMW',
      externalId: externalId || transactionId,
      payer: {
        partyIdType: 'MSISDN',
        partyId: normalizedPhone
      },
      payerMessage: description,
      payeeNote: description
    };

    // ✅ AWAIT the token before using it
    const token = await getAccessToken('collections');
    
    const headers = {
      'X-Reference-Id': transactionId,
      'X-Callback-Url': process.env.MTN_CALLBACK_URL || 'https://ka-ndeke-backend-5dgy.onrender.com/api/payments/callback',
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': config.collectionsSubKey
    };

    logger.info('mtnPayments.requestMoney.start', { phone: normalizedPhone, amount: numAmount, externalId });

    const response = await httpsRequest('POST', '/collection/v1_0/requesttopay', headers, requestBody);

    if (response.status >= 200 && response.status < 300) {
      logger.info('mtnPayments.requestMoney.success', { transactionId, externalId, phone: normalizedPhone, amount: numAmount });
      return {
        transactionId,
        externalId: externalId || transactionId,
        status: 'pending',
        amount: numAmount,
        phone: normalizedPhone,
        createdAt: timestamp
      };
    } else {
      logger.error('mtnPayments.requestMoney.failed', { status: response.status, body: response.body, phone: normalizedPhone });
      throw new Error(`MTN API error: ${response.status} - ${JSON.stringify(response.body)}`);
    }
  } catch (err) {
    logger.error('mtnPayments.requestMoney.error', { message: err.message, phone, amount });
    throw err;
  }
}

/**
 * SEND MONEY (Disbursements API)
 * Send money directly to a user's phone
 */
async function sendMoney(phone, amount, externalId, description = 'Ka Ndeke Withdrawal') {
  try {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      throw new Error('Invalid phone number format');
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0 || numAmount > 10000) {
      throw new Error('Amount must be between 0.01 and 10000');
    }

    const transactionId = generateUUID();
    const timestamp = new Date().toISOString();

    const requestBody = {
      amount: String(numAmount),
      currency: 'ZMW',
      externalId: externalId || transactionId,
      payee: {
        partyIdType: 'MSISDN',
        partyId: normalizedPhone
      },
      payerMessage: description,
      payeeNote: description
    };

    // ✅ AWAIT the token before using it
    const token = await getAccessToken('disbursements');

    const headers = {
      'X-Reference-Id': transactionId,
      'X-Callback-Url': process.env.MTN_CALLBACK_URL || 'https://ka-ndeke-backend-5dgy.onrender.com/api/payments/callback',
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': config.disbursementsSubKey
    };

    logger.info('mtnPayments.sendMoney.start', { phone: normalizedPhone, amount: numAmount, externalId });

    const response = await httpsRequest('POST', '/disbursement/v1_0/transfer', headers, requestBody);

    if (response.status >= 200 && response.status < 300) {
      logger.info('mtnPayments.sendMoney.success', { transactionId, externalId, phone: normalizedPhone, amount: numAmount });
      return {
        transactionId,
        externalId: externalId || transactionId,
        status: 'pending',
        amount: numAmount,
        phone: normalizedPhone,
        createdAt: timestamp
      };
    } else {
      logger.error('mtnPayments.sendMoney.failed', { status: response.status, body: response.body, phone: normalizedPhone });
      throw new Error(`MTN API error: ${response.status} - ${JSON.stringify(response.body)}`);
    }
  } catch (err) {
    logger.error('mtnPayments.sendMoney.error', { message: err.message, phone, amount });
    throw err;
  }
}

/**
 * CHECK TRANSACTION STATUS
 * Poll MTN API to check if a payment succeeded/failed
 */
async function getTransactionStatus(transactionId, type = 'collections') {
  try {
    const apiPath = type === 'collections' 
      ? `/collection/v1_0/requesttopay/${transactionId}`
      : `/disbursement/v1_0/transfer/${transactionId}`;

    const subKey = type === 'collections' 
      ? config.collectionsSubKey 
      : config.disbursementsSubKey;

    // ✅ AWAIT the token
    const token = await getAccessToken(type);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': subKey,
      'X-Target-Environment': USE_SANDBOX ? 'sandbox' : 'production'
    };

    logger.info('mtnPayments.getTransactionStatus.start', { transactionId, type });

    const response = await httpsRequest('GET', apiPath, headers);

    if (response.status >= 200 && response.status < 300) {
      const body = response.body;
      logger.info('mtnPayments.getTransactionStatus.success', { transactionId, status: body.status });
      return {
        transactionId,
        status: (body.status || 'UNKNOWN').toUpperCase(),
        amount: body.amount,
        currency: body.currency,
        externalId: body.externalId,
        errorDescription: body.reason || null
      };
    } else {
      logger.error('mtnPayments.getTransactionStatus.failed', { status: response.status, body: response.body, transactionId });
      throw new Error(`Failed to get transaction status: ${response.status}`);
    }
  } catch (err) {
    logger.error('mtnPayments.getTransactionStatus.error', { message: err.message, transactionId, type });
    throw err;
  }
}

/**
 * Get OAuth token from MTN API
 * Caches tokens briefly to reduce API calls
 */
const tokenCache = {}; // { type: { token, expiresAt } }

async function getAccessToken(type = 'collections') {
  const apiUser = type === 'collections' 
    ? config.collectionsApiUser 
    : config.disbursementsApiUser;
  
  const apiKey = process.env.MTN_API_KEY;
  
  if (!apiUser || !apiKey) {
    throw new Error(`Missing MTN credentials for ${type}`);
  }

  // Check cache first
  if (tokenCache[type] && tokenCache[type].expiresAt > Date.now()) {
    logger.info('mtnPayments.getAccessToken.from_cache', { type });
    return tokenCache[type].token;
  }

  try {
    // Create Basic Auth header: base64(apiUser:apiKey)
    const auth = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
    
    const response = await httpsRequest('POST', '/oauth2/v1/token', {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }, 'grant_type=client_credentials');

    if (response.status >= 200 && response.status < 300) {
      const token = response.body?.access_token;
      const expiresIn = response.body?.expires_in || 3600;
      
      if (!token) {
        throw new Error('No access token in response');
      }
      
      // Cache the token
      tokenCache[type] = {
        token,
        expiresAt: Date.now() + (expiresIn * 1000 * 0.9) // Refresh at 90%
      };
      
      logger.info('mtnPayments.getAccessToken.success', { type, expiresIn });
      return token;
    } else {
      throw new Error(`MTN token request failed: ${response.status}`);
    }
  } catch (err) {
    logger.error('mtnPayments.getAccessToken.error', { type, message: err.message });
    throw err;
  }
}

// ✅ Export all functions
module.exports = {
  requestMoney,
  sendMoney,
  getTransactionStatus,
  verifyWebhookSignature,
  normalizePhoneNumber,
  generateUUID,
  USE_SANDBOX,
  environment: env
};
