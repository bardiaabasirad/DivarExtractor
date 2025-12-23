import fs from 'fs/promises';

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
                console.warn('⚠️  فایل cookies.json یافت نشد');
                return [];
            }
            
            console.error('❌ خطا در خواندن کوکی‌ها:', error.message);
            return [];
        }
    }

    async setCookies(page, cookies) {
        if (!cookies || cookies.length === 0) {
            console.log('ℹ️  هیچ کوکی‌ای برای تنظیم وجود ندارد');
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
            console.log(`✅ ${processedCookies.length} کوکی با موفقیت تنظیم شد`);
            return true;
            
        } catch (error) {
            console.error('❌ خطا در تنظیم کوکی‌ها:', error.message);
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
            
            console.log(`✅ ${cookies.length} کوکی ذخیره شد`);
            return true;
            
        } catch (error) {
            console.error('❌ خطا در ذخیره کوکی‌ها:', error.message);
            return false;
        }
    }

    async verifyLogin(page) {
        try {
            // کلیک روی دکمه "دیوار من"
            await page.click('button.kt-nav-button:has(.kt-icon-person)');
            
            // صبر کردن تا منوی dropdown باز شود
            await page.waitForSelector('.kt-dropdown-menu__menu--open', {
                visible: true,
                timeout: 3000
            });

            // کمی صبر برای اطمینان از رندر کامل (جایگزین waitForTimeout)
            await new Promise(resolve => setTimeout(resolve, 500));

            // بررسی وجود دکمه ورود یا خروج
            const loginStatus = await page.evaluate(() => {
                const menu = document.querySelector('.kt-dropdown-menu__menu--open');
                if (!menu) return null;

                // بررسی دکمه ورود (لاگین نیست)
                const loginButton = menu.querySelector('.kt-icon-log-in-o');
                if (loginButton) {
                    return { isLoggedIn: false, reason: 'دکمه ورود پیدا شد' };
                }

                // بررسی دکمه خروج (لاگین است)
                const logoutButton = menu.querySelector('.kt-icon-log-out-o');
                if (logoutButton) {
                    return { isLoggedIn: true, reason: 'دکمه خروج پیدا شد' };
                }

                // بررسی اضافی: وجود لینک "آگهی‌های من"
                const myPostsLink = menu.querySelector('a[href="/my-divar/my-posts"]');
                if (myPostsLink) {
                    return { isLoggedIn: true, reason: 'لینک آگهی‌های من پیدا شد' };
                }

                return { isLoggedIn: false, reason: 'هیچ نشانه‌ای از لاگین پیدا نشد' };
            });

            // بستن منو با کلیک در خارج از آن
            await page.click('body');
            await new Promise(resolve => setTimeout(resolve, 300));

            if (loginStatus.isLoggedIn) {
                console.log('✅ لاگین با موفقیت تأیید شد -', loginStatus.reason);
            } else {
                console.log('⚠️  کاربر لاگین نیست -', loginStatus.reason);
            }

            return loginStatus.isLoggedIn;
            
        } catch (error) {
            console.error('❌ خطا در تأیید لاگین:', error.message);
            
            // در صورت خطا، سعی در بستن منو
            try {
                await page.click('body');
            } catch (e) {}
            
            return false;
        }
    }

}

export default CookieManager;
