document.querySelectorAll('.custom-select').forEach(wrapper => {
            const trigger = wrapper.querySelector('.select-trigger');
            const options = wrapper.querySelectorAll('.select-option');
            
            trigger.addEventListener('click', (e) => {
                document.querySelectorAll('.custom-select').forEach(w => {
                    if(w !== wrapper) w.classList.remove('open');
                });
                wrapper.classList.toggle('open');
                e.stopPropagation();
            });

            options.forEach(opt => {
                opt.addEventListener('click', () => {
                    trigger.value = opt.textContent;
                    wrapper.classList.remove('open');
                });
            });
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.custom-select').forEach(w => w.classList.remove('open'));
        });

        function togglePassword() {
            const passwordInput = document.getElementById('password');
            const eyeIcon = document.getElementById('eye-icon');
            
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                eyeIcon.innerHTML = '<path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"></path>';
            } else {
                passwordInput.type = 'password';
                eyeIcon.innerHTML = '<path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"></path><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>';
            }
        }

        function checkPasswordStrength(password) {
            let strength = 0;
            const bar1 = document.getElementById('bar-1');
            const bar2 = document.getElementById('bar-2');
            const bar3 = document.getElementById('bar-3');
            const bar4 = document.getElementById('bar-4');
            const text = document.getElementById('strength-text');
            
            // Reset colors
            [bar1, bar2, bar3, bar4].forEach(bar => bar.style.backgroundColor = 'rgba(0,0,0,0.1)');
            
            if (password.length === 0) {
                text.textContent = 'Use 8+ characters with a mix of letters, numbers & symbols.';
                text.style.color = 'var(--text-muted)';
                return;
            }

            // Criteria checks
            if (password.length >= 8) strength += 1;
            if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength += 1;
            if (password.match(/\d/)) strength += 1;
            if (password.match(/[^a-zA-Z\d]/)) strength += 1;

            if (strength === 1) {
                bar1.style.backgroundColor = '#ef4444'; // Red (Weak)
                text.textContent = 'Weak: Add upper/lowercase, numbers & symbols.';
                text.style.color = '#ef4444';
            } else if (strength === 2) {
                bar1.style.backgroundColor = '#eab308'; // Yellow (Fair)
                bar2.style.backgroundColor = '#eab308';
                text.textContent = 'Fair: Keep adding variety.';
                text.style.color = '#eab308';
            } else if (strength === 3) {
                bar1.style.backgroundColor = '#3b82f6'; // Blue (Good)
                bar2.style.backgroundColor = '#3b82f6';
                bar3.style.backgroundColor = '#3b82f6';
                text.textContent = 'Good: Just one more element to make it strong.';
                text.style.color = '#3b82f6';
            } else if (strength === 4) {
                bar1.style.backgroundColor = '#22c55e'; // Green (Strong)
                bar2.style.backgroundColor = '#22c55e';
                bar3.style.backgroundColor = '#22c55e';
                bar4.style.backgroundColor = '#22c55e';
                text.textContent = 'Strong password! Highly secure.';
                text.style.color = '#22c55e';
            }
        }

        function showRegisterAlert(msg, type = 'error') {
            const box = document.getElementById('register-alert');
            const text = document.getElementById('register-alert-message');
            if (box && text) {
                box.className = `login-alert alert-${type}`;
                text.textContent = msg;
                box.style.display = 'flex';
            }
        }

        async function fetchServerPublicKey() {
            const res = await fetch('/api/auth/public-key', { cache: 'no-store' });
            if (!res.ok) throw new Error('Cannot load encryption keys');
            const data = await res.json();
            const b64 = data.publicKey.replace(/-----BEGIN [A-Z ]+-----/g, '').replace(/-----END [A-Z ]+-----/g, '').replace(/[\r\n\s]/g, '');
            const str = window.atob(b64);
            const buf = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
            const key = await window.crypto.subtle.importKey('spki', buf.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
            return { key, keyId: data.keyId };
        }

        async function encryptPayload(payload) {
            const { key, keyId } = await fetchServerPublicKey();
            const aesKey = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
            const rawAes = await window.crypto.subtle.exportKey('raw', aesKey);
            const encKey = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, rawAes);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const cipherBuf = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, new TextEncoder().encode(JSON.stringify(payload)));
            const bytes = new Uint8Array(cipherBuf);
            const ct = bytes.slice(0, bytes.length - 16);
            const tag = bytes.slice(bytes.length - 16);

            const toB64 = b => {
                let bin = '';
                const u = new Uint8Array(b);
                for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
                return window.btoa(bin);
            };

            return {
                keyId,
                encryptedKey: toB64(encKey),
                iv: toB64(iv),
                ciphertext: toB64(ct),
                tag: toB64(tag)
            };
        }

        document.addEventListener('DOMContentLoaded', () => {
            const form = document.getElementById('register-form');
            if (form) {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const submitBtn = form.querySelector('.btn-submit');
                    const origBtnText = submitBtn.innerHTML;

                    const fullname = document.getElementById('fullname')?.value.trim() || '';
                    const age = document.getElementById('age')?.value || '';
                    const gender = document.getElementById('gender')?.value || '';
                    const email = document.getElementById('email')?.value.trim() || '';
                    const role = document.getElementById('role')?.value.trim().toLowerCase() || 'user';
                    const userid = document.getElementById('userid')?.value.trim() || '';
                    const password = document.getElementById('password')?.value || '';

                    if (!userid || userid.length < 3) {
                        showRegisterAlert('User ID must be at least 3 characters long.');
                        return;
                    }
                    if (!password || password.length < 8) {
                        showRegisterAlert('Password must be at least 8 characters long.');
                        return;
                    }

                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Encrypting & Registering...';

                    try {
                        const payload = {
                            fullname,
                            age,
                            gender,
                            email,
                            role,
                            userid,
                            password,
                            timestamp: Date.now(),
                            nonce: window.crypto.randomUUID ? window.crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36))
                        };

                        const encrypted = await encryptPayload(payload);
                        const res = await fetch('/api/auth/register', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(encrypted)
                        });

                        const data = await res.json();
                        if (!res.ok || !data.success) {
                            showRegisterAlert(data.error || 'Registration failed.');
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = origBtnText;
                            return;
                        }

                        showRegisterAlert('Account registered successfully! Redirecting to login...', 'success');
                        setTimeout(() => {
                            window.location.href = '/index.html?registered=1';
                        }, 800);
                    } catch (err) {
                        showRegisterAlert(err.message || 'An unexpected error occurred.');
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = origBtnText;
                    }
                });
            }

            const toggleBtn = document.getElementById('password-toggle-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', togglePassword);
            }

            const passwordInput = document.getElementById('password');
            if (passwordInput) {
                passwordInput.addEventListener('input', function() {
                    checkPasswordStrength(this.value);
                });
            }
        });
