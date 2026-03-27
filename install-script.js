// install-script.js
import fs from 'fs';
import path from 'path';

const INSTALL_DIR = process.cwd(); // aktueller Ordner
const REPO_BASE = 'https://raw.githubusercontent.com/npask/NovaPlay/main';

const FILES_TO_FETCH = ['server.js','package.json'];

async function install() {
    console.log("Installing Nico's Media Server...");

    for (const file of FILES_TO_FETCH) {
        try {
            const url = `${REPO_BASE}/${file}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch ${file}`);
            const data = await res.text();
            const targetPath = path.join(INSTALL_DIR, file);
            await fs.writeFile(targetPath, data);
            console.log(`✔ ${file} downloaded`);
        } catch (e) {
            console.error(`❌ Error fetching ${file}:`, e.message);
        }
    }

    console.log(`Installation to "${INSTALL_DIR}" completed!`);
}

// Start Installation
install();
