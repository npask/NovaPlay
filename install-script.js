// install-script.js
const fs = require("fs").promises;
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

let INSTALL_DIR = process.cwd();
const FILES_TO_FETCH = ["server.js", "package.json"];
let REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/main";
const isDevBeta = process.argv.includes("devbeta=true");
const isDebug = process.argv.includes("--debug");

if (isDevBeta) {
  REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/developing";
  console.log("⚡ Running in DEV/BETA mode!");
}

if (isDebug) console.log("🐞 Debug mode ON: verbose logging enabled");

// --- Einfache Frage an den Nutzer
function ask(question, options = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let timeoutId;
    if (options.timeout) {
      timeoutId = setTimeout(() => {
        rl.close();
        resolve(options.default || '');
      }, options.timeout);
    }

    rl.question(question, answer => {
      if (timeoutId) clearTimeout(timeoutId);
      rl.close();
      answer = answer.trim();
      if (!answer && options.default !== undefined) return resolve(options.default);
      resolve(answer);
    });
  });
}

// --- Fetch file vom GitHub Repo
const fetchFile = async (file) => {
  console.log(`⬇ Fetching ${file} from ${REPO_BASE}...`);
  const res = await fetch(`${REPO_BASE}/${file}`);
  if (!res.ok) throw new Error(`Failed to fetch ${file}`);
  const data = await res.text();
  console.log(`✔ Fetched ${file}`);
  return data;
};

// --- Installiert ein Paket direkt vom npm-Tarball, keine Nebendependencies
async function installDep(dep, version = "latest") {
  if (dep === "ffmpeg-static") {
    console.log(`🔍 Checking ffmpeg availability...`);
    const check = spawn("ffmpeg", ["-version"]);
    check.on("error", () => console.warn("⚠ ffmpeg not found. Install manually."));
    check.on("exit", code => {
      if (code === 0) console.log("✔ ffmpeg available");
      else console.warn("⚠ ffmpeg not found. Install manually.");
    });
    return;
  }

  const tarballUrl = `https://registry.npmjs.org/${dep}/-/${dep}-${version}.tgz`;
  console.log(`📦 Installing ${dep}@${version} from tarball...`);

  return new Promise((resolve) => {
    const args = ["install", tarballUrl, "--no-save"];
    if (!isDebug) args.push("--silent");

    const npm = spawn("npm", args, { stdio: isDebug ? "inherit" : "ignore" });
    npm.on("exit", code => {
      if (code === 0) console.log(`✔ ${dep} installed`);
      else console.error(`❌ Failed to install ${dep}`);
      resolve();
    });
  });
}

// --- Hauptfunktion
async function install() {
  console.log(
    `📥 Installing NovaPlay${isDevBeta ? " BETA mode... (NOTICE: THIS VERSION IS NOT VERIFIED, BUGS CAN HAPPEN)" : "..." }`
  );

  // Frage den Nutzer, ob er einen anderen Installationsordner nutzen möchte
  const ans = await ask(`Current install folder is "${INSTALL_DIR}". Do you want to install in a different folder? [y/N] `, { default: 'N', timeout: 60000 });
  if (ans.toLowerCase() === "y") {
    const newDir = await ask("Enter full path to the new install folder: ");
    if (newDir) {
      INSTALL_DIR = path.resolve(newDir);
      console.log(`🔹 Installation folder changed to: ${INSTALL_DIR}`);
    } else {
      console.log("⚠ No path entered, using current folder");
    }
  }

  if(isDevBeta){
    const devFilePath = path.join(process.cwd(), 'DELETE THIS IF YOU WANT TO LEAVE THE BETA DEV PROGRAMM.NovaPlayDevFile');
    fs.ensureFile(devFilePath)
      .then(() => console.log("📄 Set the next updates to dev beta only"))
      .catch(err => console.error("❌ Error in setting up the dev beta only updates:", err));
  }

  // 1️⃣ server.js holen
  try {
    const serverJs = await fetchFile("server.js");
    await fs.writeFile(path.join(INSTALL_DIR, "server.js"), serverJs, "utf8");
    console.log("✔ server.js saved");
  } catch (e) {
    console.error(`❌ Error downloading server.js: ${e.message}`);
  }

  // 2️⃣ package.json nur im Speicher laden, noch nicht speichern
  let pkg;
  try {
    const pkgData = await fetchFile("package.json");
    pkg = JSON.parse(pkgData);
    console.log("✔ package.json loaded in memory");
  } catch (e) {
    console.error("❌ Cannot fetch package.json:", e.message);
    return;
  }

  // 3️⃣ Jede Dependency einzeln installieren
  const depEntries = Object.entries(pkg.dependencies || {});
  for (const [dep, ver] of depEntries) {
    const cleanVersion = ver.replace(/^[^0-9]*/, ""); // entfernt ^ oder ~
    console.log(`🔹 Installing dependency: ${dep}@${cleanVersion || "latest"}`);
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
  console.log(`Start server with: node ${path.join(INSTALL_DIR, "server.js")}`);
}

install();
