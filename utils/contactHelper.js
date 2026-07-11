import { timeouts } from '../config.js';
import { randomDelay } from './randomDelay.js';

/**
 * Clicks on contact button and waits for phone number or hidden status
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{status: 'phone_found'} | {status: 'phone_hidden'} | {status: 'anonymous_contact'}>}
 */
export async function revealPhoneNumber(page) {
    try {
        console.log('📱 Checking the contact info button...');

        const contactButton = await page.waitForSelector(
            'button.post-actions__get-contact',
            { timeout: timeouts.elementWait }
        );

        if (!contactButton) {
            throw new Error('دکمه اطلاعات تماس پیدا نشد');
        }

        // 🔍 خواندن متن دکمه قبل از هر کلیکی
        const buttonText = await page.evaluate(el => {
            const label = el.querySelector('.kt-text-truncate');
            return (label?.textContent || el.textContent || '').trim();
        }, contactButton);

        // 🚫 اگر دکمه «تماس ناشناس» بود، اصلاً کلیک نکن
        if (buttonText.includes('تماس ناشناس')) {
            console.log('🚫 The button is "Anonymous Call"; click was not performed.');
            return { status: 'anonymous_contact' };
        }

        // ⏱️ تاخیر قبل از کلیک
        await randomDelay(1000, 3000);

        await contactButton.click();

        // ⏱️ تاخیر بعد از کلیک
        await randomDelay(1500, 2500);

        const contactStatus = await page.waitForFunction(
            () => {
                const phoneLink = document.querySelector('a[href^="tel:"]');
                if (phoneLink) return 'phone_found';

                const hiddenText = Array.from(
                    document.querySelectorAll('.kt-unexpandable-row__title')
                ).find(el =>
                    el.textContent?.includes('شماره مخفی شده است')
                );

                if (hiddenText) return 'phone_hidden';

                return null;
            },
            { timeout: 5000, poling: 100 }
        );

        await randomDelay(1000, 2000);

        return { status: await contactStatus.jsonValue() };

    } catch (error) {
        throw new Error(`خطا در دریافت اطلاعات تماس: ${error.message}`);
    }
}
