export function convertPersianPriceToNumber(priceString) {
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