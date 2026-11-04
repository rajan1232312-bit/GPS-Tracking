const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// 1. RSA KEY MANAGEMENT (Asymmetric In-Flight Payload Encryption)
// ─────────────────────────────────────────────────────────────────────────────
let keyPair = null;
let keyId = null;

function generateServerKeyPair() {
    try {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        keyPair = { publicKey, privateKey };
        keyId = 'key-' + Date.now();
        console.log(`[Auth] Secure 2048-bit RSA-OAEP Key Pair generated successfully (Key ID: ${keyId}).`);
    } catch (err) {
        console.error('[Auth] Error generating RSA Key Pair:', err);
    }
}
generateServerKeyPair();

// Anti-Replay: Track nonces with timestamp expiration (5-minute sliding window)
const nonceStore = new Map();
const nonceCleaner = setInterval(() => {
    const cutoff = Date.now() - 300000;
    for (const [nonce, ts] of nonceStore.entries()) {
        if (ts < cutoff) nonceStore.delete(nonce);
    }
}, 60000);
if (nonceCleaner.unref) nonceCleaner.unref();

/**
 * Decrypts hybrid RSA-OAEP + AES-256-GCM envelope sent from client
 * Payload structure:
 * {
 *   encryptedKey: base64(RSA_OAEP_encrypt(aesKey)),
 *   iv: base64(12_bytes_iv),
 *   ciphertext: base64(AES_GCM_encrypt(jsonString)),
 *   tag: base64(16_bytes_authTag)
 * }
 */
function decryptPayload(body) {
    if (!body || !body.encryptedKey || !body.iv || !body.ciphertext || !body.tag) {
        throw new Error('Malformed encrypted payload. Expected encryptedKey, iv, ciphertext, and tag.');
    }

    if (!keyPair || !keyPair.privateKey) {
        throw new Error('Server cryptographic keys unavailable.');
    }

    // 1. Decrypt 256-bit AES session key using Server RSA Private Key (RSA-OAEP-256)
    let aesKey;
    try {
        aesKey = crypto.privateDecrypt(
            {
                key: keyPair.privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            Buffer.from(body.encryptedKey, 'base64')
        );
    } catch (e) {
        throw new Error('Cryptographic validation failed: Unable to decrypt session key. Keys may have been rotated.');
    }

    // 2. Decrypt ciphertext using AES-256-GCM
    let decryptedText;
    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            aesKey,
            Buffer.from(body.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(body.tag, 'base64'));
        decryptedText = decipher.update(Buffer.from(body.ciphertext, 'base64'), null, 'utf8');
        decryptedText += decipher.final('utf8');
    } catch (e) {
        throw new Error('Payload tamper validation failed: Authentication tag verification failed.');
    }

    // 3. Parse JSON envelope
    let payload;
    try {
        payload = JSON.parse(decryptedText);
    } catch (e) {
        throw new Error('Invalid JSON inside decrypted payload.');
    }

    // 4. Anti-Replay and Freshness Validation (OWASP ASVS 4.0 & WSTG-ATHN-02)
    const { timestamp, nonce } = payload;
    if (!timestamp || !nonce) {
        throw new Error('Cryptographic envelope missing freshness parameters (timestamp, nonce).');
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - Number(timestamp));
    if (timeDiff > 120000) { // Max 2 minutes clock skew
        throw new Error('Request has expired or client system clock is out of sync. Please retry.');
    }

    if (nonceStore.has(nonce)) {
        throw new Error('Replay attack detected: Nonce has already been consumed.');
    }
    nonceStore.set(nonce, now);

    return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SERVER-SIDE PASSWORD SECURITY (scrypt + Salt + Timing-Safe Verification)
// ─────────────────────────────────────────────────────────────────────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { hash, salt };
}

function verifyPassword(password, storedHash, storedSalt) {
    if (!password || !storedHash || !storedSalt) return false;
    try {
        const hashBuffer = crypto.scryptSync(password, storedSalt, 64, { N: 16384, r: 8, p: 1 });
        const storedBuffer = Buffer.from(storedHash, 'hex');
        if (hashBuffer.length !== storedBuffer.length) return false;
        return crypto.timingSafeEqual(hashBuffer, storedBuffer);
    } catch (e) {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PROFESSIONAL CAPTCHA SYSTEM (Distorted Vector SVG + Single-Use Nonce)
// ─────────────────────────────────────────────────────────────────────────────
const captchaStore = new Map();

// Periodic cleanup of expired captchas (5 minutes TTL)
const captchaCleaner = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of captchaStore.entries()) {
        if (entry.expiresAt < now) captchaStore.delete(id);
    }
}, 60000);
if (captchaCleaner.unref) captchaCleaner.unref();

