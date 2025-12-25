import BaseExtractor from './BaseExtractor.js';
import { convertPersianPriceToNumber } from '../utils/priceUtils.js';

class SaleExtractor extends BaseExtractor {

    getAdType() {
        return 'sell';
    }

    getLogTitle() {
        return 'فروش';
    }

    async processAd(adUrl) {
        const result = await this.processCommon(adUrl);
        if (!result) return false;

        const { page, data } = result;

        try {

            const priceData = await page.evaluate(() => {
                const rows = document.querySelectorAll('.kt-unexpandable-row');

                const getValue = label => {
                    const row = [...rows].find(r =>
                        r.querySelector('.kt-unexpandable-row__title')?.textContent.trim() === label
                    );
                    return row?.querySelector('.kt-unexpandable-row__value')?.textContent.trim() ?? null;
                };

                return {
                    totalPrice: getValue('قیمت کل'),
                    floor: getValue('طبقه'),
                };
            });

            data.totalPrice = convertPersianPriceToNumber(priceData.totalPrice);
            data.pricePerMeter = data.area
                ? Math.floor(data.totalPrice / Number(data.area))
                : null;
            data.floor = convertPersianPriceToNumber(priceData.floor);

            await page.close();

            return data;

        } catch (error) {
            await page.close();
            console.error('❌ خطا در استخراج اطلاعات فروش:', error.message);
            return false;
        }
    }
}

export default SaleExtractor;
