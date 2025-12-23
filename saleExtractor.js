import { apiConfig, timeouts } from './config.js';

class SaleExtractor {
    constructor(browser) {
        this.browser = browser;
    }

    // تابع تبدیل قیمت فارسی به عدد
    convertPersianPriceToNumber(priceString) {
        if (!priceString) return null;

        // نقشه تبدیل اعداد فارسی به انگلیسی
        const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

        let result = priceString;

        // تبدیل اعداد فارسی به انگلیسی
        for (let i = 0; i < 10; i++) {
            result = result.replace(new RegExp(persianNumbers[i], 'g'), i.toString());
            result = result.replace(new RegExp(arabicNumbers[i], 'g'), i.toString());
        }

        // حذف کاما، فاصله، نقطه و کلمات اضافی
        result = result.replace(/[،,\s]/g, '');
        result = result.replace(/تومان/g, '');
        result = result.replace(/ریال/g, '');
        result = result.replace(/‏/g, ''); // حذف کاراکتر RLM

        // تبدیل به عدد
        const number = parseInt(result, 10);

        return isNaN(number) ? null : number;
    }

    async processAd(adUrl) {
        const page = await this.browser.newPage();

        try {
            console.log(`\n🔍 در حال بازکردن صفحه آگهی فروش...`);
            await page.goto(adUrl, {
                waitUntil: 'networkidle2',
                timeout: timeouts.pageLoad
            });

            const adId = adUrl.split('/').pop();

            // انتظار برای بارگذاری محتوا
            await page.waitForSelector('h1', { timeout: timeouts.elementWait });

            // **مرحله 1: کلیک روی دکمه اطلاعات تماس**
            console.log('📱 در حال کلیک روی دکمه اطلاعات تماس...');

            try {
                const contactButton = await page.waitForSelector(
                    'button.post-actions__get-contact',
                    { timeout: 5000 }
                );

                if (contactButton) {
                    await contactButton.click();

                    // **انتظار تا یکی از دو حالت رخ دهد**
                    const contactStatus = await page.waitForFunction(
                        () => {
                            // بررسی وجود شماره تلفن
                            const phoneLink = document.querySelector('a[href^="tel:"]');
                            if (phoneLink) return 'phone_found';

                            // بررسی پیام مخفی بودن
                            const hiddenText = Array.from(document.querySelectorAll('.kt-unexpandable-row__title'))
                                .find(el => el.textContent.includes('شماره مخفی شده است'));
                            if (hiddenText) return 'phone_hidden';

                            return null;
                        },
                        { timeout: 5000, polling: 100 }
                    ).then(handle => handle.jsonValue());

                    if (contactStatus === 'phone_hidden') {
                        console.log('❌ شماره تلفن این آگهی مخفی است - رد شد');
                        await page.close();
                        return false;
                    }

                    console.log('✅ شماره تلفن یافت شد');
                }
            } catch (error) {
                console.log('⚠️  خطا در دریافت اطلاعات تماس:', error.message);
                await page.close();
                return false;
            }

            // استخراج اطلاعات
            const adData = await page.evaluate(() => {
                const data = { adType: 'sell' };

                // استخراج عنوان
                const titleElement = document.querySelector('h1');
                data.title = titleElement ? titleElement.textContent.trim() : null;

                // استخراج شماره تلفن از صفحه
                const phoneLink = document.querySelector('a[href^="tel:"]');
                data.phoneNumber = phoneLink ? phoneLink.getAttribute('href').replace('tel:', '') : null;

                // استخراج زمان و موقعیت
                const locationElement = document.querySelector('h1 + div.kt-page-title__subtitle');
                if (locationElement) {
                    const fullText = locationElement.textContent.trim();
                    const parts = fullText.split(' در ');
                    data.timeAgo = parts[0]?.trim();
                    data.location = parts[1]?.trim();
                }

                // استخراج اطلاعات جدول اصلی (متراژ، ساخت، اتاق)
                const mainTable = document.querySelector('table.kt-group-row');
                if (mainTable) {
                    const headers = Array.from(mainTable.querySelectorAll('thead th')).map(th => th.textContent.trim());
                    const values = Array.from(mainTable.querySelectorAll('tbody td')).map(td => td.textContent.trim());

                    const areaIndex = headers.findIndex(h => h === 'متراژ');
                    const buildIndex = headers.findIndex(h => h === 'ساخت');
                    const roomIndex = headers.findIndex(h => h === 'اتاق');

                    data.area = areaIndex >= 0 ? values[areaIndex] : null;
                    data.buildYear = buildIndex >= 0 ? values[buildIndex] : null;
                    data.rooms = roomIndex >= 0 ? values[roomIndex] : null;
                }

                // استخراج قیمت کل و قیمت هر متر و طبقه
                data.totalPrice = null;
                data.pricePerMeter = null;
                data.floor = null;

                const priceRows = document.querySelectorAll('.kt-unexpandable-row');
                priceRows.forEach(row => {
                    const titleEl = row.querySelector('.kt-unexpandable-row__title');
                    const valueEl = row.querySelector('.kt-unexpandable-row__value');

                    if (titleEl && valueEl) {
                        const titleText = titleEl.textContent.trim();
                        const valueText = valueEl.textContent.trim();

                        if (titleText === 'قیمت کل') {
                            data.totalPrice = valueText;
                        } else if (titleText === 'قیمت هر متر') {
                            data.pricePerMeter = valueText;
                        } else if (titleText === 'طبقه') {
                            data.floor = valueText;
                        } else if (titleText === 'متراژ') {
                            data.extraArea = valueText;
                        }
                    }
                });

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

                return data;
            });

            // افزودن ID و URL به داده‌ها
            adData.adId = adId;
            adData.adUrl = adUrl;

            // تبدیل قیمت‌ها به عدد خالص
            if (adData.totalPrice) {
                const rawPrice = adData.totalPrice; // ذخیره برای نمایش
                adData.totalPrice = this.convertPersianPriceToNumber(rawPrice);
            }

            if (adData.pricePerMeter) {
                const rawPrice = adData.pricePerMeter;
                adData.pricePerMeter = this.convertPersianPriceToNumber(rawPrice);
            }        

            if (adData.rooms) {
                adData.rooms = this.convertPersianPriceToNumber(adData.rooms);
            }

            if (adData.buildYear) {
                adData.buildYear = this.convertPersianPriceToNumber(adData.buildYear);
            }

            this.displayExtractedData(adData);

            // ارسال به سرور
            const success = await this.sendToServer(adData);

            await page.close();
            return success;

        } catch (error) {
            console.error('❌ خطا در استخراج اطلاعات فروش:', error.message);
            await page.close();
            return false;
        }
    }

