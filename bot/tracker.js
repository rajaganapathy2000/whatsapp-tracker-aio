let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers;
const qrcode = require('qrcode-terminal');
const pino = require('pino'); 
const fs = require('fs');
const readline = require('readline');
const util = require('util'); 
const { exec } = require('child_process');
const { MongoClient } = require('mongodb'); // Added MongoDB support
const dns = require('dns'); // Added DNS support to bypass Termux SRV issues
const crypto = require('crypto'); // Added for Unique Instance ID
const Pusher = require('pusher'); // Added Pusher for Real-Time WebSockets
const os = require('os'); // Added native Node.js OS module for hardware diagnostics

dns.setServers(['8.8.8.8', '8.8.4.4']); // Forces Node.js to bypass Termux DNS issues

// ================= GLOBAL STATE =================
const CONFIG_FILE = './config.json';
const AUTH_DIR = './auth_info';
const CONTACTS_FILE = './contacts.json'; 
const SCRIPT_START_TIME = Date.now(); 
let globalBotStartTime = Date.now(); // NEW: Immortal Uptime Tracker

// MongoDB State
let mongoClient = null;
let db = null;

// Pusher State
let pusherClient = null;

// Multi-Instance State
const INSTANCE_ID = crypto.randomUUID();
let isPrimary = false;

// Auto-Wipe Tracking State
let lastAnchorSaveDate = "";
let lastWipeDate = "";

// Sleep Cycle State
let isSleeping = false;
let sleepTimeout = null;
let sleepPromptTimeout = null;
let sleepPromptMsgId = null;
let sleepPromptDate = "";
let scheduledSleepTrigger = null; // Randomized start trigger for tonight

// ================================================

let config = null;
let globalSock = null; 

let contactsMap = {};
// contactsMap local init removed, synced via Cloud Contacts now.

// Cache all raw data from WhatsApp to ensure we never miss a name
let rawContactsCache = {}; 

const activeSessions = {}; 
let lidMap = {}; // Changed to let to allow Cloud Sync
let targetBeingMapped = null; 

let tgOffset = 0; 
let isTelegramPolling = false; // Added to prevent duplicate polling loops

// Button Session Map (Fix for Telegram 64-Byte Callback Limit)
let btnSessionMap = {};
let pendingAction = null; // Intercepts next chat message for inputs like Edit Name

// Menu Message Memory Map (Links Bot menus to User commands for double-delete)
let menuMessageMap = {};
// Active Live Dashboard Tracker (For 5-sec auto-update state matching)
let activeLiveDashboard = { msgId: null, page: 0, lastText: "" };

// NEW: Session Accumulator "Waiting Room" Memory
let pendingDrops = {}; 

function getShortId(num) {
    for(let key in btnSessionMap) if(btnSessionMap[key] === num) return key;
    const id = 'B' + Math.random().toString(36).substring(2, 7);
    btnSessionMap[id] = num;
    
    // RAM Optimization: Limit to 50 active button IDs
    const keys = Object.keys(btnSessionMap);
    if (keys.length > 50) delete btnSessionMap[keys[0]];
    
    return id;
}
// ================================================

function sanitizeName(name) {
    if (!name) return "";
    return name.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
}

function getContactName(number) {
    if (contactsMap[number]) {
        return `${contactsMap[number]} (${number})`;
    }
    return number; 
}

function getSafeSheetName(name) {
    let safeName = name.replace(/[\\/?*[\]:]/g, '');
    return safeName.substring(0, 31);
}

// Helper to check if a source ID is WhatsApp (handles LIDs and Phones)
function isWhatsApp(jid) {
    if (!jid) return false;
    const str = jid.toString();
    return str.includes('@s.whatsapp.net') || str.includes('@lid');
}

// --- DATE / TIME FORMATTERS FOR MONGODB ---
function getFormattedDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
}

function getFormattedTime(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function parseDate(dateStr) {
    const [d, m, y] = dateStr.split('-');
    return new Date(y, m - 1, d);
}

function parseTime(timeStr) {
    const parts = timeStr.split(':');
    return { 
        h: parseInt(parts[0], 10), 
        m: parseInt(parts[1], 10),
        s: parts.length > 2 ? parseInt(parts[2], 10) : 0
    };
}

// --- DYNAMIC TELEGRAM API URL ROUTER ---
function getTgApiUrl() {
    if (config && config.tgProxy) {
        // Strip trailing slash if the user accidentally included one
        return config.tgProxy.replace(/\/$/, '');
    }
    return 'https://api.telegram.org';
}

// --- GLOBAL DASHBOARD RENDERER ---
async function renderTrackLive(page) {
    const pageSize = 15;
    const totalPages = Math.ceil(config.targets.length / pageSize) || 1;
    page = Math.min(Math.max(0, page), totalPages - 1);
    const slice = config.targets.slice(page * pageSize, (page + 1) * pageSize);
    
    let textOut = `🌐 *Global Live Tracker* (Page ${page + 1}/${totalPages})\n\n`;
    if (slice.length === 0) textOut += "No targets tracked.";
    
    for (const t of slice) {
        const isOnline = activeSessions[t]?.isOnline;
        const status = isOnline ? "🟢" : "🔴";
        textOut += `${status} ${getContactName(t)}\n`;
    }
    
    const kb = { inline_keyboard: [] };
    const nav = [];
    if (page > 0) nav.push({ text: "⬅️ Prev", callback_data: `tlive_${page - 1}` });
    nav.push({ text: "🔄 Refresh", callback_data: `tlive_${page}` });
    if (page < totalPages - 1) nav.push({ text: "Next ➡️", callback_data: `tlive_${page + 1}` });
    if(nav.length > 0) kb.inline_keyboard.push(nav);
    kb.inline_keyboard.push([{ text: "❌ Close", callback_data: "close" }]);
    
    return { textOut, kb, page };
}

// --- NETWORK RETRY WRAPPER (Fixes "fetch failed" micro-drops) ---
async function fetchWithRetry(url, options, retries = 3, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

// --- MONGODB CONNECTION & LOGGING ---
async function connectMongo() {
    if (!config || !config.mongoUri) {
        console.log("[DB] ⚠️ MongoDB URI not configured. Please set it in Option 7 of the main menu.");
        return false;
    }
    try {
        mongoClient = new MongoClient(config.mongoUri);
        await mongoClient.connect();
        db = mongoClient.db('WhatsAppTracker');
        console.log("[DB] ✅ Successfully connected to MongoDB!");
        return true;
    } catch (e) {
        console.error("[DB] ❌ MongoDB Connection Failed:", e.message);
        console.log("[SYS] 🚨 Database is unreachable! Forcing PM2 restart to prevent zombie state...");
        process.exit(1); // NEW: Fail-Fast Nuke
    }
}

// NEW: Immortal Uptime Loader
async function loadCloudUptime() {
    if (!db) return;
    try {
        let doc = await db.collection('system_config').findOne({ _id: 'bot_uptime' });
        if (!doc) {
            // First time ever running with DB, stamp the genesis time
            await db.collection('system_config').insertOne({ _id: 'bot_uptime', startTime: Date.now() });
            globalBotStartTime = Date.now();
        } else {
            // Found a past timestamp, pull it to survive PM2 restarts
            globalBotStartTime = doc.startTime;
        }
    } catch (e) { console.error("[DB] Failed to load Immortal Uptime:", e.message); }
}

async function updateMongoReport(targetNumber, onlineDateObj, offlineDateObj, diffMs) {
    if (!db) return null;
    try {
        const collection = db.collection(targetNumber);
        const dateStr = getFormattedDate(onlineDateObj);
        const onlineTimeStr = getFormattedTime(onlineDateObj);
        const offlineTimeStr = getFormattedTime(offlineDateObj);

        const res = await collection.insertOne({
            number: targetNumber,
            date: dateStr,
            onlineTime: onlineTimeStr,
            offlineTime: offlineTimeStr,
            durationMs: diffMs,
            timestamp: onlineDateObj.getTime()
        });
        return res.insertedId; // Returns the specific ID so we can delete it if they reconnect
    } catch (err) {
        console.error("[DB] ❌ Failed to log session to MongoDB:", err.message);
        return null;
    }
}

// Helper function to generate CSV Buffer from MongoDB (Updated to support single user export)
async function generateCSVBuffer(singleTarget = null) {
    if (!db) return null;
    let csvContent = "Target Number,Name,Date,Came Online,Went Offline,Duration (ms),Stayed For\n";
    try {
        const collections = await db.listCollections().toArray();
        let targetCollections = collections.filter(col => /^\d+$/.test(col.name));
        
        if (singleTarget) {
            targetCollections = targetCollections.filter(col => col.name === singleTarget);
        }

        for (const col of targetCollections) {
            const num = col.name;
            const displayName = getContactName(num);
            const records = await db.collection(num).find({}).sort({ timestamp: 1 }).toArray();
            
            for (const r of records) {
                const diffMs = r.durationMs || 0;
                const diffMins = Math.floor(diffMs / 60000);
                const diffSecs = Math.floor((diffMs % 60000) / 1000);
                const durationStr = `${diffMins} mins : ${diffSecs} secs`;
                csvContent += `"${num}","${displayName}","${r.date}","${r.onlineTime}","${r.offlineTime}","${diffMs}","${durationStr}"\n`;
            }
        }
        return Buffer.from(csvContent, 'utf-8');
    } catch (err) {
        console.error("[DB] Failed to generate CSV from MongoDB:", err.message);
        return null;
    }
}

// --- PUSHER INITIALIZATION ---
function initPusher() {
    if (config?.pusher?.appId && config?.pusher?.key && config?.pusher?.secret && config?.pusher?.cluster) {
        pusherClient = new Pusher({
          appId: config.pusher.appId,
          key: config.pusher.key,
          secret: config.pusher.secret,
          cluster: config.pusher.cluster,
          useTLS: true
        });
        console.log("[SYS] ⚡ Pusher WebSocket Client Initialized.");
    } else {
        pusherClient = null;
    }
}

// --- CLOUD CONFIGURATION & LEADER ELECTION ---
async function loadCloudConfig() {
    if (!db) return;
    try {
        const doc = await db.collection('system_config').findOne({ _id: 'main_config' });
        if (doc) {
            const localMongoUri = config.mongoUri; // Preserve local URI
            config = { ...config, ...doc };
            config.mongoUri = localMongoUri; 
            if (!config.snooze) config.snooze = {};
            if (!config.liveBoardOff) config.liveBoardOff = [];
            if (!config.github) config.github = null;
            if (!config.pusher) config.pusher = null;
            if (config.tgProxy === undefined) config.tgProxy = null;
            
            initPusher(); // Re-initialize Pusher with loaded config
        } else {
            await saveCloudConfig();
        }
    } catch (e) { console.error("[DB-SYNC] Cloud Config Load Error:", e.message); }
}

async function saveCloudConfig() {
    if (!db) return;
    try {
        const toSave = { ...config };
        delete toSave.mongoUri; // Never upload the URI
        await db.collection('system_config').updateOne({ _id: 'main_config' }, { $set: toSave }, { upsert: true });
    } catch (e) { console.error("[DB-SYNC] Cloud Config Save Error:", e.message); }
}

async function loadCloudContacts() {
    if (!db) return;
    try {
        const doc = await db.collection('system_config').findOne({ _id: 'contacts_map' });
        if (doc && doc.contacts) contactsMap = doc.contacts;
    } catch (e) { }
}

async function saveCloudContacts() {
    if (!db) return;
    try {
        await db.collection('system_config').updateOne({ _id: 'contacts_map' }, { $set: { contacts: contactsMap } }, { upsert: true });
    } catch (e) { }
}

async function loadCloudLidMap() {
    if (!db) return;
    try {
        const doc = await db.collection('system_config').findOne({ _id: 'lid_map' });
        if (doc && doc.lidMap) lidMap = doc.lidMap;
    } catch (e) { }
}

async function saveCloudLidMap() {
    if (!db) return;
    try {
        await db.collection('system_config').updateOne({ _id: 'lid_map' }, { $set: { lidMap: lidMap } }, { upsert: true });
    } catch (e) { }
}

// --- NEW: THE SECRETARY (0.01s Instant Load Fix + Live Stopwatch Fix) ---
async function updateInstantUIStatus(targetNumber) {
    if (!db) return;
    try {
        const todayStr = getFormattedDate(new Date());
        const records = await db.collection(targetNumber).find({ date: todayStr }).sort({ timestamp: -1 }).toArray();

        let todayMs = records.reduce((acc, r) => acc + (r.durationMs || 0), 0);
        let recentOffline = "Never";
        let recentOfflineMs = 0;
        let recentDurationMs = 0;

        if (records.length > 0) {
           recentOffline = records[0].offlineTime || "Unknown";
           recentOfflineMs = records[0].timestamp + (records[0].durationMs || 0);
           recentDurationMs = records[0].durationMs || 0;
        } else {
           const lastRec = await db.collection(targetNumber).find().sort({ timestamp: -1 }).limit(1).toArray();
           if (lastRec.length > 0) {
             recentOffline = `${lastRec[0].date.slice(0,5)} ${lastRec[0].offlineTime || ''}`;
             recentOfflineMs = lastRec[0].timestamp + (lastRec[0].durationMs || 0);
             recentDurationMs = lastRec[0].durationMs || 0;
           }
        }

        const isOnline = activeSessions[targetNumber]?.isOnline || false;
        if (isOnline) {
             const pendingDoc = await db.collection('pending_sessions').findOne({ _id: targetNumber });
             if (pendingDoc) {
                 todayMs += (Date.now() - pendingDoc.onlineStartTime);
                 recentOffline = "Active Now";
                 recentOfflineMs = pendingDoc.onlineStartTime; // Anchors to start time
                 recentDurationMs = 0;
             }
        }

        await db.collection('system_config').updateOne(
            { _id: 'instant_status' },
            { $set: {
                [`statuses.${targetNumber}`]: {
                    todayMs,
                    recentOffline,
                    recentOfflineMs,
                    recentDurationMs,
                    isOnline
                }
            }},
            { upsert: true }
        );
    } catch (e) {
        console.error("[SYS] Error updating instant cache:", e.message);
    }
}

// Blind Backup Fix & 15-Second Gap Fix: Sync state & re-ping when promoted
async function syncActiveSessionsFromCloud() {
    if (!db) return;
    try {
        const pendingCol = db.collection('pending_sessions');
        const sessions = await pendingCol.find({}).toArray();
        const onlineTargets = sessions.map(s => s._id);

        let restoredCount = 0;
        for (const target of onlineTargets) {
            if (!activeSessions[target]) {
                activeSessions[target] = { isOnline: false, onlineStartTime: null };
            }
            if (!activeSessions[target].isOnline) {
                activeSessions[target] = { isOnline: true, restoredCount };
                restoredCount++;
            }
        }
        if (restoredCount > 0) {
            console.log(`\n[DB-SYNC] 🔄 Restored ${restoredCount} active sessions from cloud.`);
        }
        
        // --- 15-SECOND FAILOVER GAP FIX: RE-PING PRESENCE & SCOREBOARD INIT ---
        if (globalSock && config && config.targets) {
            console.log(`[WA-SYNC] 📡 Re-pinging WhatsApp and Initializing Scoreboards...`);
            const targetsToSync = config.targets.slice(0, 10);
            for (const target of targetsToSync) {
                try {
                    const jid = `${target}@s.whatsapp.net`;
                    await globalSock.presenceSubscribe(jid);
                    await updateLiveScoreboard(target); // Force generation on boot/failover
                    await updateInstantUIStatus(target); // NEW: Initialize the Secretary cache
                    // Jittered natural delay between 5 to 12 seconds to mimic human entropy
                    const jitterMs = Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000;
                    await new Promise(r => setTimeout(r, jitterMs)); 
                } catch (e) {}
            }
        }

    } catch (e) {
        console.error("[DB-SYNC] Cloud Session Sync Error:", e.message);
    }
}

async function runHeartbeat() {
    if (!db) return;
    try {
        const now = Date.now();
        const lockCol = db.collection('system_locks');
        // Valid lock lasts 15 seconds. If older, we steal it.
        const result = await lockCol.findOneAndUpdate(
            {
                _id: 'primary_lock',
                $or: [
                    { instanceId: INSTANCE_ID }, 
                    { updatedAt: { $lt: now - 15000 } }
                ]
            },
            { $set: { instanceId: INSTANCE_ID, updatedAt: now } },
            { upsert: true, returnDocument: 'after' }
        );

        if (result && result.instanceId === INSTANCE_ID) {
            if (!isPrimary) {
                console.log(`\n[SYS] 👑 Instance promoted to PRIMARY. Handling tasks & tracking.`);
                isPrimary = true;
                await syncActiveSessionsFromCloud(); // Pull live state & re-ping
            }
        } else {
            if (isPrimary) {
                console.log(`\n[SYS] 🛡️ Instance demoted to SECONDARY. Suspending outputs.`);
                isPrimary = false;
            }
        }
    } catch (e) {
        // Silent catch for network blips during heartbeat
    }
    setTimeout(runHeartbeat, 5000); 
}

// --- TELEGRAM BOT MENU SETUP ---
async function setupTelegramCommands() {
    if (!config || !config.botToken) return;
    const commands = [
        { command: 'start', description: 'Start the bot and show welcome message' },
        { command: 'tracking', description: 'Interactive Tracking Dashboard' },
        { command: 'tracklive', description: 'Global Live Dashboard' },
        { command: 'add', description: 'Add target via Contacts/Keyboard' },
        { command: 'remove', description: 'Stop tracking a target' },
        { command: 'summary', description: 'View stats for a number' },
        { command: 'top', description: 'View top 3 active targets today' },
        { command: 'settings', description: 'Interactive Settings Panel' },
        { command: 'sleep', description: 'Put WhatsApp to sleep for X hours (/sleep 5)' },
        { command: 'wake', description: 'Instantly wake WhatsApp from sleep mode' },
        { command: 'database', description: 'Manage and clean MongoDB' },
        { command: 'export', description: 'Interactive Export Menu' },
        { command: 'muteall', description: 'Silence all notifications' },
        { command: 'unmuteall', description: 'Restore all notifications' },
        { command: 'update', description: 'Update bot from GitHub' },
        { command: 'rollback', description: 'Revert to previous code' },
        { command: 'logs', description: 'View live bot console logs' },
        { command: 'addanchorid', description: 'Set wipe boundaries manually' },
        { command: 'forceclear', description: 'Trigger Telegram chat wipe now' },
        { command: 'ping', description: 'Check bot health and uptime' },
        { command: 'setproxy', description: 'Set Telegram proxy link' },
        { command: 'exec', description: 'Run shell command' },
        { command: 'help', description: 'Show all commands' }
    ];
    try {
        await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commands })
        });
        console.log("[TG-API] ✅ Telegram Bot menu commands updated successfully!");
    } catch (e) {
        console.error("[TG-API] ⚠️ Failed to set Telegram commands:", e.message);
    }
}

