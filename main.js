import { launch } from 'puppeteer';
import { targetUrl, checkInterval, puppeteerConfig, timeouts } from './config.js';
import SaleExtractor from './saleExtractor.js';
import RentExtractor from './rentExtractor.js';
import CookieManager from './cookieManager.js';

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
        } else {
            // console.log('ℹ️  بدون کوکی ادامه می‌دهیم (حالت مهمان)');
        }
    }

    async getAllAdsLinks() {
        try {
            await this.mainPage.goto(this.targetUrl, {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            await this.mainPage.waitForSelector('[data-index="0"]', {
                timeout: timeouts.elementWait
            });

            const adsData = await this.mainPage.evaluate(() => {
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
                        console.log(urlParts);
                        const adId = urlParts[urlParts.length - 1];
                        
                        // تشخیص نوع آگهی: بررسی تمام محتوای متنی کارت
                        let adType = 'sale'; // پیش‌فرض
                        
                        // دریافت تمام متن‌های داخل کارت
                        const allText = dataIndexDiv.innerText || dataIndexDiv.textContent || '';
                        
                        // بررسی وجود کلمات کلیدی اجاره
                        // توجه: از includes استفاده می‌کنیم تا حتی اگر فرمت متن متفاوت باشد، پیدا شود
                        if (allText.includes('ودیعه') || 
                            allText.includes('اجاره') || 
                            allText.includes('رهن')) {
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
            });

            return adsData;

        } catch (error) {
            console.error('❌ خطا در دریافت لیست آگهی‌ها:', error.message);
            this.statistics.errors++;
            return [];
        }
    }

    async checkForNewAds() {
        this.statistics.totalChecks++;

        const adsData = await this.getAllAdsLinks();

        if (adsData.length === 0) {
            // console.log('⚠️  هیچ آگهی‌ای یافت نشد');
            this.displayStatistics();
            return;
        }

        // console.log(`📊 تعداد آگهی‌های یافت شده: ${adsData.length}`);
        this.statistics.totalAdsFound += adsData.length;

        for (const ad of adsData) {
            // console.log(`\n${'─'.repeat(70)}`);
            // console.log(`📍 آگهی #${ad.index + 1} از ${adsData.length}`);
            // console.log(`🆔 ID: ${ad.adId}`);
            // console.log(`📋 نوع: ${ad.type === 'sale' ? '🏷️  فروش' : '🏠 اجاره'}`);
            
            // نمایش اطلاعات دیباگ (بعداً حذف کنید)
            if (ad.debugInfo) {
                // console.log(`🔍 دیباگ: ودیعه=${ad.debugInfo.hasDeposit}, اجاره=${ad.debugInfo.hasRent}, رهن=${ad.debugInfo.hasFullMortgage}`);
                // console.log(`📝 متن: ${ad.debugInfo.textPreview}...`);
            }

            this.statistics.totalAdsProcessed++;

            let success = false;

            // استفاده از Extractor مناسب
            if (ad.type === 'sale') {
                this.statistics.saleAds++;
                success = await this.saleExtractor.processAd(ad.fullUrl);
            } else {
                this.statistics.rentAds++;
                // success = await this.rentExtractor.processAd(ad.fullUrl);
            }

            if (success) {
                this.statistics.successfullySent++;
            } else {
                this.statistics.errors++;
            }

            // تأخیر بین آگهی‌ها
            if (ad.index < adsData.length - 1) {
                // console.log('\n⏳ انتظار 2 ثانیه تا آگهی بعدی...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // console.log(`\n${'═'.repeat(70)}`);
        this.displayStatistics();
    }

    displayStatistics() {        
        if (this.statistics.totalAdsProcessed > 0) {
            const successRate = ((this.statistics.successfullySent / this.statistics.totalAdsProcessed) * 100).toFixed(1);
            // console.log(`   • نرخ موفقیت: ${successRate}%`);
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
            // console.log('\n👋 مرورگر بسته شد');
            this.displayStatistics();
        }
    }
}

// اجرای برنامه
(async () => {
    const monitor = new DivarMonitor();

    try {
        // console.log('🚀 در حال راه‌اندازی سیستم مانیتورینگ دیوار...\n');
        await monitor.initialize();
        // console.log('✅ سیستم با موفقیت راه‌اندازی شد\n');
        
        await monitor.startMonitoring();

        process.on('SIGINT', async () => {
            // console.log('\n\n⚠️  دریافت سیگنال توقف...');
            await monitor.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ خطای کلی:', error);
        await monitor.close();
        process.exit(1);
    }
})();
