console.log("✨ Starting NovaPlay")
import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import bodyParser from 'body-parser';
import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import dns from 'dns';
import cookieParser from 'cookie-parser';

let ffmpegPath = null;

try {
    // dynamischer Import, catch falls Modul nicht existiert
    ffmpegPath = (await import('ffmpeg-static')).default;
    console.log("📌 ffmpeg-static gefunden");
} catch (e) {
    console.warn("⚠ ffmpeg-static nicht gefunden, fallback auf System-ffmpeg");
}

async function setupFFmpeg() {
    if (ffmpegPath) {
        try {
            ffmpeg.setFfmpegPath(ffmpegPath);
            await new Promise((resolve, reject) => {
                exec(`cd ${path.dirname(ffmpegPath)} && ${path.basename(ffmpegPath)} -version`, (err, stdout) => err ? reject(err) : resolve(stdout));
            });
            console.log("✅ ffmpeg-static wird verwendet");
            return;
        } catch (e) {
            console.log(e)
            console.warn("⚠ ffmpeg-static funktioniert nicht, fallback auf System ffmpeg");
        }
    }

    // Prüfen ob System-FFmpeg installiert ist
    try {
        await new Promise((resolve, reject) => {
            exec('ffmpeg -version', (err, stdout) => err ? reject(err) : resolve(stdout));
        });
        ffmpeg.setFfmpegPath('ffmpeg'); // System ffmpeg
        console.log("✅ System-ffmpeg wird verwendet");
    } catch (e) {
        console.error("❌ Kein ffmpeg gefunden! Bitte installieren: pkg install ffmpeg oder sudo apt-get install ffmpeg");
        process.exit(1);
    }
}

await setupFFmpeg();

async function checkBetaFile() {
    const devFilePath = path.join(process.cwd(), 'DELETE THIS IF YOU WANT TO LEAVE THE BETA DEV PROGRAMM.NovaPlayDevFile');
    const exists = await fs.pathExists(devFilePath);
    if (exists) {
        console.log("⚡ Beta/Dev-Program active");
        return true;
    } else {return false;}
}

const app = express();
const PORT = 3000;

const configFile = './data/config.json';
const accountsFile = './data/accounts.json';
const libraryFile = './data/library.json';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

let config = {};
if(await fs.pathExists(configFile)){
    config = await fs.readJson(configFile);
    app.use('/media', express.static(config.videoPath || 'videos'));
    app.use('/music', express.static(config.musicPath || 'music'));
}

const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi'];
const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg'];

// --- Update funktion ---
const SERVER_VERSION = '0.0.1 DEV';
const UPDATE_CHECK_INTERVAL = 1000 * 60 * 15;
const isBeta = await checkBetaFile();
const REMOTE_SERVER_JS_URL = isBeta == true ? 'https://raw.githubusercontent.com/npask/NovaPlay/developing/server.js': 'https://raw.githubusercontent.com/npask/NovaPlay/main/server.js';
const LOCAL_SERVER_JS = process.argv[1];

// --- Prüfen ob Internet verfügbar ---
async function isOnline() {
    return new Promise(resolve => {
        dns.lookup('github.com', err => resolve(!err));
    });
}

// --- Update prüfen und ggf. anwenden ---
async function checkForUpdate() {
    const online = await isOnline();
    if (!online) return console.log('Kein Internet - Update übersprungen');

    try {
        // Remote server.js laden
        const res = await fetch(REMOTE_SERVER_JS_URL);
        if (!res.ok) return console.log('Remote server.js konnte nicht geladen werden');
        const remoteCode = await res.text();

        // Prüfen, ob die Version anders ist (embedded in remote)
        const versionMatch = remoteCode.match(/const SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/);
        if (!versionMatch) return console.log('⚠ No Version in Server Version found');
        const remoteVersion = versionMatch[1];

        if (remoteVersion !== SERVER_VERSION) {
            console.log(`💠 New Version found: ${remoteVersion} (local: ${SERVER_VERSION})`);

            // Backup der alten server.js
            await fs.copy(LOCAL_SERVER_JS, LOCAL_SERVER_JS + '.bak');

            // Update schreiben
            await fs.writeFile(LOCAL_SERVER_JS, remoteCode);

            console.log('🎉 Update installiert - Server wird neu gestartet');
            exec(`node ${LOCAL_SERVER_JS}`, (err, stdout, stderr) => {
                if (err) console.error(err);
                process.exit(0); // alter Prozess beendet sich
            });
        } else {
            console.log('🔵 Server is up-to-date!');
        }

    } catch (e) {
        console.error('Update-Check Fehler:', e);
    }
}

