import os from 'os';

export function getChromeExecutablePath() {
    const platform = os.platform();

    if (platform === 'win32') {
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }

    if (platform === 'darwin') {
        return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    if (platform === 'linux') {
        return '/usr/bin/google-chrome';
    }

    throw new Error('❌ Chrome executable path not found for this OS');
}
