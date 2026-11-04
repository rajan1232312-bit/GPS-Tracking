/**
 * GPS Vehicle Tracker - Enterprise Login Controller
 * Features:
 * - Native Browser WebCrypto In-Flight Hybrid Encryption (RSA-OAEP-2048 + AES-256-GCM)
 * - Server-Validated Anti-Replay Protection (Nonce + Timestamp)
 * - Distorted Vector SVG CAPTCHA with Single-Use Validation
 * - Brute-Force Feedback & Account Lockout Handling
 */

let cachedServerPublicKey = null;
let currentKeyId = null;
let currentCaptchaId = null;

// Toggle Password Visibility
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eye-icon');
    if (!passwordInput || !eyeIcon) return;

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.innerHTML = '<path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"></path>';
    } else {
        passwordInput.type = 'password';
        eyeIcon.innerHTML = '<path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"></path><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>';
    }
}

// UI Alert Helper
function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('login-alert');
    const alertMsg = document.getElementById('alert-message');
    if (!alertBox || !alertMsg) return;

    alertBox.className = `login-alert alert-${type}`;
    alertMsg.textContent = message;
    alertBox.style.display = 'flex';
}

function hideAlert() {
    const alertBox = document.getElementById('login-alert');
    if (alertBox) alertBox.style.display = 'none';
}

// ArrayBuffer <-> Base64 helpers
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function pemToArrayBuffer(pem) {
    const b64Lines = pem.replace(/-----BEGIN [A-Z ]+-----/g, '')
                        .replace(/-----END [A-Z ]+-----/g, '')
                        .replace(/[\r\n\s]/g, '');
    const str = window.atob(b64Lines);
    const buf = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i);
    }
    return buf.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CAPTCHA CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