function generateCaptchaCode() {
    // Unambiguous character set (omits 0, O, o, 1, l, I to prevent human frustration)
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars[crypto.randomInt(0, chars.length)];
    }
    return code;
}

function generateCaptchaSvg(text) {
    const width = 180;
    const height = 52;
    const colors = ['#a3e635', '#38bdf8', '#f43f5e', '#fbbf24', '#c084fc', '#34d399', '#f97316'];

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="border-radius: 12px; background: #131722; user-select: none; display: block;">`;

    // Anti-OCR distortion lines (cubic bezier curves)
    for (let i = 0; i < 5; i++) {
        const x1 = Math.floor(Math.random() * (width / 4));
        const y1 = Math.floor(Math.random() * height);
        const x2 = Math.floor(width * 0.75 + Math.random() * (width / 4));
        const y2 = Math.floor(Math.random() * height);
        const cx1 = Math.floor(Math.random() * width);
        const cy1 = Math.floor(Math.random() * height);
        const cx2 = Math.floor(Math.random() * width);
        const cy2 = Math.floor(Math.random() * height);
        const stroke = colors[Math.floor(Math.random() * colors.length)];
        const strokeWidth = (Math.random() * 1.5 + 1).toFixed(1);
        const opacity = (Math.random() * 0.35 + 0.25).toFixed(2);
        svg += `<path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" />`;
    }

    // Anti-OCR noise particles
    for (let i = 0; i < 35; i++) {
        const cx = Math.floor(Math.random() * width);
        const cy = Math.floor(Math.random() * height);
        const r = (Math.random() * 1.6 + 0.6).toFixed(1);
        const fill = colors[Math.floor(Math.random() * colors.length)];
        const opacity = (Math.random() * 0.4 + 0.2).toFixed(2);
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}" />`;
    }

    // Distorted individual glyphs
    const charSpacing = (width - 30) / text.length;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const x = 20 + i * charSpacing + (Math.random() * 6 - 3);
        const y = 35 + (Math.random() * 8 - 4);
        const angle = Math.floor(Math.random() * 36 - 18);
        const fontSize = Math.floor(Math.random() * 5 + 26);
        const color = colors[(i * 2 + Math.floor(Math.random() * 2)) % colors.length];
        svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="'Courier New', Courier, monospace" font-weight="bold" font-size="${fontSize}px" fill="${color}" transform="rotate(${angle}, ${x.toFixed(1)}, ${y.toFixed(1)})" text-anchor="middle" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${ch}</text>`;
    }

    svg += `</svg>`;
    return svg;
}

function createCaptcha() {
    const captchaId = crypto.randomUUID();
    const code = generateCaptchaCode();
    const svg = generateCaptchaSvg(code);

    captchaStore.set(captchaId, {
        code: code.toUpperCase(),
        expiresAt: Date.now() + 300000, // 5 minutes TTL
        used: false
    });

    return { captchaId, svg };
}

function verifyCaptcha(captchaId, solution) {
    if (!captchaId || !solution) {
        return { valid: false, message: 'Security verification code is required.' };
    }

    const entry = captchaStore.get(captchaId);
    if (!entry) {
        return { valid: false, message: 'CAPTCHA challenge expired or invalid. Please refresh.' };
    }

    // Single-use consumption (destroy immediately to prevent replay)
    captchaStore.delete(captchaId);

    if (Date.now() > entry.expiresAt) {
        return { valid: false, message: 'CAPTCHA challenge has expired. Please refresh.' };
    }

    const userClean = String(solution).trim().toUpperCase();
    const expected = entry.code.toUpperCase();

    // Constant-time string comparison
    const userBuf = Buffer.from(userClean);
    const expBuf = Buffer.from(expected);
    if (userBuf.length !== expBuf.length || !crypto.timingSafeEqual(userBuf, expBuf)) {
        return { valid: false, message: 'Incorrect security verification code. Please try again.' };
    }

    return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RATE LIMITING & BRUTE-FORCE LOCKOUT PROTECTION
// ─────────────────────────────────────────────────────────────────────────────
const ipAttemptStore = new Map();
const userLockoutStore = new Map();

function isIpRateLimited(ip) {
    const now = Date.now();
    const entry = ipAttemptStore.get(ip);
    if (!entry) return false;
    if (entry.resetAt < now) {
        ipAttemptStore.delete(ip);
        return false;
    }
    return entry.count >= 20; // Max 20 attempts per 5 minutes per IP
}

function recordIpAttempt(ip, success) {
    const now = Date.now();
    let entry = ipAttemptStore.get(ip);
    if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + 300000 };
        ipAttemptStore.set(ip, entry);
    }
    if (!success) {
        entry.count++;
    } else {
        ipAttemptStore.delete(ip);
    }
}

function isUserLocked(username) {
    const lock = userLockoutStore.get(username.toLowerCase());
    if (!lock) return { locked: false };
    if (Date.now() < lock.lockedUntil) {
        const remainingMinutes = Math.ceil((lock.lockedUntil - Date.now()) / 60000);
        return { locked: true, remainingMinutes };
    }
    userLockoutStore.delete(username.toLowerCase());
    return { locked: false };
}

function recordUserFailedAttempt(username) {
    const key = username.toLowerCase();
    let lock = userLockoutStore.get(key) || { attempts: 0, lockedUntil: 0 };
    lock.attempts++;
    if (lock.attempts >= 5) {
        lock.lockedUntil = Date.now() + 15 * 60000; // 15-minute lockout
        console.warn(`[Security Alert] Account '${username}' locked due to 5 consecutive failed attempts.`);
    }
    userLockoutStore.set(key, lock);
}

function clearUserLockout(username) {
    userLockoutStore.delete(username.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SECURE SESSION MANAGEMENT (HMAC-SHA256 Signed Tokens + HttpOnly Cookies)
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const activeSessions = new Map();

// Session cleaner runs every 30 minutes
const sessionCleaner = setInterval(() => {
    const now = Date.now();
    for (const [token, sess] of activeSessions.entries()) {
        if (sess.expiresAt < now) activeSessions.delete(token);
    }
}, 1800000);
if (sessionCleaner.unref) sessionCleaner.unref();

function createSession(user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    const payload = `${rawToken}:${user.id}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const signedCookie = `${payload}:${signature}`;

    activeSessions.set(rawToken, {
        userId: user.id,
        username: user.username,
        role: user.role || 'user',
        fullname: user.fullname || user.username,
        email: user.email || '',
        expiresAt
    });

    return { signedCookie, rawToken, expiresAt };
}

