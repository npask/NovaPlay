// install-script.js (CommonJS, läuft ohne package.json)
const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const INSTALL_DIR = process.cwd();
const REPO_BASE = "https://raw.githubusercontent.com/npask/NovaPlay/main";

const FILES_TO_FETCH = ["server.js", "package.json"];

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

    console.log("📦 Installing dependencies...");
    execSync("npm install", { stdio: "inherit" });

    console.log("✅ Done! Start server with:");
    console.log("node server.js");
}

install();