async function fetchCaptcha() {
    const preview = document.getElementById('captcha-preview');
    const refreshBtn = document.getElementById('captcha-refresh-btn');
    const captchaInput = document.getElementById('captcha-input');

    if (refreshBtn) refreshBtn.classList.add('rotating');
    if (captchaInput) captchaInput.value = '';

    try {
        const res = await fetch('/api/auth/captcha', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load CAPTCHA');
        const data = await res.json();

        currentCaptchaId = data.captchaId;
        if (preview) {
            preview.innerHTML = data.captchaSvg;
        }
    } catch (err) {
        console.error('Error fetching CAPTCHA:', err);
        if (preview) {
            preview.innerHTML = '<span class="captcha-loading" style="color:#ef4444;">Error loading CAPTCHA</span>';
        }
    } finally {
        if (refreshBtn) {
            setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. IN-FLIGHT ASYMMETRIC HYBRID ENCRYPTION (RSA-OAEP-2048 + AES-256-GCM)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchServerPublicKey() {
    if (cachedServerPublicKey) return cachedServerPublicKey;
    try {
        const res = await fetch('/api/auth/public-key', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to retrieve server encryption key');
        const data = await res.json();

        currentKeyId = data.keyId;
        const der = pemToArrayBuffer(data.publicKey);

        cachedServerPublicKey = await window.crypto.subtle.importKey(
            'spki',
            der,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            false,
            ['encrypt']
        );
        return cachedServerPublicKey;
    } catch (err) {
        console.error('Error loading public key:', err);
        throw new Error('Encryption service unavailable. Please check your connection.');
    }
}

async function encryptLoginEnvelope(envelope) {
    const publicKey = await fetchServerPublicKey();

    // 1. Generate one-time 256-bit AES-GCM session key
    const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt']
    );

    // 2. Encrypt AES session key with Server RSA Public Key (RSA-OAEP-SHA256)
    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        rawAesKey
    );

    // 3. Encrypt envelope data with AES-256-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedPayload = new TextEncoder().encode(JSON.stringify(envelope));

    const encryptedData = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        aesKey,
        encodedPayload
    );

    // WebCrypto puts the 16-byte auth tag at the end of ciphertext
    const fullCipher = new Uint8Array(encryptedData);
    const ciphertext = fullCipher.slice(0, fullCipher.length - 16);
    const authTag = fullCipher.slice(fullCipher.length - 16);

    return {
        keyId: currentKeyId,
        encryptedKey: arrayBufferToBase64(encryptedKeyBuffer),
        iv: arrayBufferToBase64(iv),
        ciphertext: arrayBufferToBase64(ciphertext),
        tag: arrayBufferToBase64(authTag)
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LOGIN SUBMISSION & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
async function handleLoginSubmit(e) {
    e.preventDefault();
    hideAlert();

    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const captchaInput = document.getElementById('captcha-input');
    const submitBtn = document.getElementById('btn-submit');
    const submitText = document.getElementById('btn-submit-text');
    const submitIcon = document.getElementById('btn-submit-icon');
    const submitSpinner = document.getElementById('btn-submit-spinner');

    const username = usernameInput ? usernameInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    const captchaSolution = captchaInput ? captchaInput.value.trim() : '';

    if (!username) {
        showAlert('Please enter your user login.', 'error');
        usernameInput?.focus();
        return;
    }
    if (!password) {
        showAlert('Please enter your password.', 'error');
        passwordInput?.focus();
        return;
    }
    if (!captchaSolution) {
        showAlert('Please enter the security verification code.', 'error');
        captchaInput?.focus();
        return;
    }
    if (!currentCaptchaId) {
        showAlert('Verification challenge missing. Refreshing...', 'warning');
        await fetchCaptcha();
        return;
    }

    // Enter loading state
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Encrypting & Verifying...';
    if (submitIcon) submitIcon.style.display = 'none';
    if (submitSpinner) submitSpinner.style.display = 'block';

    try {
        // Construct anti-replay envelope
        const envelope = {
            username,
            password,
            captchaId: currentCaptchaId,
            captchaSolution,
            timestamp: Date.now(),
            nonce: (window.crypto.randomUUID ? window.crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36)))
        };

        // Encrypt credentials in-flight with RSA-OAEP & AES-256-GCM
        const encryptedTransmission = await encryptLoginEnvelope(envelope);

        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(encryptedTransmission)
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            showAlert(data.error || 'Authentication failed. Please verify your credentials.', 'error');
            // Immediate CAPTCHA refresh on any failure (enforces single-use)
            await fetchCaptcha();
            return;
        }

        // Authentication Success
        showAlert('Login verified! Redirecting to secure dashboard...', 'success');
        if (submitText) submitText.textContent = 'Authorized! Redirecting...';

        if (data.user) {
            sessionStorage.setItem('gps_user', JSON.stringify(data.user));
        }

        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 600);

    } catch (err) {
        console.error('Login error:', err);
        showAlert(err.message || 'An unexpected error occurred during secure authentication.', 'error');
        await fetchCaptcha();
    } finally {
        if (!submitBtn.disabled) return;
        setTimeout(() => {
            if (window.location.pathname.includes('dashboard')) return;
            if (submitBtn) submitBtn.disabled = false;
            if (submitText) submitText.textContent = 'Sign In';
            if (submitIcon) submitIcon.style.display = 'block';
            if (submitSpinner) submitSpinner.style.display = 'none';
        }, 500);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 1. Password visibility toggle
    const toggleBtn = document.getElementById('password-toggle-btn');
    if (toggleBtn) toggleBtn.addEventListener('click', togglePassword);

    // 2. CAPTCHA refresh button
    const captchaRefreshBtn = document.getElementById('captcha-refresh-btn');
    if (captchaRefreshBtn) captchaRefreshBtn.addEventListener('click', fetchCaptcha);

    // 3. Form submission
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    // 4. Check URL status parameters (e.g., unauthorized redirect or registered notice)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error') === 'unauthorized') {
        showAlert('Please sign in with your credentials to access the tracking dashboard.', 'warning');
    } else if (urlParams.get('registered') === '1') {
        showAlert('Registration successful! You may now sign in.', 'success');
    }

    // 5. Preload CAPTCHA and RSA public key asynchronously
    fetchCaptcha();
    fetchServerPublicKey().catch(err => console.warn('Preloading public key notice:', err.message));
});
