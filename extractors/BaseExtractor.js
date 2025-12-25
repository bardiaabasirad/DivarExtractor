import {cityId, timeouts} from '../config.js';
import { revealPhoneNumber } from '../utils/contactHelper.js';
import { convertPersianPriceToNumber } from "../utils/priceUtils.js";
import { addToBlacklist } from '../utils/blacklist.js';

export default class BaseExtractor {
    constructor(browser) {
        this.browser = browser;
    }

    getAdType() {
        throw new Error('getAdType() must be implemented');
    }

    getLogTitle() {
        throw new Error('getLogTitle() must be implemented');
    }

    extractAdId(adUrl) {
        return adUrl.split('/').pop();
    }

    /**
     * مراحل مشترک پردازش آگهی
     */
    async processCommon(adUrl) {
        const page = await this.browser.newPage();

        try {
            await page.goto(adUrl, {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            const adId = this.extractAdId(adUrl);

            await page.waitForSelector('h1', { timeout: timeouts.elementWait });

            // کلیک روی اطلاعات تماس
            const { status } = await revealPhoneNumber(page);

            if (status === 'phone_hidden') {
                console.log('❌ شماره تلفن این آگهی مخفی است - رد شد');

                // افزودن به لیست سیاه
                addToBlacklist(adId, 'phone_hidden');

                await page.close();
                return null;
            }

            console.log('✅ شماره تلفن یافت شد');

            const commonData = await page.evaluate((adType, adId, adUrl) => {
                try {
                    const data = { adType, adId, adUrl };

                    // عنوان
                    const title = document.querySelector('h1');
                    data.title = title?.textContent.trim() ?? null;

                    // تلفن
                    const phoneLink = document.querySelector('a[href^="tel:"]');
                    data.phoneNumber = phoneLink
                        ? phoneLink.getAttribute('href').replace('tel:', '')
                        : null;

                    // زمان و موقعیت
                    const locationElement = document.querySelector('h1 + div.kt-page-title__subtitle');
                    if (locationElement) {
                        const fullText = locationElement.textContent.trim();
                        const parts = fullText.split(' در ');
                        data.timeAgo = parts[0]?.trim();
                        data.location = parts[1]?.trim();
                    }

                    // جدول اصلی
                    const table = document.querySelector('table.kt-group-row');
                    if (table) {
                        const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
                        const values  = [...table.querySelectorAll('tbody td')].map(td => td.textContent.trim());

                        const getValue = key => {
                            const index = headers.indexOf(key);
                            return index >= 0 ? values[index] : null;
                        };

                        data.area      = getValue('متراژ');
                        data.buildYear = getValue('ساخت');
                        data.rooms     = getValue('اتاق');
                    }

                    // استخراج متراژ از section (اگر در جدول نبود)
                    if (!data.area) {
                        const allSections = document.querySelectorAll('section');
                        allSections.forEach(section => {
                            const title = section.querySelector('p.kt-base-row__title');
                            if (title && title.textContent.trim() === 'متراژ') {
                                const value = section.querySelector('p.kt-base-row__title + p');
                                data.area = value ? value.textContent.trim() : null;
                            }
                        });
                    }

                    // استخراج ویژگی‌ها
                    data.features = {
                        elevator: null,
                        parking: null,
                        warehouse: null
                    };

                    const featureTables = document.querySelectorAll('table.kt-group-row');
                    featureTables.forEach(table => {
                        const cells = table.querySelectorAll('td.kt-group-row-item__value');
                        cells.forEach(cell => {
                            const text = cell.textContent.trim();
                            const isDisabled = cell.classList.contains('kt-group-row-item--disabled');

                            if (text.includes('آسانسور')) {
                                data.features.elevator = !isDisabled;
                            }
                            if (text.includes('پارکینگ')) {
                                data.features.parking = !isDisabled;
                            }
                            if (text.includes('انباری')) {
                                data.features.warehouse = !isDisabled;
                            }
                        });
                    });

                    // استخراج توضیحات
                    data.description = null;
                    const sections = document.querySelectorAll('section.post-page__section--padded');
                    for (const section of sections) {
                        const h2 = section.querySelector('h2.kt-title-row__title');
                        if (h2 && h2.textContent.trim() === 'توضیحات') {
                            const descParagraph = section.querySelector('p.kt-description-row__text');
                            if (descParagraph) {
                                const text = descParagraph.textContent.trim();
                                if (text && text !== 'موردی برای نمایش وجود ندارد') {
                                    data.description = text;
                                    break;
                                }
                            }
                        }
                    }

                    // استخراج دسته‌بندی
                    const breadcrumbLinks = document.querySelectorAll('.kt-breadcrumbs__item a[href*="/buy-"], .kt-breadcrumbs__item a[href*="/rent-"]');
                    data.category = breadcrumbLinks.length > 0
                        ? breadcrumbLinks[breadcrumbLinks.length - 1].textContent.trim()
                        : null;

                    // استخراج تصاویر
                    data.images = [];
                    const imageElements = document.querySelectorAll('img[src*="divarcdn.com"]');
                    imageElements.forEach(img => {
                        const src = img.getAttribute('src');
                        if (src && src.includes('webp_post') && !data.images.includes(src)) {
                            data.images.push(src);
                        }
                    });

                    if (data.images.length === 0) {
                        imageElements.forEach(img => {
                            const src = img.getAttribute('src');
                            if (src && !src.includes('thumbnail') && !data.images.includes(src)) {
                                data.images.push(src);
                            }
                        });
                    }

                    console.log('✅ استخراج داده‌ها کامل شد');
                    return data;

                } catch (error) {
                    console.error('❌ خطا در evaluate:', error.message);
                    throw error;
                }
            }, this.getAdType(), adId, adUrl);

            // تبدیل مقادیر عددی در محیط Node.js
            if (commonData.area) {
                commonData.area = convertPersianPriceToNumber(commonData.area);
            }

            if (commonData.buildYear) {
                commonData.buildYear = convertPersianPriceToNumber(commonData.buildYear);
            }

            if (commonData.rooms) {
                commonData.rooms = convertPersianPriceToNumber(commonData.rooms);
            }

            commonData.cityId = cityId;

            return { page, data: commonData };

        } catch (error) {
            console.error('❌ خطا در processCommon:', error.message);
            console.error(error.stack);
            await page.close();
            throw error;
        }
    }
}
