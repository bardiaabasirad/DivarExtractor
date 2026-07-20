const { cityId, timeouts } = require('../config');
const { revealPhoneNumber } = require('../utils/contactHelper');
const { convertPersianPriceToNumber } = require('../utils/priceUtils');
const { addToBlacklist } = require('../utils/blacklist');
const { humanScroll } = require('../utils/humanScroll');
const { randomDelay } = require('../utils/randomDelay');

const MAP_STYLE_PATTERN = 'base-style-light';

class BaseExtractor {
    constructor(browser) {
        this.browser = browser;
    }

    extractAdId(adUrl) {
        try {
            const url = new URL(adUrl, 'https://divar.ir');
            const segments = url.pathname.split('/').filter(Boolean);

            return segments.at(-1) || null;
        } catch (error) {
            console.error('Failed to extract adId from URL:', adUrl, error);
            return null;
        }
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

            if (status === 'anonymous_contact') {
                console.log('🚫 "Anonymous Call" button found - ad added to blacklist');
                addToBlacklist(adId, 'anonymous_contact');
                await humanScroll(page);
                await randomDelay(1000, 3000);
                await page.close();
                return null;
            }

            if (status === 'phone_hidden') {
                console.log('❌ This ad phone number is hidden - skipped');

                // افزودن به لیست سیاه
                addToBlacklist(adId, 'phone_hidden');

                await humanScroll(page);

                // ⏱️ تاخیر قبل از بستن تب (جلوگیری از بستن ناگهانی)
                await randomDelay(1000, 3000);

                await page.close();
                return null;
            }

            console.log('✅ Phone number found');

            await humanScroll(page);
            await randomDelay(1000, 3000);

            const commonData = await page.evaluate((adId, adUrl) => {
                try {
                    const data = { adId, adUrl };

                    // عنوان
                    const title = document.querySelector('h1');
                    data.title = title?.textContent.trim() ?? null;

                    // تلفن
                    const phoneLink = document.querySelector('a[href^="tel:"]');
                    data.phoneNumber = phoneLink
                        ? phoneLink.getAttribute('href').replace('tel:', '')
                        : null;

                    // ۱. انتخاب المان با استفاده از کلاس دقیق جدید
                    const titleElement = document.querySelector('.kt-info-row__title');

                    if (titleElement) {
                        const fullText = titleElement.textContent.trim();

                        // ۲. تقسیم متن بر اساس کلمه " در " برای جدا کردن زمان از مکان
                        const parts = fullText.split(' در ');

                        if (parts.length > 1) {
                            data.timeAgo = parts[0].trim(); // "۷ ساعت پیش"

                            // ۳. حالا بخش دوم یعنی "نورآباد، خ پاسداران ۸" را داریم
                            const locationPart = parts[1];

                            // استخراج بخش بعد از ویرگول (یعنی دقیقاً "خ پاسداران ۸")
                            if (locationPart.includes('،')) {
                                const subParts = locationPart.split('،');
                                data.location = subParts[1]?.trim(); // "خ پاسداران ۸"
                                data.city = subParts[0]?.trim();     // "نورآباد"
                            } else {
                                data.location = locationPart.trim();
                            }
                        }
                    }

                    // جدول اصلی
                    const table = document.querySelector('table.kt-group-row');
                    if (table) {
                        const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
                        const values = [...table.querySelectorAll('tbody td')].map(td => td.textContent.trim());

                        const getValue = key => {
                            const index = headers.indexOf(key);
                            return index >= 0 ? values[index] : null;
                        };

                        data.area = getValue('متراژ') ?? getValue('متراژ زمین');
                        data.buildYear = getValue('ساخت');
                        data.rooms = getValue('اتاق');
                    }

                    // استخراج متراژ از section (اگر در جدول نبود)
                    if (!data.area) {
                        const rows = document.querySelectorAll('.kt-base-row');

                        rows.forEach(row => {
                            const title = row.querySelector('.kt-base-row__title');
                            const titleText = title ? title.textContent.trim() : '';

                            if (titleText === 'متراژ' || titleText === 'متراژ زمین') {
                                const value = row.querySelector(
                                    '.kt-unexpandable-row__value, .kt-base-row__end p'
                                );
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

                    // تشخیص نوع آگهی (اجاره/فروش) بر اساس breadcrumbs — مرجع اصلی تشخیص
                    const breadcrumbItems = document.querySelectorAll('.kt-breadcrumbs__item');
                    let isRentAd = false;

                    breadcrumbItems.forEach(item => {
                        const link = item.querySelector('a');
                        const href = link?.getAttribute('href') || '';
                        const text = item.textContent || '';

                        // مسیر /rent- در href یا واژهٔ «اجاره» (شامل «اجارهٔ») در متن
                        if (href.includes('/rent-') || text.includes('اجاره')) {
                            isRentAd = true;
                        }
                    });

                    data.adType = isRentAd ? 'rent' : 'sell';

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

                    console.log('✅ Data extraction completed');
                    return data;

                } catch (error) {
                    console.error('❌ Error in evaluate:', error.message);
                    throw error;
                }
            }, adId, adUrl);

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

            // commonData.geo = await this.extractGeoByOpeningMap(page);

            return { page, data: commonData };

        } catch (error) {
            console.error('❌ Error in processCommon:', error.message);

            await humanScroll(page);

            await randomDelay(1000, 3000);

            await page.close();
            throw error;
        }
    }

    async extractGeoByOpeningMap(page) {
        try {
            await page.waitForSelector('img[alt="موقعیت مکانی"]', { timeout: timeouts.elementWait });
        } catch {
            return null;
        }

        const mapStyleResponsePromise = page.waitForResponse(
            (response) =>
                response.url().includes(MAP_STYLE_PATTERN) && response.request().method() === 'GET',
            { timeout: timeouts.elementWait }
        ).catch(() => null);

        await page.click('img[alt="موقعیت مکانی"]');

        const styleJson = await mapStyleResponsePromise?.then((res) => res.json()).catch(() => null);
        if (!styleJson?.center || styleJson.center.length < 2) {
            return null;
        }

        const [lng, lat] = styleJson.center;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return null;
        }

        return { latitude: lat, longitude: lng };
    }

    async processAd(adUrl) {
        const result = await this.processCommon(adUrl);
        if (!result) return false;

        const { page, data } = result;

        try {
            if (data.adType === 'rent') {
                await this.extractRentPrices(page, data);
            } else {
                await this.extractSalePrices(page, data);
            }

            await randomDelay(1000, 3000);
            await page.close();
            return data;
        } catch (error) {
            await randomDelay(1000, 3000);
            await page.close();
            console.error('❌ خطا در استخراج قیمت:', error.message);
            return false;
        }
    }

    async extractRentPrices(page, data) {
        const rentInfo = await page.evaluate(() => {
            const rentData = { deposit: null, monthlyRent: null };

            document.querySelectorAll('.kt-unexpandable-row').forEach(row => {
                const title = row.querySelector('.kt-base-row__title')?.textContent.trim();
                const value = row.querySelector('.kt-unexpandable-row__value')?.textContent.trim();
                if (!title || !value) return;
                if (title === 'ودیعه') rentData.deposit = value;
                else if (title.includes('اجاره') && title.includes('ماهانه')) rentData.monthlyRent = value;
            });

            if (!rentData.deposit || !rentData.monthlyRent) {
                document.querySelectorAll('table.kt-group-row').forEach(table => {
                    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
                    if (headers.some(h => h.includes('ودیعه')) && headers.some(h => h.includes('اجاره'))) {
                        const values = [...table.querySelectorAll('tbody td')].map(td => td.textContent.trim());
                        const di = headers.findIndex(h => h.includes('ودیعه'));
                        const ri = headers.findIndex(h => h.includes('اجاره'));
                        if (di >= 0 && values[di]) rentData.deposit = values[di];
                        if (ri >= 0 && values[ri]) rentData.monthlyRent = values[ri];
                    }
                });
            }
            return rentData;
        });

        data.deposit = rentInfo.deposit ? convertPersianPriceToNumber(rentInfo.deposit) : null;
        data.monthlyRent = rentInfo.monthlyRent ? convertPersianPriceToNumber(rentInfo.monthlyRent) : null;
    }

    async extractSalePrices(page, data) {
        const priceData = await page.evaluate(() => {
            const rows = document.querySelectorAll('.kt-unexpandable-row');
            const getValue = label => {
                const row = [...rows].find(r =>
                    r.querySelector('.kt-unexpandable-row__title')?.textContent.trim() === label
                );
                return row?.querySelector('.kt-unexpandable-row__value')?.textContent.trim() ?? null;
            };
            return {
                // «قیمت ملک» برای زمین/کلنگی، «قیمت کل» برای آپارتمان
                totalPrice: getValue('قیمت کل') ?? getValue('قیمت ملک'),
                floor: getValue('طبقه'),
            };
        });

        data.totalPrice = convertPersianPriceToNumber(priceData.totalPrice);
        data.pricePerMeter = data.area ? Math.floor(data.totalPrice / Number(data.area)) : null;
        data.floor = convertPersianPriceToNumber(priceData.floor);
    }

}

module.exports = BaseExtractor;
