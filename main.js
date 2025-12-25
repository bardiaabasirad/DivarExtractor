import {launch} from 'puppeteer';
import {checkInterval, puppeteerConfig, targetUrl, timeouts, externalRefsUrl} from './config.js';
import SaleExtractor from './extractors/saleExtractor.js';
import RentExtractor from './extractors/rentExtractor.js';
import CookieManager from './cookieManager.js';
import {sendAdToServer} from "./services/adSender.js";
import {loadBlacklist} from "./utils/blacklist.js";

class DivarMonitor {
    constructor() {
        this.targetUrl = targetUrl;
        this.interval = checkInterval;
        this.browser = null;
        this.mainPage = null;
        this.saleExtractor = null;
        this.rentExtractor = null;
        this.cookieManager = new CookieManager('./cookies.json');
        this.statistics = {
            totalChecks: 0,
            totalAdsFound: 0,
            totalAdsProcessed: 0,
            saleAds: 0,
            rentAds: 0,
            successfullySent: 0,
            errors: 0
        };
    }

    async initialize() {
        this.browser = await launch(puppeteerConfig);
        this.mainPage = await this.browser.newPage();
        
        // ایجاد نمونه از هر دو Extractor
        this.saleExtractor = new SaleExtractor(this.browser);
        this.rentExtractor = new RentExtractor(this.browser);

        // بارگذاری و تنظیم کوکی‌ها
        const cookies = await this.cookieManager.loadCookies();
        
        if (cookies.length > 0) {
            await this.cookieManager.setCookies(this.mainPage, cookies);
            
            // رفتن به صفحه اصلی برای تأیید لاگین
            await this.mainPage.goto('https://divar.ir', {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });
            
            await this.cookieManager.verifyLogin(this.mainPage);
        }
    }

    async getAllAdsLinks() {
        try {
            // 1. دریافت لیست adIdهای قبلی از API
            let existingAdIds = [];
            try {
                const response = await fetch(externalRefsUrl);
                if (response.ok) {
                    existingAdIds = await response.json();
                    console.log(`✅ تعداد adIdهای موجود در دیتابیس: ${existingAdIds.length}`);
                }
            } catch (apiError) {
                console.warn('⚠️  خطا در دریافت لیست adIdهای موجود:', apiError.message);
            }

            // 2. بارگذاری لیست سیاه
            const blacklist = loadBlacklist();
            const blacklistedAdIds = blacklist.map(item => item.adId);
            console.log(`🚫 تعداد آگهی‌های لیست سیاه: ${blacklistedAdIds.length}`);

            // 3. بارگذاری صفحه دیوار
            await this.mainPage.goto(this.targetUrl, {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            await this.mainPage.waitForSelector('[data-index="0"]', {
                timeout: timeouts.elementWait
            });

            // 4. استخراج لینک‌ها و فیلتر کردن
            return await this.mainPage.evaluate((existingIds, blacklistedIds) => {
                const ads = [];
                let index = 0;

                while (true) {
                    const dataIndexDiv = document.querySelector(`[data-index="${index}"]`);

                    if (!dataIndexDiv) break;

                    const firstChildDiv = dataIndexDiv.querySelector(':scope > div:first-child');
                    if (!firstChildDiv) {
                        index++;
                        continue;
                    }

                    const linkElement = firstChildDiv.querySelector('a.kt-post-card__action');
                    if (!linkElement) {
                        index++;
                        continue;
                    }

                    const href = linkElement.getAttribute('href');
                    if (href) {
                        const urlParts = href.split('/');
                        const adId = urlParts[urlParts.length - 1];

                        // بررسی وجود در لیست موجود یا لیست سیاه
                        if (existingIds.includes(adId)) {
                            console.log(`⏭️  آگهی ${adId} قبلاً ثبت شده است، رد شد`);
                            index++;
                            continue;
                        }

                        if (blacklistedIds.includes(adId)) {
                            console.log(`🚫 آگهی ${adId} در لیست سیاه است، رد شد`);
                            index++;
                            continue;
                        }

                        // ✅ تغییر: فقط متن همین آگهی را بررسی کن
                        let adType = 'sale';
                        const cardText = firstChildDiv.innerText || firstChildDiv.textContent || '';

                        if (cardText.includes('ودیعه') ||
                            cardText.includes('اجاره') ||
                            cardText.includes('رهن')) {
                            adType = 'rent';
                        }

                        ads.push({
                            index: index,
                            adId: adId,
                            href: href,
                            fullUrl: `https://divar.ir${href}`,
                            type: adType
                        });
                    }

                    index++;
                }

                return ads;
            }, existingAdIds, blacklistedAdIds);

        } catch (error) {
            this.statistics.errors++;
            return [];
        }
    }

    async checkForNewAds() {
        this.statistics.totalChecks++;

        const adsData = await this.getAllAdsLinks();

        this.statistics.totalAdsFound += adsData.length;

        for (let i = 0; i < adsData.length; i++) {
            const ad = adsData[i];

            this.statistics.totalAdsProcessed++;

            let success = false;

            // استفاده از Extractor مناسب
            if (ad.type === 'sale') {
                this.statistics.saleAds++;
                const adData = await this.saleExtractor.processAd(ad.fullUrl);
                if (! adData) continue;
                await sendAdToServer(adData);
            } else {
                this.statistics.rentAds++;
                const adData = await this.rentExtractor.processAd(ad.fullUrl);
                if (! adData) continue;
                await sendAdToServer(adData);
            }

            if (success) {
                this.statistics.successfullySent++;
            } else {
                this.statistics.errors++;
            }

            // تأخیر ۵ دقیقه بین پردازش هر آگهی (به جز آخرین آگهی)
            if (i < adsData.length - 1) {
                const delayMs = timeouts.delayMinutes * 60 * 1000;

                console.log(`⏳ صبر ${timeouts.delayMinutes} دقیقه تا پردازش آگهی بعدی...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    async startMonitoring() {
        await this.checkForNewAds();

        setInterval(async () => {
            await this.checkForNewAds();
        }, this.interval);
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// اجرای برنامه
(async () => {
    const monitor = new DivarMonitor();

    try {
        await monitor.initialize();
        await monitor.startMonitoring();

        process.on('SIGINT', async () => {
            await monitor.close();
            process.exit(0);
        });

    } catch (error) {
        await monitor.close();
        process.exit(1);
    }
})();
