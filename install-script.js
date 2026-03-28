// install-script.js (CommonJS, läuft ohne package.json)
const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const INSTALL_DIR = process.cwd();
const REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/main";

const FILES_TO_FETCH = ["server.js", "package.json"];

  return new Promise((resolve) => {
    const args = ["install", tarballUrl];
    if (!isDebug) args.push("--silent");

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const npm = spawn(npmCmd, args, { shell: process.platform === "win32" ? true : false, stdio: isDebug ? "inherit" : "ignore" });
    npm.on("exit", code => {
      if (code === 0) console.log(`✔ ${dep} installed`);
      else console.error(`❌ Failed to install ${dep}`);
      resolve();
    });
  });
}

// --- Hauptfunktion
async function install() {
    console.log("Installing NovaPlay...");

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
    console.log("✅ Starting installation...\n");
  }
  
  await countdown(5);

  if (isDevBeta) {
    const devFilePath = path.join(process.cwd(), 'DELETE THIS IF YOU WANT TO LEAVE THE BETA DEV PROGRAMM.NovaPlayDevFile');

    async function ensureFile(filePath) {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true }); // erstellt nur Ordner, falls nötig

      try {
        await fs.access(filePath, fs.constants.F_OK); // prüft, ob Datei existiert
      } catch {
        await fs.writeFile(filePath, ''); // Datei erstellen, falls fehlt
      }
    }

    ensureFile(devFilePath)
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

    console.log("📦 Installing dependencies...");
    execSync("npm install", { stdio: "inherit" });

    console.log("✅ Done! Start server with:");
    console.log("node server.js");
}

install();
