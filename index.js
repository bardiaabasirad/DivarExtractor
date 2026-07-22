const { launch } = require("puppeteer");

const {
    checkInterval,
    puppeteerConfig,
    targetUrl,
    timeouts,
    externalRefsUrl,
    cookiesPath,
} = require("./config");

const BaseExtractor = require("./extractors/BaseExtractor");
const CookieManager = require("./cookieManager");
const { sendAdToServer } = require("./services/adSender");
const { loadBlacklist } = require("./utils/blacklist");
const { randomDelay } = require("./utils/randomDelay");

class DivarMonitor {
    constructor() {
        this.targetUrl = targetUrl;
        this.interval = checkInterval;
        this.browser = null;
        this.mainPage = null;
        this.cookieManager = new CookieManager(cookiesPath);
        this.extractor = null;

        this.isChecking = false;
        this.stopRequested = false;

        this.statistics = {
            totalChecks: 0,
            totalAdsFound: 0,
            totalAdsProcessed: 0,
            saleAds: 0,
            rentAds: 0,
            successfullySent: 0,
            errors: 0,
            skippedBecauseOfDatabase: 0,
            skippedBecauseOfBlacklist: 0,
            reloadRetries: 0,
            reloadFailures: 0,
            skippedBecauseLocked: 0,
        };
    }

    async initialize() {
        this.browser = await launch(puppeteerConfig);
        this.mainPage = await this.browser.newPage();

        this.extractor = new BaseExtractor(this.browser);

        const cookies = await this.cookieManager.loadCookies();

        if (cookies.length > 0) {
            await this.cookieManager.setCookies(this.mainPage, cookies);
        }

        await this.safeNavigate(this.targetUrl);

        if (cookies.length > 0) {
            await this.cookieManager.verifyLogin(this.mainPage);
        }

        await this.cookieManager.saveCookies(this.mainPage);

        await this.waitForAdsContainer();

        console.log("✅ Monitor initialized successfully.");
    }

    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async delayWithJitter(baseMs, jitterMs = 500) {
        const extra = Math.floor(Math.random() * jitterMs);
        await this.delay(baseMs + extra);
    }

    async withCheckLock(callback) {
        if (this.isChecking) {
            this.statistics.skippedBecauseLocked++;
            console.warn(
                "⚠️ checkForNewAds skipped because previous check is still running."
            );
            return;
        }

        this.isChecking = true;

        try {
            return await callback();
        } finally {
            this.isChecking = false;
        }
    }

    async waitForAdsContainer() {
        const cardLinkSelector = "article.kt-post-card a.kt-post-card__action";

        await this.mainPage.waitForSelector(cardLinkSelector, {
            visible: true,
            timeout: timeouts.elementWait,
        });

        await this.mainPage.waitForFunction(
            (selector) => {
                const links = document.querySelectorAll(selector);
                return links && links.length > 0;
            },
            {
                timeout: timeouts.elementWait,
            },
            cardLinkSelector
        );

        await this.delay(1200);
    }

    async safeNavigate(url, options = {}) {
        const finalOptions = {
            waitUntil: "domcontentloaded",
            timeout: timeouts.pageLoad,
            ...options,
        };

        await this.mainPage.goto(url, finalOptions);
    }

    async reloadMainPageAndWait() {
        const maxAttempts = 4;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const useGoto = attempt > 1;
            const actionLabel = useGoto ? "goto" : "reload";

            try {
                console.log(
                    `🔄 Page refresh attempt ${attempt}/${maxAttempts} using ${actionLabel}...`
                );

                const currentUrl = this.mainPage.url();

                if (!currentUrl || currentUrl === "about:blank" || useGoto) {
                    await this.safeNavigate(this.targetUrl);
                } else {
                    await this.mainPage.reload({
                        waitUntil: "domcontentloaded",
                        timeout: timeouts.pageLoad,
                    });
                }

                await this.waitForAdsContainer();

                console.log(`✅ Page loaded successfully on attempt ${attempt}.`);
                return;
            } catch (error) {
                lastError = error;
                this.statistics.reloadRetries++;

                console.warn(
                    `⚠️ Reload attempt ${attempt} failed: ${error.message}`
                );

                if (attempt < maxAttempts) {
                    const backoffMs = attempt * 2000;
                    console.log(`⏳ Retrying after ${backoffMs}ms...`);
                    await this.delayWithJitter(backoffMs, 1200);
                }
            }
        }

