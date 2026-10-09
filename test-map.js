const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
    await page.goto('http://localhost:5001/dashboard.html', { waitUntil: 'networkidle0' });
    await browser.close();
})();