// --- MESSAGING ARCHITECTURE ---
async function sendTelegramDirect(text, replyMarkup = null) {
    if (config && config.botToken && config.chatId) {
        try {
            const body = { chat_id: config.chatId, text: text };
            if (replyMarkup) body.reply_markup = replyMarkup;
            const res = await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json(); 
            return data;
        } catch (err) {
            console.error("[TG-API] ⚠️ Failed to send Telegram message:", err.message);
            return null;
        }
    }
}

async function editTelegramMessage(messageId, text, replyMarkup = null) {
    if (config && config.botToken && config.chatId && messageId) {
        try {
            const body = { chat_id: config.chatId, message_id: messageId, text: text };
            if (replyMarkup) body.reply_markup = replyMarkup;
            const response = await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            
            // Fix 2: Prevent spam if Telegram says "message is not modified"
            if (!data.ok && data.description && data.description.includes('message is not modified')) {
                return true; 
            }
            
            return data.ok; // Returns true if success, false if message deleted/not found
        } catch (err) { 
            return false; 
        }
    }
    return false;
}

async function deleteTelegramMessage(messageId) {
    if (config && config.botToken && config.chatId && messageId) {
        try {
            const res = await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: config.chatId, message_id: messageId })
            });
            const data = await res.json();
            if (!data.ok) {
                console.error(`[TG-API-ERROR] Failed to delete message ${messageId}. Error: ${data.description}`);
            }
        } catch (err) { console.error("[TG-API] ⚠️ Failed to delete message:", err.message); }
    }
}

async function sendWhatsAppDirect(text) {
    // Purged: Outbound WhatsApp messaging completely disabled for account stealth
    return;
}

// Global Alert: Respects Platform Mute Settings, updated to return Telegram response
async function sendGlobalAlert(text) {
    let tgRes = null;
    if (config.enableTelegram) tgRes = await sendTelegramDirect(text);
    // WhatsApp outbound alerts disabled for stealth
    return tgRes;
}

// --- SLEEP CYCLE CONTROLLER ---
async function startSleep(durationHours, reason = "Nightly Sleep Cycle") {
    if (isSleeping) return;
    isSleeping = true;
    const durationMs = durationHours * 3600 * 1000;
    const wakeDate = new Date(Date.now() + durationMs);
    const wakeTimeStr = wakeDate.toLocaleTimeString();

    await sendTelegramDirect(`💤 *Bot Entering Sleep Mode (${durationHours}h)*\n\nReason: ${reason}\n🔌 WhatsApp disconnected to simulate human sleep.\n⏰ Expected wake up at: *${wakeTimeStr}*\n\nSend /wake anytime to wake immediately.`);

    if (globalSock) {
        try {
            globalSock.end(new Error("Scheduled Sleep Cycle Activated"));
        } catch (e) {}
    }

    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = setTimeout(async () => {
        await wakeBot("Scheduled sleep period ended");
    }, durationMs);
}

async function wakeBot(reason = "Manual Wake") {
    if (!isSleeping) return;
    isSleeping = false;
    if (sleepTimeout) clearTimeout(sleepTimeout);
    sleepTimeout = null;
    await sendTelegramDirect(`🌅 *Bot Waking Up!*\n\nReason: ${reason}\n🔄 Reconnecting to WhatsApp socket...`);
    process.exit(1); // PM2 restarts smoothly into active state
}

