// Khorramabad
// export const targetUrl = 'https://divar.ir/s/khorramabad/real-estate';
// export const cityId = 9;

// Delfan
export const targetUrl = 'https://divar.ir/s/nurabad/real-estate';
export const cityId = 21;

import { getChromeExecutablePath } from './utils/chromePath.js';
export const externalRefsUrl = 'https://malko.ir/external-refs';
export const checkInterval = 60000;
export const apiConfig = {
    endpoint: 'https://malko.ir/new-place', // آدرس API سرور شما
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    }
};
export const puppeteerConfig = {
    headless: true,
    executablePath: getChromeExecutablePath(),
    defaultViewport: {
        width: 1920,
        height: 1080
    },
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
    ]
};
export const timeouts = {
    pageLoad: 30000,
    elementWait: 10000,
    minDelayMinutes: 5,
    maxDelayMinutes: 15,
};
