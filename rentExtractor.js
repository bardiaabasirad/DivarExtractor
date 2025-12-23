import { apiConfig, timeouts } from './config.js';

class RentExtractor {
    constructor(browser) {
        this.browser = browser;
    }

    async processAd(adUrl) {
        const page = await this.browser.newPage();

        try {
            console.log(`\n🔍 در حال بازکردن صفحه آگهی اجاره...`);
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
                const data = { adType: 'rent' };

                // **استخراج شماره تلفن**
                const phoneLink = document.querySelector('a[href^="tel:"]');
                if (phoneLink) {
                    const href = phoneLink.getAttribute('href');
                    data.phoneNumber = href.replace('tel:', '');
                } else {
                    data.phoneNumber = null;
                }

                // استخراج عنوان
                const titleElement = document.querySelector('h1');
                data.title = titleElement ? titleElement.textContent.trim() : null;

                // استخراج زمان و موقعیت
                const locationElement = document.querySelector('h1 + p');
                if (locationElement) {
                    const fullText = locationElement.textContent.trim();
                    const parts = fullText.split('در');
                    data.timeAgo = parts[0]?.trim();
                    data.location = parts[1]?.trim();
                }

                // استخراج اطلاعات جدول اصلی (متراژ، ساخت، اتاق)
                const firstTable = document.querySelector('table');
                if (firstTable) {
                    const headers = Array.from(firstTable.querySelectorAll('thead th')).map(th => th.textContent.trim());
                    const values = Array.from(firstTable.querySelectorAll('tbody td')).map(td => td.textContent.trim());

                    const areaIndex = headers.findIndex(h => h === 'متراژ');
                    const buildIndex = headers.findIndex(h => h === 'ساخت');
                    const roomIndex = headers.findIndex(h => h === 'اتاق');

                    data.area = areaIndex >= 0 ? values[areaIndex] : null;
                    data.buildYear = buildIndex >= 0 ? values[buildIndex] : null;
                    data.rooms = roomIndex >= 0 ? values[roomIndex] : null;
                }

                // استخراج ودیعه و اجاره ماهانه
                const allTables = document.querySelectorAll('table');

                allTables.forEach(table => {
                    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());

                    // جدول ودیعه و اجاره را پیدا کن
                    if (headers.some(h => h.includes('ودیعه'))) {
                        const values = Array.from(table.querySelectorAll('tbody td')).map(td => td.textContent.trim());

                        const depositIndex = headers.findIndex(h => h.includes('ودیعه'));
                        const rentIndex = headers.findIndex(h => h.includes('اجاره'));

                        data.deposit = depositIndex >= 0 ? values[depositIndex] : null;
                        data.monthlyRent = rentIndex >= 0 ? values[rentIndex] : null;
                    }
                });

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

                // استخراج سایر ویژگی‌ها از sections
                const allSections = document.querySelectorAll('section');

                allSections.forEach(section => {
                    const title = section.querySelector('p.kt-base-row__title');
                    const value = section.querySelector('p.kt-base-row__title + p');

                    if (title && value) {
                        const titleText = title.textContent.trim();
                        const valueText = value.textContent.trim();

                        if (titleText === 'طبقه') {
                            data.floor = valueText;
                        }
                    }
                });

                // استخراج ویژگی‌ها (آسانسور، پارکینگ، انباری)
                data.features = {
                    elevator: null,
                    parking: null,
                    warehouse: null
                };

                const featuresSection = Array.from(allSections).find(section => {
                    const header = section.querySelector('p.kt-base-row__title');
                    return header && header.textContent.trim() === 'ویژگی‌ها و امکانات';
                });

                if (featuresSection) {
                    const featureTable = featuresSection.querySelector('table');
                    if (featureTable) {
                        const cells = featureTable.querySelectorAll('td');
                        cells.forEach(cell => {
                            const text = cell.textContent.trim();

                            if (text.includes('آسانسور')) {
                                data.features.elevator = text.includes('دارد');
                            }
                            if (text.includes('پارکینگ')) {
                                data.features.parking = text.includes('دارد');
                            }
                            if (text.includes('انباری')) {
                                data.features.warehouse = text.includes('دارد');
                            }
                        });
                    }
                }

                // استخراج توضیحات
                const descriptionHeader = Array.from(document.querySelectorAll('h2')).find(h =>
                    h.textContent.trim() === 'توضیحات'
                );

                if (descriptionHeader) {
                    const descParagraph = descriptionHeader.nextElementSibling;
                    data.description = descParagraph ? descParagraph.textContent.trim() : null;
                }

                // استخراج دسته‌بندی
                const categoryLink = document.querySelector('a[href*="/rent-"]');
                data.category = categoryLink ? categoryLink.textContent.trim() : null;

                // استخراج تصاویر
                data.images = [];
                const imageElements = document.querySelectorAll('img[src*="divarcdn.com"]');
                imageElements.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && !data.images.includes(src)) {
                        data.images.push(src);
                    }
                });

                return data;
            });

            // **بررسی نهایی وجود شماره تلفن**
            if (!adData.phoneNumber) {
                console.log('❌ شماره تلفن یافت نشد - آگهی رد شد');
                await page.close();
                return false;
            }

            // افزودن ID و URL به داده‌ها
            adData.adId = adId;
            adData.adUrl = adUrl;

            this.displayExtractedData(adData);

            // ارسال به سرور
            const success = await this.sendToServer(adData);

            await page.close();
            return success;

        } catch (error) {
            console.error('❌ خطا در استخراج اطلاعات اجاره:', error.message);
            await page.close();
            return false;
        }
    }

    displayExtractedData(data) {
        // console.log('\n✅ اطلاعات استخراج شده (اجاره):');
        // console.log(`   🆔 شناسه: ${data.adId}`);
        // console.log(`   📝 نوع: ${data.adType}`);
        // console.log(`   📞 شماره تلفن: ${data.phoneNumber || 'ندارد'}`);
        // console.log(`   📌 عنوان: ${data.title || 'ندارد'}`);
        // console.log(`   🏷️  دسته: ${data.category || 'ندارد'}`);
        // console.log(`   ⏰ زمان: ${data.timeAgo || 'ندارد'}`);
        // console.log(`   📍 موقعیت: ${data.location || 'ندارد'}`);
        // console.log(`   📐 متراژ: ${data.area || 'ندارد'}`);
        // console.log(`   🏗️  سال ساخت: ${data.buildYear || 'ندارد'}`);
        // console.log(`   🚪 تعداد اتاق: ${data.rooms || 'ندارد'}`);
        // console.log(`   💰 ودیعه: ${data.deposit || 'ندارد'}`);
        // console.log(`   💵 اجاره ماهانه: ${data.monthlyRent || 'ندارد'}`);
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

export default RentExtractor;
