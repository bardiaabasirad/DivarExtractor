const BaseExtractor = require("./BaseExtractor");
const { convertPersianPriceToNumber } = require("../utils/priceUtils");
const { randomDelay } = require("../utils/randomDelay");

class SaleExtractor extends BaseExtractor {
    getAdType() {
        return "sell";
    }

    getLogTitle() {
        return "فروش";
    }

    async processAd(adUrl) {
        const result = await this.processCommon(adUrl);
        if (!result) return false;

        const { page, data } = result;

        try {
            const priceData = await page.evaluate(() => {
                const rows = document.querySelectorAll(".kt-unexpandable-row");

                const getValue = (label) => {
                    const row = [...rows].find(
                        (r) =>
                            r
                                .querySelector(".kt-unexpandable-row__title")
                                ?.textContent.trim() === label
                    );

                    return (
                        row
                            ?.querySelector(".kt-unexpandable-row__value")
                            ?.textContent.trim() ?? null
                    );
                };

                return {
                    totalPrice: getValue("قیمت کل"),
                    floor: getValue("طبقه"),
                };
            });

            data.totalPrice = convertPersianPriceToNumber(priceData.totalPrice);

            data.pricePerMeter = data.area
                ? Math.floor(data.totalPrice / Number(data.area))
                : null;

            data.floor = convertPersianPriceToNumber(priceData.floor);

            // ⏱️ تاخیر قبل از بستن تب (شبیه‌سازی خواندن و بررسی داده‌ها)
            await randomDelay(1000, 3000);

            await page.close();

            return data;
        } catch (error) {
            // ⏱️ تاخیر قبل از بستن تب در مسیر خطا
            await randomDelay(1000, 3000);

            await page.close();
            console.error("❌ خطا در استخراج اطلاعات فروش:", error.message);
            return false;
        }
    }
}

module.exports = SaleExtractor;