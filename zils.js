'use strict';

const https = require('https');
const logger = require('./logger');
const crypto = require('crypto');

/**
 * ZILS LOGISTICS PAYMENT GATEWAY
 * Handles deposits (collections) and withdrawals (disbursements)
 */

const ZILS_API_BASE_URL = process.env.ZILS_API_BASE_URL || 'https://collections.zilslogistics.com/api/v1';
const ZILS_DISBURSEMENTS_URL = process.env.ZILS_DISBURSEMENTS_URL || 'https://disbursements.zilslogistics.com/api/v1';
const ZILS_API_TOKEN = process.env.ZILS_API_TOKEN;
const ZILS_MERCHANT_PHONE = process.env.ZILS_MERCHANT_PHONE || '0761948460';

if (!ZILS_API_TOKEN) {
  logger.error('zils.initialization_failed', { message: 'ZILS_API_TOKEN not set in environment' });
}

logger.info('zils.initialized', { 
  baseUrl: ZILS_API_BASE_URL, 
  disbursementsUrl: ZILS_DISBURSEMENTS_URL,
  merchantPhone: ZILS_MERCHANT_PHONE
});

/**
 * Make HTTPS request to Zils API
 */
function httpsRequest(method, path, baseUrl, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZILS_API_TOKEN}`,
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
      logger.error('zils.httpsRequest.error', { method, path, message: err.message });
      reject(err);
    });

    req.on('timeout', () => {
      req.abort();
      reject(new Error('Zils API request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * DEPOSIT - Customer sends money to merchant
 * Flow: Customer Phone → Merchant Phone
 * 
 * @param {string} customerPhone - Customer's phone number (e.g., "0768031801")
 * @param {number} amount - Amount to deposit (integer, e.g., 100 for K100)
 * @param {string} customerUUID - Customer's unique UUID
 * @returns {object} { transactionId, status, amount }
 */
async function deposit(customerPhone, amount, customerUUID) {
  try {
    if (!customerPhone || !amount || !customerUUID) {
      throw new Error('Missing required parameters: customerPhone, amount, customerUUID');
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    // Normalize phone (remove + if present)
    const normalizedPhone = String(customerPhone).replace('+', '').trim();

    const transactionId = crypto.randomUUID();
    const requestBody = {
      amount: numAmount,
      sender: normalizedPhone,  // Customer sends money
      receiver: ZILS_MERCHANT_PHONE,  // To merchant account
      uuid: customerUUID,  // Customer's permanent UUID
      description: `FlyZed Deposit - ${customerUUID}`
    };

    logger.info('zils.deposit.start', { 
      customerPhone: normalizedPhone, 
      amount: numAmount, 
      customerUUID,
      transactionId
    });

    const response = await httpsRequest(
      'POST',
      '/wallets/external',
      ZILS_API_BASE_URL,
      {},
      requestBody
    );

    if (response.status >= 200 && response.status < 300) {
      logger.info('zils.deposit.success', { 
        transactionId, 
        customerPhone: normalizedPhone, 
        amount: numAmount,
        responseBody: response.body
      });
      
      return {
        transactionId,
        status: 'pending',
        amount: numAmount,
        customerPhone: normalizedPhone,
        createdAt: new Date().toISOString(),
        apiResponse: response.body
      };
    } else {
      logger.error('zils.deposit.failed', { 
        status: response.status, 
        body: response.body, 
        customerPhone: normalizedPhone 
      });
      throw new Error(`Zils API error: ${response.status} - ${JSON.stringify(response.body)}`);
    }
  } catch (err) {
    logger.error('zils.deposit.error', { 
      message: err.message, 
      customerPhone: customerPhone,
      amount: amount 
    });
    throw err;
  }
}

/**
 * WITHDRAWAL - Merchant sends money to customer
 * Flow: Merchant Phone → Customer Phone
 * 
 * @param {string} customerPhone - Customer's phone number (e.g., "0768031801")
 * @param {number} amount - Amount to withdraw (integer, e.g., 100 for K100)
 * @param {string} customerUUID - Customer's unique UUID
 * @returns {object} { transactionId, status, amount }
 */
async function withdrawal(customerPhone, amount, customerUUID) {
  try {
    if (!customerPhone || !amount || !customerUUID) {
      throw new Error('Missing required parameters: customerPhone, amount, customerUUID');
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    // Normalize phone
    const normalizedPhone = String(customerPhone).replace('+', '').trim();

    const transactionId = crypto.randomUUID();
    const requestBody = {
      amount: numAmount,
      sender: ZILS_MERCHANT_PHONE,  // Merchant sends money
      receiver: normalizedPhone,  // To customer
      uuid: customerUUID,  // Customer's permanent UUID
      description: `FlyZed Withdrawal - ${customerUUID}`
    };

    logger.info('zils.withdrawal.start', { 
      customerPhone: normalizedPhone, 
      amount: numAmount, 
      customerUUID,
      transactionId
    });

    const response = await httpsRequest(
      'POST',
      '/wallets/external',
      ZILS_DISBURSEMENTS_URL,
      {},
      requestBody
    );

    if (response.status >= 200 && response.status < 300) {
      logger.info('zils.withdrawal.success', { 
        transactionId, 
        customerPhone: normalizedPhone, 
        amount: numAmount,
        responseBody: response.body
      });
      
      return {
        transactionId,
        status: 'pending',
        amount: numAmount,
        customerPhone: normalizedPhone,
        createdAt: new Date().toISOString(),
        apiResponse: response.body
      };
    } else {
      logger.error('zils.withdrawal.failed', { 
        status: response.status, 
        body: response.body, 
        customerPhone: normalizedPhone 
      });
      throw new Error(`Zils API error: ${response.status} - ${JSON.stringify(response.body)}`);
    }
  } catch (err) {
    logger.error('zils.withdrawal.error', { 
      message: err.message, 
      customerPhone: customerPhone,
      amount: amount 
    });
    throw err;
  }
}

/**
 * CHECK TRANSACTION STATUS
 * Query Zils to check if payment was successful
 * 
 * @param {string} transactionId - The transaction ID to check
 * @returns {object} { status, transactionId, details }
 */
async function checkTransactionStatus(transactionId) {
  try {
    if (!transactionId) {
      throw new Error('Transaction ID required');
    }

    logger.info('zils.checkStatus.start', { transactionId });

    const response = await httpsRequest(
      'GET',
      `/transactionstatus/${transactionId}`,
      ZILS_API_BASE_URL,
      {}
    );

    if (response.status >= 200 && response.status < 300) {
      const body = response.body;
      
      logger.info('zils.checkStatus.success', { 
        transactionId, 
        status: body.status || body.statusCode 
      });

      return {
        transactionId,
        status: (body.status || body.statusCode || 'unknown').toUpperCase(),
        details: body,
        timestamp: new Date().toISOString()
      };
    } else {
      logger.error('zils.checkStatus.failed', { 
        status: response.status, 
        body: response.body, 
        transactionId 
      });
      throw new Error(`Failed to check transaction status: ${response.status}`);
    }
  } catch (err) {
    logger.error('zils.checkStatus.error', { 
      message: err.message, 
      transactionId 
    });
    throw err;
  }
}

module.exports = {
  deposit,
  withdrawal,
  checkTransactionStatus,
  ZILS_MERCHANT_PHONE
};
