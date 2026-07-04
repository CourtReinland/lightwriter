// electron-builder afterPack hook: ad-hoc sign the packed .app BEFORE the DMG is
// built. With "identity": null electron-builder skips signing entirely, and an
// UNSIGNED binary inside the DMG is refused outright on Apple Silicon — users
// see "LightWriter is damaged and can't be opened" no matter what they do.
// An ad-hoc signature makes the app launchable after the standard one-time
// quarantine clear (xattr -cr) documented in the README.
const { execSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`  • afterPack: ad-hoc signing ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
