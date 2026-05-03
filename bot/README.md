<div align="center">
  <h1>📱 WhatsApp Multi-Number Tracker</h1>
  <p><i>A powerful, headless Node.js utility to securely track WhatsApp presence, extract media, and manage messages remotely via Telegram.</i></p>
  
  [![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Telegram](https://img.shields.io/badge/Integrated-Telegram_Bot-2CA5E0.svg)](https://core.telegram.org/bots)
</div>

---

## ⚠️ Disclaimer
> This tool is strictly designed for **personal utility, productivity automation, and authorized tracking** (such as managing your own business lines or keeping track of customer support availability). Do not use this tool for unauthorized stalking or violation of WhatsApp's Terms of Service. The maintainers assume no liability for account bans or misuse.

---

## ✨ Core Features
* **📊 Automated Tracking**: Logs exact Online/Offline durations to an auto-generating `.xlsx` file.
* **💬 Remote Messaging**: Send messages, reply to specific IDs, and broadcast natively from Telegram.
* **📎 Media Extraction**: Automatically downloads incoming photos, videos, audio, and documents, forwarding them securely to Telegram.
* **🥷 Stealth Mode**: Read incoming WhatsApp messages anonymously via Telegram. Manually trigger "Blue Ticks" on demand using `/markread`.
* **⏰ Scheduled Messages**: Draft messages to be sent at a delayed time natively via Telegram commands.
* **🌙 Do Not Disturb (DND)**: Define quiet hours where Telegram pings are silenced while background Excel tracking continues.

---

## 📚 Beginner's Step-by-Step Guide

Click the dropdowns below to reveal detailed instructions for setting up and using this tool!

<details>
<summary><b>🛠️ 1. Prerequisites (What you need before starting)</b></summary>
<br>

To run this bot, you need three things:
1. **Node.js**: Download and install the LTS version from [nodejs.org](https://nodejs.org/). Make sure to check the box that says "Add to PATH" during installation.
2. **A Telegram Bot Token**:
   * Open Telegram and search for `@BotFather`.
   * Send the message `/newbot` and follow the prompts to name your bot.
   * Copy the **HTTP API Token** (e.g., `1234567890:ABCdefGHIjkl...`).
3. **Your Telegram Chat ID**:
   * Start a chat with your newly created bot and say "Hello".
   * Search for `@userinfobot` in Telegram and start a chat to get your unique `Id` (e.g., `123456789`).

</details>

<details>
<summary><b>💻 2. Installation & First Run (PC/Mac)</b></summary>
<br>

1. **Download the Code**: Clone this repository or download the ZIP file and extract it.
2. **Open Terminal**: Open PowerShell, Command Prompt, or your OS terminal and navigate to the folder.
   ```bash
   cd path/to/whatsapp-tracker
   ```
3. **Install Dependencies**: Run the following command to download the required libraries:
   ```bash
   npm install
   ```
4. **Start the Bot**:
   ```bash
   node tracker.js
   ```
5. **Follow the On-Screen Prompts**: 
   * Enter the numbers you want to track (e.g., `919876543210`).
   * Paste your Telegram Token and Chat ID.
   * Choose to log in by scanning a **QR Code** or using an 8-digit **Pairing Code** via your phone's "Linked Devices" menu.

</details>

<details>
<summary><b>👻 3. Running Invisibly in the Background (PM2 for PC)</b></summary>
<br>

If you want the tracker to run 24/7 without keeping a terminal window open, use PM2 (a professional Node.js process manager).

**1. Install PM2 Globally:**
Open PowerShell/Command Prompt and run:
```bash
npm install pm2 -g
```

**2. Start the Bot in Background:**
Ensure you are in the `whatsapp-tracker` folder. 

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
<summary><b>📱 4. 24/7 Tracking on a Spare Android Phone (Free VPS Alternative)</b></summary>
<br>

Don't want to leave your PC on 24/7? You can run this bot entirely on an old or spare Android phone using **Termux**!

**1. Install Termux (Important):**
* Download Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or GitHub. *(Do NOT use the Google Play Store version, it is broken and deprecated).*

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
git clone [https://github.com/yourusername/whatsapp-tracker.git](https://github.com/yourusername/whatsapp-tracker.git)
cd whatsapp-tracker
npm install
node tracker.js
```
*(Tip: You can also install PM2 inside Termux using `npm install pm2 -g` just like on a PC!)*

</details>

<details>
<summary><b>🤖 5. Telegram Commands Cheat Sheet</b></summary>
<br>

Send any of these commands directly to your Telegram bot to manage your WhatsApp script remotely:

**🎯 Tracking Management**
* `/add <num>` - Start tracking a new number.
* `/remove <num>` - Stop tracking a number.
* `/status` - View the live status of all tracked numbers.
* `/summary <num>` - Get today's total online time for a specific number.

**🔕 Notifications & Data**
* `/mute <num>` - Stop Telegram alerts for a number (Excel tracking continues silently).
* `/unmute <num>` - Resume Telegram alerts.
* `/dnd <HH:MM> <HH:MM>` - Set quiet hours (e.g., `/dnd 22:00 08:00`).
* `/dnd off` - Disable quiet hours.
* `/export` - Download the latest Excel tracking report instantly.

**💬 Messaging**
* `/send <num> <msg>` - Send a new WhatsApp message.
* `/reply <ID> <msg>` - Reply to a specific message ID forwarded by the bot.
* `/markread <ID>` - Mark a message as read (applies blue ticks).
* `/schedule <mins> <num> <msg>` - Send a message after X minutes.
* `/broadcast <msg>` - Send a message to all tracked numbers at once.
* `/autoreply on <msg>` - Turn on a global away message (with 30-min anti-spam cooldown).
* `/autoreply off` - Disable the away message.

**⚙️ System**
* `/ping` - Check bot uptime and health.
* `/help` - View this list in Telegram.

</details>

<details>
<summary><b>💡 6. Troubleshooting & FAQ</b></summary>
<br>

* **The bot crashed with an Excel error!**
  * *Fix:* Do not open the `WhatsApp_Tracking_Report.xlsx` file in Microsoft Excel while the script is running. Excel locks the file, causing the bot to crash when it tries to save new data. Use the `/export` Telegram command instead to view the data safely!
* **The Pairing Code isn't working.**
  * *Fix:* Ensure you enter the exact phone number *of the account you are logging in with*, including the country code (e.g., `919876543210`), with no + signs or spaces.
* **My scheduled messages disappeared!**
  * *Fix:* Scheduled messages are saved to `schedule.json`. If you force-delete everything using the startup menu (Option 4), your scheduled messages will be wiped. Otherwise, they survive reboots safely.

</details>

---
<p align="center">Made with ❤️ from 🇮🇳
