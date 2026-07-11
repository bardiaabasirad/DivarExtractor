export function convertPersianPriceToNumber(priceString) {
    if (!priceString) return null;

    // نقشه تبدیل اعداد فارسی/عربی به انگلیسی
    const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

    let result = priceString;

    // تبدیل اعداد فارسی به انگلیسی
    for (let i = 0; i < 10; i++) {
        result = result.replace(new RegExp(persianNumbers[i], 'g'), i.toString());
        result = result.replace(new RegExp(arabicNumbers[i], 'g'), i.toString());
    }

    // نرمال‌سازی: حذف RLM، جداکننده هزارگان و یکسان‌سازی نقطه اعشار
    result = result.replace(/\u200f/g, '');   // حذف کاراکتر RLM
    result = result.replace(/[،,]/g, '');     // حذف جداکننده هزارگان
    result = result.replace(/[٫]/g, '.');     // نقطه اعشار فارسی → نقطه انگلیسی

    // تشخیص ضریب مقیاس (بزرگ‌ترین ضریب موجود ملاک است)
    let multiplier = 1;
    if (/میلیارد/.test(result)) {
        multiplier = 1_000_000_000;
    } else if (/میلیون/.test(result)) {
        multiplier = 1_000_000;
    } else if (/هزار/.test(result)) {
        multiplier = 1_000;
    }

    // حذف واحدها و کلمات اضافی
    result = result.replace(/تومان|ریال|میلیارد|میلیون|هزار/g, '');
    result = result.replace(/\s/g, ''); // حذف فاصله‌ها

    // استخراج بش عددی (با پشتیبانی از اعشار)
    const match = result.match(/-?\d+(\.\d+)?/);
    if (!match) return null;

    const number = parseFloat(match[0]) * multiplier;

    return isNaN(number) ? null : number;
}