// BOUNDED AUTO WIPE LOGIC (Updated with Advanced Error Tracking)
async function runAutoWipe() {
    if (!db || !config.botToken || !config.chatId) return;
    try {
        const doc = await db.collection('system_config').findOne({ _id: 'daily_anchor' });
        if (!doc || !doc.id_from_del || !doc.id_to_del) {
            console.log("[SYS] ⚠️ No bounded IDs found for Auto-Wipe. Skipping wipe.");
            return;
        }

        let id_from_del = doc.id_from_del;
        let id_to_del = doc.id_to_del;

        // Failsafe limit to prevent Telegram API abuse just in case the gap is massive
        if (id_to_del - id_from_del > 2000) id_from_del = id_to_del - 2000;
        if (id_to_del <= id_from_del) return;

        console.log(`[SYS] 🧹 Running Auto-Wipe strictly between IDs ${id_from_del} and ${id_to_del}...`);
        
        // "delete messages inbetween"
        let allIds = [];
        // We start at id_from_del (yesterday's ghost) and go up to id_to_del - 1.
        // This leaves id_to_del (today's ghost message) alone, keeping at least 1 message in the chat.
        for (let i = id_from_del; i < id_to_del; i++) {
            allIds.push(i);
        }

        // Delete in batches of 100
        for (let i = 0; i < allIds.length; i += 100) {
            const chunk = allIds.slice(i, i + 100);
            try {
                const res = await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/deleteMessages`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: config.chatId, message_ids: chunk })
                });
                const data = await res.json();
                if (!data.ok) {
                    console.error(`[TG-WIPE-ERROR] Telegram refused to delete chunk from ${chunk[0]} to ${chunk[chunk.length-1]}. Error: ${data.description}`);
                }
                await new Promise(r => setTimeout(r, 600)); // Rate limit protection
            } catch (e) {
                console.error(`[TG-WIPE-ERROR] Request failed: ${e.message}`);
            }
        }
        console.log(`[SYS] ✅ Auto-Wipe completed successfully.`);
    } catch (e) {
        console.error(`[SYS] ❌ Auto-Wipe Error:`, e.message);
    }
}

// SCHEDULED TASKS (11:59 PM Anchor, 1:00 AM Wipe, & Nightly Sleep Prompt)
async function checkScheduledTasks() {
    if (!isPrimary) return;
    const now = new Date();
    const H = now.getHours();
    const M = now.getMinutes();
    const dateStr = getFormattedDate(now);

    // Initialize tonight's randomized sleep trigger if not set
    if (!scheduledSleepTrigger || scheduledSleepTrigger.date !== dateStr) {
        // Randomize sleep trigger between 11:45 PM (23:45) and 12:15 AM (00:15)
        const offsetMins = Math.floor(Math.random() * 31); // 0 to 30 mins
        let trgH = 23;
        let trgM = 45 + offsetMins;
        if (trgM >= 60) {
            trgH = 0;
            trgM = trgM - 60;
        }
        scheduledSleepTrigger = { date: dateStr, hour: trgH, minute: trgM };
    }

    // Automated Nightly Sleep Prompt: Trigger at randomized window
    if (!isSleeping && H === scheduledSleepTrigger.hour && M === scheduledSleepTrigger.minute && sleepPromptDate !== dateStr) {
        sleepPromptDate = dateStr;
        const kb = {
            inline_keyboard: [
                [{ text: "❌ Cancel Sleep Tonight", callback_data: "cancelsleep" }]
            ]
        };
        const promptRes = await sendTelegramDirect("💤 *Nightly Sleep Cycle Notice*\n\nInitiating sleep cycle to simulate human rest and prevent bot detection.\nWhatsApp socket will disconnect in *5 minutes* unless you cancel.\n\nWaking up around ~4:00 AM.", kb);
        if (promptRes && promptRes.result) {
            sleepPromptMsgId = promptRes.result.message_id;
        }

        // 5-Minute Non-Response Timeout
        if (sleepPromptTimeout) clearTimeout(sleepPromptTimeout);
        sleepPromptTimeout = setTimeout(async () => {
            if (!isSleeping) {
                await startSleep(4, "Nightly Schedule (Auto-confirmed after 5 mins)");
            }
        }, 5 * 60 * 1000);
    }

    // 11:59 PM - Send Ghost Message & Shift Boundaries
    if (H === 23 && M === 59 && lastAnchorSaveDate !== dateStr) {
        lastAnchorSaveDate = dateStr;
        
        // "today send a message @ exactly 11:59PM and get the message id (this is ghost message just to get the last ID)"
        const ghostMsg = await sendTelegramDirect("⏳ *Daily system sync... capturing anchor ID.*");
        
        if (ghostMsg && ghostMsg.result && ghostMsg.result.message_id) {
            // "make it as id_to_del"
            let id_to_del = ghostMsg.result.message_id;

            if (db) {
                const anchorDoc = await db.collection('system_config').findOne({ _id: 'daily_anchor' });
                
                // "when you do this you may already have a id_to_del from yesterday's make it as id_from_del"
                // "so you make id_to_del as id_from_del before making the change to id_to_del"
                let id_from_del = (anchorDoc && anchorDoc.id_to_del) ? anchorDoc.id_to_del : (id_to_del - 100); // Fallback for fresh boot

                // Save the newly shifted boundaries
                await db.collection('system_config').updateOne(
                    { _id: 'daily_anchor' }, 
                    { $set: { id_from_del: id_from_del, id_to_del: id_to_del, date: dateStr } }, 
                    { upsert: true }
                );
                console.log(`[SYS] ⚓ Captured Ghost ID: ${id_to_del}. Bounded wipe range set: ${id_from_del} -> ${id_to_del}`);
            }
        }
    }

    // 1:00 AM - Trigger Bounded Auto Wipe
    if (H === 1 && M === 0 && lastWipeDate !== dateStr) {
        lastWipeDate = dateStr;
        runAutoWipe(); 
    }
}

// LIVE SCOREBOARD UPDATE
async function updateLiveScoreboard(targetNumber) {
    if (!db) return;
    if (config.liveBoardOff && config.liveBoardOff.includes(targetNumber)) return;
    const collection = db.collection(targetNumber);
    const todayStr = getFormattedDate(new Date());
    const records = await collection.find({ date: todayStr }).sort({ timestamp: 1 }).toArray();

    let totalMs = records.reduce((acc, r) => acc + (r.durationMs || 0), 0);
    let firstOnline = records.length > 0 ? records[0].onlineTime : "N/A";
    let lastOffline = records.length > 0 ? records[records.length-1].offlineTime : "N/A";
    let count = records.length;

    const isOnline = activeSessions[targetNumber]?.isOnline;
    if (isOnline) {
         const pendingDoc = await db.collection('pending_sessions').findOne({ _id: targetNumber });
         if (pendingDoc) {
             const liveDuration = Date.now() - pendingDoc.onlineStartTime;
             totalMs += liveDuration;
             count += 1; 
             if (firstOnline === "N/A") {
                 firstOnline = getFormattedTime(new Date(pendingDoc.onlineStartTime));
             }
             lastOffline = "Currently Active";
         }
    }

    const mins = Math.floor(totalMs / 60000);
    const timeStr = formatDuration(totalMs);
    const statusStr = isOnline ? "🟢 ONLINE" : "🔴 OFFLINE";
    const displayName = getContactName(targetNumber);

    const text = `📊 *Live Status: ${displayName}*\n━━━━━━━━━━━━━━━━━━━━\n📡 Current status: ${statusStr}\n🕒 First online: ${firstOnline}\n🕛 Last offline: ${lastOffline}\n🔌 Total count: ${count} sessions\n⏱️ Total time: ${timeStr}\n⏳ Total in mins: ${mins} mins`;

    const boardCol = db.collection('live_scoreboards');
    const boardId = `${targetNumber}_${todayStr}`;
    const existing = await boardCol.findOne({ _id: boardId });

    if (existing) {
        let tgMsgId = existing.tgMsgId;
        let dbNeedsUpdate = false;

        // Edit Telegram
        if (config.enableTelegram && config.chatId && (!config.snooze[targetNumber] || config.snooze[targetNumber] < Date.now())) {
            if (tgMsgId) {
                const isEdited = await editTelegramMessage(tgMsgId, text);
                if (!isEdited) {
                    // Telegram message was deleted or not found, send a new one
                    const tgRes = await sendTelegramDirect(text);
                    if (tgRes && tgRes.result) {
                        tgMsgId = tgRes.result.message_id;
                        dbNeedsUpdate = true;
                    }
                }
            } else {
                // Was off or failed previously, send a new one
                const tgRes = await sendTelegramDirect(text);
                if (tgRes && tgRes.result) {
                    tgMsgId = tgRes.result.message_id;
                    dbNeedsUpdate = true;
                }
            }
        }

        // WhatsApp scoreboards disabled for stealth

        if (dbNeedsUpdate) {
            await boardCol.updateOne({ _id: boardId }, { $set: { tgMsgId } });
        }
    } else {
        // Send new
        let tgMsgId = null;

        if (config.enableTelegram && config.chatId && (!config.snooze[targetNumber] || config.snooze[targetNumber] < Date.now())) {
            const tgRes = await sendTelegramDirect(text);
            if (tgRes && tgRes.result) tgMsgId = tgRes.result.message_id;
        }

        await boardCol.updateOne({ _id: boardId }, { $set: { tgMsgId } }, { upsert: true });
    }
}

async function sendTelegramDocument() {
    if (!config || !config.botToken || !config.chatId) return;
    if (!db) return sendTelegramDirect("⚠️ MongoDB is not connected. Cannot export data.");
    try {
        sendTelegramDirect("⏳ Generating CSV export from MongoDB...");
        const buffer = await generateCSVBuffer();
        if (!buffer) return sendTelegramDirect("⚠️ Failed to generate export data.");
        
        const blob = new Blob([buffer], { type: 'text/csv' });
        const formData = new FormData();
        formData.append('chat_id', config.chatId);
        formData.append('document', blob, 'WhatsApp_Tracking_Report.csv');
        await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/sendDocument`, {
            method: 'POST',
            body: formData
        });
    } catch (err) {
        sendTelegramDirect(`❌ Failed to send document: ${err.message}`);
    }
}

function isDndActive() {
    if (!config || !config.dnd) return false;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = config.dnd.start.split(':').map(Number);
    const [endH, endM] = config.dnd.end.split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    if (startMins <= endMins) return currentMins >= startMins && currentMins <= endMins;
    return currentMins >= startMins || currentMins <= endMins; 
}

async function subscribeAndMapTarget(sock, target, shouldTrack = true) {
    const jid = `${target}@s.whatsapp.net`;
    
    if (shouldTrack && !activeSessions[target]) {
        activeSessions[target] = { isOnline: false, onlineStartTime: null };
    }
    
    const displayName = getContactName(target);
    const role = shouldTrack ? "Target" : "Admin";
    console.log(`[WA-SOCKET] -> Subscribed to ${displayName} (${role}). Mapping internal ID...`);
    
    targetBeingMapped = target; 
    await sock.presenceSubscribe(jid);
    
    // SAFE FIX: Dummy readMessages removed to avoid cryptographic mismatches & anti-bot bans
    await new Promise(resolve => setTimeout(resolve, 3000));
    targetBeingMapped = null;
}

function formatUptime(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${mins}m`;
}

// Helper for formatting duration dynamically as HH:MM:SS
function formatDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Summary Logic Extracted for Multi-Use
async function generateSummaryText(num, mode = 'today') {
    if (!db) return "⚠️ MongoDB is not connected.";
    const collection = db.collection(num);
    const records = await collection.find({}).sort({ timestamp: 1 }).toArray();
    
    const currentStatus = activeSessions[num]?.isOnline ? "🟢 ONLINE" : "🔴 OFFLINE";
    let filtered = [];
    
    if (mode === 'today') {
        const todayStr = getFormattedDate(new Date());
        filtered = records.filter(r => r.date === todayStr);
    } else if (mode === 'yest') {
        const d = new Date(); d.setDate(d.getDate() - 1);
        const yestStr = getFormattedDate(d);
        filtered = records.filter(r => r.date === yestStr);
    } else if (mode === '7d') {
        const d = new Date(); d.setDate(d.getDate() - 7);
        const startD = d.getTime();
        filtered = records.filter(r => parseDate(r.date).getTime() >= startD);
    } else {
        filtered = records; // All
    }

    let firstOnline = "N/A", lastOnline = "N/A";
    let totalMs = 0;
    let count = filtered.length;
    
    if (count > 0) {
        firstOnline = mode === 'today' ? filtered[0].onlineTime : `${filtered[0].date} ${filtered[0].onlineTime}`;
        lastOnline = mode === 'today' ? filtered[count - 1].offlineTime : `${filtered[count - 1].date} ${filtered[count - 1].offlineTime}`;
        totalMs = filtered.reduce((acc, r) => acc + (r.durationMs || 0), 0);
    }
    
    const totalTimeStr = formatDuration(totalMs);
    const displayName = getContactName(num);
    
    let out = `📊 *Summary for ${displayName}*\n\n`;
    out += `📡 Current Status: ${currentStatus}\n`;
    out += `🕒 First Online: ${firstOnline}\n`;
    out += `🕛 Last Online: ${lastOnline}\n`;
    out += `🔌 Total Online Count: ${count}\n`;
    out += `⏱️ Total Online Time: ${totalTimeStr}\n\n`;
    
    if (mode === 'today' && count > 0) {
        out += `📝 *History (Times):*\n`;
        filtered.forEach(r => out += `- ${r.onlineTime} to ${r.offlineTime} (${formatDuration(r.durationMs||0)})\n`);
    } else if (count > 0) {
        out += `📝 *History (Last 5 Sessions):*\n`;
        const last5 = filtered.slice(-5);
        last5.forEach(r => out += `- ${r.date} | ${r.onlineTime} to ${r.offlineTime} (${formatDuration(r.durationMs||0)})\n`);
    }
    
    return out;
}

// Universal Command Processor
async function processCommand(text, sock, reply, sendDoc, sourceId, msgObject) { 
    const args = text.trim().split(' ');
    const command = args[0].toLowerCase();
    const userMsgId = msgObject?.message_id;

    try {
        // PENDING ACTION INTERCEPTOR (For Edit Name, Add Number, GitHub Config, Pusher Config, Anchor Editing)
        if (pendingAction && sourceId === config.chatId) {
            if (pendingAction.type === 'editname') {
                contactsMap[pendingAction.num] = text.trim();
                await saveCloudContacts();
                reply(`✅ Name updated to: ${text.trim()}`);
                pendingAction = null;
            } else if (pendingAction.type === 'addnum') {
                const num = text.replace(/\D/g, '');
                if (!config.targets.includes(num)) {
                    config.targets.push(num);
                    await saveCloudConfig();
                    reply(`✅ Added ${num} to tracking list.`);
                    await subscribeAndMapTarget(sock, num, true);
                    await updateInstantUIStatus(num); // Initialize Secretary
                } else {
                    reply(`⚠️ ${num} is already tracked.`);
                }
                pendingAction = null;
            } else if (pendingAction.type === 'git_user') {
                if (!config.github) config.github = {};
                config.github.user = text.trim();
                pendingAction = { type: 'git_repo' };
                reply("Please type the **Repository Name**:");
            } else if (pendingAction.type === 'git_repo') {
                config.github.repo = text.trim();
                pendingAction = { type: 'git_branch' };
                reply("Please type the **Branch Name** (e.g., main):");
            } else if (pendingAction.type === 'git_branch') {
                config.github.branch = text.trim();
                pendingAction = { type: 'git_filepath' };
                reply("Please type the **File Path** inside the repository (e.g., bot/tracker.js or tracker.js):");
            } else if (pendingAction.type === 'git_filepath') {
                config.github.filename = text.trim();
                pendingAction = { type: 'git_token' };
                reply("Please type your **Personal Access Token (PAT)**:");
            } else if (pendingAction.type === 'git_token') {
                config.github.token = text.trim();
                await saveCloudConfig();
                pendingAction = null;
                reply("✅ GitHub Updater configured successfully! You can now use /update or use the Web UI restart button.");
            } else if (pendingAction.type === 'pusher_appid') {
                if (!config.pusher) config.pusher = {};
                config.pusher.appId = text.trim();
                pendingAction = { type: 'pusher_key' };
                reply("Please type your **Pusher Key**:");
            } else if (pendingAction.type === 'pusher_key') {
                config.pusher.key = text.trim();
                pendingAction = { type: 'pusher_secret' };
                reply("Please type your **Pusher Secret**:");
            } else if (pendingAction.type === 'pusher_secret') {
                config.pusher.secret = text.trim();
                pendingAction = { type: 'pusher_cluster' };
                reply("Please type your **Pusher Cluster** (e.g., ap2):");
            } else if (pendingAction.type === 'pusher_cluster') {
                config.pusher.cluster = text.trim();
                await saveCloudConfig();
                initPusher();
                pendingAction = null;
                reply("⚡ Pusher Real-Time WebSockets configured and activated successfully!");
            } else if (pendingAction.type === 'edit_anchor_from' || pendingAction.type === 'edit_anchor_to') {
                const newId = parseInt(text.trim());
                if (isNaN(newId)) {
                    reply("⚠️ Invalid number. Anchor edit canceled.");
                } else {
                    if (db) {
                        const anchorDoc = await db.collection('system_config').findOne({ _id: 'daily_anchor' });
                        let id_from_del = anchorDoc && anchorDoc.id_from_del ? anchorDoc.id_from_del : 0;
                        let id_to_del = anchorDoc && anchorDoc.id_to_del ? anchorDoc.id_to_del : 0;

                        if (pendingAction.type === 'edit_anchor_from') id_from_del = newId;
                        if (pendingAction.type === 'edit_anchor_to') id_to_del = newId;

                        await db.collection('system_config').updateOne(
                            { _id: 'daily_anchor' }, 
                            { $set: { id_from_del: id_from_del, id_to_del: id_to_del, date: getFormattedDate(new Date()) } }, 
                            { upsert: true }
                        );
                        reply(`✅ *Anchor Manually Updated!*\n\nFrom ID: ${id_from_del}\nTo ID: ${id_to_del}\n\nUse /forceclear to execute the wipe now.`);
                    } else {
                        reply("⚠️ MongoDB not connected. Cannot save anchor.");
                    }
                }
                pendingAction = null;
            }
            return;
        }

        if (command === '/start') {
            const welcomeMsg = `👋 *Welcome to the WhatsApp Tracker Bot!* 🤖\n\nI am currently running and actively monitoring your targets.\n\n🎯 *Getting Started:*\n1. Use /add to track a new number.\n2. Use /tracking to view your interactive dashboard.\n3. Use /help to see all available commands.\n\n📡 Currently Tracking: ${config.targets.length} numbers.`;
            reply(welcomeMsg);
        }
        else if (command === '/sleep') {
            if (sourceId !== config.chatId) return;
            const hrs = parseFloat(args[1]);
            if (isNaN(hrs) || hrs <= 0) {
                return reply("⚠️ *Usage:* `/sleep <hours>`\n\n*Examples:*\n- `/sleep 5` (Sleeps for 5 hours)\n- `/sleep 0.5` (Sleeps for 30 minutes)\n\nDuring sleep, WhatsApp disconnects to simulate human rest. Send `/wake` to restore connection anytime.");
            }
            reply(`⏳ Preparing to enter sleep mode for *${hrs} hours*...`);
            await startSleep(hrs, "Manual /sleep command");
        }
        else if (command === '/wake') {
            if (sourceId !== config.chatId) return;
            if (!isSleeping) return reply("⚠️ Bot is not currently sleeping.");
            await wakeBot("User issued /wake");
        }
        else if (command === '/add') {
            if (args[1]) {
                const num = args[1].replace(/\D/g, '');
                if (!config.targets.includes(num)) {
                    config.targets.push(num);
                    await saveCloudConfig();
                    if (rawContactsCache[num]) {
                        const raw = rawContactsCache[num];
                        const bestName = sanitizeName(raw.name || raw.notify || raw.verifiedName);
                        if (bestName) {
                            contactsMap[num] = bestName;
                            await saveCloudContacts();
                        }
                    }
                    reply(`✅ Added ${getContactName(num)} to tracking list.`);
                    await subscribeAndMapTarget(sock, num, true);
                    await updateInstantUIStatus(num); // Initialize Secretary
                } else {
                    reply(`⚠️ ${num} is already being tracked.`);
                }
            } else {
                const kb = {
                    inline_keyboard: [
                        [{ text: "📇 From Contacts", callback_data: "addcon_0" }],
                        [{ text: "🔢 Type Number", callback_data: "addtyp" }],
                        [{ text: "❌ Close", callback_data: "close" }]
                    ]
                };
                const res = await sendTelegramDirect("How would you like to add a target?", kb);
                if (res && res.result && userMsgId) {
                    menuMessageMap[res.result.message_id] = userMsgId;
                    const keys = Object.keys(menuMessageMap);
                    if (keys.length > 50) delete menuMessageMap[keys[0]];
                }
            }
        } 
        else if (command === '/remove') {
            if (!args[1]) return reply("⚠️ Usage: /remove <number>");
            const num = args[1].replace(/\D/g, '');
            if (config.targets.includes(num)) {
                config.targets = config.targets.filter(t => t !== num);
                delete activeSessions[num];
                await saveCloudConfig();
                reply(`🗑️ Removed ${getContactName(num)} from tracking list.`);
            } else {
                reply(`⚠️ ${num} is not in the tracking list.`);
            }
        }
        else if (command === '/setproxy') {
            if (!args[1]) return reply("⚠️ Usage: /setproxy <link>\nTo remove: /setproxy default");
            const proxyLink = args[1].trim();
            
            if (proxyLink.toLowerCase() === 'default') {
                config.tgProxy = null;
                await saveCloudConfig();
                reply("✅ Telegram proxy disabled. Connection restored to default (api.telegram.org).");
            } else {
                if (!proxyLink.startsWith('http')) return reply("⚠️ Invalid proxy link. It must start with http:// or https://");
                config.tgProxy = proxyLink;
                await saveCloudConfig();
                reply(`✅ Telegram Reverse Proxy successfully set to:\n${proxyLink}\n\nAll Telegram alerts and menus will now route through this URL, bypassing ISP blocks!`);
            }
        }
        else if (command === '/tracking' || command === '/status') {
            if (config.targets.length === 0) return reply("You are not tracking any numbers.");
            const kb = { inline_keyboard: [] };
            for (const t of config.targets) {
                const sc = getShortId(t);
                const state = activeSessions[t]?.isOnline ? "🟢" : "🔴";
                const muteState = config.muted.includes(t) ? " 🔕" : " 🔔";
                kb.inline_keyboard.push([{ text: `${state} ${getContactName(t)}${muteState}`, callback_data: `trk_${sc}` }]);
            }
            kb.inline_keyboard.push([{ text: "🔄 Refresh", callback_data: `trkmenu` }]);
            kb.inline_keyboard.push([{ text: "❌ Close", callback_data: `close` }]);
            const res = await sendTelegramDirect("📊 *Active Tracking Dashboard*\nSelect a target to manage:", kb);
            if (res && res.result && userMsgId) {
                menuMessageMap[res.result.message_id] = userMsgId;
                const keys = Object.keys(menuMessageMap);
                if (keys.length > 50) delete menuMessageMap[keys[0]];
            }
        }
        else if (command === '/tracklive') {
            const { textOut, kb, page } = await renderTrackLive(0);
            const res = await sendTelegramDirect(textOut, kb);
            if (res && res.result) {
                const botMsgId = res.result.message_id;
                if (userMsgId) {
                    menuMessageMap[botMsgId] = userMsgId;
                    const keys = Object.keys(menuMessageMap);
                    if (keys.length > 50) delete menuMessageMap[keys[0]];
                }
                activeLiveDashboard = { msgId: botMsgId, page: page, lastText: textOut };
            }
        }
        else if (command === '/settings') {
            const isPusherSet = (config?.pusher?.appId) ? true : false;
            const kb = {
                inline_keyboard: [
                    [{ text: `✈️ TG Alerts: ${config.enableTelegram ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_tg` }],
                    [{ text: `🔗 TG Merge Drops: ${config.mergeTelegramDrops ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_mtg` }],
                    [{ text: `🗄️ DB Merge Drops: ${config.mergeDatabaseDrops ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_mdb` }],
                    [{ text: `🌙 DND Mode: ${config.dnd ? 'ACTIVE' : 'OFF'}`, callback_data: `set_dnd` }],
                    [{ text: `⚡ Setup Pusher (Real-Time UI) ${isPusherSet ? '🟢' : ''}`, callback_data: `setpusher` }],
                    [{ text: "🛠️ Setup GitHub Update", callback_data: `setgit` }],
                    [{ text: "❌ Close", callback_data: `close` }]
                ]
            };
            const res = await sendTelegramDirect("⚙️ *Global Settings Control Panel*", kb);
            if (res && res.result && userMsgId) {
                menuMessageMap[res.result.message_id] = userMsgId;
                const keys = Object.keys(menuMessageMap);
                if (keys.length > 50) delete menuMessageMap[keys[0]];
            }
        }
        else if (command === '/database') {
            const kb = {
                inline_keyboard: [
                    [{ text: "🗑️ Clear Glitch Sessions (<5s)", callback_data: `db_glc` }],
                    [{ text: "🧹 Delete Data > 30 Days", callback_data: `db_oldc` }],
                    [{ text: "❌ Close", callback_data: `close` }]
                ]
            };
            const res = await sendTelegramDirect("🗄️ *Database Janitor*", kb);
            if (res && res.result && userMsgId) {
                menuMessageMap[res.result.message_id] = userMsgId;
                const keys = Object.keys(menuMessageMap);
                if (keys.length > 50) delete menuMessageMap[keys[0]];
            }
        }
        else if (command === '/export') {
            const kb = {
                inline_keyboard: [
                    [{ text: "📄 Full CSV Export", callback_data: `exp_full` }],
                    [{ text: "❌ Close", callback_data: `close` }]
                ]
            };
            const res = await sendTelegramDirect("Select export option:", kb);
            if (res && res.result && userMsgId) {
                menuMessageMap[res.result.message_id] = userMsgId;
                const keys = Object.keys(menuMessageMap);
                if (keys.length > 50) delete menuMessageMap[keys[0]];
            }
        }
        else if (command === '/muteall') {
            config.muted = [...config.targets];
            await saveCloudConfig();
            reply("🔕 Muted notifications for ALL tracking targets.");
        }
        else if (command === '/unmuteall') {
            config.muted = [];
            await saveCloudConfig();
            reply("🔔 Unmuted notifications for ALL tracking targets.");
        }
        else if (command === '/top') {
            if (!db) return reply("⚠️ MongoDB not connected.");
            const todayStr = getFormattedDate(new Date());
            let stats = [];
            for (const target of config.targets) {
                const records = await db.collection(target).find({ date: todayStr }).toArray();
                let totalMs = records.reduce((acc, r) => acc + (r.durationMs || 0), 0);
                if (activeSessions[target]?.isOnline) {
                    const p = await db.collection('pending_sessions').findOne({ _id: target });
                    if (p) totalMs += (Date.now() - p.onlineStartTime);
                }
                if (totalMs > 0) stats.push({ target, totalMs });
            }
            stats.sort((a, b) => b.totalMs - a.totalMs);
            let out = `🏆 *Top Active Targets Today*\n\n`;
            stats.slice(0, 3).forEach((s, i) => {
                out += `${i+1}. ${getContactName(s.target)}: ${formatDuration(s.totalMs)}\n`;
            });
            if (stats.length === 0) out += "No activity recorded today.";
            reply(out);
        }
        else if (command === '/summary') {
            if (!args[1]) {
                return reply(`⚠️ *Usage:*\n1. /summary <num> (Today's stats)\n2. /summary <num> time <hh:mm> <hh:mm> (Stats in time range)\n3. /summary <num> date <dd-mm-yyyy> <dd-mm-yyyy> (Stats in date range)`);
            }
            const num = args[1].replace(/\D/g, '');
            const mode = args[2] ? args[2].toLowerCase() : 'today';

            if (!db) return reply("⚠️ MongoDB is not connected. No database records available to build summary.");
            const collection = db.collection(num);
            
            // SPEEDUP 1: Database Query Offloading (Only fetch the exact timeframe needed)
            let dbQuery = {};
            if (mode === 'today' || mode === undefined || mode === 'time') {
                dbQuery = { date: getFormattedDate(new Date()) };
            } else if (mode === 'date' && args.length >= 5) {
                const startD = parseDate(args[3]).getTime();
                const endD = parseDate(args[4]).getTime() + 86400000;
                dbQuery = { timestamp: { $gte: startD, $lt: endD } };
            }
            const records = await collection.find(dbQuery).sort({ timestamp: 1 }).toArray();
            
            const currentStatus = activeSessions[num]?.isOnline ? "🟢 ONLINE" : "🔴 OFFLINE";
            let filtered = [];
            
            if (mode === 'today' || mode === undefined) {
                const todayStr = getFormattedDate(new Date());
                filtered = records.filter(r => r.date === todayStr);
            } else if (mode === 'time') {
                if (args.length < 5) return reply("⚠️ Usage: /summary <num> time <hh:mm> <hh:mm>");
                const startTime = parseTime(args[3]);
                const endTime = parseTime(args[4]);
                const todayStr = getFormattedDate(new Date());
                
                filtered = records.filter(r => {
                    if (r.date !== todayStr) return false;
                    const rTime = parseTime(r.onlineTime);
                    const rSecs = rTime.h * 3600 + rTime.m * 60 + rTime.s;
                    const sSecs = startTime.h * 3600 + startTime.m * 60 + startTime.s;
                    const eSecs = endTime.h * 3600 + endTime.m * 60 + endTime.s;
                    return rSecs >= sSecs && rSecs <= eSecs;
                });
            } else if (mode === 'date') {
                if (args.length < 5) return reply("⚠️ Usage: /summary <num> date <dd-mm-yyyy> <dd-mm-yyyy>");
                const startD = parseDate(args[3]).getTime();
                const endD = parseDate(args[4]).getTime();
                
                filtered = records.filter(r => {
                    const rTime = parseDate(r.date).getTime();
                    return rTime >= startD && rTime <= endD;
                });
            } else {
                return reply("⚠️ Invalid summary format. Use 'time', 'date', or leave blank for today.");
            }

            let firstOnline = "N/A", lastOnline = "N/A";
            let totalMs = 0;
            let count = filtered.length;
            
            if (count > 0) {
                firstOnline = mode === 'date' ? `${filtered[0].date} ${filtered[0].onlineTime}` : filtered[0].onlineTime;
                lastOnline = mode === 'date' ? `${filtered[count - 1].date} ${filtered[count - 1].offlineTime}` : filtered[count - 1].offlineTime;
                totalMs = filtered.reduce((acc, r) => acc + (r.durationMs || 0), 0);
            }
            
            const totalTimeStr = formatDuration(totalMs);
            const displayName = getContactName(num);
            
            let out = `📊 *Summary for ${displayName}*\n\n`;
            out += `📡 Current Status: ${currentStatus}\n`;
            out += `🕒 First Online: ${firstOnline}\n`;
            out += `🕛 Last Online: ${lastOnline}\n`;
            out += `🔌 Total Online Count: ${count}\n`;
            out += `⏱️ Total Online Time: ${totalTimeStr}\n\n`;
            
            if (mode === 'time' && count > 0) {
                out += `📝 *History (Times):*\n`;
                filtered.forEach(r => out += `- ${r.onlineTime} to ${r.offlineTime} (${formatDuration(r.durationMs||0)})\n`);
            } else if (mode === 'date' && count > 0) {
                out += `📝 *History (Last 5 Sessions):*\n`;
                const last5 = filtered.slice(-5);
                last5.forEach(r => out += `- ${r.date} | ${r.onlineTime} to ${r.offlineTime} (${formatDuration(r.durationMs||0)})\n`);
            }
            
            reply(out);
        }
        else if (command === '/update') {
            if (sourceId !== config.chatId) return; // Basic security
            if (!config.github || !config.github.token || !config.github.user || !config.github.repo || !config.github.branch) {
                return reply("⚠️ GitHub Updater not configured. Please use /settings to configure it first.");
            }
            reply("⏳ Fetching latest update from GitHub repository...");
            try {
                const url = `https://raw.githubusercontent.com/${config.github.user}/${config.github.repo}/${config.github.branch}/${config.github.filename || 'tracker.js'}`;
                const res = await fetch(url, { headers: { 'Authorization': `token ${config.github.token}` } });
                if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
                
                const newCode = await res.text();
                if (fs.existsSync('./tracker.js')) {
                    fs.writeFileSync('./tracker.bak.js', fs.readFileSync('./tracker.js'));
                }
                fs.writeFileSync('./tracker.js', newCode);
                await sendTelegramDirect("✅ Update downloaded and backed up! Restarting via PM2...");
                if (db) await db.collection('system_config').deleteMany({ _id: { $in: ['bot_uptime', 'bot_health'] } });
                process.exit(1);
            } catch (e) {
                reply(`❌ Update Failed: ${e.message}`);
            }
        }
        else if (command === '/rollback') {
            if (sourceId !== config.chatId) return; // Basic security
            if (fs.existsSync('./tracker.bak.js')) {
                fs.writeFileSync('./tracker.js', fs.readFileSync('./tracker.bak.js'));
                await sendTelegramDirect("⏪ Rollback applied! Restarting via PM2 to previous code state...");
                if (db) await db.collection('system_config').deleteMany({ _id: { $in: ['bot_uptime', 'bot_health'] } });
                process.exit(1);
            } else {
                reply("⚠️ No backup file found. Cannot rollback.");
            }
        }
        else if (command === '/logs') {
            if (sourceId !== config.chatId) return;
            const lines = parseInt(args[1]) || 30;
            const maxLines = Math.min(lines, 100); // Failsafe limit for Telegram max char length
            exec(`pm2 logs --nostream --lines ${maxLines}`, (err, stdout, stderr) => {
                let logOutput = stdout || stderr || "No logs found in PM2.";
                // Sanitize backticks to prevent markdown code block breaking
                logOutput = logOutput.replace(/`/g, "'");
                // Safety trim for Telegram 4096 character limit
                if (logOutput.length > 3900) {
                    logOutput = "..." + logOutput.substring(logOutput.length - 3900);
                }
                reply(`📝 *PM2 Live Console Logs (Last ${maxLines} lines)*\n\n\`\`\`text\n${logOutput}\n\`\`\``);
            });
        }
        else if (command === '/addanchorid') {
            if (sourceId !== config.chatId) return;
            
            const repliedMsg = msgObject?.reply_to_message;
            if (repliedMsg && repliedMsg.message_id && userMsgId) {
                // Scenario A: User replied to a message
                const id_from_del = repliedMsg.message_id;
                const id_to_del = userMsgId;
                
                if (db) {
                    await db.collection('system_config').updateOne(
                        { _id: 'daily_anchor' }, 
                        { $set: { id_from_del: id_from_del, id_to_del: id_to_del, date: getFormattedDate(new Date()) } }, 
                        { upsert: true }
                    );
                    reply(`✅ *Anchor Manually Set via Reply!*\n\nFrom ID: ${id_from_del}\nTo ID: ${id_to_del}\n\nThese boundaries will be used for the next auto-wipe, or you can run /forceclear now.`);
                } else {
                    reply("⚠️ MongoDB not connected. Cannot save anchor.");
                }
            } else {
                // Scenario B: User did NOT reply to a message, show prompt
                if (userMsgId) {
                    const kb = {
                        inline_keyboard: [
                            [{ text: "✅ Yes, Set THIS as End Anchor", callback_data: `setanch_${userMsgId}` }],
                            [{ text: "🛠️ Manual Mode", callback_data: `mananch` }],
                            [{ text: "❌ Cancel", callback_data: `cancel` }]
                        ]
                    };
                    await sendTelegramDirect("⚠️ You didn't reply to a message.\n\nDo you want to push the old End Anchor to the Start Anchor position, and set **THIS** exact message as the new End Anchor?", kb);
                }
            }
        }
        else if (command === '/forceclear') {
            if (sourceId !== config.chatId) return;
            reply("🧹 *Force Clear Triggered!*\n\nExecuting bounded wipe now. Use /logs in a few seconds to see the results.");
            runAutoWipe();
        }
        else if (command === '/eval') {
            if (sourceId !== config.chatId) return; // "God Mode" strict security lock
            const evalCode = text.substring(5).trim();
            try {
                let evalOut = eval(evalCode);
                if (evalOut instanceof Promise) evalOut = await evalOut;
                reply(`💻 *Eval Output:*\n\n${util.inspect(evalOut).substring(0, 3000)}`);
            } catch (e) {
                reply(`❌ *Eval Error:*\n${e.message}`);
            }
        }
        else if (command === '/ping') {
            // NEW: Use Immortal Uptime tracker logic
            const uptime = formatUptime(Date.now() - globalBotStartTime);
            const sleepStatus = isSleeping ? " (💤 WhatsApp Sleeping)" : " (🟢 Active)";
            reply(`🏓 Pong! Bot is healthy.\n⏱️ Uptime: ${uptime}${sleepStatus}\n📡 Tracking: ${config.targets.length} contacts.`);
        }
        else if (command === '/exec') {
            if (args.length < 2) return reply("⚠️ Usage: /exec <cmd>");
            const shellCmd = args.slice(1).join(' ');
            exec(shellCmd, (err, stdout, stderr) => {
                if (err) return reply(`❌ Exec Error: ${err.message}`);
                reply(`💻 *Shell Output*\n\n${stdout || stderr || "Success (No Output)"}`);
            });
        }
        else if (command === '/help') {
            const helpMenu = `🤖 *Bot Commands* 🤖\n
🎯 *Tracking*
/start - Welcome message & status
/tracking - Interactive Dashboard
/tracklive - Global Live Dashboard
/add - Add new target
/remove <num> - Stop tracking
/top - View top 3 targets today
/summary <num> - Online stats
/muteall - Silence everyone
/unmuteall - Restore alerts

💤 *Stealth & Sleep*
/sleep <hours> - Disconnect WhatsApp for X hours
/wake - Wake WhatsApp immediately from sleep

⚙️ *Settings & System*
/settings - Interactive Toggles
/database - Clean up MongoDB
/export - Get Excel file
/logs [lines] - View live bot console logs
/addanchorid - Set wipe boundaries manually
/forceclear - Trigger Telegram chat wipe now
/setproxy <link> - Set Telegram reverse proxy
/update - Pull code from GitHub
/rollback - Revert to previous code
/exec <cmd> - Remote Shell
/eval <code> - God Mode JS Execute
/ping - Check bot health and uptime`;
            reply(helpMenu);
        }
        else if (command === '/getid') {
            reply("🆔 This command is mostly redundant now as Admin ID is auto-discovered.");
        }
    } catch (e) {
        reply(`❌ Command Error: ${e.message}`);
    }
}

// CALLBACK QUERY PROCESSOR (INLINE BUTTONS)
async function processCallback(query, sock) {
    if (!isPrimary) return;
    const data = query.data;
    const msgId = query.message.message_id;

    try {
        await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/answerCallbackQuery`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: query.id })
        });
    } catch(e){}

    const parts = data.split('_');
    const action = parts[0];

    if (action === 'cancelsleep') {
        if (sleepPromptTimeout) {
            clearTimeout(sleepPromptTimeout);
            sleepPromptTimeout = null;
            await editTelegramMessage(msgId, "✅ Automated sleep cycle *CANCELLED* for tonight. Bot will stay active.\n\nYou can manually trigger sleep anytime using `/sleep <hours>`.", { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
        } else {
            await editTelegramMessage(msgId, "⚠️ Sleep prompt has already expired.", { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
        }
    }
    else if (action === 'close') {
        const botMsgId = msgId;
        const userMsgId = menuMessageMap[botMsgId];
        await deleteTelegramMessage(botMsgId);
        if (userMsgId) {
            await deleteTelegramMessage(userMsgId);
            delete menuMessageMap[botMsgId];
        }
        if (activeLiveDashboard.msgId === botMsgId) {
            activeLiveDashboard.msgId = null;
        }
    }
    else if (action === 'addcon') {
        const page = parseInt(parts[1]);
        const contacts = Object.entries(contactsMap);
        const pageSize = 20;
        const totalPages = Math.ceil(contacts.length / pageSize);
        const slice = contacts.slice(page * pageSize, (page + 1) * pageSize);

        const kb = { inline_keyboard: [] };
        for (let [num, name] of slice) {
            const sc = getShortId(num);
            kb.inline_keyboard.push([{ text: `${name} (${num})`, callback_data: `addt_${sc}` }]);
        }

        const navRow = [];
        if (page > 0) navRow.push({ text: "⬅️ Prev", callback_data: `addcon_${page - 1}` });
        if (page < totalPages - 1) navRow.push({ text: "Next ➡️", callback_data: `addcon_${page + 1}` });
        if (navRow.length > 0) kb.inline_keyboard.push(navRow);
        kb.inline_keyboard.push([{ text: "🔙 Cancel", callback_data: "cancel" }, { text: "❌ Close", callback_data: "close" }]);

        await editTelegramMessage(msgId, `📇 Select Contact to Track (Page ${page+1}/${totalPages}):`, kb);
    }
    else if (action === 'addtyp') {
        pendingAction = { type: 'addnum' };
        await editTelegramMessage(msgId, "Please type the WhatsApp number (with country code) in the chat now:", { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
    }
    else if (action === 'addt') {
        const num = btnSessionMap[parts[1]];
        if (!num) return sendTelegramDirect("⚠️ Button expired. Please run /add again.");
        if (!config.targets.includes(num)) {
            config.targets.push(num);
            await saveCloudConfig();
            await subscribeAndMapTarget(sock, num, true);
            await updateInstantUIStatus(num); // Initialize Secretary
            await editTelegramMessage(msgId, `✅ Added ${getContactName(num)} to tracking list.`, { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
        } else {
            await editTelegramMessage(msgId, `⚠️ ${getContactName(num)} is already tracked.`, { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
        }
    }
    else if (action === 'trk') {
        const num = btnSessionMap[parts[1]];
        if (!num) return sendTelegramDirect("⚠️ Session expired. Please run /tracking again.");
        const name = getContactName(num);
        const isMuted = config.muted.includes(num);
        const isLiveBoardOff = config.liveBoardOff && config.liveBoardOff.includes(num);

        const kb = {
            inline_keyboard: [
                [{ text: "📊 Summary", callback_data: `sum_${parts[1]}` }],
                [{ text: "🔄 Force New Scoreboard", callback_data: `fnew_${parts[1]}` }],
                [{ text: isLiveBoardOff ? "📊 Live Board: OFF 🔴" : "📊 Live Board: ON 🟢", callback_data: `tbod_${parts[1]}` }],
                [{ text: "✏️ Edit Name", callback_data: `edn_${parts[1]}` }],
                [{ text: isMuted ? "🔔 Unmute" : "🔕 Mute", callback_data: `tmut_${parts[1]}` }],
                [{ text: "💤 Snooze 1h", callback_data: `snz_${parts[1]}_1` }, { text: "💤 Snooze 8h", callback_data: `snz_${parts[1]}_8` }],
                [{ text: "📄 Export CSV", callback_data: `exp_${parts[1]}` }],
                [{ text: "❌ Remove", callback_data: `rem_${parts[1]}` }],
                [{ text: "🔙 Back", callback_data: `trkmenu` }, { text: "❌ Close", callback_data: `close` }]
            ]
        };
        await editTelegramMessage(msgId, `🎯 *Target Profile:*\n${name}\nNumber: ${num}`, kb);
    }
    else if (action === 'tbod') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        if (!config.liveBoardOff) config.liveBoardOff = [];
        if (config.liveBoardOff.includes(num)) {
            config.liveBoardOff = config.liveBoardOff.filter(n => n !== num);
        } else {
            config.liveBoardOff.push(num);
        }
        await saveCloudConfig();
        query.data = `trk_${parts[1]}`;
        await processCallback(query, sock); // Refresh menu
    }
    else if (action === 'fnew') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        const todayStr = getFormattedDate(new Date());
        const boardId = `${num}_${todayStr}`;
        if (db) await db.collection('live_scoreboards').deleteOne({ _id: boardId });
        await updateLiveScoreboard(num);
        
        const kb = { inline_keyboard: [[{ text: "🔙 Back to Profile", callback_data: `trk_${parts[1]}` }, { text: "❌ Close", callback_data: `close` }]] };
        await editTelegramMessage(msgId, `✅ Brand new live scoreboard generated and sent for ${getContactName(num)}!`, kb);
    }
    else if (action === 'edn') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        pendingAction = { type: 'editname', num: num };
        await sendTelegramDirect(`Please type the new name for ${getContactName(num)} in the chat now:`);
    }
    else if (action === 'tmut') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        if (config.muted.includes(num)) {
            config.muted = config.muted.filter(n => n !== num);
        } else {
            config.muted.push(num);
        }
        await saveCloudConfig();
        query.data = `trk_${parts[1]}`;
        await processCallback(query, sock); // Refresh menu
    }
    else if (action === 'snz') {
        const num = btnSessionMap[parts[1]];
        const hours = parseInt(parts[2]);
        if (!num) return;
        if (!config.snooze) config.snooze = {};
        config.snooze[num] = Date.now() + (hours * 3600 * 1000);
        await saveCloudConfig();
        await sendTelegramDirect(`💤 Snoozed notifications for ${getContactName(num)} for ${hours} hours.`);
    }
    else if (action === 'rem') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        const kb = {
            inline_keyboard: [
                [{ text: "⚠️ YES, REMOVE", callback_data: `remc_${parts[1]}` }],
                [{ text: "❌ Cancel", callback_data: `trk_${parts[1]}` }, { text: "❌ Close", callback_data: `close` }]
            ]
        };
        await editTelegramMessage(msgId, `Are you sure you want to stop tracking ${getContactName(num)}?`, kb);
    }
    else if (action === 'remc') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        config.targets = config.targets.filter(t => t !== num);
        delete activeSessions[num];
        await saveCloudConfig();
        await editTelegramMessage(msgId, `🗑️ Removed ${getContactName(num)}.`, { inline_keyboard: [[{ text: "❌ Close", callback_data: `close` }]] });
    }
    else if (action === 'trkmenu') {
        const kb = { inline_keyboard: [] };
        for (const t of config.targets) {
            const sc = getShortId(t);
            const state = activeSessions[t]?.isOnline ? "🟢" : "🔴";
            const muteState = config.muted.includes(t) ? " 🔕" : " 🔔";
            kb.inline_keyboard.push([{ text: `${state} ${getContactName(t)}${muteState}`, callback_data: `trk_${sc}` }]);
        }
        kb.inline_keyboard.push([{ text: "🔄 Refresh", callback_data: `trkmenu` }]);
        kb.inline_keyboard.push([{ text: "❌ Close", callback_data: `close` }]);
        await editTelegramMessage(msgId, "📊 *Active Tracking Dashboard*\nSelect a target to manage:", kb);
    }
    else if (action === 'tlive') {
        const reqPage = parseInt(parts[1]);
        const { textOut, kb, page } = await renderTrackLive(reqPage);
        await editTelegramMessage(msgId, textOut, kb);
        if (activeLiveDashboard.msgId === msgId) {
            activeLiveDashboard.page = page;
            activeLiveDashboard.lastText = textOut;
        }
    }
    else if (action === 'sum') {
        const num = btnSessionMap[parts[1]];
        if (!num) return;
        const kb = {
            inline_keyboard: [
                [{ text: "📅 Today", callback_data: `sumt_${parts[1]}_today` }, { text: "📆 Yesterday", callback_data: `sumt_${parts[1]}_yest` }],
                [{ text: "🗓️ Last 7 Days", callback_data: `sumt_${parts[1]}_7d` }],
                [{ text: "🔙 Back", callback_data: `trk_${parts[1]}` }, { text: "❌ Close", callback_data: `close` }]
            ]
        };
        await editTelegramMessage(msgId, `📊 Select summary range for ${getContactName(num)}:`, kb);
    }
    else if (action === 'sumt') {
        const num = btnSessionMap[parts[1]];
        const mode = parts[2];
        if (!num) return;
        
        // Emulate command to use user's custom layout
        const mockReply = (txt) => editTelegramMessage(msgId, txt, { inline_keyboard: [[{ text: "🔙 Back", callback_data: `sum_${parts[1]}` }, { text: "❌ Close", callback_data: `close` }]] });
        
        if (mode === 'today') {
            await processCommand(`/summary ${num} today`, sock, mockReply, null, config.chatId, null);
        } else if (mode === 'yest') {
            const d = new Date(); d.setDate(d.getDate() - 1);
            const yestStr = getFormattedDate(d);
            await processCommand(`/summary ${num} date ${yestStr} ${yestStr}`, sock, mockReply, null, config.chatId, null);
        } else if (mode === '7d') {
            const dEnd = new Date();
            const dStart = new Date(); dStart.setDate(dStart.getDate() - 7);
            const endStr = getFormattedDate(dEnd);
            const startStr = getFormattedDate(dStart);
            await processCommand(`/summary ${num} date ${startStr} ${endStr}`, sock, mockReply, null, config.chatId, null);
        }
    }
    else if (action === 'exp') {
        const num = btnSessionMap[parts[1]] || null; // null means Full Export
        sendTelegramDirect(`⏳ Generating export...`);
        const buffer = await generateCSVBuffer(num);
        if (buffer) {
            const blob = new Blob([buffer], { type: 'text/csv' });
            const formData = new FormData();
            formData.append('chat_id', config.chatId);
            formData.append('document', blob, `${num || "Full"}_Report.csv`);
            await fetchWithRetry(`${getTgApiUrl()}/bot${config.botToken}/sendDocument`, { method: 'POST', body: formData });
        }
    }
    else if (action === 'setgit') {
        pendingAction = { type: 'git_user' };
        await editTelegramMessage(msgId, "🛠️ *GitHub Setup*\n\nPlease type your **GitHub Username** in the chat:", { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "close" }]] });
    }
    else if (action === 'setpusher') {
        pendingAction = { type: 'pusher_appid' };
        await editTelegramMessage(msgId, "🛠️ *Pusher Setup*\n\nPlease type your **Pusher App ID** in the chat:", { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "close" }]] });
    }
    else if (action === 'setanch') {
        const currentMsgId = parseInt(parts[1]);
        if (db && currentMsgId) {
            const anchorDoc = await db.collection('system_config').findOne({ _id: 'daily_anchor' });
            let id_to_del = currentMsgId;
            // Fetch old End ID, set it to the new Start ID (default offset -100 if none exists)
            let id_from_del = (anchorDoc && anchorDoc.id_to_del) ? anchorDoc.id_to_del : (id_to_del - 100);

            await db.collection('system_config').updateOne(
                { _id: 'daily_anchor' }, 
                { $set: { id_from_del: id_from_del, id_to_del: id_to_del, date: getFormattedDate(new Date()) } }, 
                { upsert: true }
            );
            await editTelegramMessage(msgId, `✅ *Anchor Manually Shifted!*\n\nFrom ID: ${id_from_del}\nTo ID: ${id_to_del}`, { inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]] });
        }
    }
    else if (action === 'mananch') {
        // NEW: Load manual dashboard from DB
        if (db) {
            const anchorDoc = await db.collection('system_config').findOne({ _id: 'daily_anchor' });
            const fromId = anchorDoc && anchorDoc.id_from_del ? anchorDoc.id_from_del : 'Not Set';
            const toId = anchorDoc && anchorDoc.id_to_del ? anchorDoc.id_to_del : 'Not Set';

            const kb = {
                inline_keyboard: [
                    [{ text: `✏️ Edit From ID (${fromId})`, callback_data: `editanch_from` }],
                    [{ text: `✏️ Edit To ID (${toId})`, callback_data: `editanch_to` }],
                    [{ text: "❌ Close", callback_data: `close` }]
                ]
            };
            await editTelegramMessage(msgId, `🛠️ *Manual Anchor Dashboard*\n\nCurrent Boundaries:\n*From ID:* ${fromId}\n*To ID:* ${toId}`, kb);
        }
    }
    else if (action === 'editanch') {
        // NEW: Trigger interceptor for manual ID entry
        const mode = parts[1]; // 'from' or 'to'
        pendingAction = { type: `edit_anchor_${mode}` };
        await editTelegramMessage(msgId, `⏳ Please type the exact numeric Message ID for the **${mode.toUpperCase()}** anchor in the chat now:`, { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cancel" }]] });
    }
    else if (action === 'set') {
        const toggle = parts[1];
        if (toggle === 'tg') config.enableTelegram = !config.enableTelegram;
        if (toggle === 'wa') config.enableWhatsApp = !config.enableWhatsApp;
        if (toggle === 'mtg') config.mergeTelegramDrops = !config.mergeTelegramDrops;
        if (toggle === 'mdb') config.mergeDatabaseDrops = !config.mergeDatabaseDrops;
        if (toggle === 'dnd') {
            if (config.dnd) config.dnd = null;
            else { sendTelegramDirect("Use `/dnd HH:MM HH:MM` to set quiet hours."); return; }
        }
        await saveCloudConfig();
        
        const isPusherSet = (config?.pusher?.appId) ? true : false;
        const kb = {
            inline_keyboard: [
                [{ text: `✈️ TG Alerts: ${config.enableTelegram ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_tg` }],
                [{ text: `🔗 TG Merge Drops: ${config.mergeTelegramDrops ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_mtg` }],
                [{ text: `🗄️ DB Merge Drops: ${config.mergeDatabaseDrops ? 'ON 🟢' : 'OFF 🔴'}`, callback_data: `set_mdb` }],
                [{ text: `🌙 DND Mode: ${config.dnd ? 'ACTIVE' : 'OFF'}`, callback_data: `set_dnd` }],
                [{ text: `⚡ Setup Pusher (Real-Time UI) ${isPusherSet ? '🟢' : ''}`, callback_data: `setpusher` }],
                [{ text: "🛠️ Setup GitHub Update", callback_data: `setgit` }],
                [{ text: "❌ Close", callback_data: `close` }]
            ]
        };
        await editTelegramMessage(msgId, "⚙️ *Control Panel*", kb);
    }
    else if (action === 'db') {
        const op = parts[1];
        if (op === 'glc') {
            const kb = { inline_keyboard: [[{ text: "⚠️ Confirm Delete", callback_data: `db_gl` }], [{ text: "❌ Cancel", callback_data: `cancel` }, { text: "❌ Close", callback_data: `close` }]] };
            await editTelegramMessage(msgId, "Delete all sessions lasting < 5 seconds?", kb);
        }
        else if (op === 'oldc') {
            const kb = { inline_keyboard: [[{ text: "⚠️ Confirm Delete", callback_data: `db_old` }], [{ text: "❌ Cancel", callback_data: `cancel` }, { text: "❌ Close", callback_data: `close` }]] };
            await editTelegramMessage(msgId, "Delete all records older than 30 days?", kb);
        }
        else if (op === 'gl') {
            if(db) {
                for (const t of config.targets) {
                    await db.collection(t).deleteMany({ durationMs: { $lt: 5000 } });
                }
                await editTelegramMessage(msgId, "✅ Cleaned up glitch sessions (<5s).", { inline_keyboard: [[{ text: "❌ Close", callback_data: `close` }]] });
            }
        }
        else if (op === 'old') {
             if (db) {
                const limitMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
                for (const t of config.targets) {
                    await db.collection(t).deleteMany({ timestamp: { $lt: limitMs } });
                }
                await editTelegramMessage(msgId, "✅ Cleaned up old records.", { inline_keyboard: [[{ text: "❌ Close", callback_data: `close` }]] });
            }
        }
    }
    else if (action === 'cancel') {
        pendingAction = null;
        await editTelegramMessage(msgId, "Action canceled.", { inline_keyboard: [[{ text: "❌ Close", callback_data: `close` }]] });
    }
}

async function pollTelegramUpdates(sock) {
    if (!isPrimary) {
        setTimeout(() => pollTelegramUpdates(sock), 2000);
        return; // Prevent Secondary from polling and causing 409 Conflict
    }

    if (!config || !config.botToken) return;
    try {
        const url = `${getTgApiUrl()}/bot${config.botToken}/getUpdates?offset=${tgOffset}&timeout=10`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                tgOffset = update.update_id + 1; 

                // Route button clicks to callback handler
                if (update.callback_query) {
                    // SPEEDUP 3: Asynchronous processing (removed 'await')
                    processCallback(update.callback_query, sock).catch(e => console.error(e));
                    continue;
                }

                if (update.message && update.message.text && update.message.chat.id.toString() === config.chatId) {
                    // RAM Optimization 3: Ignore old command spam from when bot was offline
                    const msgTimeMs = update.message.date * 1000;
                    if (msgTimeMs < SCRIPT_START_TIME) {
                        console.log(`[TG-API] ⏳ Ignored offline command spam: ${update.message.text}`);
                        continue;
                    }
                    
                    // SPEEDUP 3: Asynchronous processing (removed 'await' for zero-lag UI)
                    processCommand(
                        update.message.text, 
                        sock, 
                        sendTelegramDirect, 
                        sendTelegramDocument,
                        config.chatId, // Telegram Source
                        update.message // Passes msgObject so we can grab msg_id for Close button
                    ).catch(e => console.error(e));
                }
            }
        }
    } catch (e) {} 
    setTimeout(() => pollTelegramUpdates(sock), 2000);
}

async function connectToWhatsApp(loginMethod = 'qr', loginNumber = '') {
    if (isSleeping) {
        console.log('[WA-AUTH] 💤 WhatsApp is in Sleep Cycle mode. Skipping connection.');
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    const sockOptions = {
        version,
        auth: state,
        printQRInTerminal: loginMethod === 'qr', 
        logger: pino({ level: 'silent' }),
        syncFullHistory: true, // FORCE FETCH ENTIRE ADDRESS BOOK (FIX FOR 400+ CONTACTS)
        markOnlineOnConnect: true // Force online status to receive presence updates in Termux
    };
    
    // Use official Baileys browser strings to prevent Termux shadowbans
    if (loginMethod === 'pairing') {
        sockOptions.browser = Browsers.ubuntu('Chrome');
    } else {
        sockOptions.browser = Browsers.ubuntu('Chrome');
    }
    
    const sock = makeWASocket(sockOptions);
    globalSock = sock; 
    sock.ev.on('creds.update', saveCreds);

    if (loginMethod === 'pairing' && !sock.authState.creds.registered) {
        console.log('\n[WA-AUTH] ⏳ Requesting pairing code...');
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(loginNumber);
                console.log(`\n[WA-AUTH] 🔑 YOUR PAIRING CODE IS: ${code.match(/.{1,4}/g)?.join('-')} \n`);
                console.log('[WA-AUTH] 📱 Open WhatsApp on your phone -> Linked Devices -> Link a device -> Use phone number instead.');
            } catch (err) {
                console.error('[WA-AUTH] ❌ Failed to request pairing code:', err.message);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // NEW: Intercept QR code, push to MongoDB, and Trigger Pusher Web UI update!
        if (qr && loginMethod === 'qr') {
            console.log('\n[WA-AUTH] 📱 Scan this QR code with your secondary WhatsApp:\n');
            qrcode.generate(qr, { small: true });
            if (db) {
                try {
                    await db.collection('system_config').updateOne(
                        { _id: 'bot_status' },
                        { $set: { status: 'qr_required', qrString: qr, lastUpdated: Date.now() } },
                        { upsert: true }
                    );
                } catch(e) {}
            }
            if (pusherClient) {
                pusherClient.trigger("whatsapp-tracker", "qr-update", { qrString: qr })
                    .catch(e => console.error("[PUSHER] ⚠️ QR Trigger failed:", e.message));
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('\n[WA-SOCKET] ⚠️ Connection closed. Reconnecting:', shouldReconnect);
            
            if (isSleeping) {
                console.log('[WA-SOCKET] 💤 WhatsApp disconnected cleanly for sleep cycle.');
                return;
            }

            if (shouldReconnect) {
                // SAFE ANTI-BAN FIX: Randomized graceful reconnection delay (10 to 60 seconds)
                const reconnectDelaySec = Math.floor(Math.random() * (60 - 10 + 1)) + 10;
                console.log(`\n[WA-SOCKET] ⚠️ Connection dropped. Waiting ${reconnectDelaySec}s (graceful anti-ban jitter) before PM2 restart...`);
                setTimeout(() => {
                    process.exit(1);
                }, reconnectDelaySec * 1000);
            } else {
                console.log('[WA-SOCKET] ❌ Logged out. Clearing dead credentials and restarting...');
                // FIX: Wipe the dead auth folder so it generates a new QR on next boot!
                if (fs.existsSync(AUTH_DIR)) {
                    require('child_process').execSync(`rm -rf ${AUTH_DIR}`);
                }
                process.exit(1); 
            }
        } else if (connection === 'open') {
            console.log('\n[WA-SOCKET] ✅ Connected successfully!');
            
            // NEW: Clear QR code status from MongoDB
            if (db) {
                try {
                    await db.collection('system_config').updateOne(
                        { _id: 'bot_status' },
                        { $set: { status: 'connected', qrString: null, lastUpdated: Date.now() } },
                        { upsert: true }
                    );
                } catch(e) {}
            }
            
            try {
                await sock.sendPresenceUpdate('available');
            } catch (e) {}

            console.log('[WA-SOCKET] ⏳ Waiting for address book sync (This may take a moment for large lists)...');
            
            if (isPrimary) {
                sendGlobalAlert(`🚀 WhatsApp Tracker Bot online!\nTracking: ${config.targets.map(t => getContactName(t)).join(', ')}\nType /help for commands.`);
            }
            
            // Setup Telegram Commands & start polling
            setupTelegramCommands();
            if (!isTelegramPolling) {
                isTelegramPolling = true;
                pollTelegramUpdates(sock);
            }
            
            console.log('\n[WA-SOCKET] 📡 Initializing tracking...');
            // Cap initialization to max 10 concurrent targets to prevent mass connection spikes
            const targetsToInit = [...config.targets].slice(0, 10);

            setTimeout(async () => {
                for (const target of targetsToInit) {
                    await subscribeAndMapTarget(sock, target, true);
                    await updateInstantUIStatus(target); // Initialize Secretary Cache
                    // Human entropy jitter: randomized 5 to 12 second delay between target subscriptions
                    const jitterMs = Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000;
                    await new Promise(r => setTimeout(r, jitterMs));
                }
                console.log('\n[WA-SOCKET] 👀 Tracking is now active. Waiting for status changes...\n');
            }, 2000);
        }
    });

    // CACHE POPULATION
    const populateCache = (contacts) => {
        for (const contact of contacts) {
            if (!contact.id) continue;
            const num = contact.id.split('@')[0].split(':')[0];
            if (!rawContactsCache[num]) rawContactsCache[num] = {};
            if (contact.name) rawContactsCache[num].name = contact.name;
            if (contact.notify) rawContactsCache[num].notify = contact.notify;
            if (contact.verifiedName) rawContactsCache[num].verifiedName = contact.verifiedName;
        }
    };

    const handleContactsUpdate = (contacts) => {
        populateCache(contacts);
        let updated = false;
        let lidUpdated = false;
        let syncCount = 0; 
        
        for (const contact of contacts) {
            if (!contact.id) continue;

            const isLid = contact.id.includes('@lid');
            let num = contact.id.split('@')[0].split(':')[0];

            // Aggressive LID to Phone Number Mapping
            if (contact.lid && contact.id && !isLid) {
                const lidNum = contact.lid.split('@')[0];
                if (lidMap[lidNum] !== num) {
                    lidMap[lidNum] = num;
                    lidMap[`${lidNum}@lid`] = num;
                    lidUpdated = true;
                }
            }

            // Fallback Name Assignment (Check all possible fields)
            const cleanName = sanitizeName(contact.name || contact.notify || contact.verifiedName);

            if (cleanName && contactsMap[num] !== cleanName && !isLid) {
                contactsMap[num] = cleanName;
                updated = true;
                syncCount++;
            }
        }
        
        if (updated) {
            saveCloudContacts().catch(() => {});
            if (syncCount > 0) console.log(`\n[WA-CACHE] 📇 Synced ${syncCount} contacts from WhatsApp History/Updates!`);
        }
        if (lidUpdated) {
            saveCloudLidMap().catch(() => {});
        }
    };

    sock.ev.on('contacts.upsert', handleContactsUpdate);
    sock.ev.on('contacts.update', handleContactsUpdate);
    
    sock.ev.on('messaging-history.set', ({ contacts }) => {
        if (contacts && contacts.length > 0) {
            console.log(`\n[WA-CACHE] 📦 Received history sync chunk (${contacts.length} contacts). Processing...`);
            handleContactsUpdate(contacts);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        // Outbound WhatsApp message handling purged for account stealth
    });

    sock.ev.on('presence.update', async (update) => {
        const incomingId = update.id;
        if (!lidMap[incomingId] && targetBeingMapped) {
            lidMap[incomingId] = targetBeingMapped;
            saveCloudLidMap().catch(() => {}); // Save dynamically created mapping
            const displayName = getContactName(targetBeingMapped);
            console.log(`[WA-MAP] ✅ Internal ID ${incomingId} successfully linked to ${displayName}`);
        }
        
        const targetNumber = lidMap[incomingId] || incomingId.split(':')[0].split('@')[0];
        if (!activeSessions[targetNumber]) return; 

        if (!isPrimary) return; // Prevent secondary from logging presence changes and duplicate messaging

        let currentStatus = null;
        if (update.presences) {
            const presenceKey = Object.keys(update.presences)[0];
            if (presenceKey) currentStatus = update.presences[presenceKey].lastKnownPresence;
        }
        const displayName = getContactName(targetNumber);

        if (currentStatus === 'available') {
            const pendingCol = db.collection('pending_sessions');
            const pendingDoc = await pendingCol.findOne({ _id: targetNumber });

            if (!pendingDoc) {
                // New Session - Checking for micro-drop merge
                const now = new Date();
                let dbStart = now.getTime();
                let tgStart = now.getTime();
                let dbMergedCount = 0;
                let tgMergedCount = 0;
                let tgMergedNow = false;
                let mergedDropsList = []; // Array to store merged timestamps

                const dropMemory = pendingDrops[targetNumber];
                if (dropMemory) {
                    const gracePeriodMs = (config.dropGracePeriodSeconds || 15) * 1000;
                    const offlineDurationMs = now.getTime() - dropMemory.offlineEpoch;

                    if (offlineDurationMs <= gracePeriodMs) {
                        // MERGE DB if enabled
                        if (config.mergeDatabaseDrops) {
                            dbStart = dropMemory.dbOriginalStart;
                            dbMergedCount = dropMemory.dbMergedCount + 1;
                            if (dropMemory.dbRecordId && db) await db.collection(targetNumber).deleteOne({ _id: dropMemory.dbRecordId });
                        }
                        // MERGE TG if enabled
                        if (config.mergeTelegramDrops) {
                            tgMergedNow = true;
                            tgStart = dropMemory.tgOriginalStart;
                            tgMergedCount = dropMemory.tgMergedCount + 1;
                            
                            // Restore previously accumulated drop list for this session
                            mergedDropsList = dropMemory.mergedDropsList || []; 
                            
                            // Format the current drop: HH:MM:SS AM to HH:MM:SS AM (X secs)
                            const dropStartStr = new Date(dropMemory.offlineEpoch).toLocaleTimeString();
                            const dropEndStr = now.toLocaleTimeString();
                            const dropSecs = Math.floor(offlineDurationMs / 1000);
                            
                            mergedDropsList.push(`${dropStartStr} to ${dropEndStr} (${dropSecs} secs)`);

                            if (dropMemory.tgMsgId) await deleteTelegramMessage(dropMemory.tgMsgId);
                        }
                    }
                    delete pendingDrops[targetNumber]; // Always clear the memory
                }
                
                // 🚀 MOVED UP: PUSHER REAL-TIME TRIGGER (Instant UI - Zero Latency)
                if (pusherClient) {
                    pusherClient.trigger("whatsapp-tracker", "status-change", {
                        number: targetNumber,
                        status: "online",
                        timestamp: dbStart // Send the DB start time so UI reflects the raw/merged DB logic
                    }).catch(e => console.error("[PUSHER] ⚠️ Trigger failed:", e.message));
                }
                
                // Now do the heavy MongoDB saving in background...
                await pendingCol.updateOne(
                    { _id: targetNumber }, 
                    { $set: { 
                        onlineStartTime: dbStart,
                        tgOnlineStartTime: tgStart,
                        dbMergedCount: dbMergedCount,
                        tgMergedCount: tgMergedCount,
                        mergedDropsList: mergedDropsList // Save the array to the cloud
                    } }, 
                    { upsert: true }
                );

                activeSessions[targetNumber].isOnline = true; // Local tracker
                const timeStr = now.toLocaleTimeString();
                
                await updateInstantUIStatus(targetNumber); // Secretary Update

                // --- NEW OFFLINE DURATION LOGIC ---
                let offlineDurationStr = "";
                if (db && !tgMergedNow) {
                    try {
                        const lastRecord = await db.collection(targetNumber).find().sort({ timestamp: -1 }).limit(1).toArray();
                        if (lastRecord.length > 0) {
                            const lastOfflineEpoch = lastRecord[0].timestamp + (lastRecord[0].durationMs || 0);
                            const offlineDiffMs = now.getTime() - lastOfflineEpoch;
                            if (offlineDiffMs > 0 && offlineDiffMs < 30 * 24 * 60 * 60 * 1000) { // Limit to 30 days sanity check
                                const offMins = Math.floor(offlineDiffMs / 60000);
                                const offSecs = Math.floor((offlineDiffMs % 60000) / 1000);
                                offlineDurationStr = `\n💤 Offline Duration: ${offMins} mins : ${offSecs} secs`;
                            }
                        }
                    } catch (e) {}
                }
                // ----------------------------------

                if (!tgMergedNow) {
                    console.log(`[WA-PRESENCE] [${timeStr}] 🟢 ${displayName} is ONLINE${offlineDurationStr.replace('\n', ' - ')}`);
                } else {
                    console.log(`[WA-PRESENCE] [${timeStr}] 🟢 ${displayName} is ONLINE (Micro-drop ignored/merged)`);
                }
                
                // Restore individual alerts for unmuted targets while keeping Live Scoreboard
                if (!isDndActive()) {
                    if (!config.muted.includes(targetNumber) && !tgMergedNow) {
                        const alertText = `🟢 ${displayName} is ONLINE at ${timeStr}${offlineDurationStr}`;
                        sendGlobalAlert(alertText);
                    }
                    await updateLiveScoreboard(targetNumber);
                }
            }
        } else if (currentStatus === 'unavailable') {
            const pendingCol = db.collection('pending_sessions');
            const pendingDoc = await pendingCol.findOne({ _id: targetNumber });

            if (pendingDoc) {
                const offlineDateObj = new Date();
                
                // 🚀 MOVED UP: PUSHER REAL-TIME TRIGGER (Instant UI - Zero Latency)
                if (pusherClient) {
                    pusherClient.trigger("whatsapp-tracker", "status-change", {
                        number: targetNumber,
                        status: "offline"
                    }).catch(e => console.error("[PUSHER] ⚠️ Trigger failed:", e.message));
                }
                
                // Session Ended - Calculate off Cloud Start Time
                activeSessions[targetNumber].isOnline = false;
                
                const onlineDateObj = new Date(pendingDoc.onlineStartTime);
                const tgOnlineDateObj = new Date(pendingDoc.tgOnlineStartTime || pendingDoc.onlineStartTime);
                
                const diffMs = offlineDateObj - onlineDateObj; // For DB
                const tgDiffMs = offlineDateObj - tgOnlineDateObj; // For Telegram (might be merged)

                // --- SANITY CHECK (Ghost Session Fix) ---
                if (diffMs > 24 * 60 * 60 * 1000) {
                    console.log(`[SYS-CHECK] ⚠️ Ignored orphaned session for ${displayName} (${Math.floor(diffMs / 3600000)}h long). Cleaning up.`);
                    await pendingCol.deleteOne({ _id: targetNumber });
                    return; // Abort logging this fake massive session
                }
                // ----------------------------------------

                const offlineTimeStr = offlineDateObj.toLocaleTimeString();
                console.log(`[WA-PRESENCE] [${offlineTimeStr}] 🔴 ${displayName} went OFFLINE.`);
                
                // MongoDB Append - Capture the record ID for potential deletion later
                const dbRecordId = await updateMongoReport(targetNumber, onlineDateObj, offlineDateObj, diffMs); 
                await pendingCol.deleteOne({ _id: targetNumber }); // Clear Cloud Pending Session
                
                await updateInstantUIStatus(targetNumber); // Secretary Update
                
                let tgMsgId = null;

                // Restore individual alerts for unmuted targets while keeping Live Scoreboard
                if (!isDndActive()) {
                    if (!config.muted.includes(targetNumber)) {
                        const diffMins = Math.floor(tgDiffMs / 60000);
                        const diffSecs = Math.floor((tgDiffMs % 60000) / 1000);
                        const durationStr = `${diffMins} mins : ${diffSecs} secs`;
                        
                        let mergedNote = "";
                        // Format the new detailed list if drops were merged!
                        if (config.mergeTelegramDrops && pendingDoc.mergedDropsList && pendingDoc.mergedDropsList.length > 0) {
                            mergedNote = `\n\nMerged Micro-Drops:\n\n` + pendingDoc.mergedDropsList.map(drop => ` - ${drop}`).join('\n');
                        } else if (config.mergeTelegramDrops && pendingDoc.tgMergedCount > 0) {
                            mergedNote = `\n*(Note: Timings merged due to network drops)*`; // Fallback
                        }

                        // Updated "Online Duration" string format
                        const alertText = `🔴 ${displayName} went OFFLINE at ${offlineTimeStr}\n⏱ Online Duration: ${durationStr}${mergedNote}`;
                        const alertRes = await sendGlobalAlert(alertText); // Captures TG Message ID
                        if (alertRes && alertRes.result) {
                            tgMsgId = alertRes.result.message_id;
                        }
                    }
                    await updateLiveScoreboard(targetNumber);
                }

                // Add to Pending Drops "Waiting Room"
                pendingDrops[targetNumber] = {
                    offlineEpoch: offlineDateObj.getTime(),
                    dbOriginalStart: pendingDoc.onlineStartTime,
                    tgOriginalStart: pendingDoc.tgOnlineStartTime || pendingDoc.onlineStartTime,
                    dbMergedCount: pendingDoc.dbMergedCount || 0,
                    tgMergedCount: pendingDoc.tgMergedCount || 0,
                    mergedDropsList: pendingDoc.mergedDropsList || [], // Pass the array down just in case they drop AGAIN
                    dbRecordId: dbRecordId,
                    tgMsgId: tgMsgId
                };
            }
        }
    });
}

// ================= ZERO-DEPENDENCY BATTERY FETCH =================
async function getBatteryStatus() {
    return new Promise((resolve) => {
        // 1. Try Termux (Android)
        exec('termux-battery-status', (err, stdout) => {
            if (!err && stdout) {
                try {
                    const data = JSON.parse(stdout);
                    return resolve({ battery: data.percentage, isCharging: data.status === 'CHARGING' || data.status === 'FULL' });
                } catch(e) {}
            }
            
            // 2. Try Windows
            if (process.platform === 'win32') {
                exec('WMIC Path Win32_Battery Get EstimatedChargeRemaining, BatteryStatus', (err2, stdout2) => {
                    if (!err2 && stdout2) {
                        const lines = stdout2.split('\n').map(l => l.trim()).filter(l => l);
                        if (lines.length > 1) {
                            const parts = lines[1].split(/\s+/);
                            if (parts.length >= 2) {
                                return resolve({ battery: parseInt(parts[1]), isCharging: parseInt(parts[0]) === 2 });
                            }
                        }
                    }
                    return resolve({ battery: null, isCharging: false });
                });
                return;
            }
            
            // 3. Try macOS / Linux
            if (process.platform === 'darwin' || process.platform === 'linux') {
                exec('pmset -g batt', (err3, stdout3) => {
                    if(!err3 && stdout3) {
                        const match = stdout3.match(/(\d+)%;\s*(charging|discharging|AC attached)/i);
                        if (match) {
                            return resolve({ battery: parseInt(match[1]), isCharging: match[2].toLowerCase() !== 'discharging' });
                        }
                    }
                    return resolve({ battery: null, isCharging: false });
                });
                return;
            }
            
            // Default Fallback
            resolve({ battery: null, isCharging: false });
        });
    });
}
// ===============================================================

// NEW: ADVANCED SYSTEM DIAGNOSTICS (RAM, STORAGE, NETWORK, CPU TEMP)
async function getAdvancedStats() {
    return new Promise((resolve) => {
        let ramStr = 'N/A';
        let networkType = 'Unknown';
        let botUptime = 'N/A';
        let storageStr = 'Unknown';
        let cpuTempStr = 'Unknown';
        
        try {
            const ramTotal = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
            const ramFree = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
            ramStr = `${ramFree}GB / ${ramTotal}GB`;

            const nets = os.networkInterfaces();
            const hasWifi = !!nets['wlan0'] || !!nets['ap0'];
            const has4G = !!nets['rmnet_data0'] || !!nets['rmnet0'] || Object.keys(nets).some(k => k.includes('rmnet'));
            
            if (hasWifi && has4G) networkType = '4G (Hotspot Active)';
            else if (has4G) networkType = 'Mobile Data (4G/5G)';
            else if (hasWifi) networkType = 'WiFi';

        } catch(e) {}

        // Fetch Android/Linux specific storage using df -h
        exec('df -h /data', (err, stdout) => {
            if (!err && stdout) {
                try {
                    const lines = stdout.split('\n');
                    if (lines.length > 1) {
                        const parts = lines[1].trim().split(/\s+/);
                        if (parts.length >= 4) {
                            storageStr = `${parts[3]} Free`;
                        }
                    }
                } catch(e){}
            }
            
            // Fetch CPU Temperature
            exec('cat /sys/class/thermal/thermal_zone0/temp', (errTemp, stdoutTemp) => {
                if (!errTemp && stdoutTemp) {
                    try {
                        const tempInt = parseInt(stdoutTemp.trim());
                        if (tempInt > 1000) {
                            cpuTempStr = `${(tempInt / 1000).toFixed(1)}°C`;
                        } else {
                            cpuTempStr = `${tempInt}°C`;
                        }
                    } catch(e) {}
                }
                // Immortal Uptime: Compare now to the DB stamped start time instead of process.uptime
                const uptimeMs = Date.now() - globalBotStartTime;
                botUptime = formatUptime(uptimeMs);
                resolve({ ram: ramStr, network: networkType, uptime: botUptime, storage: storageStr, cpuTemp: cpuTempStr });
            });
        });
    });
}

async function main() {
    // --- V7 ESM IMPORT FIX ---
    const baileys = await import('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    Browsers = baileys.Browsers;
    // -------------------------

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise(res => rl.question(q, res));
    console.log("[SYS] =============================================");
    console.log("[SYS]    WhatsApp Multi-Number Tracker Started     ");
    console.log("[SYS] =============================================\n");
    
    // DEBUG: Log args to see what PM2 is actually passing
    console.log("[SYS] Startup Arguments:", process.argv);

    // ROBUST CHECK: Look for flag OR environment variable
    const isAuto = process.argv.includes('--auto') || process.env.IS_AUTO === 'true';
    
    // Check Local Config JUST for MongoDB URI
    let localConfig = { mongoUri: "" };
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE));
            localConfig.mongoUri = parsed.mongoUri || "";
        } catch(e) {}
    }
    
    // Prompt for MongoDB URI upfront if not present
    if (!localConfig.mongoUri && !isAuto) {
         console.log("\n[SYS] ⚠️ MongoDB URI is required for Multi-Instance Tracker Setup.");
         localConfig.mongoUri = await question("Enter MongoDB Connection URI (e.g., mongodb+srv://...):\n> ");
         fs.writeFileSync(CONFIG_FILE, JSON.stringify({ mongoUri: localConfig.mongoUri }, null, 2));
    }

    // Default configuration with new Session Accumulator settings
    config = { 
        targets: [], muted: [], dnd: null, waNotify: false, adminNumber: "", botToken: "", 
        chatId: "", enableTelegram: true, enableWhatsApp: false, mongoUri: localConfig.mongoUri, 
        snooze: {}, liveBoardOff: [], github: null, pusher: null, tgProxy: null,
        mergeTelegramDrops: true, // TG clean by default
        mergeDatabaseDrops: false, // DB raw by default
        dropGracePeriodSeconds: 15
    };

    // Connect MongoDB Early
    const connected = await connectMongo();
    await loadCloudUptime(); // NEW: Load immortal uptime instantly

    // Load entire config from Cloud
    await loadCloudConfig();
    await loadCloudContacts();
    await loadCloudLidMap(); // Sync mapping state continuously

    // --- RESTORED MENU BLOCK WITH PM2 FIX ---
    let useExistingAuth = fs.existsSync(AUTH_DIR);
    if (isAuto) {
        console.log("[SYS] 🤖 AUTO MODE DETECTED: Skipping menu.");
        if (!fs.existsSync(CONFIG_FILE)) {
             console.error("[SYS] ❌ ERROR: Configuration missing in --auto mode.");
             process.exit(1);
        }
        if (!useExistingAuth) {
             console.log("[SYS] ⚠️ No login found. Bypassing menu to launch headless QR generator...");
        }
    } else {
        let exitMenu = false;
        while (!exitMenu) {
            const hasAuth = fs.existsSync(AUTH_DIR);
            console.log("\n📋 MAIN MENU");
            console.log("   [Status: " + (hasAuth ? "✅ Logged In" : "❌ Not Logged In") + " | " + (config.targets.length) + " Targets]");
            console.log("1) ▶️  Start Bot");
            console.log("2) 🎯 Edit Tracking Numbers");
            console.log("3) 🤖 Edit Telegram Details (Token & Chat ID)");
            console.log("4) 👮 Edit Admin WhatsApp Number");
            console.log("5) 🔄 Re-Login (Scan QR/Pairing again)");
            console.log("6) 🗑️  Factory Reset (Clear All Data)");
            console.log("7) 🗄️ Edit MongoDB Connection URI");
            console.log("8) 🌐 Set Telegram Reverse Proxy Link");
            const answer = await question("\nSelect an option (1-8): ");
            if (answer.trim() === '1') exitMenu = true;
            else if (answer.trim() === '2') {
                const input = await question("Enter new numbers to track (comma separated):\n> ");
                config.targets = input.split(',').map(n => n.replace(/\D/g, '').trim()).filter(n => n.length > 0);
                await saveCloudConfig();
                console.log("[SYS] ✅ Targets updated.");
            } else if (answer.trim() === '3') {
                config.botToken = (await question("Enter Telegram Bot Token:\n> ")).trim();
                config.chatId = (await question("Enter Telegram Chat ID:\n> ")).trim();
                await saveCloudConfig();
                console.log("[SYS] ✅ Telegram settings saved.");
            } else if (answer.trim() === '4') {
                const input = await question("Enter Admin WhatsApp Number:\n> ");
                config.adminNumber = input.replace(/\D/g, '');
                await saveCloudConfig();
                console.log("[SYS] ✅ Admin number saved.");
            } else if (answer.trim() === '5') {
                if (fs.existsSync(AUTH_DIR)) require('child_process').execSync(`rm -rf ${AUTH_DIR}`);
                useExistingAuth = false;
                console.log("[SYS] 🗑️ Session cleared. You will be prompted to login when starting.");
            } else if (answer.trim() === '6') {
                if (fs.existsSync(AUTH_DIR)) require('child_process').execSync(`rm -rf ${AUTH_DIR}`);
                if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
                if (fs.existsSync(CONTACTS_FILE)) fs.unlinkSync(CONTACTS_FILE);
                config = { targets: [], muted: [], dnd: null, waNotify: false, adminNumber: "", botToken: "", chatId: "", enableTelegram: true, enableWhatsApp: false, mongoUri: "", snooze: {}, liveBoardOff: [], github: null, pusher: null, tgProxy: null, mergeTelegramDrops: true, mergeDatabaseDrops: false, dropGracePeriodSeconds: 15 };
                await saveCloudConfig();
                await saveCloudContacts();
                if (db) await db.collection('system_config').deleteMany({ _id: { $in: ['bot_uptime', 'bot_health'] } });
                useExistingAuth = false;
                console.log("[SYS] ✅ Factory reset complete.");
            } else if (answer.trim() === '7') {
                const input = await question("Enter MongoDB Connection URI (e.g., mongodb+srv://...):\n> ");
                config.mongoUri = input.trim();
                fs.writeFileSync(CONFIG_FILE, JSON.stringify({ mongoUri: config.mongoUri }, null, 2));
                console.log("[SYS] ✅ MongoDB URI saved locally.");
                await connectMongo(); // Reconnect immediately after saving
            } else if (answer.trim() === '8') {
                const input = await question("Enter Cloudflare Worker Proxy URL (or type 'default' to clear):\n> ");
                const url = input.trim();
                if (url.toLowerCase() === 'default') {
                    config.tgProxy = null;
                    await saveCloudConfig();
                    console.log("[SYS] ✅ Proxy cleared. Using default api.telegram.org");
                } else {
                    config.tgProxy = url;
                    await saveCloudConfig();
                    console.log("[SYS] ✅ Proxy saved!");
                }
            } else console.log("[SYS] ⚠️ Invalid option.");
        }
    }
    
    if (config.targets.length === 0 && !isAuto) {
         console.log("\n[SYS] ⚠️ No tracking numbers found!");
         const input = await question("Enter numbers to track (comma separated):\n> ");
         config.targets = input.split(',').map(n => n.replace(/\D/g, '').trim()).filter(n => n.length > 0);
         await saveCloudConfig();
    }

    // Helper function to safely start background tasks ONLY after setup is finished
    const startMultiInstanceTasks = () => {
        if (connected) {
            runHeartbeat();
            
            // Check for 1:00 AM Auto-Wipe, 11:59 PM Anchor Saving, and Sleep cycle prompts every minute
            setInterval(checkScheduledTasks, 60000); 

            setInterval(async () => {
                if (db && !isPrimary) {
                    await loadCloudConfig();
                    await loadCloudContacts();
                    await loadCloudLidMap(); // Sync mapping state continuously
                }
            }, 15000);
            
            // ==================== SAFE DOOR HEARTBEAT SELECTOR ====================
            // OPTION A (Stealth - Recommended): Protocol-level WebSocket Ping.
            // Sends a silent ping at the network layer without querying WhatsApp presence.
            setInterval(() => {
                if (isPrimary && !isSleeping && globalSock && globalSock.ws && globalSock.ws.isOpen) {
                    try {
                        globalSock.ws.ping();
                    } catch (e) {}
                }
            }, 5 * 60 * 1000);

            /*
            // OPTION B (Legacy): 5-Minute Presence Poll with 10-Second Watchdog.
            // Re-subscribes to every target and forces a PM2 restart if WhatsApp doesn't reply in 10s.
            setInterval(async () => {
                if (isPrimary && !isSleeping && globalSock && config && config.targets) {
                    for (const target of config.targets.slice(0, 10)) {
                        try {
                            const jid = `${target}@s.whatsapp.net`;
                            
                            // The 10-Second Watchdog Bomb
                            const timeoutBomb = new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('WATCHDOG_TIMEOUT')), 10000)
                            );

                            // Race the Ping against the 10-Second Bomb
                            await Promise.race([
                                globalSock.presenceSubscribe(jid),
                                timeoutBomb
                            ]);

                            await new Promise(r => setTimeout(r, 500)); 
                        } catch (e) {
                            if (e.message === 'WATCHDOG_TIMEOUT') {
                                console.error(`\n[SYS] 🚨 WATCHDOG TRIGGERED: WhatsApp server did not reply in 10 seconds. Connection is dead. Forcing PM2 reboot...`);
                                process.exit(1);
                            }
                        }
                    }
                }
            }, 5 * 60 * 1000);
            */
            // =====================================================================

            // 12-HOUR ANTI-LOGOUT KEEP-ALIVE (Prevents WA Companion Device Purge)
            setInterval(async () => {
                if (isPrimary && !isSleeping && globalSock) {
                    try {
                        await globalSock.sendPresenceUpdate('available');
                        console.log('\n[SYS] 🛡️ Sent 12-hour anti-logout keep-alive presence.');
                    } catch (e) {
                        console.error('\n[SYS] ⚠️ Failed to send anti-logout presence:', e.message);
                    }
                }
            }, 12 * 60 * 60 * 1000);

            // 5-SECOND LOOP: TrackLive update AND Remote Restart listener
            setInterval(async () => {
                if (isPrimary) {
                    // Check for Remote Update & Restart Signals
                    if (db) {
                        try {
                            const restartCmd = await db.collection('system_config').findOne({ _id: 'remote_restart' });
                            if (restartCmd && restartCmd.pending) {
                                await db.collection('system_config').updateOne({ _id: 'remote_restart' }, { $set: { pending: false } });
                                
                                if (restartCmd.update) {
                                    console.log("\n[SYS] ☁️ Remote GitHub Update triggered from Web UI!");
                                    if (config.github && config.github.token && config.github.user && config.github.repo && config.github.branch) {
                                        try {
                                            const url = `https://raw.githubusercontent.com/${config.github.user}/${config.github.repo}/${config.github.branch}/${config.github.filename || 'tracker.js'}`;
                                            const res = await fetch(url, { headers: { 'Authorization': `token ${config.github.token}` } });
                                            if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
                                            
                                            const newCode = await res.text();
                                            if (fs.existsSync('./tracker.js')) {
                                                fs.writeFileSync('./tracker.bak.js', fs.readFileSync('./tracker.js'));
                                            }
                                            fs.writeFileSync('./tracker.js', newCode);
                                            console.log("[SYS] ✅ Update downloaded and backed up! Restarting via PM2...");
                                        } catch (e) {
                                            console.error(`[SYS] ❌ Update Failed: ${e.message}. Restarting anyway...`);
                                        }
                                    } else {
                                        console.log("[SYS] ⚠️ GitHub Updater not fully configured. Skipping update and just restarting...");
                                    }
                                } else {
                                    console.log("\n[SYS] 🔄 Remote PM2 restart triggered from Web UI!");
                                }
                                if (db) await db.collection('system_config').deleteMany({ _id: { $in: ['bot_uptime', 'bot_health'] } });
                                process.exit(1);
                            }
                        } catch(e){}
                    }

                    if (activeLiveDashboard.msgId) {
                        const { textOut, kb, page } = await renderTrackLive(activeLiveDashboard.page);
                        if (textOut !== activeLiveDashboard.lastText) {
                            const isEdited = await editTelegramMessage(activeLiveDashboard.msgId, textOut, kb);
                            if (isEdited) {
                                activeLiveDashboard.lastText = textOut;
                            } else {
                                activeLiveDashboard.msgId = null;
                            }
                        }
                    }
                }
            }, 5 * 1000);

            // 60-SECOND BOT HEALTH MONITOR (BATTERY & SYSTEM CONFIG)
            setInterval(async () => {
                if (isPrimary && db) {
                    try {
                        const health = await getBatteryStatus();
                        const advStats = await getAdvancedStats(); // Fetch RAM, Storage, Uptime, Network, CPU Temp
                        
                        if (health.battery !== null) {
                            await db.collection('system_config').updateOne(
                                { _id: 'bot_health' },
                                { $set: { 
                                    battery: health.battery, 
                                    isCharging: health.isCharging, 
                                    ram: advStats.ram,
                                    storage: advStats.storage,
                                    network: advStats.network,
                                    botUptime: advStats.uptime,
                                    cpuTemp: advStats.cpuTemp,
                                    lastUpdated: Date.now() 
                                } },
                                { upsert: true }
                            );
                        }
                        
                        // Secretary Status Tick (keeps active timers updating every minute)
                        if (config && config.targets && !isSleeping) {
                             for (const target of config.targets) {
                                  if (activeSessions[target]?.isOnline) {
                                      await updateInstantUIStatus(target);
                                  }
                             }
                        }
                    } catch (e) { }
                }
            }, 60000);
            
            // SCHEDULED 3-HOUR AUTO-RESTART SLEDGEHAMMER (Prevent Zombie States & Reduce Login Spikes)
            setInterval(() => {
                if (isPrimary && !isSleeping) {
                    console.log("\n[SYS] ⏳ Executing scheduled 3-hour reboot to permanently prevent zombie states...");
                    process.exit(1);
                }
            }, 3 * 60 * 60 * 1000); // 3 hours (180 minutes)
        }
    };

    useExistingAuth = fs.existsSync(AUTH_DIR); // Re-check in case they factory resetted in menu
    if (!useExistingAuth) {
         if (isAuto) { 
             console.log("\n[SYS] 🤖 AUTO MODE DETECTED WITHOUT LOGIN. Bypassing terminal prompt and launching headless QR generator...");
             startMultiInstanceTasks(); 
             connectToWhatsApp('qr', '');
             return; // Safely exit the main execution block to prevent crashing on the terminal prompt
         }
        const methodChoice = await question("\nHow would you like to login?\n1) QR Code\n2) Pairing Code\n> ");
        let loginMethod = 'qr';
        let loginNumber = '';
        if (methodChoice.trim() === '2') {
            loginMethod = 'pairing';
            loginNumber = await question("Enter your secondary WhatsApp login number (with country code):\n> ");
            loginNumber = loginNumber.replace(/\D/g, '');
        }
        rl.close();
        startMultiInstanceTasks(); // Start heartbeat now that UI input is fully complete
        connectToWhatsApp(loginMethod, loginNumber);
    } else {
        rl.close();
        startMultiInstanceTasks(); // Start heartbeat now that UI input is fully complete
        connectToWhatsApp();
    }
}

main();

// SAFETY NET: Prevent hard crashes from corrupting session files
process.on('uncaughtException', (err) => {
    console.error('[SYS] ❌ CRITICAL ERROR CAUGHT:', err);
    console.log('[SYS] 🔄 Forcing PM2 restart to clear corrupted memory...');
    process.exit(1);
    // We keep the process alive to prevent session file corruption (Deprecated: Now using PM2)
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[SYS] ❌ UNHANDLED PROMISE REJECTION:', reason);
    console.log('[SYS] 🔄 Forcing PM2 restart to prevent zombie state...');
    process.exit(1);
    // Keeps bot alive during temporary network/MongoDB blips or Promise failures (Deprecated: Now using PM2)
});