// --- Intervall starten ---
setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);

// --- Optional: sofort prüfen beim Start ---
checkForUpdate();

// --- Hilfsfunktionen ---
async function listFolders(basePath) {
    const result = [];
    try {
        const items = await fs.readdir(basePath);
        for (let item of items) {
            const fullPath = path.join(basePath, item);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory() && !fullPath.toLowerCase().startsWith('c:\\windows')) {
                    result.push(fullPath);
                }
            } catch {}
        }
    } catch {}
    return result;
}

// --- Scan & Library ---
async function scanMedia(mediaRoot, type) {
    const library = [];

    async function scanFolder(folder, categoryName = null) {
        let items;
        try {
            items = await fs.readdir(folder);
        } catch {
            return;
        }

        for (const item of items) {
            const fullPath = path.join(folder, item);
            let stat;
            try { stat = await fs.stat(fullPath); } catch { continue; }

            if (stat.isDirectory()) {
                // rekursiv weiter scannen
                // Kategorie ist nur das erste Level unter mediaRoot
                const newCategory = categoryName || item;
                await scanFolder(fullPath, newCategory);
            } else {
                const ext = path.extname(item).toLowerCase();

                if (
                    (type === 'video' && videoExtensions.includes(ext)) ||
                    (type === 'music' && audioExtensions.includes(ext))
                ) {
                    library.push({
                        title: path.parse(item).name,
                        category: categoryName || '', // Root-Dateien bekommen leere Kategorie
                        path: fullPath,
                        type,
                        watched: false,
                        position: 0
                    });
                }
            }
        }
    }

    await scanFolder(mediaRoot);

    await fs.ensureDir('./data');

    let existing = await fs.readJson(libraryFile).catch(() => []);
    existing = existing.filter(v => !library.some(n => n.path === v.path));
    await fs.writeJson(libraryFile, [...existing, ...library], { spaces: 2 });

    generateThumbnails(mediaRoot);

    return library;
}

// --- Thumbnail Worker ---

let progressState = {
    total: 0,
    done: 0,
    currentFile: null,
    status: 'idle' // idle | running | finished
};

async function generateThumbnails(rootFolder) {
    progressState.status = 'running';
    progressState.total = 0;
    progressState.done = 0;
    progressState.currentFile = null;

    async function processFolder(folder) {
        const files = await fs.readdir(folder);
        const cacheFolder = path.join(folder, 'NovaPlayCACHE'); // Kein Punkt

        await fs.ensureDir(cacheFolder);

        // Ordner verstecken
        if (process.platform === 'win32') {
            exec(`attrib +h "${cacheFolder}"`, (err) => {
                if (err) console.warn('Kann Cache-Ordner nicht verstecken (Windows):', err.message);
            });
        } else if (process.platform === 'darwin') {
            exec(`chflags hidden "${cacheFolder}"`, (err) => {
                if (err) console.warn('Kann Cache-Ordner nicht verstecken (macOS):', err.message);
            });
        } // Linux: kein nativer Explorer, meist kein Problem

        for (const f of files) {
            const fullPath = path.join(folder, f);
            const stat = await fs.stat(fullPath);

            if (stat.isDirectory() && f !== 'NovaPlayCACHE') {
                await processFolder(fullPath); // rekursiv
            } else {
                const ext = path.extname(f).toLowerCase();
                if (videoExtensions.includes(ext)) {
                    const thumbPath = path.join(cacheFolder, `Thumbnail_${path.parse(f).name}.webp`);
                    if (!await fs.pathExists(thumbPath)) {
                        progressState.currentFile = f;
                        progressState.total += 1;

                        if (await fs.pathExists(thumbPath)) { // SKIP if already exists
                            progressState.done += 1;
                            continue;
                        }

                        console.log(`Generating thumbnail for ${f} ...`);
                        try {
                            await generateThumbnail(fullPath, thumbPath);
                        } catch (err) {
                            console.warn(`⚠ Skipping broken file: ${f}`, err.message);
                        }
                        progressState.done += 1;
                    }
                }
            }
        }
    }

    await processFolder(rootFolder);
    progressState.status = 'finished';
    progressState.currentFile = null;
}

