// install-script.js (CommonJS, läuft ohne package.json)
const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

const INSTALL_DIR = process.cwd();
let REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/main";
const FILES_TO_FETCH = ["server.js", "package.json"];

// Prüfen ob "devbeta=true" als Argument übergeben wurde
const isDevBeta = process.argv.some(arg => arg === "devbeta=true");

if (isDevBeta) {
    REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/developing";
  console.log("⚡ Running in DEV/BETA mode!");
}

// Einfaches readline Interface
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// Install-Funktion
async function install() {
  console.log("📥 Installing NovaPlay...");

  // 1️⃣ Alle Files downloaden
  for (const file of FILES_TO_FETCH) {
    try {
      const url = `${REPO_BASE}/${file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${file}`);
      const data = await res.text();
      const targetPath = path.join(INSTALL_DIR, file);
      await fs.writeFile(targetPath, data, "utf8");
      console.log(`✔ Downloaded ${file}`);
    } catch (e) {
      console.error(`❌ Error downloading ${file}:`, e.message);
    }
  }

  // 2️⃣ Dependencies aus package.json laden
  let pkg;
  try {
    const pkgData = await fs.readFile(path.join(INSTALL_DIR, "package.json"), "utf8");
    pkg = JSON.parse(pkgData);
  } catch (e) {
    console.error("❌ Cannot read package.json:", e.message);
    return;
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(deps);

  // 3️⃣ Alle Abhängigkeiten einzeln installieren
  for (const dep of depNames) {
    try {
      console.log(`📦 Installing ${dep}...`);
      if (dep === "ffmpeg-static") {
        // Check Plattform
        if (process.env.TERMUX_VERSION) {
          const ans = await ask("⚠ ffmpeg-static failed. Install system ffmpeg via 'pkg install ffmpeg'? [Y/n] ");
          if (ans.toLowerCase() === "y" || ans === "") {
            execSync("pkg install ffmpeg -y", { stdio: "inherit" });
            console.log("✔ ffmpeg installed via Termux pkg.");
            continue; // ffmpeg-static überspringen
          } else {
            console.warn("⚠ Skipping ffmpeg-static. Thumbnails might not work.");
            continue;
          }
        } else if (process.platform === "linux") {
          const ans = await ask("⚠ ffmpeg-static failed. Try 'apt-get install ffmpeg'? [Y/n] ");
          if (ans.toLowerCase() === "y" || ans === "") {
            execSync("sudo apt-get update && sudo apt-get install -y ffmpeg", { stdio: "inherit" });
            console.log("✔ ffmpeg installed via apt-get.");
            continue;
          } else {
            console.warn("⚠ Skipping ffmpeg-static. Thumbnails might not work.");
            continue;
          }
        } else {
          console.warn("⚠ ffmpeg-static failed. Skipping installation. Thumbnails might not work.");
          continue;
        }
      }

      execSync(`npm install ${dep}`, { stdio: "inherit" });
      console.log(`✔ ${dep} installed`);
    } catch (e) {
      console.error(`❌ Failed to install ${dep}:`, e.message);
    }
  }

  console.log("\n✅ Installation complete!");
  console.log("Start server with: node server.js");
}

install();
