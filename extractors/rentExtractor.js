import {convertPersianPriceToNumber} from '../utils/priceUtils.js';
import BaseExtractor from "./BaseExtractor.js";

class RentExtractor extends BaseExtractor {

    getAdType() {
        return 'rent';
    }

    getLogTitle() {
        return 'اجاره';
    }

    async processAd(adUrl) {
        const result = await this.processCommon(adUrl);
        if (!result) return false;

        const { page, data } = result;

        try {
            console.log('🔄 در حال استخراج اطلاعات ودیعه و اجاره...');

            const rentInfo = await page.evaluate(() => {
                const rentData = {
                    deposit: null,
                    monthlyRent: null
                };

                // روش اول: جستجو در kt-unexpandable-row
                const allRows = document.querySelectorAll('.kt-unexpandable-row');

                allRows.forEach(row => {
                    const titleElement = row.querySelector('.kt-base-row__title');
                    const valueElement = row.querySelector('.kt-unexpandable-row__value');

                    if (titleElement && valueElement) {
                        const title = titleElement.textContent.trim();
                        const value = valueElement.textContent.trim();

                        console.log(`[kt-unexpandable-row] پیدا شد - ${title}: ${value}`);

                        if (title === 'ودیعه') {
                            rentData.deposit = value;
                        } else if (title.includes('اجاره') && title.includes('ماهانه')) {
                            rentData.monthlyRent = value;
                        }
                    }
                });

                // روش دوم: جستجو در table.kt-group-row (برای حالت قابل تبدیل)
                if (!rentData.deposit || !rentData.monthlyRent) {
                    const allTables = document.querySelectorAll('table.kt-group-row');

                    allTables.forEach(table => {
                        const headers = Array.from(table.querySelectorAll('thead th')).map(th =>
                            th.textContent.trim()
                        );

                        console.log('[table.kt-group-row] هدرهای یافت شده:', headers);

                        // بررسی اینکه این جدول مربوط به ودیعه و اجاره است
                        const hasDeposit = headers.some(h => h.includes('ودیعه'));
                        const hasRent = headers.some(h => h.includes('اجاره'));

                        if (hasDeposit && hasRent) {
                            const values = Array.from(table.querySelectorAll('tbody td')).map(td =>
                                td.textContent.trim()
                            );

                            console.log('[table.kt-group-row] مقادیر یافت شده:', values);

                            const depositIndex = headers.findIndex(h => h.includes('ودیعه'));
                            const rentIndex = headers.findIndex(h => h.includes('اجاره'));

                            if (depositIndex >= 0 && values[depositIndex]) {
                                rentData.deposit = values[depositIndex];
                                console.log(`[table.kt-group-row] ودیعه: ${rentData.deposit}`);
                            }

                            if (rentIndex >= 0 && values[rentIndex]) {
                                rentData.monthlyRent = values[rentIndex];
                                console.log(`[table.kt-group-row] اجاره ماهانه: ${rentData.monthlyRent}`);
                            }
                        }
                    });
                }

                console.log('نتیجه نهایی استخراج:', rentData);
                return rentData;
            });

            console.log('✅ داده‌های خام استخراج شد:', rentInfo);

            // اضافه کردن به data
            data.deposit = rentInfo.deposit;
            data.monthlyRent = rentInfo.monthlyRent;

            // تبدیل قیمت‌های فارسی به عدد (در محیط Node.js)
            if (data.deposit) {
                console.log('🔄 تبدیل ودیعه:', data.deposit);
                const convertedDeposit = convertPersianPriceToNumber(data.deposit);
                console.log('✅ ودیعه تبدیل شد:', convertedDeposit);
                data.deposit = convertedDeposit;
            }

            if (data.monthlyRent) {
                data.monthlyRent = convertPersianPriceToNumber(data.monthlyRent);
            }

            await page.close();

            console.log('✅ استخراج کامل شد:', {
                deposit: data.deposit,
                monthlyRent: data.monthlyRent,
                area: data.area,
                title: data.title
            });

            return data;

        } catch (error) {
            await page.close();
            console.error('❌ خطا در استخراج اطلاعات اجاره:', error.message);
            console.error(error.stack);
            return false;
        }
    }
}

export default RentExtractor;