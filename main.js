import { launch } from 'puppeteer';
import {
    checkInterval,
    puppeteerConfig,
    targetUrl,
    timeouts,
    externalRefsUrl
} from './config.js';
import SaleExtractor from './extractors/saleExtractor.js';
import RentExtractor from './extractors/rentExtractor.js';
import CookieManager from './cookieManager.js';
import { sendAdToServer } from './services/adSender.js';
import { loadBlacklist } from './utils/blacklist.js';

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
            errors: 0,
            skippedBecauseOfDatabase: 0,
            skippedBecauseOfBlacklist: 0
        };
    }

    async initialize() {
        this.browser = await launch(puppeteerConfig);
        this.mainPage = await this.browser.newPage();

        this.saleExtractor = new SaleExtractor(this.browser);
        this.rentExtractor = new RentExtractor(this.browser);

        const cookies = await this.cookieManager.loadCookies();

        if (cookies.length > 0) {
            await this.cookieManager.setCookies(this.mainPage, cookies);

            await this.mainPage.goto('https://divar.ir', {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            await this.cookieManager.verifyLogin(this.mainPage);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getAllAdsLinks() {
        try {
            let existingAdIds = [];

            try {
                const response = await fetch(externalRefsUrl);
                if (response.ok) {
                    const payload = await response.json();
                    const rawIds = Array.isArray(payload)
                        ? payload
                        : Array.isArray(payload?.data)
                            ? payload.data
                            : [];
                    existingAdIds = rawIds.filter(Boolean).map(id => String(id));
                    console.log(`✅ تعداد adIdهای موجود در دیتابیس: ${existingAdIds.length}`);
                } else {
                    console.warn(`⚠️  دریافت adIdها ناکام ماند (status: ${response.status})`);
                }
            } catch (apiError) {
                console.warn('⚠️  خطا در دریافت لیست adIdهای موجود:', apiError.message);
            }

            const blacklist = loadBlacklist() || [];
            const blacklistedAdIds = blacklist
                .map(item => item?.adId)
                .filter(Boolean)
                .map(id => String(id));
            console.log(`🚫 تعداد آگهی‌های لیست سیاه: ${blacklistedAdIds.length}`);

            await this.mainPage.goto(this.targetUrl, {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            const cardLinkSelector = 'article.kt-post-card a.kt-post-card__action';

            try {
                await this.mainPage.waitForSelector(cardLinkSelector, {
                    timeout: timeouts.elementWait
                });
            } catch {
                console.warn('⚠️  لینک آگهی اولیه پیدا نشد؛ تلاش مجدد پس از رفرش...');
                await this.delay(3000);
                await this.mainPage.reload({
                    waitUntil: 'networkidle2',
                    timeout: timeouts.pageLoad
                });
                await this.mainPage.waitForSelector(cardLinkSelector, {
                    timeout: timeouts.elementWait
                });
            }

            for (let i = 0; i < 3; i++) {
                await this.mainPage.evaluate(() => window.scrollBy(0, window.innerHeight));
                const randomDelay = Math.floor(Math.random() * 2000) + 1500;
                await this.delay(randomDelay);
            }

            const {
                ads,
                skippedDbCount,
                skippedBlacklistCount,
                rawCardCount
            } = await this.mainPage.evaluate((existingIds, blacklistedIds) => {
                const existingSet = new Set(existingIds);
                const blacklistSet = new Set(blacklistedIds);

                const result = {
                    ads: [],
                    skippedDbCount: 0,
                    skippedBlacklistCount: 0,
                    rawCardCount: 0
                };

                const links = Array.from(document.querySelectorAll('article.kt-post-card a.kt-post-card__action'));
                const seenIds = new Set();

                result.rawCardCount = links.length;

                links.forEach((link, idx) => {
                    const href = link.getAttribute('href');
                    if (!href) return;

                    const parts = href.split('/').filter(Boolean);
                    const adId = parts[parts.length - 1];
                    if (!adId || seenIds.has(adId)) return;
                    seenIds.add(adId);

                    if (existingSet.has(adId)) {
                        result.skippedDbCount++;
                        return;
                    }

                    if (blacklistSet.has(adId)) {
                        result.skippedBlacklistCount++;
                        return;
                    }

                    const cardRoot =
                        link.closest('article.kt-post-card') ||
                        link.closest('[data-index]') ||
                        link;

                    const textSource = cardRoot?.innerText || cardRoot?.textContent || '';

                    const isRent = /ودیعه|اجاره|رهن/i.test(textSource);

                    result.ads.push({
                        index: idx,
                        adId,
                        href,
                        fullUrl: href.startsWith('http') ? href : `https://divar.ir${href}`,
                        type: isRent ? 'rent' : 'sale'
                    });
                });

                return result;
            }, existingAdIds, blacklistedAdIds);

            this.statistics.skippedBecauseOfDatabase += skippedDbCount;
            this.statistics.skippedBecauseOfBlacklist += skippedBlacklistCount;

            console.log(`📄 تعداد کارت‌های دیده‌شده: ${rawCardCount}`);
            console.log(`⏭️  تعداد آگهی رد شده به دلیل دیتابیس: ${skippedDbCount}`);
            console.log(`🚫 تعداد آگهی رد شده به دلیل لیست سیاه: ${skippedBlacklistCount}`);
            console.log(`✅ تعداد آگهی آماده پردازش: ${ads.length}`);

            return ads;
        } catch (error) {
            this.statistics.errors++;
            console.error('❌ خطا در getAllAdsLinks:', error.message);
            return [];
        }
    }

    async checkForNewAds() {
        this.statistics.totalChecks++;

        const adsData = await this.getAllAdsLinks();
        this.statistics.totalAdsFound += adsData.length;

        if (adsData.length === 0) {
            console.log('ℹ️  آگهی جدیدی یافت نشد.');
            return;
        }

        for (let i = 0; i < adsData.length; i++) {
            const ad = adsData[i];
            const isLastAd = i === adsData.length - 1;

            this.statistics.totalAdsProcessed++;

            try {
                let adData;

                if (ad.type === 'sale') {
                    this.statistics.saleAds++;
                    adData = await this.saleExtractor.processAd(ad.fullUrl);
                } else {
                    this.statistics.rentAds++;
                    adData = await this.rentExtractor.processAd(ad.fullUrl);
                }

                if (!adData) {
                    console.warn(`⚠️  داده‌ای برای آگهی ${ad.adId} استخراج نشد؛ ارسال انجام نمی‌شود.`);
                    continue;
                }

                await sendAdToServer(adData);
                this.statistics.successfullySent++;
                console.log(`🚀 آگهی ${ad.adId} (${ad.type}) ارسال شد.`);
            } catch (error) {
                this.statistics.errors++;
                console.error(`❌ خطا در پردازش/ارسال آگهی ${ad.adId}:`, error.message);
            } finally {
                if (!isLastAd) {
                    await this.waitRandomDelay();
                }
            }
        }
    }

    async waitRandomDelay() {
        const minutes = Math.floor(Math.random() * (timeouts.maxDelayMinutes - timeouts.minDelayMinutes + 1)) + timeouts.minDelayMinutes;
        const delayMs = minutes * 60 * 1000;
        console.log(`⏳ صبر ${minutes} دقیقه‌ای تا پردازش آگهی بعدی...`);
        await this.delay(delayMs);
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

(async () => {
    const monitor = new DivarMonitor();

    try {
        await monitor.initialize();
        await monitor.startMonitoring();

        const gracefulShutdown = async () => {
            await monitor.close();
            process.exit(0);
        };

        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
    } catch (error) {
        console.error('❌ خطای کلی برنامه:', error.message);
        await monitor.close();
        process.exit(1);
    }
})();