        this.statistics.reloadFailures++;
        throw new Error(
            `Failed to refresh page after multiple attempts. Last error: ${lastError?.message}`
        );
    }

    async getExistingAdIdsFromApi() {
        let existingAdIds = [];

        try {
            const response = await fetch(externalRefsUrl);

            if (response.ok) {
                const payload = await response.json();
                const source = payload?.data ?? payload;

                const rawIds = Array.isArray(source)
                    ? source
                    : source && typeof source === "object"
                        ? Object.values(source)
                        : [];

                existingAdIds = rawIds.filter(Boolean).map((id) => String(id));

                console.log(
                    `✅ Number of adIds found in the database: ${existingAdIds.length}`
                );
            } else {
                console.warn(
                    `⚠️ Failed to fetch adIds (status: ${response.status})`
                );
            }
        } catch (apiError) {
            console.warn(
                "⚠️ Error fetching the list of existing adIds:",
                apiError.message
            );
        }

        return existingAdIds;
    }

    getBlacklistedAdIds() {
        const blacklist = loadBlacklist() || [];

        const blacklistedAdIds = blacklist
            .map((item) => item?.adId)
            .filter(Boolean)
            .map((id) => String(id));

        console.log(`🚫 Number of blacklisted ads: ${blacklistedAdIds.length}`);

        return blacklistedAdIds;
    }

    async autoScrollForMoreAds(scrollRounds = 3) {
        for (let i = 0; i < scrollRounds; i++) {
            await this.mainPage.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            const scrollDelay = Math.floor(Math.random() * 2000) + 1500;
            await this.delay(scrollDelay);
        }
    }

    async getAllAdsLinks() {
        try {
            const existingAdIds = await this.getExistingAdIdsFromApi();
            const blacklistedAdIds = this.getBlacklistedAdIds();

            await this.reloadMainPageAndWait();
            await this.autoScrollForMoreAds(3);

            const { ads, skippedDbCount, skippedBlacklistCount, rawCardCount } =
                await this.mainPage.evaluate(
                    (existingIds, blacklistedIds) => {
                        const existingSet = new Set(existingIds);
                        const blacklistSet = new Set(blacklistedIds);

                        const result = {
                            ads: [],
                            skippedDbCount: 0,
                            skippedBlacklistCount: 0,
                            rawCardCount: 0,
                        };

                        const links = Array.from(
                            document.querySelectorAll(
                                "article.kt-post-card a.kt-post-card__action"
                            )
                        );

                        const seenIds = new Set();
                        result.rawCardCount = links.length;

                        links.forEach((link, idx) => {
                            const href = link.getAttribute("href");
                            if (!href) return;

                            const normalizedUrl = new URL(href, "https://divar.ir");
                            const pathParts = normalizedUrl.pathname
                                .split("/")
                                .filter(Boolean);
                            const adId = pathParts[pathParts.length - 1];

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

                            result.ads.push({
                                index: idx,
                                adId,
                                href,
                                fullUrl: normalizedUrl.href,
                            });
                        });

                        return result;
                    },
                    existingAdIds,
                    blacklistedAdIds
                );

            this.statistics.skippedBecauseOfDatabase += skippedDbCount;
            this.statistics.skippedBecauseOfBlacklist += skippedBlacklistCount;

            console.log(`📄 Number of cards found: ${rawCardCount}`);
            console.log(
                `⏭️ Number of ads skipped due to database match: ${skippedDbCount}`
            );
            console.log(
                `🚫 Number of ads skipped due to blacklist: ${skippedBlacklistCount}`
            );
            console.log(`✅ Number of ads ready for processing: ${ads.length}`);

            return ads;
        } catch (error) {
            this.statistics.errors++;
            console.error("❌ Error in getAllAdsLinks:", error.message);
            return [];
        }
    }

    async checkForNewAds() {
        return this.withCheckLock(async () => {
            this.statistics.totalChecks++;

            await randomDelay(1000, 3000);

            const adsData = await this.getAllAdsLinks();
            this.statistics.totalAdsFound += adsData.length;

            if (adsData.length === 0) {
                console.log("ℹ️ No new ads found.");
                return;
            }

            for (let i = 0; i < adsData.length; i++) {
                const ad = adsData[i];
                const isLastAd = i === adsData.length - 1;

                this.statistics.totalAdsProcessed++;

                try {
                    const adData = await this.extractor.processAd(ad.fullUrl);

                    if (!adData) {
                        console.warn(
                            `⚠️ No data extracted for ad ${ad.adId}; skipping submission.`
                        );
                        continue;
                    }

                    if (adData.adType === "rent") {
                        this.statistics.rentAds++;
                    } else {
                        this.statistics.saleAds++;
                    }

                    await sendAdToServer(adData);
                    this.statistics.successfullySent++;
                    console.log(
                        `🚀 Ad ${ad.adId} (${adData.adType}) submitted.`
                    );
                } catch (error) {
                    this.statistics.errors++;
                    console.error(
                        `❌ Error processing/submitting ad ${ad.adId}:`,
                        error.message
                    );
                } finally {
                    if (!isLastAd) {
                        await this.waitRandomDelay();
                    }
                }
            }
        });
    }

    async waitRandomDelay() {
        const seconds =
            Math.floor(Math.random() * (timeouts.maxDelay - timeouts.minDelay + 1)) +
            timeouts.minDelay;

        const delayMs = seconds * 1000;
        console.log(`⏳ Next ad processing in ${seconds} seconds...`);
        await this.delay(delayMs);
    }

    logStatistics() {
        console.log("📊 Current statistics:", JSON.stringify(this.statistics, null, 2));
    }

    async startMonitoring() {
        console.log("🚀 Monitoring started.");

        while (!this.stopRequested) {
            const startedAt = Date.now();

            try {
                await this.checkForNewAds();
            } catch (error) {
                this.statistics.errors++;
                console.error("❌ Unexpected monitoring error:", error.message);
            }

            this.logStatistics();

            const elapsed = Date.now() - startedAt;
            const remainingTime = Math.max(0, this.interval - elapsed);

            console.log(`⏳ Next check in ${Math.ceil(remainingTime / 1000)} seconds...`);
            await this.delay(remainingTime);
        }

        console.log("🛑 Monitoring stopped gracefully.");
    }

    async close() {
        this.stopRequested = true;

        await this.cookieManager.saveCookies(this.mainPage);

        if (this.browser) {
            await this.browser.close();
        }
    }
}

(async () => {
    const monitor = new DivarMonitor();

    try {
        await monitor.initialize();

        const gracefulShutdown = async () => {
            console.log("🛑 Shutdown signal received...");
            await monitor.close();
            process.exit(0);
        };

        process.on("SIGINT", gracefulShutdown);
        process.on("SIGTERM", gracefulShutdown);

        await monitor.startMonitoring();
    } catch (error) {
        console.error("❌ General application error:", error.message);
        await monitor.close();
        process.exit(1);
    }
})();