/**
 * Erstellt ein einzelnes Thumbnail aus dem Video und speichert als WebP
 */
async function generateThumbnail(videoPath, outputPath) {
    await fs.ensureDir(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
        const tempPath = path.join(path.dirname(outputPath), 'temp.png');

        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['5'],  // 5. Sekunde
                filename: 'temp.png',
                folder: path.dirname(outputPath),
                size: '320x?'
            })
            .on('end', async () => {
                try {
                    await fs.rename(tempPath, outputPath);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', (err) => reject(err));
    });
}

// --- Progress Route ---
app.get('/thumbnail-progress', (req,res)=>{
    res.json(progressState);
});

// --- UI Helper ---
function renderPage(title, body){
    return `
        <html>
        <head>
        <title>${title}</title>
        <style>
        body { font-family:'Roboto',sans-serif; background:#0f0f0f; color:#fff; margin:0; padding:0; }
        a {text-decoration:none;color:#1db954;} a:hover {color:#1ed760;}
        header {background:#1c1c1c;padding:15px 20px;font-size:1rem;font-weight:bold; display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,0.5);}
        nav {display:flex; justify-content:center; gap:30px; padding:15px 0; background:#111; box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1); border-radius: 100px;}
        nav a { font-weight:600; text-transform:uppercase; transition:0.2s;}
        nav a:hover {color:#ff4500; transform:scale(1.1);}
        .container {max-width:1200px; margin:20px auto; padding:0 15px;}
        .media-list {display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:20px;}
        .media-card {background:#1a1a1a; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.5); display:flex; flex-direction:column; transition:0.3s;}
        .media-card:hover {transform:translateY(-5px); box-shadow:0 8px 25px rgba(0,0,0,0.7);}
        .media-card img, .media-card video, .media-card audio {width:100%; object-fit:cover; aspect-ratio: 16 / 9;}
        .media-info {padding:10px; display:flex; flex-direction:column; gap:5px;}
        .media-info h3 {font-size:1rem; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
        .media-info small {color:#aaa;}
        button {background:linear-gradient(135deg,#ff4500,#ff8c00); border:none; color:#fff; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:600; transition:0.2s;}
        button:hover {transform:scale(1.05); box-shadow:0 5px 15px rgba(0,0,0,0.5);}
        video,audio {border-radius:8px; margin-top:10px; background:#000; width:100%;}
        form {margin:0;}
        .player-container {
            max-width: 900px;
            margin: 20px auto;
            background: #1b1b1b;
            padding: 15px;
            border-radius: 12px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.6);
        }
        #playerControls button {
            background: linear-gradient(135deg,#ff4500,#ff8c00);
            border-radius: 6px;
            color: #fff;
            padding: 10px 20px;
            margin: 5px;
            font-weight: 600;
            cursor: pointer;
            transition: 0.2s;
        }
        #playerControls button:hover {
            transform: scale(1.05);
            box-shadow: 0 6px 15px rgba(0,0,0,0.5);
        }
        </style>
        </head>
        <body>
        <header>NovaPlay</header>
        <div class="container">
        ${body}
        </div>
        </body>
        </html>
    `;
}

// --- Setup ---
app.get('/', async (req,res)=>{
    if(!await fs.pathExists(configFile)){
        const folders = await listFolders('C:/Users');
        return res.send(renderPage("Setup", `
            <h2>Initial Setup</h2>
            <form method="POST" action="/setup">
            <label>Admin Name:</label><input name="adminName" required/><br><br>
            <label>Video Ordner:</label>
            <select name="videoPath"><option value="">-- Ordner wählen --</option>${folders.map(f=>`<option>${f}</option>`).join('')}</select><br>
            <label>Oder eigenen Pfad:</label><input name="customVideo" placeholder="D:/Videos"/><br><br>
            <label>Musik Ordner:</label><input name="musicPath" placeholder="D:/Musik"/><br><br>
            <button type="submit">Setup</button>
            </form>
        `));
    }
    res.redirect('/login');
});

