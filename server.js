import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import bodyParser from 'body-parser';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';

const app = express();
const PORT = 3000;

const configFile = './data/config.json';
const accountsFile = './data/accounts.json';
const libraryFile = './data/library.json';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

let config = {};
if(await fs.pathExists(configFile)){
    config = await fs.readJson(configFile);
    app.use('/media', express.static(config.videoPath || 'videos'));
    app.use('/music', express.static(config.musicPath || 'music'));
}

let progressState = {}; // für Thumbnail-Worker

const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi'];
const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg'];
const imageExtensions = ['.png', '.gif', '.jpg', '.jpeg'];

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
    try {
        const categories = await fs.readdir(mediaRoot);
        for (let cat of categories) {
            const catPath = path.join(mediaRoot, cat);
            let stat;
            try { stat = await fs.stat(catPath); } catch { continue; }
            if (!stat.isDirectory()) continue;

            let files;
            try { files = await fs.readdir(catPath); } catch { continue; }

            for (let f of files) {
                const ext = path.extname(f).toLowerCase();
                if ((type==='video' && videoExtensions.includes(ext)) ||
                    (type==='music' && audioExtensions.includes(ext))) {
                    library.push({
                        title: path.parse(f).name,
                        category: cat,
                        path: path.join(catPath, f),
                        type,
                        watched: false,
                        position: 0
                    });
                }
            }
        }
        await fs.ensureDir('./data');
        let existing = await fs.readJson(libraryFile).catch(()=>[]);
        existing = existing.filter(v => !library.some(n => n.path === v.path));
        await fs.writeJson(libraryFile, [...existing, ...library], { spaces:2 });

        // Thumbnail Worker starten parallel
        startChillThumbnailWorker(mediaRoot);

    } catch(e){ console.error(e); }
    return library;
}

// --- Thumbnail Worker ---
let progressQueue = [];   // Warteschlange aller Videos
let isProcessing = false; // Worker-Status

async function startChillThumbnailWorker(rootFolder) {
    // Rekursiv alle Videos in Warteschlange packen
    async function enqueueVideos(folder) {
        const files = await fs.readdir(folder);
        const cacheFolder = path.join(folder,'.MediaNicoPlayerWEBPCache');
        await fs.ensureDir(cacheFolder);

        for (const f of files) {
            const fullPath = path.join(folder,f);
            const stat = await fs.stat(fullPath);

            if (stat.isDirectory() && f !== '.MediaNicoPlayerWEBPCache') {
                await enqueueVideos(fullPath);
            } else {
                const ext = path.extname(f).toLowerCase();
                if (videoExtensions.includes(ext)) {
                    const outputFile = path.join(cacheFolder, `Thumbnail_${path.parse(f).name}.webp`);
                    if (!await fs.pathExists(outputFile)) {
                        progressQueue.push({ video: fullPath, output: outputFile, status: 'queued' });
                        progressState[fullPath] = 'queued';
                    }
                }
            }
        }
    }

    await enqueueVideos(rootFolder);
    processQueue();
}

// Worker verarbeitet Videos nacheinander
async function processQueue() {
    if (isProcessing) return; // bereits am Laufen
    isProcessing = true;

    while(progressQueue.length > 0) {
        const item = progressQueue.shift();
        progressState[item.video] = 'in progress';
        try {
            await generateThumbnail(item.video, item.output);
            progressState[item.video] = 'done';
        } catch(e) {
            progressState[item.video] = 'error';
        }
    }

    isProcessing = false;
    console.log('Alle Thumbnails fertig ✅');
}

