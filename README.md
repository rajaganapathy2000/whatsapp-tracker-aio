<div align="center">
  <h1>📱 WhatsApp Multi-Number Tracker (AIO Workspace)</h1>
  <p><i>A powerful, headless Node.js utility to securely track WhatsApp presence, extract media, and manage messages remotely via Telegram.</i></p>
  
  [![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Telegram](https://img.shields.io/badge/Integrated-Telegram_Bot-2CA5E0.svg)](https://core.telegram.org/bots)
</div>

---

## ⚠️ Disclaimer & Educational Notice
> **This project is provided strictly for educational and research purposes only.**
> This tool is strictly designed for **personal utility, productivity automation, and authorized tracking** (such as managing your own business lines or keeping track of customer support availability). Do not use this tool for unauthorized stalking or violation of WhatsApp's Terms of Service. The maintainers assume no liability for account bans or misuse.

---

## 🏗️ Repository Structure (AIO)
This workspace uses a **Monorepo structure**. All three essential components of the tracker live in this single repository, making it easy to manage and deploy from one GitHub link.
```text
whatsapp-tracker-aio/
│
├── proxy/       <-- Vercel Serverless Function (Secure MongoDB Bridge)
├── ui/          <-- React + Vite Dashboard (Glassmorphism Web App)
└── bot/         <-- Node.js Baileys Script (Runs 24/7 on Termux or PC)
```

---

## ✨ Core Features
* **📊 Automated Tracking**: Logs exact Online/Offline durations securely to your MongoDB database (upgraded from local `.xlsx` files).
* **🌐 Real-Time UI**: Apple-style Glassmorphism web dashboard powered by Pusher WebSockets for instant, live status updates across all your devices.
* **💬 Remote Messaging**: Send messages, reply to specific IDs, and broadcast natively from Telegram.
* **📎 Media Extraction**: Automatically downloads incoming photos, videos, audio, and documents, forwarding them securely to Telegram.
* **🥷 Stealth Mode**: Read incoming WhatsApp messages anonymously via Telegram. Manually trigger "Blue Ticks" on demand using `/markread`.
* **⏰ Scheduled Messages**: Draft messages to be sent at a delayed time natively via Telegram commands.
* **🌙 Do Not Disturb (DND)**: Define quiet hours where Telegram pings are silenced while background database tracking continues silently.

---

## 📚 Beginner's Step-by-Step Deployment Guide

Click the dropdowns below to reveal detailed instructions for setting up and deploying your entire ecosystem!

<details>
<summary><b>🛠️ 1. Prerequisites (Keys & Accounts Needed)</b></summary>
<br>

Before touching any code, ensure you have created accounts and gathered the following free keys:
1. **A Telegram Bot Token**:
   * Open Telegram and search for `@BotFather`.
   * Send the message `/newbot` and follow the prompts to name your bot.
   * Copy the **HTTP API Token** (e.g., `1234567890:ABCdef...`).
2. **Your Telegram Chat ID**:
   * Start a chat with your newly created bot and say "Hello".
   * Search for `@userinfobot` in Telegram and start a chat to get your unique `Id` (e.g., `123456789`).
3. **MongoDB Database URI**: Create a free cluster on MongoDB Atlas and copy the connection string. Make sure Network Access is set to allow all IPs (`0.0.0.0/0`).
4. **Pusher Credentials**: Create a free Channels app on Pusher.com to get your App ID, Key, Secret, and Cluster.
5. **App Secret Key**: Create a random password (e.g., `mySuperSecret123`) to protect your database proxy from unauthorized access.

</details>

<details>
<summary><b>🌐 2. Deploy the Proxy (Vercel)</b></summary>
<br>

The proxy acts as a secure, serverless bridge between your web dashboard and your MongoDB database.
1. Go to your Vercel Dashboard and click **Add New > Project**.
2. Import your `whatsapp-tracker-aio` GitHub repository.
3. **CRITICAL:** In the "Configure Project" screen, click Edit next to **Root Directory** and select the `proxy` folder.
4. Expand the "Environment Variables" section and add exactly these two keys:
   * Name: `MONGODB_URI` | Value: *Your full MongoDB connection string*
   * Name: `APP_SECRET_KEY` | Value: *Your custom password*
5. Click **Deploy**. Once finished, copy the final Vercel URL (this is your Proxy URL).

</details>

<details>
<summary><b>💻 3. Deploy the UI Dashboard (Vercel)</b></summary>
<br>

This is the highly optimized, glossy web app you will install on your phone's home screen.
1. Go to your Vercel Dashboard and click **Add New > Project** again.
2. Import the *exact same* `whatsapp-tracker-aio` repository.
3. **CRITICAL:** Click Edit next to **Root Directory** and select the `ui` folder.
4. Leave all other settings as default (Vercel will automatically detect Vite and Tailwind v4).
5. Click **Deploy**.
6. Open the deployed URL on your phone's Chrome browser, go to the Settings tab, and enter your new Proxy URL, Secret Key, and Pusher details.
7. Tap your browser menu and select **"Add to Home Screen"** for the full app-like experience!

</details>

<details>
<summary><b>👻 4. Running the Bot Invisibly on PC/Mac (PM2)</b></summary>
<br>

If you want the tracker to run 24/7 without keeping a terminal window open on your computer, use PM2 (a professional Node.js process manager).

**1. Install PM2 Globally:**
Open PowerShell/Command Prompt and run:
```bash
npm install pm2 -g
```

**2. Start the Bot in Background:**
Navigate into your bot directory (`cd whatsapp-tracker-aio/bot`) and run `npm install`. Then start the bot. 

If you are using **Windows PowerShell**, use quotes around the `--` separator so PowerShell doesn't eat the command:
```powershell
pm2 start tracker.js --name "whatsapp-bot" "--" --auto
```

If you are using **Command Prompt (cmd)**, **Mac**, or **Linux**:
```bash
pm2 start tracker.js --name "whatsapp-bot" -- --auto
```
*(The `--` tells PM2 to pass the `--auto` flag to our script, skipping the setup menus and using your saved login).*

**3. Helpful PM2 Commands:**
* **View terminal output:** `pm2 logs whatsapp-bot`
* **Stop the bot:** `pm2 stop whatsapp-bot`
* **Restart the bot:** `pm2 restart whatsapp-bot`
* **Ensure bot starts when Windows restarts:** Read the [PM2 Startup Guide](https://pm2.keymetrics.io/docs/usage/startup/).

</details>

<details>
<summary><b>📱 5. Running the Bot on a Spare Android Phone (Termux)</b></summary>
<br>

Don't want to leave your PC on 24/7? You can run this bot entirely on an old or spare Android phone using **Termux**!

**1. Install Termux (Important):**
* Download Termux from [F-Droid](https://f-droid.org/packages/com.termux/) (Do NOT use the Google Play Store version, it is broken and deprecated).

**2. Prepare the Linux Environment:**
Open Termux on your phone and run these commands one by one to install Node.js and Git:
```bash
pkg update && pkg upgrade
pkg install nodejs git
```

**3. Prevent Android from Killing the Bot (Crucial):**
Android aggressively puts background apps to sleep. To keep the bot running 24/7:
* Run this command in Termux to keep the CPU awake: `termux-wake-lock`
* Go to your phone's **Settings > Apps > Termux > Battery** and set it to **"Unrestricted"** (Disable Battery Optimization).

**4. Install and Run the Tracker:**
```bash
git clone [https://github.com/YOUR_USERNAME/whatsapp-tracker-aio.git](https://github.com/YOUR_USERNAME/whatsapp-tracker-aio.git)
cd whatsapp-tracker-aio/bot
npm install
node tracker.js
```
*(Tip: You can also install PM2 inside Termux using `npm install pm2 -g` just like on a PC!)*

</details>

<details>
<summary><b>🤖 6. Telegram Commands Cheat Sheet</b></summary>
<br>

Send any of these commands directly to your Telegram bot to manage your WhatsApp script remotely:

**🎯 Tracking Management**
* `/add <num>` - Start tracking a new number.
* `/remove <num>` - Stop tracking a number.
* `/status` - View the live status of all tracked numbers.
* `/summary <num>` - Get today's total online time for a specific number.

**🔕 Notifications & Data**
* `/mute <num>` - Stop Telegram alerts for a number (Database tracking continues silently).
* `/unmute <num>` - Resume Telegram alerts.
* `/dnd <HH:MM> <HH:MM>` - Set quiet hours (e.g., `/dnd 22:00 08:00`).
* `/dnd off` - Disable quiet hours.
* `/export` - Download the latest Database tracking report instantly via CSV.

**💬 Messaging**
* `/send <num> <msg>` - Send a new WhatsApp message.
* `/reply <ID> <msg>` - Reply to a specific message ID forwarded by the bot.
* `/markread <ID>` - Mark a message as read (applies blue ticks).
* `/schedule <mins> <num> <msg>` - Send a message after X minutes.
* `/broadcast <msg>` - Send a message to all tracked numbers at once.

**⚙️ System**
* `/settings` - Open the Interactive Settings Panel to configure Pusher, GitHub Updates, etc.
* `/database` - Clean up old data and glitch sessions from MongoDB.
* `/update` - Pull the latest code directly from GitHub.
* `/ping` - Check bot uptime and health.
* `/help` - View this list in Telegram.

</details>

<details>
<summary><b>💡 7. Troubleshooting & FAQ</b></summary>
<br>

* **The Pairing Code isn't working.**
  * *Fix:* Ensure you enter the exact phone number *of the account you are logging in with*, including the country code (e.g., `919876543210`), with no + signs or spaces.
* **My scheduled messages disappeared!**
  * *Fix:* Scheduled messages are saved to `schedule.json`. If you force-delete everything using the startup menu (Option 6 for Factory Reset), your scheduled messages will be wiped. Otherwise, they survive reboots safely.
* **Vercel Proxy returns 500 Internal Server Error.**
  * *Fix:* Double-check that your MongoDB Network Access is set to allow connections from anywhere (`0.0.0.0/0`). Vercel uses dynamic IPs, so restricting IP access in MongoDB will block the proxy from functioning.

</details>

---
<p align="center">Made with ❤️ from 🇮🇳</p>
