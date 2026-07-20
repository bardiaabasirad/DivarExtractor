const { apiConfig } = require("../config");

async function sendAdToServer(data) {
    console.log("\n📤 Sending to server...");

    try {
        const response = await fetch(apiConfig.endpoint, {
            method: apiConfig.method || "POST",
            headers: apiConfig.headers,
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        console.log("✅ Sent successfully");
        return true;
    } catch (error) {
        console.error("❌ Error sending to server:", error.message);
        return false;
    }
}

module.exports = {
    sendAdToServer,
};
