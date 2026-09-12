import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { buildAbsoluteUrl } from './lib/urls.js';
dotenv.config();
const app = express();
const port = Number(process.env.PORT ?? '3001');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
const normalizeEnvVar = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    const match = trimmed.match(/^(['"])(.*)\1$/);
    return match ? match[2] : trimmed;
};
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
app.post('/api/functions/create-mp-preference', async (req, res) => {
    const rawTokenClient = process.env.MERCADOPAGO_ACCESS_TOKEN_CLIENT;
    const rawTokenDefault = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const tokenClient = normalizeEnvVar(rawTokenClient);
    const tokenDefault = normalizeEnvVar(rawTokenDefault);
    const accessToken = tokenClient || tokenDefault;
    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
    const orderId = typeof payload.orderId === 'string' ? payload.orderId.trim() : undefined;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const payer = payload.payer && typeof payload.payer === 'object' ? payload.payer : {};
    const shipping = Number(payload.shipping ?? 0);
    const total = Number(payload.total ?? 0);
    const discountAmount = Number(payload.discountAmount ?? 0);
    const couponCode = typeof payload.couponCode === 'string' ? payload.couponCode.trim().toUpperCase() : undefined;
    const backUrlsSource = payload.backUrls && typeof payload.backUrls === 'object' ? payload.backUrls : undefined;
    const legacyBackUrlsSource = payload.back_urls && typeof payload.back_urls === 'object' ? payload.back_urls : undefined;
    const backUrls = backUrlsSource ?? legacyBackUrlsSource;
    if (!accessToken) {
        return res.status(500).json({ error: 'mercadopago_token_missing', message: 'MERCADOPAGO_ACCESS_TOKEN no está configurado' });
    }
    const validationErrors = [];
    if (!orderId)
        validationErrors.push('orderId requerido');
    if (!rawItems.length)
        validationErrors.push('items requerido');
    if (!Number.isFinite(total) || total < 0)
        validationErrors.push('total inválido');
    if (!Number.isFinite(shipping) || shipping < 0)
        validationErrors.push('shipping inválido');
    if (!Number.isFinite(discountAmount) || discountAmount < 0)
        validationErrors.push('discountAmount inválido');
    if (backUrls) {
        const requiredBackUrlKeys = ['success', 'failure', 'pending'];
        const missingBackUrls = requiredBackUrlKeys.filter((key) => typeof backUrls[key] !== 'string' || !String(backUrls[key]).trim());
        if (missingBackUrls.length)
            validationErrors.push(`backUrls faltantes: ${missingBackUrls.join(', ')}`);
    }
    if (validationErrors.length) {
        return res.status(400).json({ error: 'payload_invalid', message: 'El payload recibido no cumple las validaciones mínimas', validationErrors });
    }
    const [first = '', ...rest] = (typeof payer.name === 'string' ? payer.name : '').trim().split(' ');
    const surname = rest.join(' ') || undefined;
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const forwardedHost = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    const notificationUrl = buildAbsoluteUrl(forwardedProto, forwardedHost, '/api/functions/mp-webhook');
    const normalizeItem = (it) => {
        const item = it;
        return {
            id: String(item.id ?? ''),
            title: String(item.title ?? '').slice(0, 250),
            quantity: Math.max(1, Math.floor(Number(item.quantity ?? 0) || 1)),
            unit_price: Math.round(Number(item.unit_price ?? 0) || 0),
            currency_id: 'COP',
            picture_url: item.picture_url ?? undefined,
        };
    };
    const items = rawItems.map(normalizeItem);
    const invalidItems = items.filter((item) => !item.id || !item.title || item.quantity <= 0 || item.unit_price < 0);
    if (invalidItems.length) {
        return res.status(400).json({ error: 'items_invalid', message: 'Los items no cumplen con el formato esperado', validationErrors: invalidItems });
    }
    const discountAmountNormalized = Math.max(0, Math.round(Number(discountAmount || 0)));
    if (shipping > 0) {
        items.push({ id: 'shipping', title: 'Envío', quantity: 1, unit_price: Math.round(Number(shipping) || 0), currency_id: 'COP', picture_url: undefined });
    }
    if (discountAmountNormalized > 0) {
        items.push({
            id: 'discount',
            title: couponCode ? `Descuento ${String(couponCode).toUpperCase()}` : 'Descuento',
            quantity: 1,
            unit_price: -discountAmountNormalized,
            currency_id: 'COP',
            picture_url: undefined,
        });
    }
    const preference = {
        items,
        external_reference: String(orderId),
        payer: {
            name: first || undefined,
            surname,
            email: typeof payer.email === 'string' ? String(payer.email) : undefined,
            phone: typeof payer.phone === 'string' ? { number: String(payer.phone) } : undefined,
            address: typeof payer.address === 'string' ? { street_name: String(payer.address) } : undefined,
        },
        statement_descriptor: 'SHELBY',
        notification_url: notificationUrl,
    };
    if (backUrls) {
        const backUrlsData = {
            success: String(backUrls.success ?? ''),
            failure: String(backUrls.failure ?? ''),
            pending: String(backUrls.pending ?? ''),
        };
        if (backUrlsData.success && backUrlsData.failure && backUrlsData.pending) {
            preference.back_urls = backUrlsData;
            preference.auto_return = 'approved';
        }
    }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(preference),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const rawResponseBody = await response.text();
        let parsedResponseBody = null;
        try {
            parsedResponseBody = rawResponseBody ? JSON.parse(rawResponseBody) : null;
        }
        catch {
            parsedResponseBody = rawResponseBody;
        }
        if (!response.ok) {
            return res.status(response.status).json({ error: 'mercadopago_rejected', message: 'Mercado Pago rechazó la preferencia', status: response.status, response: parsedResponseBody });
        }
        if (!parsedResponseBody || typeof parsedResponseBody !== 'object') {
            return res.status(502).json({ error: 'mercadopago_invalid_response', message: 'Mercado Pago no devolvió una respuesta válida', response: parsedResponseBody });
        }
        const mpPayload = parsedResponseBody;
        if (typeof mpPayload.init_point !== 'string') {
            return res.status(502).json({ error: 'mercadopago_missing_init_point', message: 'Mercado Pago no devolvió init_point', response: mpPayload });
        }
        return res.json({ id: mpPayload.id, init_point: mpPayload.init_point, sandbox_init_point: mpPayload.sandbox_init_point, message: 'Preferencia creada' });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return res.status(502).json({ error: 'mercadopago_request_failed', message: errorMessage });
    }
});
app.listen(port, () => {
    console.log(`Clean backend listening on http://localhost:${port}`);
});