app.post('/setup', async (req,res)=>{
    const videoPath = req.body.videoPath || req.body.customVideo;
    const musicPath = req.body.musicPath || '';
    const { adminName } = req.body;
    if(!videoPath) return res.send("Bitte Video-Ordner auswählen!");
    await fs.ensureDir('./data');
    await fs.writeJson(configFile, { adminName, videoPath, musicPath }, { spaces:2 });
    await fs.ensureFile(accountsFile);
    await fs.writeJson(accountsFile, [], { spaces:2 });
    await scanMedia(videoPath,'video');
    if(musicPath) await scanMedia(musicPath,'music');
    res.redirect('/login');
});

// --- Login ---
app.get('/login', async (req,res)=>{
    const username = req.query.user || req.cookies.username;
    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===username);

    if(username && account){
        res.redirect('/library');
    } else {
        res.send(renderPage("Login", `
            <h2>Login</h2>
            <form method="POST" action="/login">
                <input name="username" required/>
                <button type="submit">Login</button>
            </form>
        `));
    }
});

// --- Login Handler ---
app.post('/login', async (req,res)=>{
    const { username } = req.body;
    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    if(!accounts.find(a=>a.username===username)) accounts.push({username, watched:[], lastCategory:null});
    await fs.writeJson(accountsFile, accounts, { spaces:2 });

    // Cookie setzen, z.B. für 7 Tage
    res.cookie('username', username, { maxAge: 7*24*60*60*1000, httpOnly: true });

    // Direkt weiterleiten
    res.redirect('/library');
});

// --- Help Recommend things ---

function tokenizeTitle(title){
    return title
        .toLowerCase()
        .replace(/[^a-z0-9äöüß ]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3);
}

function buildUserTasteProfile(account, library){
    const watchedTitles = account.watched || [];

    const watchedItems = library.filter(v => watchedTitles.includes(v.title));
    const wordScore = {};
    const categoryScore = {};

    for(const item of watchedItems){
        const words = tokenizeTitle(item.title);

        for(const w of words){
            wordScore[w] = (wordScore[w] || 0) + 2;
        }

        categoryScore[item.category] = (categoryScore[item.category] || 0) + 3;
    }

    return { wordScore, categoryScore };
}

function scoreMediaItem(item, profile){
    let score = 0;

    // Kategorie Bewertung
    score += (profile.categoryScore[item.category] || 0);

    // Titel Wörter Bewertung
    const words = tokenizeTitle(item.title);
    for(const w of words){
        score += (profile.wordScore[w] || 0);
    }

    // Bonus: wenn Titel "replay" / "part" / "episode" etc enthält
    if(item.title.toLowerCase().includes("replay")) score += 3;
    if(item.title.toLowerCase().includes("part")) score += 2;
    if(item.title.toLowerCase().includes("episode")) score += 2;

    // leichter Zufall damit es nicht immer gleich ist
    score += Math.random() * 2;

    return score;
}

function getRecommendations(account, library, tab='video', limit=24){
    const watchedSet = new Set(account.watched || []);

    // Nur ungeschaut
    let candidates = library.filter(v => v.type === tab && !watchedSet.has(v.title));

    if(candidates.length === 0) return [];

    // Profil bauen
    const profile = buildUserTasteProfile(account, library);

    // Scoring
    candidates = candidates.map(v => ({
        ...v,
        score: scoreMediaItem(v, profile)
    }));

    // Sortieren nach Score
    candidates.sort((a,b) => b.score - a.score);

    // Top X zurückgeben
    return candidates.slice(0, limit);
}


function tokenize(text){
    return text
        .toLowerCase()
        .replace(/[^a-z0-9äöüß ]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3);
}

function buildProfile(account, library){
    const watched = new Set(account.watched || []);
    const wordScore = {};
    const categoryScore = {};

    for(const item of library){
        if(!watched.has(item.title)) continue;

        // Kategorie trainieren
        categoryScore[item.category] = (categoryScore[item.category] || 0) + 5;

        // Wörter trainieren
        const words = tokenize(item.title);
        for(const w of words){
            wordScore[w] = (wordScore[w] || 0) + 2;
        }
    }

    return { wordScore, categoryScore };
}

