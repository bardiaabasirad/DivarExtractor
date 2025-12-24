import { timeouts } from '../config.js';
import { revealPhoneNumber } from '../utils/contactHelper.js';
import {convertPersianPriceToNumber} from "../utils/priceUtils.js";

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
            console.log(`\n🔍 در حال بازکردن صفحه آگهی ${this.getLogTitle()}...`);

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
                await page.close();
                return null;
            }

            console.log('✅ شماره تلفن یافت شد');

            // استخراج داده‌های عمومی
            const commonData = await page.evaluate((adType, adId, adUrl) => {
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

                // استخراج ویژگی‌ها (آسانسور، پارکینگ، انباری) - اصلاح شده
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

                // استخراج توضیحات - نسخه نهایی و دقیق
                data.description = null;

                // فقط توضیحات داخل section اصلی صفحه را بگیر
                const sections = document.querySelectorAll('section.post-page__section--padded');
                for (const section of sections) {
                    // بررسی اینکه h2 با عنوان "توضیحات" داخل این section وجود دارد
                    const h2 = section.querySelector('h2.kt-title-row__title');
                    if (h2 && h2.textContent.trim() === 'توضیحات') {
                        // حالا پاراگراف توضیحات را پیدا کن
                        const descParagraph = section.querySelector('p.kt-description-row__text');
                        if (descParagraph) {
                            const text = descParagraph.textContent.trim();
                            // فیلتر متن پیش‌فرض
                            if (text && text !== 'موردی برای نمایش وجود ندارد') {
                                data.description = text;
                                break;
                            }
                        }
                    }
                }

                // استخراج دسته‌بندی
                // استخراج دقیق دسته‌بندی از breadcrumb
                const breadcrumbLinks = document.querySelectorAll('.kt-breadcrumbs__item a[href*="/buy-"], .kt-breadcrumbs__item a[href*="/rent-"]');
                data.category = breadcrumbLinks.length > 0
                    ? breadcrumbLinks[breadcrumbLinks.length - 1].textContent.trim()
                    : null;

                // استخراج تصاویر - فقط با کیفیت بالا
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

                if (data.area) {
                    data.area = convertPersianPriceToNumber(data.area);
                }

                if (data.buildYear) {
                    data.buildYear = convertPersianPriceToNumber(data.buildYear);
                }

                if (data.rooms) {
                    data.rooms = convertPersianPriceToNumber(data.rooms);
                }

                return {
                    adType,
                    adId,
                    adUrl,
                    ...data
                };
            }, this.getAdType(), adId, adUrl);

            return { page, data: commonData };

        } catch (error) {
            await page.close();
            throw error;
        }
    }
}
