import { getChromeExecutablePath } from './utils/chromePath.js';
import path from 'path';

// Khorramabad
// export const targetUrl = 'https://divar.ir/s/khorramabad/real-estate';
// export const cityId = 9;

// Delfan
export const targetUrl = 'https://divar.ir/s/nurabad/real-estate';
export const cityId = 21;

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
    headless: false,
    executablePath: getChromeExecutablePath(),
    defaultViewport: null,
    userDataDir: path.resolve('./chrome-profile'),
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized'
    ]
};

export const timeouts = {
    pageLoad: 30000,
    elementWait: 10000,
    minDelay: 10,
    maxDelay: 40,
};
