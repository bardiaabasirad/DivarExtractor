/**
 * اسکرول تدریجی و انسان‌گونهٔ صفحه به پایین و کمی بازگشت به بالا.
 * این تابع نباید جریان اصلی را متوقف کند؛ خطاها داخل خودش مدیریت می‌شوند.
 * @param {import('puppeteer').Page} page
 */
async function humanScroll(page) {
  try {
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const rand = (min, max) => Math.random() * (max - min) + min;

      const maxScroll = document.body.scrollHeight - window.innerHeight;
      let current = 0;

      // اسکرول تدریجی به پایین با گام و تأخیر تصادفی
      while (current < maxScroll) {
        const step = rand(80, 260);
        current = Math.min(current + step, maxScroll);
        window.scrollTo({ top: current, behavior: "smooth" });
        await sleep(rand(120, 400));
      }

      // کمی مکث و بازگشت جزئی به بالا (رفتار طبیعی کاربر)
      await sleep(rand(120, 400));
      window.scrollTo({
        top: current * rand(0.4, 0.7),
        behavior: "smooth",
      });
      await sleep(rand(120, 400));
    });
  } catch (err) {
    // اسکرول نباید جریان اصلی را متوقف کند
    console.warn("humanScroll failed:", err.message);
  }
}

module.exports = {
  humanScroll,
};
