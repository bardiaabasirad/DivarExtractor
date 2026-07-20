/**
 * Creates a non-blocking delay for a random duration
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 * @returns {Promise<void>}
 */
const randomDelay = (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);

    // استفاده از Promise برای اینکه حلقه اجرای کد بلاک نشود
    return new Promise((resolve) => setTimeout(resolve, delay));
};

module.exports = {
    randomDelay,
};
