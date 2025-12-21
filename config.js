export const targetUrl = 'https://divar.ir/s/nurabad/buy-residential';
export const checkInterval = 60000;
export const apiConfig = {
    endpoint: 'https://malko.ir/api/new-place', // آدرس API سرور شما
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_TOKEN' // توکن احراز هویت
    }
};
export const puppeteerConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
};
export const timeouts = {
    pageLoad: 30000,
    elementWait: 10000
};
