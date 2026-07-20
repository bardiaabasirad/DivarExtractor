const fs = require("fs");
const path = require("path");

const BLACKLIST_FILE = path.join(__dirname, "../data/blacklisted-ads.json");

/**
 * بارگذاری لیست سیاه از فایل
 */
function loadBlacklist() {
    try {
        // ایجاد پوشه data اگر وجود نداشت
        const dataDir = path.dirname(BLACKLIST_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(BLACKLIST_FILE)) {
            const content = fs.readFileSync(BLACKLIST_FILE, "utf-8");
            return JSON.parse(content);
        }
        return [];
    } catch (error) {
        console.error("❌ خطا در بارگذاری لیست سیاه:", error.message);
        return [];
    }
}

/**
 * ذخیره لیست سیاه در فایل
 */
function saveBlacklist(blacklist) {
    try {
        const dataDir = path.dirname(BLACKLIST_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(
            BLACKLIST_FILE,
            JSON.stringify(blacklist, null, 2),
            "utf-8"
        );
        return true;
    } catch (error) {
        console.error("❌ خطا در ذخیره لیست سیاه:", error.message);
        return false;
    }
}

/**
 * افزودن adId به لیست سیاه
 */
function addToBlacklist(adId, reason = "phone_hidden") {
    const blacklist = loadBlacklist();

    // بررسی وجود قبلی
    const exists = blacklist.find((item) => item.adId === adId);
    if (exists) {
        console.log(`⚠️  آگهی ${adId} قبلاً در لیست سیاه وجود دارد`);
        return false;
    }

    // افزودن به لیست
    blacklist.push({
        adId,
        reason,
        addedAt: new Date().toISOString(),
    });

    saveBlacklist(blacklist);
    console.log(`🚫 آگهی ${adId} به لیست سیاه اضافه شد`);
    return true;
}

/**
 * بررسی وجود adId در لیست سیاه
 */
function isBlacklisted(adId) {
    const blacklist = loadBlacklist();
    return blacklist.some((item) => item.adId === adId);
}

/**
 * حذف adId از لیست سیاه
 */
function removeFromBlacklist(adId) {
    let blacklist = loadBlacklist();
    const initialLength = blacklist.length;

    blacklist = blacklist.filter((item) => item.adId !== adId);

    if (blacklist.length < initialLength) {
        saveBlacklist(blacklist);
        console.log(`✅ آگهی ${adId} از لیست سیاه حذف شد`);
        return true;
    }

    console.log(`⚠️  آگهی ${adId} در لیست سیاه یافت نشد`);
    return false;
}

/**
 * نمایش آمار لیست سیاه
 */
function getBlacklistStats() {
    const blacklist = loadBlacklist();
    return {
        total: blacklist.length,
        items: blacklist,
    };
}

module.exports = {
    loadBlacklist,
    saveBlacklist,
    addToBlacklist,
    isBlacklisted,
    removeFromBlacklist,
    getBlacklistStats,
};
