// install-script.js
const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");

const INSTALL_DIR = process.cwd();
const FILES_TO_FETCH = ["server.js", "package.json"];
let REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/main";
const isDevBeta = process.argv.includes("devbeta=true");

if (isDevBeta) {
  REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/developing";
  console.log("⚡ Running in DEV/BETA mode!");
}

// --- Fetch file vom GitHub Repo
const fetchFile = async (file) => {
  const res = await fetch(`${REPO_BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}`);
  return await res.text();
};

// --- Installiert ein Paket direkt vom npm-Tarball, keine Nebendependencies
async function installDep(dep, version = "latest") {
  if (dep === "ffmpeg-static") {
    const check = spawn("ffmpeg", ["-version"]);
    check.on("error", () => console.warn("⚠ ffmpeg not found. Install manually."));
    check.on("exit", code => {
      if (code === 0) console.log("✔ ffmpeg available");
      else console.warn("⚠ ffmpeg not found. Install manually.");
    });
    return;
  }

  const tarballUrl = `https://registry.npmjs.org/${dep}/-/${dep}-${version}.tgz`;

  return new Promise((resolve) => {
    const npm = spawn("npm", ["install", tarballUrl, "--no-save", "--silent"], { stdio: "ignore" });
    npm.on("exit", code => {
      if (code === 0) console.log(`✔ ${dep} installed`);
      else console.error(`❌ Failed to install ${dep}`);
      resolve();
    });
  });
}

// --- Hauptfunktion
async function install() {
  console.log("📥 Installing NovaPlay...");

  // 1️⃣ server.js holen
  try {
    const serverJs = await fetchFile("server.js");
    await fs.writeFile(path.join(INSTALL_DIR, "server.js"), serverJs, "utf8");
    console.log("✔ Downloaded server.js");
  } catch (e) {
    console.error(`❌ Error downloading server.js: ${e.message}`);
  }

  // 2️⃣ package.json nur im Speicher laden, noch nicht speichern
  let pkg;
  try {
    const pkgData = await fetchFile("package.json");
    pkg = JSON.parse(pkgData);
  } catch (e) {
    console.error("❌ Cannot fetch package.json:", e.message);
    return;
  }

  // 3️⃣ Jede Dependency einzeln installieren
  const depEntries = Object.entries(pkg.dependencies || {});
  for (const [dep, ver] of depEntries) {
    const cleanVersion = ver.replace(/^[^0-9]*/, ""); // entfernt ^ oder ~
    await installDep(dep, cleanVersion || "latest");
  }

  // 4️⃣ package.json erst nach der Installation speichern
  try {
    await fs.writeFile(path.join(INSTALL_DIR, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
    console.log("✔ package.json saved");
  } catch (e) {
    console.error(`❌ Failed to save package.json: ${e.message}`);
  }

  console.log("\n✅ Installation complete!");
  console.log("Start server with: node server.js");
}

install();