function scoreItem(item, profile){
    let score = 0;

    score += (profile.categoryScore[item.category] || 0);

    const words = tokenize(item.title);
    for(const w of words){
        score += (profile.wordScore[w] || 0);
    }

    // Bonus Keywords
    const t = item.title.toLowerCase();
    if(t.includes("episode")) score += 2;
    if(t.includes("part")) score += 2;
    if(t.includes("replay")) score += 3;
    if(t.includes("mix")) score += 2;
    if(t.includes("remix")) score += 2;

    // bisschen random (damit es sich lebendig anfühlt)
    score += Math.random() * 3;

    return score;
}

function diversify(items, limit=24){
    const result = [];
    const catCount = {};

    for(const item of items){
        const c = item.category;
        catCount[c] = catCount[c] || 0;

        // max 4 pro category in den top results
        if(catCount[c] >= 4) continue;

        result.push(item);
        catCount[c]++;

        if(result.length >= limit) break;
    }

    return result;
}

function getAIRecommendations(account, library, type, limit=24){
    const watched = new Set(account.watched || []);
    const profile = buildProfile(account, library);

    let candidates = library.filter(v => v.type === type && !watched.has(v.title));

    if(candidates.length === 0) return [];

    candidates = candidates.map(v => ({
        ...v,
        score: scoreItem(v, profile)
    }));

    candidates.sort((a,b) => b.score - a.score);

    return diversify(candidates, limit);
}

// --- Beispiel: Library greift Cookie ab ---
app.get('/library', async (req,res)=>{
    const username = req.query.user || req.cookies.username;
    const mode = req.query.mode || "home"; // home | videos | music

    if(!username) return res.redirect('/login');

    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===username);
    if(!account) return res.redirect('/login');

    await fs.ensureFile(libraryFile);
    let library = await fs.readJson(libraryFile).catch(()=>[]);

    function makeCard(v){
        const thumbName = `Thumbnail_${path.parse(v.path).name}.webp`;
        const imgSrc = `/media/${encodeURIComponent(v.category + "/NovaPlayCACHE/" + thumbName)}`;

        return `
            <div class="media-card">
                ${
                    v.type === "video"
                    ? `<img src="${imgSrc}" />`
                    : `<div class="music-cover">🎵</div>`
                }
                <div class="media-info">
                    <h3>${v.title}</h3>
                    <small>${v.category}</small>
                    <a href="/play?tab=${v.type}&cat=${encodeURIComponent(v.category)}&path=${encodeURIComponent(v.path)}">▶ Play</a>
                </div>
            </div>
        `;
    }

    // HOME = AI Empfehlungen (20 Videos + 20 Musik)
    if(mode === "home"){
        const videoRecs = getAIRecommendations(account, library, "video", 20);
        const musicRecs = getAIRecommendations(account, library, "music", 20);

        return res.send(renderPage("Home", `
            <nav>
                <a href="/library?mode=home">Home</a>
                <a href="/library?mode=videos">Videos</a>
                <a href="/library?mode=music">Musik</a>
            </nav>

            <h2 style="margin-top:20px;">🔥 Für dich (Videos)</h2>
            <div class="media-list">
                ${videoRecs.map(makeCard).join("")}
            </div>

            <h2 style="margin-top:40px;">🎵 Für dich (Musik)</h2>
            <div class="media-list">
                ${musicRecs.map(makeCard).join("")}
            </div>

            <br>
            <a href="/scan">🔄 Medien neu scannen</a>

            <style>
                .music-cover{
                    width:100%;
                    aspect-ratio: 16 / 9;
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    font-size:3rem;
                    background: linear-gradient(135deg,#222,#111);
                }
            </style>
        `));
    }

    // VIDEOS TAB = ALLE Videos
    if(mode === "videos"){
        const allVideos = library.filter(v => v.type === "video");

        return res.send(renderPage("Videos", `
            <nav>
                <a href="/library?mode=home">Home</a>
                <a href="/library?mode=videos">Videos</a>
                <a href="/library?mode=music">Musik</a>
            </nav>

            <h2 style="margin-top:20px;">🎬 Alle Videos</h2>
            <div class="media-list">
                ${allVideos.map(makeCard).join("")}
            </div>

            <br>
            <a href="/scan">🔄 Medien neu scannen</a>
        `));
    }

    // MUSIC TAB = ALLE Musik
    if(mode === "music"){
        const allMusic = library.filter(v => v.type === "music");

        return res.send(renderPage("Musik", `
            <nav>
                <a href="/library?mode=home">Home</a>
                <a href="/library?mode=videos">Videos</a>
                <a href="/library?mode=music">Musik</a>
            </nav>

            <h2 style="margin-top:20px;">🎵 Alle Musik</h2>
            <div class="media-list">
                ${allMusic.map(makeCard).join("")}
            </div>

            <br>
            <a href="/scan">🔄 Medien neu scannen</a>

            <style>
                .music-cover{
                    width:100%;
                    aspect-ratio: 16 / 9;
                    display:flex;
                    justify-content:center;
                    align-items:center;
                    font-size:3rem;
                    background: linear-gradient(135deg,#222,#111);
                }
            </style>
        `));
    }

    res.redirect("/library?mode=home");
});

