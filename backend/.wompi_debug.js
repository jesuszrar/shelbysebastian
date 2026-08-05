import 'dotenv/config';
import fetch from 'node-fetch';
import { getWompiConfig } from './src/lib/wompi.js';

const config = getWompiConfig();
console.log('Wompi config:', {
  environment: config.baseUrl.includes('sandbox') ? 'sandbox' : 'production',
  hasPublicKey: Boolean(config.publicKey),
  hasPrivateKey: Boolean(config.privateKey),
  hasIntegrityKey: Boolean(config.integrityKey),
  hasEventsKey: Boolean(config.eventsKey),
  baseUrl: config.baseUrl,
});

const headers = {
  Authorization: `Bearer ${config.privateKey}`,
  'Content-Type': 'application/json',
};

const merchantUrl = `${config.baseUrl}/merchants/${encodeURIComponent(config.publicKey)}`;
console.log('GET merchant', merchantUrl);
const merchantRes = await fetch(merchantUrl, { headers });
const merchantBody = await merchantRes.text();
let merchantJson;
try {
  merchantJson = JSON.parse(merchantBody);
} catch {
  merchantJson = merchantBody;
}
console.log('merchant status', merchantRes.status);
console.log('merchant body', JSON.stringify(merchantJson, null, 2));
console.log('enabled_payment_methods', merchantJson?.enabled_payment_methods ?? merchantJson?.data?.enabled_payment_methods ?? null);
console.log('payment_methods', merchantJson?.payment_methods ?? merchantJson?.data?.payment_methods ?? null);
console.log('nequi enabled', Array.isArray(merchantJson?.enabled_payment_methods) ? merchantJson.enabled_payment_methods.includes('NEQUI') || merchantJson.enabled_payment_methods.includes('nequi') : null);

const reference = `NEQUI_TEST_${Date.now()}`;
const transactionPayload = {
  amount_in_cents: 1000,
  currency: 'COP',
  reference,
  customer_email: 'test@example.com',
  payment_method: {
    type: 'NEQUI',
    phone_number: '3001234567',
  },
};

const transactionUrl = `${config.baseUrl}/transactions`;
console.log('POST transaction', transactionUrl);
console.log('payload', JSON.stringify(transactionPayload, null, 2));
const txRes = await fetch(transactionUrl, { method: 'POST', headers, body: JSON.stringify(transactionPayload) });
const txBody = await txRes.text();
let txJson;
try {
  txJson = JSON.parse(txBody);
} catch {
  txJson = txBody;
}
console.log('transaction create status', txRes.status);
console.log('transaction create body', JSON.stringify(txJson, null, 2));

let transactionId = txJson?.id ?? txJson?.data?.id ?? txJson?.transaction?.id ?? null;
console.log('transactionId', transactionId);
if (!transactionId) {
  process.exit(0);
}

for (let i = 0; i < 12; i += 1) {
  const statusUrl = `${config.baseUrl}/transactions/${transactionId}`;
  console.log(`poll ${i + 1}: GET ${statusUrl}`);
  const statusRes = await fetch(statusUrl, { headers });
  const statusText = await statusRes.text();
  let statusJson;
  try {
    statusJson = JSON.parse(statusText);
  } catch {
    statusJson = statusText;
  }
  console.log(`poll ${i + 1} status`, statusRes.status);
  console.log(`poll ${i + 1} body`, JSON.stringify(statusJson, null, 2));
  if (statusRes.status !== 200) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
