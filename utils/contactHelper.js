const { timeouts } = require("../config");
const { randomDelay } = require("./randomDelay");

// حداکثر زمان انتظار برای حل دستی چالش امنیتی + کد پیامک توسط کاربر (پیش‌فرض ۵ دقیقه)
const CAPTCHA_MANUAL_TIMEOUT =
    (timeouts && timeouts.captchaManual) || 5 * 60 * 1000;

// انتخابگر عنصر چالش ArcCaptcha (مرحله پازل)
const CHALLENGE_SELECTOR =
    ".kt-dimmer--open #challenge, .kt-dimmer--open .arc-puzzle, #challenge .arc-puzzle";

// انتخابگر مودال باز (هر مرحله‌ای: پازل یا کد پیامک)
const MODAL_OPEN_SELECTOR = ".kt-dimmer--open, [role='dialog']";

/**
 * وضعیت لحظه‌ای صفحه را می‌خواند (مقاوم در برابر ناوبری/رفرش).
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{
 *   phone:boolean, hidden:boolean, challenge:boolean, modalOpen:boolean, contextLost:boolean
 * }>}
 */
async function readPageState(page) {
    try {
        return await page.evaluate(
            (challengeSel, modalSel) => {
                const phone = !!document.querySelector('a[href^="tel:"]');

                const hidden = Array.from(
                    document.querySelectorAll(".kt-unexpandable-row__title")
                ).some((el) => el.textContent?.includes("شماره مخفی شده است"));

                const challenge = !!document.querySelector(challengeSel);
                const modalOpen = !!document.querySelector(modalSel);

                return { phone, hidden, challenge, modalOpen, contextLost: false };
            },
            CHALLENGE_SELECTOR,
            MODAL_OPEN_SELECTOR
        );
    } catch (e) {
        // صفحه در حال رفرش/ناوبری است و context از بین رفته؛ یعنی هنوز در جریان هستیم.
        return {
            phone: false,
            hidden: false,
            challenge: false,
            modalOpen: false,
            contextLost: true,
        };
    }
}

/**
 * دکمه تماس را پیدا و کلیک می‌کند. متن دکمه را هم برمی‌گرداند.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<'clicked'|'anonymous_contact'>}
 */
async function clickContactButton(page) {
    const contactButton = await page.waitForSelector(
        "button.post-actions__get-contact",
        { timeout: timeouts.elementWait }
    );

    if (!contactButton) {
        throw new Error("دکمه اطلاعات تماس پیدا نشد");
    }

    const buttonText = await page.evaluate((el) => {
        const label = el.querySelector(".kt-text-truncate");
        return (label?.textContent || el.textContent || "").trim();
    }, contactButton);

    if (buttonText.includes("تماس ناشناس")) {
        return "anonymous_contact";
    }

    await randomDelay(1000, 3000);
    await contactButton.click();
    await randomDelay(1500, 2500);

    return "clicked";
}

/**
 * تا رسیدن به وضعیت نهایی (شماره پیدا شد / مخفی) در یک حلقه مقاوم صبر می‌کند.
 * تمام مراحل میانی (پازل، بسته‌شدن موقت مودال، بازشدن دوباره برای کد پیامک،
 * ناوبری/رفرش) را تحمل می‌کند.
 *
 * فقط اگر مودال به‌طور «پایدار» بسته شد و شماره‌ای نیامد، یک‌بار دوباره کلیک می‌کند.
 *
 * @param {import('puppeteer').Page} page
 * @param {number} timeout
 * @returns {Promise<'phone_found'|'phone_hidden'|null>}
 */
async function waitForContactResolution(page, timeout) {
    const start = Date.now();

    // چند ثانیه پیوستهِ «مودال بسته و بدون شماره» تا مطمئن شویم واقعاً بسته شده
    // (نه فقط بازهٔ گذرای ۱ تا ۲ ثانیه‌ایِ بین پازل و کد پیامک).
    const CLOSED_STABLE_MS = 6000;
    let closedSince = null;
    let hasReclicked = false;

    while (Date.now() - start < timeout) {
        const s = await readPageState(page);

        if (s.phone) return "phone_found";
        if (s.hidden) return "phone_hidden";

        // اگر چالش یا هر مودالی باز است، یا صفحه در حال ناوبری است:
        // یعنی هنوز وسط جریان هستیم؛ شمارنده «بسته بودن» را ریست کن.
        if (s.challenge || s.modalOpen || s.contextLost) {
            closedSince = null;
        } else {
            // مودال بسته است و شماره‌ای هم نیست.
            if (closedSince === null) closedSince = Date.now();

            const closedFor = Date.now() - closedSince;

            // اگر برای مدت پایدار بسته ماند و هنوز کلیک مجدد نکرده‌ایم،
            // احتمالاً کل جریان تمام شده و باید یک‌بار دیگر دکمه را بزنیم.
            if (closedFor >= CLOSED_STABLE_MS && !hasReclicked) {
                hasReclicked = true;
                closedSince = null;
                try {
                    await clickContactButton(page);
                } catch (e) {
                    // اگر کلیک مجدد شکست خورد، حلقه ادامه می‌دهد تا تایم‌اوت.
                }
            }
        }

        await new Promise((r) => setTimeout(r, 700));
    }

    return null;
}

/**
 * روی دکمه تماس کلیک می‌کند و شماره/مخفی را برمی‌گرداند.
 * جریان چندمرحله‌ای دیوار (کپچا → بسته‌شدن موقت → کد پیامک → شماره) را مدیریت می‌کند.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{status:'phone_found'|'phone_hidden'|'anonymous_contact'}>}
 */
async function revealPhoneNumber(page) {
    try {
        console.log("📱 Checking the contact info button...");

        const clickResult = await clickContactButton(page);

        if (clickResult === "anonymous_contact") {
            console.log('🚫 The button is "Anonymous Call"; click was not performed.');
            return { status: "anonymous_contact" };
        }

        // وضعیت اولیه را سریع بررسی می‌کنیم
        const initial = await readPageState(page);

        if (initial.phone) return { status: "phone_found" };
        if (initial.hidden) return { status: "phone_hidden" };

        // اگر شماره فوری نیامد (چه کپچا باز شده باشد، چه هنوز در حال بارگذاری)،
        // وارد حلقهٔ انتظارِ مقاوم می‌شویم.
        if (initial.challenge || initial.modalOpen) {
            console.log(
                "🧩 چالش امنیتی/تأیید نمایش داده شد. لطفاً پازل و کد پیامک را به‌صورت دستی وارد کنید..."
            );
        }

        console.log(
            `⏳ حداکثر ${Math.round(
                CAPTCHA_MANUAL_TIMEOUT / 1000
            )} ثانیه برای تکمیل جریان تأیید و نمایش شماره منتظر می‌مانم.`
        );

        const status = await waitForContactResolution(
            page,
            CAPTCHA_MANUAL_TIMEOUT
        );

        if (!status) {
            throw new Error("شماره تماس در زمان مجاز نمایش داده نشد");
        }

        console.log("✅ وضعیت تماس مشخص شد:", status);

        await randomDelay(1000, 2000);

        return { status };
    } catch (error) {
        throw new Error(`خطا در دریافت اطلاعات تماس: ${error.message}`);
    }
}

module.exports = {
    revealPhoneNumber,
};