// generateThumbnail wie vorher
async function generateThumbnail(videoPath, outputPath) {
    await fs.ensureDir(path.dirname(outputPath));
    return new Promise((resolve, reject) => {
        const tempDir = './temp';
        fs.ensureDirSync(tempDir);
        ffmpeg(videoPath)
            .screenshots({
                timestamps: ['5'],
                filename: 'temp.png',
                folder: tempDir,
                size: '320x?'
            })
            .on('end', async () => {
                try {
                    await sharp(path.join(tempDir,'temp.png'))
                        .webp({ quality: 60 })
                        .toFile(outputPath);
                    await fs.remove(path.join(tempDir,'temp.png'));
                    resolve();
                } catch(e) { reject(e); }
            })
            .on('error', err => reject(err));
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
header {background:#1c1c1c;padding:15px 20px;font-size:2rem;font-weight:bold; display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,0.5);}
nav {display:flex; justify-content:center; gap:30px; padding:15px 0; background:#111; box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1);}
nav a { font-weight:600; text-transform:uppercase; transition:0.2s;}
nav a:hover {color:#ff4500; transform:scale(1.1);}
.container {max-width:1200px; margin:20px auto; padding:0 15px;}
.media-list {display:grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap:20px;}
.media-card {background:#1a1a1a; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.5); display:flex; flex-direction:column; transition:0.3s;}
.media-card:hover {transform:translateY(-5px); box-shadow:0 8px 25px rgba(0,0,0,0.7);}
.media-card img, .media-card video, .media-card audio {width:100%; object-fit:cover;}
.media-info {padding:10px; display:flex; flex-direction:column; gap:5px;}
.media-info h3 {font-size:1rem; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.media-info small {color:#aaa;}
button {background:linear-gradient(135deg,#ff4500,#ff8c00); border:none; color:#fff; padding:8px 15px; border-radius:6px; cursor:pointer; font-weight:600; transition:0.2s;}
button:hover {transform:scale(1.05); box-shadow:0 5px 15px rgba(0,0,0,0.5);}
video,audio {border-radius:8px; margin-top:10px; background:#000; width:100%;}
form {margin:0;}
</style>
</head>
<body>
<header>Media Server</header>
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
    res.send(renderPage("Login", `
<h2>Login</h2>
<form method="POST" action="/login">
<input name="username" required/>
<button type="submit">Login</button>
</form>
`));
});

app.post('/login', async (req,res)=>{
    const { username } = req.body;
    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    if(!accounts.find(a=>a.username===username)) accounts.push({username, watched:[], lastCategory:null});
    await fs.writeJson(accountsFile, accounts, { spaces:2 });
    res.redirect(`/library?user=${encodeURIComponent(username)}&tab=video`);
});

// --- Library ---
app.get('/library', async (req,res)=>{
    const { user, tab='video' } = req.query;
    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===user);
    if(!account) return res.redirect('/login');

    await fs.ensureFile(libraryFile);
    let library = await fs.readJson(libraryFile).catch(()=>[]);
    library = library.filter(v=>v.type===tab);

    let recommend = library.filter(v=>v.category===account.lastCategory && !account.watched.includes(v.title))[0]
    if(!recommend) recommend = library.find(v=>!account.watched.includes(v.title))

    const itemsHTML = library.map(v=>{
        const watched = account.watched.includes(v.title);
        const mediaSrc = v.type==='video' ? `/media/${encodeURIComponent(v.category + "/" + path.basename(v.path))}` : `/music/${encodeURIComponent(path.basename(v.path))}`;
        const mediaTag = v.type==='video' ? 'video' : 'audio';
        return `
<div class="media-card">
<${mediaTag} controls preload="metadata">
<source src="${mediaSrc}">
Your browser does not support the media element.
</${mediaTag}>
<div class="media-info">
<h3>${v.title}</h3>
<small>${v.category} • ${watched?'Gesehen':'Neu'}</small>
<form action="/watch" method="POST">
<input type="hidden" name="title" value="${v.title}">
<input type="hidden" name="user" value="${user}">
<input type="hidden" name="category" value="${v.category}">
<button type="submit">${watched ? 'Als ungesehen markieren' : 'Als gesehen markieren'}</button>
</form>
<a href="/play?tab=${v.type}&cat=${encodeURIComponent(v.category)}&path=${v.category + "/" + encodeURIComponent(v.path)}">▶ Play</a>
</div>
</div>`;
    }).join('');

    res.send(renderPage("Library", `
<nav>
<a href="/library?user=${user}&tab=video">Videos</a>
<a href="/library?user=${user}&tab=music">Musik</a>
</nav>
<h2>Empfohlen: ${recommend?.title || 'Keine Empfehlung'}</h2>
<div class="media-list">${itemsHTML}</div>
<a href="/scan">Medien neu scannen</a>
`));
});

// --- Watch Toggle / Resume ---
app.post('/watch', async (req,res)=>{
    const { title, user, category } = req.body;
    let accounts = await fs.readJson(accountsFile).catch(()=>[]);
    const account = accounts.find(a=>a.username===user);
    if(!account) return res.redirect('/login');

    if(account.watched.includes(title)) account.watched = account.watched.filter(t=>t!==title);
    else account.watched.push(title);

    account.lastCategory = category;

    await fs.writeJson(accountsFile, accounts, { spaces:2 });
    const backURL = req.get('referer') || '/';
    res.redirect(backURL);
});

// --- Play Video/Music ---
app.get('/play', async (req,res)=>{
    const { tab='video', cat, path: mediaPath } = req.query;
    const fileName = path.basename(mediaPath);
    const source = tab==='video'?'/media':'/music';
    const tag = tab==='video'?'video':'audio';
    res.send(renderPage(`Play ${tab}`, `
<h2>${fileName}</h2>
<${tag} controls autoplay style="width:100%;border-radius:10px;">
<source src="${source}/${encodeURIComponent(cat + "/" + fileName)}">
Dein Browser unterstützt das Medium nicht.
</${tag}>
<br><a href="javascript:history.back()">⏪ Zurück</a>
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
app.listen(PORT,()=>console.log(`Server läuft auf http://localhost:${PORT}`));
