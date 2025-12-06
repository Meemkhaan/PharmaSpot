const { app, dialog} = require("electron");
let mainWindow;
const path = require("path");
const iconPath = path.join(__dirname, "../../../assets/images/favicon.png");
const appVersion = app.getVersion();
const appName = app.getName();
const pkg = require("../../../package.json");
const { appConfig } = require("../../../app.config");
const { autoUpdater } = require("electron-updater");
const isPackaged = app.isPackaged;

// Configure auto-updater based on config
if (appConfig.USE_GITHUB_UPDATES && appConfig.GITHUB_OWNER && appConfig.GITHUB_REPO) {
  // Use GitHub Releases for updates
  autoUpdater.setFeedURL({
    provider: "github",
    owner: appConfig.GITHUB_OWNER,
    repo: appConfig.GITHUB_REPO,
  });
  console.log(`[Auto-Updater] Configured for GitHub: ${appConfig.GITHUB_OWNER}/${appConfig.GITHUB_REPO}`);
} else {
  // Fallback to custom update server
  const updateServer = appConfig.UPDATE_SERVER;
  const updateUrl = `${updateServer}/update/${process.platform}/${app.getVersion()}`;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: updateUrl,
  });
  console.log(`[Auto-Updater] Configured for custom server: ${updateUrl}`);
}

function showAbout() {
  const options = {
    applicationName: `${appName}`,
    applicationVersion: `v${appVersion}`,
    copyright: `Copyright © ${
      appConfig.COPYRIGHT_YEAR
    }-${new Date().getFullYear()} ${pkg.author}`,
    version: `v${appVersion}`,
    authors: [pkg.author],
    website: pkg.website,
    iconPath: iconPath,
  };
  app.setAboutPanelOptions(options);
  app.showAboutPanel();
}

function getDocs() {}

function sendFeedback() {}

function checkForUpdates() {
  if (!isPackaged) {
    console.log(`[Auto-Updater] Skipping update check in development mode`);
    return;
  }

  console.log(`[Auto-Updater] Checking for updates...`);
  
  const dialogOpts = {
    type: "info",
    buttons: ["Update now", "Later"],
    title: "New version available",
  };

  // Configure auto-download (user can choose to download)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true; // Auto-install on app quit if update is downloaded
  
  // Check for updates
  autoUpdater.checkForUpdates();

  const handleUpdateAvailable = (info) => {
    const message = `Current version: ${pkg.version}\nNew Version: ${info.version}`;
    dialogOpts.message = message;
    dialogOpts.detail =
      process.platform === "win32" ? releaseNotes : releaseName;

    dialog.showMessageBox(dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  };

  const handleUpdateNotAvailable = (info) => {
    console.log(`[Auto-Updater] No updates available. Current version: ${info.version || pkg.version}`);
    dialogOpts.type = "info";
    dialogOpts.buttons = ["OK"];
    dialogOpts.title = "No Updates Available";
    dialogOpts.message = `You are using the latest version: ${info.version || pkg.version}`;
    dialogOpts.detail = "";
    dialog.showMessageBox(mainWindow, dialogOpts);
  };

  const handleUpdateDownloaded = (info) => {
    console.log(`[Auto-Updater] Update downloaded for version ${info.version}`);
    dialogOpts.buttons = ["Install now", "Later"];
    dialogOpts.title = "Ready to Install Update";
    dialogOpts.message = `The update for version ${info.version} is downloaded.\nClick 'Install now' to restart the app and apply the update.`;
    dialogOpts.detail = "The application will close and restart automatically.";
    dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) {
        console.log(`[Auto-Updater] User chose to install update now`);
        autoUpdater.quitAndInstall();
      } else {
        console.log(`[Auto-Updater] User chose to install later - will install on next app quit`);
      }
    });
  };
  
  const handleDownloadProgress = (progressObj) => {
    // Optional: Show download progress
    const percent = Math.round(progressObj.percent || 0);
    if (percent % 10 === 0) { // Log every 10%
      console.log(`[Auto-Updater] Download progress: ${percent}%`);
    }
  };


  const handleError = async (err) => {
    try {
      console.error(`[Auto-Updater] Error checking for updates:`, err);
      
      const dialogOpts = {
        type: "error",
        title: "Update check failed",
        message: "An error occurred while checking for updates.",
        detail: err.message || err.toString(),
        buttons: ["Retry", "Cancel"]
      };

      const returnValue = await dialog.showMessageBox(mainWindow, dialogOpts);

      if (returnValue.response === 0) {
        console.log(`[Auto-Updater] User chose to retry update check`);
        checkForUpdates();
      }
    } catch (error) {
      console.error(`[Auto-Updater] Error in handleError function: ${error}`);
    }
  };

  // Set up event listeners (only once)
  autoUpdater.removeAllListeners(); // Remove any existing listeners to prevent duplicates
  autoUpdater.on("update-available", handleUpdateAvailable);
  autoUpdater.on("update-not-available", handleUpdateNotAvailable);
  autoUpdater.on("update-downloaded", handleUpdateDownloaded);
  autoUpdater.on("download-progress", handleDownloadProgress);
  autoUpdater.on("error", handleError);
  
  console.log(`[Auto-Updater] Event listeners registered`);
}

const initializeMainWindow = (win)=>{
mainWindow = win;
} 

const handleClick = (elementId)=>{
  mainWindow.webContents.send('click-element', elementId);
}

module.exports = {
showAbout, 
checkForUpdates, 
getDocs, 
sendFeedback,
initializeMainWindow,
handleClick,
 };