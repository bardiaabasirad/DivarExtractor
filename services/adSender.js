import { apiConfig } from '../config.js';

export async function sendAdToServer(data) {
    console.log('\n📤 در حال ارسال به سرور...');
    console.log('data:', data);

    try {
        const response = await fetch(apiConfig.endpoint, {
            method: apiConfig.method || 'POST',
            headers: apiConfig.headers,
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        console.log('✅ ارسال موفق');
        return true;

    } catch (error) {
        console.error('❌ خطا در ارسال به سرور:', error.message);
        return false;
    }
}