function parseCookies(req) {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
            }
        });
    }
    return list;
}

function verifySessionFromRequest(req) {
    const cookies = parseCookies(req);
    let cookieVal = cookies['auth_session'];

    // Also support Authorization: Bearer <token>
    if (!cookieVal && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        cookieVal = req.headers.authorization.slice(7).trim();
    }

    if (!cookieVal) return null;

    const parts = cookieVal.split(':');
    if (parts.length !== 4) return null;

    const [rawToken, userId, expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);
    if (Date.now() > expiresAt) {
        activeSessions.delete(rawToken);
        return null;
    }

    // Verify HMAC signature
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET)
        .update(`${rawToken}:${userId}:${expiresAtStr}`)
        .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }

    const session = activeSessions.get(rawToken);
    if (!session || session.userId !== Number(userId)) {
        return null;
    }

    return session;
}

function destroySessionFromRequest(req) {
    const cookies = parseCookies(req);
    const cookieVal = cookies['auth_session'];
    if (cookieVal) {
        const parts = cookieVal.split(':');
        if (parts.length === 4) {
            activeSessions.delete(parts[0]);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    getPublicKeyInfo: () => ({
        keyId,
        publicKey: keyPair ? keyPair.publicKey : null,
        algorithm: 'RSA-OAEP',
        hash: 'SHA-256',
        serverTime: Date.now()
    }),
    decryptPayload,
    hashPassword,
    verifyPassword,
    createCaptcha,
    verifyCaptcha,
    isIpRateLimited,
    recordIpAttempt,
    isUserLocked,
    recordUserFailedAttempt,
    clearUserLockout,
    createSession,
    verifySessionFromRequest,
    destroySessionFromRequest
};
