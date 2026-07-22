const fs = require("fs/promises");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieManager {
    constructor(cookieFilePath = "./cookies.json") {
        this.cookieFilePath = cookieFilePath;
    }

    async loadCookies() {
        try {
            const cookiesData = await fs.readFile(this.cookieFilePath, "utf-8");
            const cookies = JSON.parse(cookiesData);

            if (!Array.isArray(cookies)) {
                console.warn("⚠️  cookies.json does not contain an array");
                return [];
            }

            return cookies;
        } catch (error) {
            if (error.code === "ENOENT") {
                console.warn("⚠️  cookies.json file not found");
                return [];
            }

            console.error("❌ Error reading cookies:", error.message);
            return [];
        }
    }

    normalizeCookie(cookie) {
        const cloned = { ...cookie };

        if (cloned.expires == null && cloned.expirationDate != null) {
            cloned.expires = cloned.expirationDate;
        }

        if (cloned.expires && typeof cloned.expires === "string") {
            const parsed = new Date(cloned.expires).getTime();
            if (!Number.isNaN(parsed)) {
                cloned.expires = Math.floor(parsed / 1000);
            } else {
                delete cloned.expires;
            }
        } else if (typeof cloned.expires === "number" && cloned.expires > 10000000000) {
            cloned.expires = Math.floor(cloned.expires / 1000);
        }

        delete cloned.expirationDate;
        delete cloned.hostOnly;
        delete cloned.session;
        delete cloned.storeId;
        delete cloned.id;
        delete cloned.sameSite;
        delete cloned.firstPartyDomain;
        delete cloned.partitionKey;

        return cloned;
    }

    async setCookies(page, cookies) {
        if (!cookies || cookies.length === 0) {
            console.log("ℹ️  No cookies to set");
            return false;
        }

        try {
            const processedCookies = cookies
                .map((cookie) => this.normalizeCookie(cookie))
                .filter((cookie) => cookie.name && cookie.value);

            if (processedCookies.length === 0) {
                console.warn("⚠️  No valid cookies remained after normalization");
                return false;
            }

            await page.setCookie(...processedCookies);
            console.log(`✅ ${processedCookies.length} cookies set successfully`);

            const currentCookies = await page.cookies();
            console.log(`🔎 Page now has ${currentCookies.length} cookies`);

            return true;
        } catch (error) {
            console.error("❌ Error setting cookies:", error.message);
            return false;
        }
    }

    async saveCookies(page) {
        const cookies = await page.cookies();
        const tempPath = `${this.cookieFilePath}.tmp`;

        await fs.writeFile(
            tempPath,
            JSON.stringify(cookies, null, 2),
            "utf-8"
        );

        await fs.rename(tempPath, this.cookieFilePath);

        console.log(`✅ ${cookies.length} cookies saved`);
        return true;
    }

    async verifyLogin(page, options = {}) {
        const {
            waitTimeout = 15000,
            afterClickDelay = 1200,
            allowRetry = true,
        } = options;

        const selectors = {
            icon: [
                "button.kt-nav-button .kt-icon-person",
                "button [class*='person']",
                "button svg",
            ],
            menuOpen: [
                ".kt-dropdown-menu__menu--open",
                "[class*='dropdown'][class*='open']",
            ],
            loggedIn: [
                ".kt-icon-log-out-o",
                'a[href="/my-divar/my-posts"]',
                'a[href*="/my-divar/"]',
            ],
            loggedOut: [
                ".kt-icon-log-in-o",
                'a[href*="/login"]',
            ],
        };

        const findFirstVisible = async (candidates, timeout = 3000) => {
            for (const selector of candidates) {
                try {
                    await page.waitForSelector(selector, {
                        visible: true,
                        timeout,
                    });
                    return selector;
                } catch (e) {}
            }
            return null;
        };

        try {
            const iconSelector = await findFirstVisible(selectors.icon, waitTimeout);

            if (!iconSelector) {
                console.warn("⚠️  Login icon not found");
                return false;
            }

            const iconHandle = await page.$(iconSelector);
            if (!iconHandle) {
                console.warn("⚠️  Login icon handle not found");
                return false;
            }

            const buttonHandle = await iconHandle.evaluateHandle((el) =>
                el.closest("button")
            );

            const buttonElement = buttonHandle.asElement();
            if (!buttonElement) {
                console.warn("⚠️  Login button element not found");
                return false;
            }

            if (buttonElement.scrollIntoViewIfNeeded) {
                await buttonElement.scrollIntoViewIfNeeded();
            } else {
                await page.evaluate((el) => {
                    el.scrollIntoView({ block: "center", behavior: "instant" });
                }, buttonElement);
            }

            await sleep(300);
            await buttonElement.click({ delay: 50 });

            const menuSelector = await findFirstVisible(selectors.menuOpen, 5000);
            if (!menuSelector) {
                console.warn("⚠️  Login menu did not open in time");
                return false;
            }

            await sleep(afterClickDelay);

            const loginStatus = await page.evaluate((sel) => {
                const menu =
                    document.querySelector(".kt-dropdown-menu__menu--open") ||
                    document.querySelector("[class*='dropdown'][class*='open']") ||
                    document;

                const hasLoggedIn = sel.loggedIn.some((s) => menu.querySelector(s));
                const hasLoggedOut = sel.loggedOut.some((s) => menu.querySelector(s));

                if (hasLoggedIn) {
                    return { isLoggedIn: true, reason: "Logged-in indicator found" };
                }

                if (hasLoggedOut) {
                    return { isLoggedIn: false, reason: "Logged-out indicator found" };
                }

                const profileLink =
                    document.querySelector('a[href="/my-divar/my-posts"]') ||
                    document.querySelector('a[href*="/my-divar/"]');

                if (profileLink) {
                    return { isLoggedIn: true, reason: "Profile link found" };
                }

                return { isLoggedIn: false, reason: "No sign of login found" };
            }, selectors);

            try {
                await page.click("body");
            } catch (e) {}

            await sleep(300);

            console.log(
                loginStatus.isLoggedIn
                    ? `✅ Login verified - ${loginStatus.reason}`
                    : `⚠️  Not logged in - ${loginStatus.reason}`
            );

            return loginStatus.isLoggedIn;
        } catch (error) {
            console.error("❌ Error verifying login:", error.message);

            if (allowRetry) {
                try {
                    console.log("🔁 Retrying login verification once...");
                    await sleep(2000);
                    return await this.verifyLogin(page, {
                        waitTimeout: Math.min(waitTimeout + 5000, 25000),
                        afterClickDelay,
                        allowRetry: false,
                    });
                } catch (e) {}
            }

            try {
                await page.click("body");
            } catch (e) {}

            return false;
        }
    }
}

module.exports = CookieManager;