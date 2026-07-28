const path = require("path");
const { getChromeExecutablePath } = require("./utils/chromePath");

// مسیر ریشه پروژه
const projectRoot = __dirname;

// مسیرهای absolute برای اجرا با PM2
const chromeProfilePath = path.resolve(projectRoot, "chrome-profile");
const cookiesPath = path.resolve(projectRoot, "cookies.json");

const cities = {
  khorramabad: { url: "https://divar.ir/s/khorramabad/real-estate?recent_ads=1d", cityId: 9 },
  nurabad:      { url: "https://divar.ir/s/nurabad/real-estate?recent_ads=1d",     cityId: 21 },
};

const selectedCity = cities[process.env.CITY] || cities["nurabad"];
const targetUrl = selectedCity.url;
const cityId    = selectedCity.cityId;

// API
const externalRefsUrl = "https://malko.ir/external-refs";
const checkInterval = 60000;

const apiConfig = {
    endpoint: "https://malko.ir/new-place",
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
};

// Timeout ها
const timeouts = {
    pageLoad: 30000,
    elementWait: 10000,
    minDelay: 30,
    maxDelay: 60,
};

// تشخیص حالت اجرا
const isLinux = process.platform === "linux";
const envHeadless = process.env.PUPPETEER_HEADLESS;

const headless =
    envHeadless === "false"
        ? false
        : envHeadless === "true"
            ? "new"
            : isLinux
                ? "new"
                : false;

const isVisibleMode = headless === false;

// مسیر Chrome
const chromeExecutablePath = getChromeExecutablePath();

// تنظیمات Puppeteer
const puppeteerConfig = {
    headless,
    executablePath: chromeExecutablePath,
    defaultViewport: isVisibleMode ? null : { width: 1366, height: 768 },
    userDataDir: chromeProfilePath,
    args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        ...(isVisibleMode ? ["--start-maximized"] : []),
    ],
};

module.exports = {
    projectRoot,
    chromeProfilePath,
    cookiesPath,
    targetUrl,
    cityId,
    externalRefsUrl,
    checkInterval,
    apiConfig,
    timeouts,
    chromeExecutablePath,
    puppeteerConfig,
};