// --- Watch Toggle / Resume ---
app.post('/watch', async (req,res)=>{
    let { title, category } = req.body;
    const user = req.query.user || req.cookies.username;
    if(!user) return res.json({ ok:false });

    title = path.parse(title).name;

    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===user);
    if(!account) return res.json({ ok:false });

    if(!account.watched.includes(title)){
        account.watched.push(title);
    }

    account.lastCategory = category;

    await fs.writeJson(accountsFile, accounts, { spaces:2 });
    res.json({ ok:true });
});

// --- Play Video/Music ---
app.get('/play', async (req,res)=>{
    const { tab='video', cat, path: mediaPath} = req.query;
    const user = req.query.user || req.cookies.username;
    const fileName = path.basename(mediaPath);
    const source = tab==='video'?'/media':'/music';
    const tag = tab==='video'?'video':'audio';

    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===user);

    let library = await fs.readJson(libraryFile).catch(()=>[]);
    let recommend = library.filter(v => !account?.watched.includes(v.title) && v.path !== mediaPath);
    if(account?.lastCategory){
        recommend = recommend.sort(v => v.category === account.lastCategory ? -1 : 1)[0];
    } else {
        recommend = recommend[0];
    }

    res.send(renderPage(`Play ${tab}`, `
        <div class="player-wrapper">
            <${tag} id="mediaPlayer" autoplay>
                <source src="${source}/${encodeURIComponent(cat + "/" + fileName)}">
            </${tag}>
            
            <!-- Custom Controls -->
            <div class="custom-controls" id="customControls">
                <button id="leaveBtn" class="top-left">⏹ Leave</button>
                <button id="centerPlayPause" class="center">⏯</button>
                <div class="bottom-left">
                    <span id="currentTime">0:00</span> / <span id="duration">0:00</span>
                </div>
                <button id="miniMaxBtn" class="bottom-right">🗖</button>
                <div class="progress-wrapper">
                    <input type="range" id="progressBar" value="0" min="0" max="100" step="0.1">
                </div>
            </div>

            <!-- Post Video Overlay -->
            <div id="postVideo" class="post-overlay">
                <h3>Was möchtest du tun?</h3>
                <button onclick="replay()">Nochmal ansehen ⏮</button>
                <button onclick="location.href='/login'">Zur Auswahl ↩️</button>
                ${recommend ? `<button onclick="location.href='/play?tab=${tab}&cat=${encodeURIComponent(recommend.category)}&path=${encodeURIComponent(recommend.category + '/' + recommend.path)}&user=${user}'">Empfohlen ▶ ${recommend.title}</button>` : ''}
            </div>
        </div>

        <script>
            const media = document.getElementById('mediaPlayer');
            const wrapper = document.querySelector('.player-wrapper');
            const controls = document.getElementById('customControls');
            const post = document.getElementById('postVideo');
            const leaveBtn = document.getElementById('leaveBtn');
            const centerPlayPause = document.getElementById('centerPlayPause');
            const miniMaxBtn = document.getElementById('miniMaxBtn');
            const currentTimeElem = document.getElementById('currentTime');
            const durationElem = document.getElementById('duration');
            const progressBar = document.getElementById('progressBar');

            function togglePlay(){ media.paused ? media.play() : media.pause(); }
            centerPlayPause.addEventListener('click', togglePlay);
            media.addEventListener('click', togglePlay);

            leaveBtn.addEventListener('click', ()=>{ location.href='/login'; });
            miniMaxBtn.addEventListener('click', ()=>{
                if (!document.fullscreenElement) wrapper.requestFullscreen?.();
                else document.exitFullscreen?.();
            });

            function updateProgress(){
                if(!media.duration) return;
                const percent = (media.currentTime / media.duration) * 100;
                progressBar.value = percent;
                progressBar.style.background = \`linear-gradient(to right, #ff4500 \${percent}%, rgba(255,255,255,0.3) \${percent}%)\`;
                currentTimeElem.textContent = Math.floor(media.currentTime/60)+':'+String(Math.floor(media.currentTime%60)).padStart(2,'0');
                durationElem.textContent = Math.floor(media.duration/60)+':'+String(Math.floor(media.duration%60)).padStart(2,'0');
            }

            media.addEventListener('timeupdate', updateProgress);
            progressBar.addEventListener('input', ()=>{
                media.currentTime = (progressBar.value / 100) * media.duration;
                updateProgress();
            });

            let hideTimeout;
            function showControls(){
                controls.classList.add('visible');
                clearTimeout(hideTimeout);
                hideTimeout = setTimeout(()=>{ controls.classList.remove('visible'); }, 3000);
            }
            wrapper.addEventListener('mousemove', showControls);
            wrapper.addEventListener('click', showControls);
            showControls();

            media.addEventListener('ended', ()=>{
                setTimeout(()=>{
                    wrapper.classList.add('ended');
                    post.style.display='flex';
                    post.classList.add('fade-in');
                }, 100);

                fetch('/watch', {
                    method:'POST',
                    headers:{'Content-Type':'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({ title:'${fileName}', category:'${cat}', user:'${user}'})
                });
            });

            function replay(){ 
                media.currentTime=0; media.play(); wrapper.classList.remove('ended'); 
                post.style.display='none'; post.classList.remove('fade-in');
            }
        </script>

        <style>
            .player-wrapper{position:relative; max-width:900px; margin:20px auto;}
            video, audio{width:100%; border-radius:10px; background:#000; display:block;}

            .custom-controls{
                position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; cursor:none;
                display:flex; flex-direction:column; justify-content:space-between; opacity:0; transition:opacity 0.5s;
            }
            .custom-controls.visible{opacity:1; pointer-events:auto; cursor: unset;}
            .custom-controls button{pointer-events:auto; background:none; border:none; color:#fff; font-size:1.2rem; cursor:pointer;}
            .custom-controls .top-left{align-self:flex-start; margin:10px;}
            .custom-controls .center{align-self:center; margin:auto; font-size:3rem; opacity:0.8;}
            .custom-controls .bottom-left{margin:0 0 0 10px;}
            .custom-controls .bottom-right{align-self:flex-end; margin:0 10px 0 0;}

            .progress-wrapper{position:relative; width:calc(100% - 40px); margin:0 20px 10px 20px;}
            #progressBar{
                -webkit-appearance:none; height:6px; border-radius:3px;
                background: linear-gradient(to right, #ff4500 0%, rgba(255,255,255,0.3) 0%);
                width:100%; cursor:pointer;
                transition: background 0.1s linear;
            }
            #progressBar::-webkit-slider-thumb{
                -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:#ff4500; cursor:pointer;
            }

            .post-overlay{
                display:none; position:absolute; top:0; left:0; width:100%; height:100%; 
                background:rgba(0,0,0,0.6); color:#fff; flex-direction:column; justify-content:center; align-items:center;
                gap:15px; z-index:5; opacity:0; transform: translateY(20px); border-radius: 20px;
                transition: opacity 0.5s ease, transform 0.5s ease, backdrop-filter 0.7s ease;
            }
            .post-overlay.fade-in{ opacity:1; transform:translateY(0); backdrop-filter: blur(8px); display:flex; }
            .player-wrapper.ended video{ filter: blur(8px); transition: filter 0.7s ease;}
        </style>
    `));
});

// --- Rescan ---
app.get('/scan', async (req,res)=>{
    const conf = await fs.readJson(configFile);
    if(conf.videoPath) await scanMedia(conf.videoPath,'video');
    if(conf.musicPath) await scanMedia(conf.musicPath,'music');
    const backURL = req.get('referer') || '/';
    res.redirect(backURL);
});

// --- Server starten ---
app.listen(PORT,()=>console.log(`❇️ Started / Server running on http://localhost:${PORT}`));