    displayExtractedData(data) {
        // console.log('\n✅ اطلاعات استخراج شده (فروش):');
        // console.log(`   🆔 شناسه: ${data.adId}`);
        // console.log(`   📞 تلفن: ${data.phoneNumber || 'ندارد'}`);
        // console.log(`   📝 نوع: ${data.adType}`);
        // console.log(`   📌 عنوان: ${data.title || 'ندارد'}`);
        // console.log(`   🏷️  دسته: ${data.category || 'ندارد'}`);
        // console.log(`   ⏰ زمان: ${data.timeAgo || 'ندارد'}`);
        // console.log(`   📍 موقعیت: ${data.location || 'ندارد'}`);
        // console.log(`   📐 متراژ: ${data.area || 'ندارد'}`);
        // console.log(`   🏗️  سال ساخت: ${data.buildYear || 'ندارد'}`);
        // console.log(`   🚪 تعداد اتاق: ${data.rooms || 'ندارد'}`);
        // console.log(`   💰 قیمت کل: ${data.totalPrice || 'ندارد'}`);
        // console.log(`   💵 قیمت هر متر: ${data.pricePerMeter || 'ندارد'}`);
        // console.log(`   🏢 طبقه: ${data.floor || 'ندارد'}`);
        // console.log(`   🛗 آسانسور: ${data.features.elevator === null ? 'نامشخص' : (data.features.elevator ? '✓ دارد' : '✗ ندارد')}`);
        // console.log(`   🚗 پارکینگ: ${data.features.parking === null ? 'نامشخص' : (data.features.parking ? '✓ دارد' : '✗ ندارد')}`);
        // console.log(`   📦 انباری: ${data.features.warehouse === null ? 'نامشخص' : (data.features.warehouse ? '✓ دارد' : '✗ ندارد')}`);
        // console.log(`   🖼️  تعداد تصاویر: ${data.images.length}`);

        if (data.description) {
            const shortDesc = data.description.length > 80
                ? data.description.substring(0, 80) + '...'
                : data.description;
            console.log(`   📄 توضیحات: ${shortDesc}`);
        }
    }

    async sendToServer(data) {
        console.log('data', data);
        try {
            console.log('\n📤 در حال ارسال به سرور...');

            const response = await fetch(apiConfig.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                console.log('✅ داده با موفقیت به سرور ارسال شد');
                return true;
            } else {
                console.error(`❌ خطا در ارسال به سرور: ${response.status} ${response.statusText}`);
                return false;
            }

        } catch (error) {
            console.error('❌ خطا در ارسال به سرور:', error.message);
            return false;
        }
    }
}

export default SaleExtractor;
