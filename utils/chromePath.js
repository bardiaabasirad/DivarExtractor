const os = require("os");

function getChromeExecutablePath() {
    if (process.env.CHROME_EXECUTABLE_PATH) {
        return process.env.CHROME_EXECUTABLE_PATH;
    }

    const platform = os.platform();

    if (platform === "win32") {
        return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    }

    if (platform === "darwin") {
        return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    }

    if (platform === "linux") {
        return "/usr/bin/google-chrome";
    }

    throw new Error("❌ Chrome executable path not found for this OS");
}

module.exports = {
    getChromeExecutablePath,
};
