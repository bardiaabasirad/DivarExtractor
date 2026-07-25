const { timeouts } = require("../config");
const { randomDelay } = require("./randomDelay");

// حداکثر زمان انتظار برای حل دستی چالش امنیتی توسط کاربر (پیش‌فرض ۵ دقیقه)
const CAPTCHA_MANUAL_TIMEOUT =
    (timeouts && timeouts.captchaManual) || 5 * 60 * 1000;

// انتخابگرهای عنصر چالش ArcCaptcha
const CAPTCHA_SELECTORS =
    ".kt-dimmer--open #challenge, .kt-dimmer--open .arc-puzzle, #challenge .arc-puzzle";

/**
 * آیا مودال چالش امنیتی هنوز باز است؟ (مقاوم در برابر ناوبری/رفرش صفحه)
 * @param {import('puppeteer').Page} page
 * @param {string} selectors
 * @returns {Promise<boolean>}
 */
async function isCaptchaOpen(page, selectors) {
    try {
        return await page.evaluate(
            (sel) => !!document.querySelector(sel),
            selectors
        );
    } catch (e) {
        // اگر صفحه در حال رفرش/ناوبری باشد، context از بین می‌رود؛
        // آن را «هنوز در حال حل» در نظر می‌گیریم و ادامه می‌دهیم.
        return true;
    }
}

/**
 * تا زمان حل دستی چالش توسط کاربر (یا تایم‌اوت) صبر می‌کند.
 * @param {import('puppeteer').Page} page
 * @param {number} timeout
 * @returns {Promise<boolean>} true اگر حل شد، false اگر تایم‌اوت شد
 */
async function waitForCaptchaResolved(page, timeout) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const stillOpen = await isCaptchaOpen(page, CAPTCHA_SELECTORS);
        if (!stillOpen) return true;
        await new Promise((r) => setTimeout(r, 1000));
    }

    return false;
}

/**
 * روی دکمه تماس کلیک می‌کند و منتظر یکی از سه حالت می‌ماند:
 * شماره پیدا شد / شماره مخفی / چالش امنیتی نمایش داده شد.
 * @param {import('puppeteer').Page} page
 * @param {number} timeout
 * @returns {Promise<'phone_found'|'phone_hidden'|'captcha_required'|null>}
 */
async function clickAndDetect(page, timeout) {
    const contactButton = await page.waitForSelector(
        "button.post-actions__get-contact",
        { timeout: timeouts.elementWait }
    );

    if (!contactButton) {
        throw new Error("دکمه اطلاعات تماس پیدا نشد");
    }

    // 🔍 خواندن متن دکمه قبل از کلیک
    const buttonText = await page.evaluate((el) => {
        const label = el.querySelector(".kt-text-truncate");
        return (label?.textContent || el.textContent || "").trim();
    }, contactButton);

    // 🚫 دکمه «تماس ناشناس»
    if (buttonText.includes("تماس ناشناس")) {
        return "anonymous_contact";
    }

    await randomDelay(1000, 3000);
    await contactButton.click();
    await randomDelay(1500, 2500);

    const handle = await page.waitForFunction(
        (captchaSel) => {
            const phoneLink = document.querySelector('a[href^="tel:"]');
            if (phoneLink) return "phone_found";

            const hiddenText = Array.from(
                document.querySelectorAll(".kt-unexpandable-row__title")
            ).find((el) => el.textContent?.includes("شماره مخفی شده است"));
            if (hiddenText) return "phone_hidden";

            if (document.querySelector(captchaSel)) return "captcha_required";

            return null;
        },
        { timeout, polling: 200 },
        CAPTCHA_SELECTORS
    );

    return await handle.jsonValue();
}

/**
 * Clicks on contact button and waits for phone number or hidden status.
 * اگر چالش امنیتی ظاهر شود، تا حل دستی توسط کاربر صبر می‌کند، سپس دوباره
 * دکمه تماس را کلیک می‌کند تا شماره واقعی نمایش داده شود.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{status:'phone_found'|'phone_hidden'|'anonymous_contact'}>}
 */
async function revealPhoneNumber(page) {
    try {
        console.log("📱 Checking the contact info button...");

        let status = await clickAndDetect(page, 8000);

        if (status === "anonymous_contact") {
            console.log('🚫 The button is "Anonymous Call"; click was not performed.');
            return { status: "anonymous_contact" };
        }

        // 🧩 اگر چالش امنیتی باز شد
        if (status === "captcha_required") {
            console.log(
                "🧩 چالش امنیتی (ArcCaptcha) نمایش داده شد. لطفاً چالش را به‌صورت دستی حل کنید..."
            );
            console.log(
                `⏳ حداکثر ${Math.round(
                    CAPTCHA_MANUAL_TIMEOUT / 1000
                )} ثانیه برای حل چالش منتظر می‌مانم.`
            );

            const resolved = await waitForCaptchaResolved(
                page,
                CAPTCHA_MANUAL_TIMEOUT
            );

            if (!resolved) {
                throw new Error("چالش امنیتی در زمان مجاز حل نشد");
            }

            console.log("✅ چالش امنیتی حل شد. تلاش مجدد برای دریافت شماره...");

            // آرام‌شدن صفحه بعد از بسته‌شدن مودال / رفرش احتمالی
            await randomDelay(2000, 3500);

            // 🔁 چون مودال بسته شده، باید دوباره روی دکمه تماس کلیک کنیم
            status = await clickAndDetect(page, timeouts.elementWait || 15000);

            // اگر باز هم کپچا آمد، این‌بار خطا می‌دهیم تا در حلقه بی‌نهایت نیفتیم
            if (status === "captcha_required") {
                throw new Error("چالش امنیتی مجدداً نمایش داده شد");
            }
        }

        if (!status) {
            throw new Error("وضعیت تماس نامشخص است");
        }

        await randomDelay(1000, 2000);

        return { status };
    } catch (error) {
        throw new Error(`خطا در دریافت اطلاعات تماس: ${error.message}`);
    }
}

module.exports = {
    revealPhoneNumber,
};
