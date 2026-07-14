import fs from 'fs/promises';
import { randomDelay } from './utils/randomDelay.js';

class CookieManager {
    constructor(cookieFilePath = './cookies.json') {
        this.cookieFilePath = cookieFilePath;
    }

    async loadCookies() {
        try {
            const cookiesData = await fs.readFile(this.cookieFilePath, 'utf-8');
            return JSON.parse(cookiesData);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn('⚠️  cookies.json file not found');
                return [];
            }
            
            console.error('❌ Error reading cookies:', error.message);
            return [];
        }
    }

    async setCookies(page, cookies) {
        if (!cookies || cookies.length === 0) {
            console.log('ℹ️  No cookies to set');
            return false;
        }

        try {
            // تبدیل expires به timestamp اگر رشته باشد
            const processedCookies = cookies.map(cookie => {
                if (cookie.expires && typeof cookie.expires === 'string') {
                    cookie.expires = Math.floor(new Date(cookie.expires).getTime() / 1000);
                }
                return cookie;
            });

            await page.setCookie(...processedCookies);
            console.log(`✅ ${processedCookies.length} cookies set successfully`);
            return true;
            
        } catch (error) {
            console.error('❌ Error setting cookies:', error.message);
            return false;
        }
    }

    async saveCookies(page) {
        try {
            const cookies = await page.cookies();
            await fs.writeFile(
                this.cookieFilePath, 
                JSON.stringify(cookies, null, 2),
                'utf-8'
            );
            
            console.log(`✅ ${cookies.length} cookies saved`);
            return true;
            
        } catch (error) {
            console.error('❌ Error saving cookies:', error.message);
            return false;
        }
    }

    async verifyLogin(page) {
        try {
            const iconSelector = 'button.kt-nav-button .kt-icon-person';
            await page.waitForSelector(iconSelector, {
                visible: true,
                timeout: 10000
            });

            // به‌دست آوردن handle دکمه‌ی والد و کلیک واقعی
            const iconHandle = await page.$(iconSelector);
            const buttonHandle = await iconHandle.evaluateHandle(
                el => el.closest('button.kt-nav-button')
            );

            // اسکرول تا دیده شود و سپس کلیک واقعی ماوس
            await buttonHandle.asElement().scrollIntoViewIfNeeded?.();
            await buttonHandle.asElement().click();

            // صبر برای باز شدن منو
            await page.waitForSelector('.kt-dropdown-menu__menu--open', {
                visible: true,
                timeout: 5000
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            const loginStatus = await page.evaluate(() => {
                const menu = document.querySelector('.kt-dropdown-menu__menu--open');
                if (!menu) return { isLoggedIn: false, reason: 'منو باز نشد' };

                if (menu.querySelector('.kt-icon-log-in-o'))
                    return { isLoggedIn: false, reason: 'Login button found' };
                if (menu.querySelector('.kt-icon-log-out-o'))
                    return { isLoggedIn: true, reason: 'Logout button found' };
                if (menu.querySelector('a[href="/my-divar/my-posts"]'))
                    return { isLoggedIn: true, reason: 'My posts link found' };
                return { isLoggedIn: false, reason: 'No sign of login found' };
            });

            await page.click('body');
            await new Promise(resolve => setTimeout(resolve, 300));

            console.log(loginStatus.isLoggedIn
                ? `✅ Login verified - ${loginStatus.reason}`
                : `⚠️  Not logged in - ${loginStatus.reason}`);

            return loginStatus.isLoggedIn;

        } catch (error) {
            console.error('❌ Error verifying login:', error.message);
            try { await page.click('body'); } catch (e) {}
            return false;
        }
    }

}

export default CookieManager;
