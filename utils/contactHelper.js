import { timeouts } from '../config.js';

/**
 * Clicks on contact button and waits for phone number or hidden status
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{status: 'phone_found'} | {status: 'phone_hidden'}>}
 */
export async function revealPhoneNumber(page) {
    try {
        console.log('📱 در حال کلیک روی دکمه اطلاعات تماس...');

        const contactButton = await page.waitForSelector(
            'button.post-actions__get-contact',
            { timeout: timeouts.elementWait }
        );

        if (!contactButton) {
            throw new Error('دکمه اطلاعات تماس پیدا نشد');
        }

        await contactButton.click();

        const contactStatus = await page.waitForFunction(
            () => {
                // ✅ حالت 1: شماره پیدا شد
                const phoneLink = document.querySelector('a[href^="tel:"]');
                if (phoneLink) return 'phone_found';

                // ✅ حالت 2: شماره مخفی شده
                const hiddenText = Array.from(
                    document.querySelectorAll('.kt-unexpandable-row__title')
                ).find(el =>
                    el.textContent?.includes('شماره مخفی شده است')
                );

                if (hiddenText) return 'phone_hidden';

                return null;
            },
            { timeout: 5000, polling: 100 }
        );

        return { status: await contactStatus.jsonValue() };

    } catch (error) {
        throw new Error(`خطا در دریافت اطلاعات تماس: ${error.message}`);
    }
}