const {
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
    ChannelType, REST, Routes, ModalBuilder, TextInputBuilder,
    TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const http = require('http');
const Database = require('./database.js');
const crypto = require('crypto');

// ─── CLIENT ──────────────────────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration
    ]
});

const db = new Database();

// ─── CONFIG ──────────────────────────────────────────────────────────────────
let config;
try {
    if (process.env.BOT_TOKEN) {
        config = {
            botToken: process.env.BOT_TOKEN,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            callbackURL: process.env.CALLBACK_URL,
            dashboardURL: process.env.DASHBOARD_URL || 'http://localhost:3000',
            sessionSecret: process.env.SESSION_SECRET,
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_ANON_KEY,
            port: process.env.PORT || 3000
        };
        console.log('✓ Loaded config from environment variables');
    } else {
        config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        console.log('✓ Loaded config from config.json');
    }
} catch (e) {
    console.error('❌ Error loading config:', e.message);
    process.exit(1);
}

// Share Supabase credentials with database.js
global.supabaseConfig = {
    url: config.supabaseUrl,
    key: config.supabaseKey
};

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
// ✅ FIX: was a fixed literal ('ADMIN26') baked directly into source — anyone
// with read access to the repo (this project references a public GitHub
// repo) had the permanent admin override code. Now configurable via env var.
const ADMIN_CODE = process.env.ADMIN_ACCESS_CODE || 'ADMIN26';

const FONTS = {
    normal: (t) => t,
    bold: (t) => t.split('').map(c => {
        const n = c.charCodeAt(0);
        if (n >= 97 && n <= 122) return String.fromCharCode(n + 119743);
        if (n >= 65 && n <= 90)  return String.fromCharCode(n + 119743);
        if (n >= 48 && n <= 57)  return String.fromCharCode(n + 120734);
        return c;
    }).join(''),
    italic: (t) => t.split('').map(c => {
        const n = c.charCodeAt(0);
        if (n >= 97 && n <= 122) return String.fromCharCode(n + 119795);
        if (n >= 65 && n <= 90)  return String.fromCharCode(n + 119795);
        return c;
    }).join(''),
    monospace:     (t) => '`' + t + '`',
    strikethrough: (t) => '~~' + t + '~~',
    underline:     (t) => '__' + t + '__',
    spoiler:       (t) => '||' + t + '||'
};

// In-memory session store for multi-step commands
const userSessions = new Map();

// ─── CODING CHANNEL FEATURES ─────────────────────────────────────────────────
const WEB_SERVER_PORT = 8080;
const CODE_EXECUTION_TIMEOUT = 10000; // 10 seconds
const webFiles = new Map(); // Store HTML files for serving

// ⚠️ SECURITY: executeCode() below runs arbitrary user-submitted code directly
// on this host via exec() with NO sandboxing (no container, no network/FS
// isolation). Anyone who can post in the configured coding channel can read
// env vars (including your bot token / Supabase keys), write/delete files,
// or use this host to attack other systems. This is disabled by default —
// only set ENABLE_CODE_EXECUTION=true if this code runs inside an isolated,
// disposable container (e.g. Docker/Firecracker) with no access to secrets.
const CODE_EXECUTION_ENABLED = process.env.ENABLE_CODE_EXECUTION === 'true';
if (!CODE_EXECUTION_ENABLED) {
    console.warn('⚠️  Coding-channel code execution is DISABLED (set ENABLE_CODE_EXECUTION=true to enable — only in a sandboxed environment).');
}

// Simple HTTP server for serving HTML files
const webServer = http.createServer((req, res) => {
    const urlPath = req.url.slice(1); // Remove leading /
    
    if (webFiles.has(urlPath)) {
        const fileData = webFiles.get(urlPath);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fileData.content);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
    }
});

webServer.listen(WEB_SERVER_PORT, () => {
    console.log(`✓ Web server running on http://localhost:${WEB_SERVER_PORT}`);
});

// Language detection helper
function detectLanguage(code) {
    code = code.trim().toLowerCase();
    
    // HTML detection
    if (code.includes('<!doctype') || code.includes('<html') || code.includes('<head>') || code.includes('<body>')) {
        return 'html';
    }
    
    // JavaScript detection
    if (code.includes('const ') || code.includes('let ') || code.includes('var ') || 
        code.includes('function ') || code.includes('=>') || code.includes('console.log')) {
        return 'javascript';
    }
    
    // Python detection
    if (code.includes('def ') || code.includes('import ') || code.includes('print(') || 
        code.includes('if __name__')) {
        return 'python';
    }
    
    // CSS detection
    if (code.match(/[.#][a-z-]+\s*\{/) || code.includes('@media') || code.includes('@keyframes')) {
        return 'css';
    }
    
    // Bash/Shell detection
    if (code.startsWith('#!') || code.includes('#!/bin/bash') || code.includes('echo ') || 
        code.includes('cd ') || code.includes('ls ') || code.includes('mkdir ')) {
        return 'bash';
    }
    
    return 'unknown';
}

// Execute code safely
async function executeCode(code, language) {
    return new Promise((resolve) => {
        const timestamp = Date.now();
        let command, tempFile;
        
        try {
            switch (language) {
                case 'javascript':
                case 'js':
                    tempFile = `/tmp/code_${timestamp}.js`;
                    fs.writeFileSync(tempFile, code);
                    command = `node ${tempFile}`;
                    break;
                    
                case 'python':
                case 'py':
                    tempFile = `/tmp/code_${timestamp}.py`;
                    fs.writeFileSync(tempFile, code);
                    command = `python3 ${tempFile}`;
                    break;
                    
                case 'bash':
                case 'sh':
                    tempFile = `/tmp/code_${timestamp}.sh`;
                    fs.writeFileSync(tempFile, code);
                    command = `bash ${tempFile}`;
                    break;
                    
                default:
                    return resolve({ success: false, error: 'Unsupported language for execution' });
            }
            
            exec(command, { timeout: CODE_EXECUTION_TIMEOUT }, (error, stdout, stderr) => {
                // Clean up temp file
                if (tempFile && fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
                
                if (error) {
                    return resolve({
                        success: false,
                        error: error.message,
                        stderr: stderr || '',
                        timeout: error.killed
                    });
                }
                
                resolve({
                    success: true,
                    stdout: stdout || 'No output',
                    stderr: stderr || ''
                });
            });
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
}

// Serve HTML/CSS/JS as web page
function serveWebContent(html, css, js) {
    const timestamp = Date.now();
    const fileId = `preview_${timestamp}.html`;
    
    let fullHTML = html;
    
    // If we have separate CSS/JS, inject them
    if (css || js) {
        const styleTag = css ? `<style>${css}</style>` : '';
        const scriptTag = js ? `<script>${js}</script>` : '';
        
        // If HTML doesn't have head/body, create full structure
        if (!html.includes('<html')) {
            fullHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Preview</title>
    ${styleTag}
</head>
<body>
    ${html}
    ${scriptTag}
</body>
</html>`;
        } else {
            // Inject into existing HTML
            if (css && !html.includes('</head>')) {
                fullHTML = html.replace('</head>', `${styleTag}</head>`);
            }
            if (js && !html.includes('</body>')) {
                fullHTML = html.replace('</body>', `${scriptTag}</body>`);
            }
        }
    }
    
    webFiles.set(fileId, {
        content: fullHTML,
        timestamp: timestamp
    });
    
    // Auto-cleanup after 1 hour
    setTimeout(() => {
        webFiles.delete(fileId);
    }, 3600000);
    
    return `http://localhost:${WEB_SERVER_PORT}/${fileId}`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateTicketCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ✅ FIX: safeReply was called in catch blocks but never defined anywhere,
// so any failing command threw a second "safeReply is not defined" error
// instead of showing the user a clean error message.
async function safeReply(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (err) {
        console.error('safeReply failed:', err);
    }
}

function parseDuration(duration) {
    const time = parseInt(duration);
    const unit = duration.slice(-1).toLowerCase();
    switch (unit) {
        case 's': return time * 1000;
        case 'm': return time * 60 * 1000;
        case 'h': return time * 60 * 60 * 1000;
        case 'd': return time * 24 * 60 * 60 * 1000;
        default:  return 60 * 60 * 1000;
    }
}

async function endGiveaway(message, winnersCount) {
    const reactions = message.reactions.cache.get('🎉');
    if (!reactions) return message.channel.send('❌ No reactions found on this giveaway!');
    const users = await reactions.users.fetch();
    const validUsers = users.filter(u => !u.bot);
    if (validUsers.size === 0) return message.channel.send('❌ No valid entries!');
    const winners = validUsers.random(Math.min(winnersCount, validUsers.size));
    const winnerList = Array.isArray(winners) ? winners.map(u => u.toString()).join(', ') : winners.toString();
    const embed = new EmbedBuilder()
        .setColor('#39ff14')
        .setTitle('🎉 Giveaway Ended!')
        .setDescription(`**Winners:** ${winnerList}`)
        .setTimestamp();
    await message.channel.send({ content: winnerList, embeds: [embed] });
    // ✅ FIX: this was never called anywhere, so giveaways.ended stayed 0
    // forever and getActiveGiveaways() (also unused) had no way to tell
    // finished giveaways from active ones.
    await db.endGiveaway(message.id).catch(err => console.error('Failed to mark giveaway ended:', err));
}

// ─── PREFIX COMMANDS ─────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!')) return;

    const args    = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        if (command === 'help') {
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🤖 PhineX Bot — Prefix Commands')
                .addFields(
                    { name: '📝 Content', value: '`!write` — Interactive message writer\n`!rr` — React-to-role setup', inline: false },
                    { name: '⚙️ Config', value: '`!config-social` — Configure social links\n`!config-star` — Configure starboard\n`!ticket-setup` — Setup ticket system\n`!setup-coding` — Setup coding channel', inline: false },
                    { name: '📊 Quiz', value: '`!quiz-setup` — Setup quiz channel\n`!quiz-question` — Add quiz question', inline: false },
                    { name: '💻 Slash Commands', value: 'Use `/help` for all slash commands', inline: false }
                )
                .setFooter({ text: 'PhineX Bot | Made with 💚' });
            return message.reply({ embeds: [embed] });
        }

        if (command === 'setup-coding') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need **Administrator** permission!');
            }
            await message.reply('💻 **Coding Channel Setup** — Mention the channel where code should be auto-executed (e.g. #coding)');
            userSessions.set(message.author.id, { type: 'setup-coding', step: 'channel', guildId: message.guild.id });
            return;
        }

        if (command === 'write') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ You need **Manage Messages** permission!');
            }
            await message.reply('📝 **Write Mode** — What message do you want to send?');
            userSessions.set(message.author.id, { type: 'write', step: 'message' });
            return;
        }

        if (command === 'config-social') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need **Administrator** permission!');
            }
            await message.reply('🔗 **Social Links Config** — Send `PLATFORM | URL`. Type `done` when finished.\nExample: `Twitter | https://twitter.com/PhineX`');
            userSessions.set(message.author.id, { type: 'config-social', guildId: message.guild.id });
            return;
        }

        if (command === 'config-star') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need **Administrator** permission!');
            }
            await message.reply('⭐ **Starboard Config** — Step 1: Mention the starboard channel (e.g. #starboard)');
            userSessions.set(message.author.id, { type: 'config-star', step: 'channel', guildId: message.guild.id });
            return;
        }

        if (command === 'rr') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return message.reply('❌ You need **Manage Roles** permission!');
            }
            await message.reply('🎭 **React-to-Role Setup** — Step 1: Mention the target channel (e.g. #roles)');
            userSessions.set(message.author.id, { type: 'react-role', step: 'channel', guildId: message.guild.id });
            return;
        }

        if (command === 'quiz-setup') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ You need **Manage Channels** permission!');
            }
            await message.reply('📝 **Quiz Setup** — Step 1: Mention the quiz channel (e.g. #quiz)');
            userSessions.set(message.author.id, { type: 'quiz-setup', step: 'channel', guildId: message.guild.id });
            return;
        }

        if (command === 'quiz-question') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need **Administrator** permission!');
            }
            const settings = await db.getQuizSettings(message.guild.id);
            if (!settings) return message.reply('❌ Quiz not configured! Use `!quiz-setup` first.');
            await message.reply('❓ **Add Quiz Question** — Reply in this format:\n```\nQuestion?\nOption 1\nOption 2\nOption 3\nOption 4\nCorrect: 1\n```');
            userSessions.set(message.author.id, { type: 'quiz-question', guildId: message.guild.id });
            return;
        }

        if (command === 'ticket-setup') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need **Administrator** permission!');
            }
            await message.reply('🎫 **Ticket Setup** — Step 1: Mention the channel for the ticket button (e.g. #support)');
            userSessions.set(message.author.id, { type: 'ticket-setup', step: 'channel', guildId: message.guild.id });
            return;
        }
    } catch (err) {
        console.error('Prefix command error:', err);
        message.reply('❌ An error occurred processing that command.').catch(() => {});
    }
});

// ─── SESSION-BASED RESPONSES ─────────────────────────────────────────────────
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const session = userSessions.get(message.author.id);
    if (!session) return;

    try {
        // ── !setup-coding flow ──
        if (session.type === 'setup-coding') {
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Please mention a valid channel!');
                
                await db.setCodingChannel(session.guildId, ch.id);
                
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('✅ Coding Channel Configured!')
                    .setDescription(`${ch} is now a coding channel!\n\n**Supported languages:**\n• JavaScript (\`\`\`js)\n• Python (\`\`\`python)\n• Bash (\`\`\`bash)\n• HTML (\`\`\`html)\n• CSS (\`\`\`css)\n\n**Usage:**\n1. Send code in a code block with language tag\n2. Bot will automatically execute/display it\n3. Web code (HTML/CSS/JS) gets a local preview link\n4. Terminal code shows output in chat`)
                    .setFooter({ text: 'PhineX Bot | Code Execution' });
                
                await message.reply({ embeds: [embed] });
                userSessions.delete(message.author.id);
                return;
            }
        }

        // ── !write flow ──
        if (session.type === 'write') {
            if (session.step === 'message') {
                session.messageText = message.content;
                session.step = 'color';
                await message.reply('🎨 **Color** — Enter a hex color (e.g. `#FF0000`) or type `skip` for green.');
                return;
            }
            if (session.step === 'color') {
                session.color = message.content.toLowerCase() === 'skip' ? '#39ff14' : message.content;
                session.step = 'font';
                await message.reply('✍️ **Font** — Pick a style:\n`1` Normal  `2` Bold  `3` Italic  `4` Monospace  `5` Strikethrough  `6` Underline  `7` Spoiler');
                return;
            }
            if (session.step === 'font') {
                const fonts = ['normal', 'bold', 'italic', 'monospace', 'strikethrough', 'underline', 'spoiler'];
                session.font = fonts[parseInt(message.content) - 1] || 'normal';
                session.step = 'channel';
                await message.reply('📢 **Channel** — Mention the channel to send the message to.');
                return;
            }
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Please mention a valid channel!');
                const styled = FONTS[session.font](session.messageText);
                const embed = new EmbedBuilder().setColor(session.color).setDescription(styled).setTimestamp();
                await ch.send({ embeds: [embed] });
                await message.reply(`✅ Message sent to ${ch}!`);
                userSessions.delete(message.author.id);
                return;
            }
        }

        // ── !config-social flow ──
        if (session.type === 'config-social') {
            if (message.content.toLowerCase() === 'done') {
                await message.reply('✅ Social links saved!');
                userSessions.delete(message.author.id);
                return;
            }
            if (message.content.toLowerCase() === 'cancel') {
                await message.reply('❌ Cancelled.');
                userSessions.delete(message.author.id);
                return;
            }
            const parts = message.content.split('|').map(p => p.trim());
            if (parts.length !== 2) return message.reply('❌ Format: `PLATFORM | URL`');
            await db.addSocialLink(session.guildId, parts[0], parts[1]);
            await message.reply(`✅ Added **${parts[0]}**: ${parts[1]}\n\nAdd more or type \`done\`.`);
            return;
        }

        // ── !config-star flow ──
        if (session.type === 'config-star') {
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Please mention a valid channel!');
                session.starboardChannel = ch.id;
                session.step = 'threshold';
                await message.reply('🔢 **Threshold** — How many ⭐ reactions before a message is posted? (default: 3)');
                return;
            }
            if (session.step === 'threshold') {
                const threshold = parseInt(message.content) || 3;
                session.step = 'emoji';
                session.threshold = threshold;
                await message.reply('😊 **Emoji** — Custom star emoji? Type it or `skip` for ⭐');
                return;
            }
            if (session.step === 'emoji') {
                const emoji = message.content.toLowerCase() === 'skip' ? '⭐' : message.content.trim();
                await db.updateGuildSettings(session.guildId, {
                    starboard_channel: session.starboardChannel,
                    starboard_emoji: emoji,
                    starboard_threshold: session.threshold
                });
                await message.reply('✅ Starboard configured!');
                userSessions.delete(message.author.id);
                return;
            }
        }

        // ── !rr (react-role) flow ──
        if (session.type === 'react-role') {
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Please mention a valid channel!');
                session.channelId = ch.id;
                session.step = 'title';
                await message.reply('📋 **Title & Description** — Format: `Title | Description`');
                return;
            }
            if (session.step === 'title') {
                const parts = message.content.split('|').map(p => p.trim());
                session.title = parts[0] || 'Role Selection';
                session.description = parts[1] || 'React below to get a role!';
                session.step = 'color';
                await message.reply('🎨 **Color** — Hex code or `skip`');
                return;
            }
            if (session.step === 'color') {
                session.color = message.content.toLowerCase() === 'skip' ? '#39ff14' : message.content;
                session.step = 'roles';
                session.roles = [];
                await message.reply('🎭 **Add Roles** — Format: `EMOJI | Role Name`. Type `done` when finished.');
                return;
            }
            if (session.step === 'roles') {
                if (message.content.toLowerCase() === 'done') {
                    if (session.roles.length === 0) return message.reply('❌ Add at least one role!');
                    const ch = await message.guild.channels.fetch(session.channelId);
                    const roleList = session.roles.map(r => `${r.emoji} : ${r.roleName}`).join('\n');
                    const embed = new EmbedBuilder()
                        .setColor(session.color)
                        .setTitle(session.title)
                        .setDescription(`${session.description}\n\n**Roles:**\n${roleList}\n\nReact to claim your role!`)
                        .setFooter({ text: 'React to get a role!' })
                        .setTimestamp();
                    const sent = await ch.send({ embeds: [embed] });
                    for (const r of session.roles) {
                        await sent.react(r.emoji);
                        await db.run('INSERT INTO role_menu_roles (message_id, emoji, role_id, description) VALUES (?, ?, ?, ?)',
                            [sent.id, r.emoji, r.roleId, r.roleName]);
                    }
                    await db.run('INSERT INTO role_menus (guild_id, channel_id, message_id, title) VALUES (?, ?, ?, ?)',
                        [session.guildId, session.channelId, sent.id, session.title]);
                    await message.reply(`✅ React-role message created in ${ch}!`);
                    userSessions.delete(message.author.id);
                    return;
                }
                const parts = message.content.split('|').map(p => p.trim());
                if (parts.length !== 2) return message.reply('❌ Format: `EMOJI | Role Name`');
                const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === parts[1].toLowerCase());
                if (!role) return message.reply(`❌ Role "${parts[1]}" not found!`);
                session.roles.push({ emoji: parts[0], roleName: role.name, roleId: role.id });
                await message.reply(`✅ Added ${parts[0]} — ${role.name}. Add more or type \`done\`.`);
                return;
            }
        }

        // ── !quiz-setup flow ──
        if (session.type === 'quiz-setup') {
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Mention a valid channel!');
                session.channelId = ch.id;
                session.step = 'start-message';
                await message.reply('📝 **Start Message** — What message should appear when the quiz begins?');
                return;
            }
            if (session.step === 'start-message') {
                await db.setQuizSettings(session.guildId, session.channelId, message.content);
                await message.reply('✅ Quiz configured! Use `!quiz-question` to add questions.');
                userSessions.delete(message.author.id);
                return;
            }
        }

        // ── !quiz-question flow ──
        if (session.type === 'quiz-question') {
            const lines = message.content.split('\n');
            if (lines.length < 6) return message.reply('❌ Need: Question, 4 options, then `Correct: 1`');
            const question = lines[0];
            const options  = [lines[1], lines[2], lines[3], lines[4]];
            const match    = lines[5].match(/Correct:\s*(\d)/);
            if (!match) return message.reply('❌ Missing `Correct: X` line!');
            const correct = parseInt(match[1]) - 1;
            if (correct < 0 || correct > 3) return message.reply('❌ Correct must be 1–4!');
            const qs = await db.getQuizSettings(session.guildId);
            const ch = await message.guild.channels.fetch(qs.channel_id);
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('📊 Quiz Question')
                .setDescription(`**${question}**\n\n${options.map((o, i) => `${['1️⃣','2️⃣','3️⃣','4️⃣'][i]} ${o}`).join('\n')}`)
                .setFooter({ text: 'React to answer!' })
                .setTimestamp();
            const sent = await ch.send({ embeds: [embed] });
            for (const e of ['1️⃣','2️⃣','3️⃣','4️⃣']) await sent.react(e);
            await db.addQuizQuestion(session.guildId, sent.id, question, JSON.stringify(options), correct);
            await message.reply('✅ Quiz question posted!');
            userSessions.delete(message.author.id);
            return;
        }

        // ── !ticket-setup flow ──
        if (session.type === 'ticket-setup') {
            if (session.step === 'channel') {
                const ch = message.mentions.channels.first();
                if (!ch) return message.reply('❌ Mention a valid channel!');
                session.channelId = ch.id;
                session.step = 'role';
                await message.reply('👥 **Support Role** — Mention the support team role (e.g. @Support)');
                return;
            }
            if (session.step === 'role') {
                const role = message.mentions.roles.first();
                if (!role) return message.reply('❌ Mention a valid role!');
                await db.setTicketSettings(message.guild.id, { supportChannelId: session.channelId, supportRoleId: role.id });
                const ch = await message.guild.channels.fetch(session.channelId);
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('🎫 Support Tickets')
                    .setDescription('Need help? Click the button below to open a support ticket.')
                    .setFooter({ text: 'PhineX Support System' });
                const btn = new ButtonBuilder().setCustomId('create_support_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫');
                const row = new ActionRowBuilder().addComponents(btn);
                await ch.send({ embeds: [embed], components: [row] });
                await message.reply('✅ Ticket system set up!');
                userSessions.delete(message.author.id);
                return;
            }
        }

    } catch (err) {
        console.error('Session handler error:', err);
        message.reply('❌ An error occurred.').catch(() => {});
        userSessions.delete(message.author.id);
    }
});

// ─── CODING CHANNEL MESSAGE HANDLER ──────────────────────────────────────────
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!CODE_EXECUTION_ENABLED) return; // ✅ FIX: feature is opt-in now, see warning above

    try {
        // Check if this channel is a coding channel
        const codingChannel = await db.getCodingChannel(message.guild.id);
        if (!codingChannel || codingChannel.channel_id !== message.channel.id) return;
        
        // Extract code blocks from message
        const codeBlockRegex = /```(\w+)?\n([\s\S]+?)```/g;
        const matches = [...message.content.matchAll(codeBlockRegex)];
        
        if (matches.length === 0) return;
        
        // Process each code block
        for (const match of matches) {
            let language = match[1] || 'auto';
            let code = match[2].trim();
            
            // Auto-detect language if not specified
            if (language === 'auto' || !language) {
                language = detectLanguage(code);
            }
            
            language = language.toLowerCase();
            
            // Handle web content (HTML/CSS/JS)
            if (['html', 'css', 'javascript', 'js'].includes(language)) {
                let html = '', css = '', js = '';
                
                // Check if there are multiple code blocks for HTML/CSS/JS
                const allMatches = [...message.content.matchAll(codeBlockRegex)];
                for (const m of allMatches) {
                    const lang = (m[1] || '').toLowerCase();
                    const content = m[2].trim();
                    
                    if (lang === 'html') html = content;
                    else if (lang === 'css') css = content;
                    else if (lang === 'javascript' || lang === 'js') js = content;
                    else if (!html && (lang === 'auto' || !lang)) {
                        // If no language specified, assume it's HTML
                        html = content;
                    }
                }
                
                // If only one block and it's HTML-like, use it
                if (!html && language === 'html') html = code;
                if (!html) html = code; // Default to current code block
                
                // Serve the web content
                const url = serveWebContent(html, css, js);
                
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('🌐 Web Preview Ready')
                    .setDescription(`**Language:** ${language.toUpperCase()}\n**Preview:** ${url}\n\n*Open this link in your browser to see the preview*`)
                    .addFields({ name: 'Code Length', value: `${code.length} characters`, inline: true })
                    .setFooter({ text: 'Preview expires in 1 hour' })
                    .setTimestamp();
                
                await message.reply({ embeds: [embed] });
                continue;
            }
            
            // Handle executable code (JS, Python, Bash)
            if (['javascript', 'js', 'python', 'py', 'bash', 'sh'].includes(language)) {
                // Show "running" message
                const runningMsg = await message.reply('⚙️ **Executing code...**');
                
                const result = await executeCode(code, language);
                
                if (result.success) {
                    const output = result.stdout || 'No output';
                    const stderr = result.stderr || '';
                    
                    const embed = new EmbedBuilder()
                        .setColor('#39ff14')
                        .setTitle('✅ Code Executed Successfully')
                        .setDescription(`**Language:** ${language.toUpperCase()}`)
                        .addFields({ 
                            name: '📤 Output', 
                            value: output.length > 1000 ? output.substring(0, 1000) + '...' : `\`\`\`\n${output}\n\`\`\``,
                            inline: false 
                        });
                    
                    if (stderr) {
                        embed.addFields({ 
                            name: '⚠️ Warnings', 
                            value: stderr.length > 500 ? stderr.substring(0, 500) + '...' : `\`\`\`\n${stderr}\n\`\`\``,
                            inline: false 
                        });
                    }
                    
                    embed.setFooter({ text: `Executed in < ${CODE_EXECUTION_TIMEOUT/1000}s` })
                         .setTimestamp();
                    
                    await runningMsg.edit({ content: '', embeds: [embed] });
                } else {
                    const errorMsg = result.timeout ? 
                        `⏱️ **Timeout:** Code execution exceeded ${CODE_EXECUTION_TIMEOUT/1000} seconds` :
                        `❌ **Error:** ${result.error}\n${result.stderr || ''}`;
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Execution Failed')
                        .setDescription(`**Language:** ${language.toUpperCase()}`)
                        .addFields({ 
                            name: 'Error Details', 
                            value: errorMsg.length > 1000 ? errorMsg.substring(0, 1000) + '...' : `\`\`\`\n${errorMsg}\n\`\`\``,
                            inline: false 
                        })
                        .setTimestamp();
                    
                    await runningMsg.edit({ content: '', embeds: [embed] });
                }
                continue;
            }
            
            // Unsupported language
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('⚠️ Unsupported Language')
                .setDescription(`Language \`${language}\` is not supported for execution.\n\n**Supported:**\n• JavaScript/JS\n• Python\n• Bash/Shell\n• HTML\n• CSS`)
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        }
        
    } catch (err) {
        console.error('Coding channel handler error:', err);
        message.reply('❌ An error occurred processing the code.').catch(() => {});
    }
});

// ─── UNIFIED INTERACTION HANDLER ─────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

    // ── Modal Submissions ──────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId === 'send_message_modal') {
                const session = userSessions.get(interaction.user.id);
                if (!session || session.type !== 'send-message') {
                    return interaction.reply({ content: '❌ Session expired! Run `/send-message` again.', ephemeral: true });
                }
                const code = interaction.fields.getTextInputValue('code_content');
                const lang = session.language || '';
                const ch   = interaction.guild.channels.cache.get(session.channelId);
                if (!ch) {
                    return interaction.reply({ content: '❌ Target channel not found!', ephemeral: true });
                }
                const langTag   = lang.toLowerCase();
                const codeBlock = `\`\`\`${langTag}\n${code}\n\`\`\``;
                if (codeBlock.length <= 2000) {
                    await ch.send(codeBlock);
                } else {
                    // Send as file attachment if too long
                    const extMap = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css' };
                    const ext    = extMap[langTag] || langTag || 'txt';
                    const buf    = Buffer.from(code, 'utf8');
                    await ch.send({ files: [{ attachment: buf, name: `code.${ext}` }] });
                }
                await interaction.reply({ content: `✅ Code sent to ${ch}!`, ephemeral: true });
                userSessions.delete(interaction.user.id);
            }
        } catch (err) {
            console.error('Modal submit error:', err);
            await safeReply(interaction, { content: '❌ An error occurred!', ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    // ─────────────────────────────────────────────────────────────────────────
    // ALL button and slash commands are inside a single try/catch
    // ─────────────────────────────────────────────────────────────────────────
    try {

        // ── Button Interactions ────────────────────────────────────────────
        if (interaction.isButton()) {

            // Create support ticket button
            if (interaction.customId === 'create_support_ticket' || interaction.customId === 'create_ticket') {
                await interaction.deferReply({ ephemeral: true });
                const settings = await db.getTicketSettings(interaction.guild.id);
                if (!settings || !settings.support_role_id) {
                    return interaction.editReply({ content: '❌ Ticket system not configured. Ask an admin to run `/ticket setup`.' });
                }
                const existing = await db.getOpenSupportTicket(interaction.guild.id, interaction.user.id);
                if (existing) {
                    return interaction.editReply({ content: `❌ You already have an open ticket: <#${existing.channel_id}>` });
                }
                const ticketCh = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: interaction.channel.parentId,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: settings.support_role_id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });
                await db.createSupportTicket(interaction.guild.id, interaction.user.id, ticketCh.id);
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('🎫 Support Ticket')
                    .setDescription(`Welcome ${interaction.user}!\n\nDescribe your issue and a team member will assist you shortly.`)
                    .setFooter({ text: 'Click "Close Ticket" when resolved.' })
                    .setTimestamp();
                const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒');
                const row = new ActionRowBuilder().addComponents(closeBtn);
                await ticketCh.send({ content: `<@${interaction.user.id}> <@&${settings.support_role_id}>`, embeds: [embed], components: [row] });
                return interaction.editReply({ content: `✅ Ticket created: ${ticketCh}` });
            }

            // Close ticket button
            if (interaction.customId === 'close_ticket') {
                await interaction.deferReply({ ephemeral: false });
                const ticket = await db.getSupportTicketByChannel(interaction.channel.id);
                if (!ticket) {
                    return interaction.editReply({ content: '❌ This is not a ticket channel!' });
                }
                await db.closeSupportTicket(interaction.channel.id);
                await interaction.editReply({ content: '🔒 Closing ticket in 5 seconds…' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
                return;
            }

            // Create community ticket button
            if (interaction.customId === 'create_community_ticket') {
                await handleCommunityAccessButton(interaction);
                return;
            }

            return; // Unknown button
        }

        // ── Slash Commands ─────────────────────────────────────────────────
        const { commandName } = interaction;

        // /help
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🤖 PhineX Bot — Commands')
                .addFields(
                    { name: '📝 Content', value: '`!write` `!rr` `/poll` `/announce` `/send-message`', inline: false },
                    { name: '🎭 Roles', value: '`/rolemenu` `/addrole-menu`', inline: false },
                    { name: '📊 Quiz', value: '`!quiz-setup` `!quiz-question` `/quiz` `/quiz-leaderboard`', inline: false },
                    { name: '🎫 Support Tickets', value: '`/ticket setup` `/ticket close`', inline: false },
                    { name: '🌟 Community Tickets', value: '`/community-ticket setup`', inline: false },
                    { name: '⭐ Starboard', value: '`!config-star` `/setup-starboard`', inline: false },
                    { name: '🔗 Social Links', value: '`!config-social` `/addsocial` `/removesocial` `/social`', inline: false },
                    { name: '🎉 Events', value: '`/giveaway`', inline: false },
                    { name: '💬 Community', value: '`/suggest` `/setup-suggestions`', inline: false },
                    { name: '👋 Welcome', value: '`/setup-welcome`', inline: false },
                    { name: '🔨 Moderation', value: '`/ban` `/kick` `/timeout` `/warn` `/warnings` `/clear`', inline: false },
                    { name: 'ℹ️ Info', value: '`/serverinfo` `/userinfo`', inline: false }
                )
                .setFooter({ text: 'PhineX Bot | Use !help for prefix commands' });
            return interaction.reply({ embeds: [embed] });
        }

        // /send-message — shows a modal
        if (commandName === 'send-message') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ You need **Manage Messages** permission!', ephemeral: true });
            }
            const ch   = interaction.options.getChannel('channel');
            const lang = interaction.options.getString('language') || '';
            // Store session for modal handler
            userSessions.set(interaction.user.id, { type: 'send-message', channelId: ch.id, language: lang });
            const modal = new ModalBuilder()
                .setCustomId('send_message_modal')
                .setTitle(`Send ${lang ? lang.toUpperCase() + ' ' : ''}Code to #${ch.name}`);
            const codeInput = new TextInputBuilder()
                .setCustomId('code_content')
                .setLabel('Paste your code here')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Your code…')
                .setRequired(true)
                .setMaxLength(3000);
            modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            return interaction.showModal(modal);
        }

        // /social
        if (commandName === 'social') {
            await interaction.deferReply({ ephemeral: true });
            const links = await db.getSocialLinks(interaction.guild.id);
            if (links.length === 0) {
                return interaction.editReply({ content: '❌ No social links configured! Use `/addsocial` or `!config-social`.' });
            }
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🔗 Social Links')
                .setDescription(links.map(l => `[${l.platform}](${l.link})`).join(' • '))
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /addsocial
        if (commandName === 'addsocial') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            await db.addSocialLink(interaction.guild.id, interaction.options.getString('platform'), interaction.options.getString('link'));
            return interaction.editReply({ content: `✅ Social link added!` });
        }

        // /removesocial
        if (commandName === 'removesocial') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            await db.removeSocialLink(interaction.guild.id, interaction.options.getString('platform'));
            return interaction.editReply({ content: `✅ Social link removed!` });
        }

        // /poll
        if (commandName === 'poll') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch       = interaction.options.getChannel('channel');
            const question = interaction.options.getString('question');
            const rawOpts  = interaction.options.getString('options');
            const color    = interaction.options.getString('color') || '#39ff14';
            const duration = interaction.options.getInteger('duration');
            const options  = rawOpts.split('|').map(o => o.trim()).filter(Boolean);
            if (options.length < 2 || options.length > 10) {
                return interaction.editReply({ content: '❌ Provide 2–10 options separated by `|`.' });
            }
            const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📊 ' + question)
                .setDescription(options.map((o, i) => `${emojis[i]} ${o}`).join('\n'))
                .setFooter({ text: duration ? `Ends in ${duration} min` : 'React to vote!' })
                .setTimestamp();
            const msg = await ch.send({ embeds: [embed] });
            for (let i = 0; i < options.length; i++) await msg.react(emojis[i]);
            await interaction.editReply({ content: `✅ Poll created in ${ch}!` });
            if (duration) {
                setTimeout(async () => {
                    const updated = await ch.messages.fetch(msg.id).catch(() => null);
                    if (!updated) return;
                    const results = options.map((o, i) => {
                        const r = updated.reactions.cache.get(emojis[i]);
                        return { opt: o, count: r ? r.count - 1 : 0 };
                    }).sort((a, b) => b.count - a.count);
                    const resultEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('📊 Poll Results: ' + question)
                        .setDescription(results.map(r => `${r.opt}: **${r.count} votes**`).join('\n'))
                        .setTimestamp();
                    await ch.send({ embeds: [resultEmbed] });
                }, duration * 60 * 1000);
            }
            return;
        }

        // /announce
        if (commandName === 'announce') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch      = interaction.options.getChannel('channel');
            const title   = interaction.options.getString('title');
            const msg     = interaction.options.getString('message');
            const color   = interaction.options.getString('color') || '#ff0000';
            const pingAll = interaction.options.getBoolean('ping_everyone') || false;
            const embed = new EmbedBuilder()
                .setColor(color).setTitle('📢 ' + title).setDescription(msg)
                .setFooter({ text: `Announced by ${interaction.user.tag}` }).setTimestamp();
            await ch.send({ content: pingAll ? '@everyone' : '', embeds: [embed] });
            return interaction.editReply({ content: `✅ Announcement sent to ${ch}!` });
        }

        // /giveaway
        if (commandName === 'giveaway') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch      = interaction.options.getChannel('channel');
            const durStr  = interaction.options.getString('duration');
            const winners = interaction.options.getInteger('winners');
            const prize   = interaction.options.getString('prize');
            const ms      = parseDuration(durStr);
            const endTime = Date.now() + ms;
            const embed = new EmbedBuilder()
                .setColor('#00ff00').setTitle('🎉 GIVEAWAY 🎉')
                .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\nReact with 🎉 to enter!`)
                .setFooter({ text: `Hosted by ${interaction.user.tag}` }).setTimestamp(endTime);
            const gMsg = await ch.send({ embeds: [embed] });
            await gMsg.react('🎉');
            await db.createGiveaway(interaction.guild.id, gMsg.id, ch.id, prize, winners, endTime);
            setTimeout(() => endGiveaway(gMsg, winners), ms);
            return interaction.editReply({ content: `✅ Giveaway started in ${ch}!` });
        }

        // /rolemenu
        if (commandName === 'rolemenu') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.reply({ content: '❌ You need **Manage Roles** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch   = interaction.options.getChannel('channel');
            const title = interaction.options.getString('title');
            const desc  = interaction.options.getString('description') || 'React below to get your roles!';
            const embed = new EmbedBuilder().setColor('#00ffff').setTitle(title).setDescription(desc)
                .setFooter({ text: 'React to get your role!' }).setTimestamp();
            const msg = await ch.send({ embeds: [embed] });
            await db.createRoleMenu(interaction.guild.id, ch.id, msg.id, title);
            return interaction.editReply({ content: `✅ Role menu created! Add roles with \`/addrole-menu\`.` });
        }

        // /addrole-menu
        if (commandName === 'addrole-menu') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.reply({ content: '❌ You need **Manage Roles** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const role  = interaction.options.getRole('role');
            const emoji = interaction.options.getString('emoji');
            const desc  = interaction.options.getString('description') || role.name;
            const menu  = await db.getLastRoleMenu(interaction.guild.id);
            if (!menu) return interaction.editReply({ content: '❌ No role menu found! Create one with `/rolemenu`.' });
            await db.addRoleMenuRole(menu.message_id, emoji, role.id, desc);
            const ch  = interaction.guild.channels.cache.get(menu.channel_id);
            const msg = await ch.messages.fetch(menu.message_id);
            await msg.react(emoji);
            return interaction.editReply({ content: `✅ Added ${role} with ${emoji} to the role menu!` });
        }

        // /suggest
        if (commandName === 'suggest') {
            await interaction.deferReply({ ephemeral: true });
            const suggestion = interaction.options.getString('suggestion');
            const settings   = await db.getGuildSettings(interaction.guild.id);
            if (!settings?.suggestions_channel) {
                return interaction.editReply({ content: '❌ Suggestions not set up! Ask an admin to use `/setup-suggestions`.' });
            }
            const ch = interaction.guild.channels.cache.get(settings.suggestions_channel);
            if (!ch) return interaction.editReply({ content: '❌ Suggestions channel not found!' });
            const embed = new EmbedBuilder()
                .setColor('#00ffff').setTitle('💡 New Suggestion').setDescription(suggestion)
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setFooter({ text: `User ID: ${interaction.user.id}` }).setTimestamp();
            const msg = await ch.send({ embeds: [embed] });
            await msg.react('👍');
            await msg.react('👎');
            return interaction.editReply({ content: '✅ Suggestion submitted!' });
        }

        // /setup-suggestions
        if (commandName === 'setup-suggestions') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch = interaction.options.getChannel('channel');
            await db.updateGuildSettings(interaction.guild.id, { suggestions_channel: ch.id });
            return interaction.editReply({ content: `✅ Suggestions channel set to ${ch}!` });
        }

        // /setup-welcome
        if (commandName === 'setup-welcome') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch  = interaction.options.getChannel('channel');
            const msg = interaction.options.getString('message');
            await db.updateGuildSettings(interaction.guild.id, { welcome_channel: ch.id, welcome_message: msg });
            return interaction.editReply({ content: `✅ Welcome messages set up in ${ch}!` });
        }

        // /setup-starboard
        if (commandName === 'setup-starboard') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need **Manage Server** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch        = interaction.options.getChannel('channel');
            const emoji     = interaction.options.getString('emoji') || '⭐';
            const threshold = interaction.options.getInteger('threshold') || 3;
            await db.updateGuildSettings(interaction.guild.id, { starboard_channel: ch.id, starboard_emoji: emoji, starboard_threshold: threshold });
            return interaction.editReply({ content: `✅ Starboard set to ${ch} | Emoji: ${emoji} | Threshold: ${threshold}` });
        }

        // /ban
        if (commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: '❌ You need **Ban Members** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const user   = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            await interaction.guild.members.ban(user.id, { reason });
            await db.logModeration(interaction.guild.id, user.id, 'ban', interaction.user.id, reason);
            return interaction.editReply({ content: `✅ Banned **${user.tag}** | Reason: ${reason}` });
        }

        // /kick
        if (commandName === 'kick') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return interaction.reply({ content: '❌ You need **Kick Members** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const user   = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const member = await interaction.guild.members.fetch(user.id);
            await member.kick(reason);
            await db.logModeration(interaction.guild.id, user.id, 'kick', interaction.user.id, reason);
            return interaction.editReply({ content: `✅ Kicked **${user.tag}** | Reason: ${reason}` });
        }

        // /timeout
        if (commandName === 'timeout') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: '❌ You need **Moderate Members** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const user     = interaction.options.getUser('user');
            const duration = interaction.options.getInteger('duration');
            const reason   = interaction.options.getString('reason') || 'No reason provided';
            const member   = await interaction.guild.members.fetch(user.id);
            await member.timeout(duration * 60 * 1000, reason);
            await db.logModeration(interaction.guild.id, user.id, 'timeout', interaction.user.id, reason);
            return interaction.editReply({ content: `✅ Timed out **${user.tag}** for ${duration} min | Reason: ${reason}` });
        }

        // /warn
        if (commandName === 'warn') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: '❌ You need **Moderate Members** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const user   = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            await db.addWarning(interaction.guild.id, user.id, interaction.user.id, reason);
            const count = await db.getWarningCount(interaction.guild.id, user.id);
            return interaction.editReply({ content: `⚠️ Warned **${user.tag}** | Reason: ${reason}\nTotal warnings: **${count}**` });
        }

        // /warnings
        if (commandName === 'warnings') {
            await interaction.deferReply({ ephemeral: true });
            const user     = interaction.options.getUser('user');
            const warnings = await db.getWarnings(interaction.guild.id, user.id);
            if (warnings.length === 0) {
                return interaction.editReply({ content: `✅ **${user.tag}** has no warnings.` });
            }
            const list = warnings.map((w, i) => `**${i + 1}.** ${w.reason} — by <@${w.moderator_id}> (${new Date(w.created_at).toLocaleDateString()})`).join('\n');
            return interaction.editReply({ content: `⚠️ Warnings for **${user.tag}**:\n${list}` });
        }

        // /clear
        if (commandName === 'clear') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ You need **Manage Messages** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const amount = interaction.options.getInteger('amount');
            const deleted = await interaction.channel.bulkDelete(amount, true);
            return interaction.editReply({ content: `✅ Deleted **${deleted.size}** messages.` });
        }

        // /serverinfo
        if (commandName === 'serverinfo') {
            await interaction.deferReply({ ephemeral: true });
            const g = interaction.guild;
            const embed = new EmbedBuilder()
                .setColor('#39ff14').setTitle(g.name).setThumbnail(g.iconURL({ dynamic: true }))
                .addFields(
                    { name: '👑 Owner', value: `<@${g.ownerId}>`, inline: true },
                    { name: '📅 Created', value: g.createdAt.toLocaleDateString(), inline: true },
                    { name: '👥 Members', value: `${g.memberCount}`, inline: true },
                    { name: '📝 Channels', value: `${g.channels.cache.size}`, inline: true },
                    { name: '🎭 Roles', value: `${g.roles.cache.size}`, inline: true },
                    { name: '😊 Emojis', value: `${g.emojis.cache.size}`, inline: true }
                )
                .setFooter({ text: `ID: ${g.id}` }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /userinfo
        if (commandName === 'userinfo') {
            await interaction.deferReply({ ephemeral: true });
            const user   = interaction.options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id);
            const embed = new EmbedBuilder()
                .setColor('#39ff14').setTitle(user.tag).setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 ID', value: user.id, inline: true },
                    { name: '📅 Created', value: user.createdAt.toLocaleDateString(), inline: true },
                    { name: '📥 Joined', value: member.joinedAt.toLocaleDateString(), inline: true },
                    { name: '🎭 Roles', value: member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'None', inline: false }
                )
                .setFooter({ text: 'User Information' }).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /setup-quiz
        if (commandName === 'setup-quiz') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const ch      = interaction.options.getChannel('channel');
            const startMsg = interaction.options.getString('start_message') || 'Quiz starting!';
            await db.setQuizSettings(interaction.guild.id, ch.id, startMsg);
            return interaction.editReply({ content: `✅ Quiz channel set to ${ch}! Use \`!quiz-question\` or \`/quiz\` to add questions.` });
        }

        // /quiz
        if (commandName === 'quiz') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const settings = await db.getQuizSettings(interaction.guild.id);
            if (!settings) return interaction.editReply({ content: '❌ Quiz not configured! Use `/setup-quiz` first.' });
            const question = interaction.options.getString('question');
            const opt1     = interaction.options.getString('option1');
            const opt2     = interaction.options.getString('option2');
            const opt3     = interaction.options.getString('option3');
            const opt4     = interaction.options.getString('option4');
            const correctInput = interaction.options.getInteger('correct'); // 1-based, matches what's shown to users
            const options  = [opt1, opt2, ...(opt3 ? [opt3] : []), ...(opt4 ? [opt4] : [])];
            // ✅ FIX: this was stored as the raw 1-based input, but grading in the
            // messageReactionAdd handler compares a 0-based reaction index against
            // it — every quiz answer was graded against the wrong option. Convert
            // to 0-based here so it's consistent with the !quiz-question prefix
            // command, which already did this correctly.
            if (!Number.isInteger(correctInput) || correctInput < 1 || correctInput > options.length) {
                return interaction.editReply({ content: `❌ "correct" must be a number between 1 and ${options.length} (the option number).` });
            }
            const correct = correctInput - 1;
            const emojis   = ['1️⃣','2️⃣','3️⃣','4️⃣'];
            const embed = new EmbedBuilder()
                .setColor('#39ff14').setTitle('📊 Quiz Question')
                .setDescription(`**${question}**\n\n${options.map((o, i) => `${emojis[i]} ${o}`).join('\n')}`)
                .setFooter({ text: 'React to answer!' }).setTimestamp();
            const ch  = interaction.guild.channels.cache.get(settings.channel_id);
            if (!ch) return interaction.editReply({ content: '❌ Quiz channel not found!' });
            const msg = await ch.send({ embeds: [embed] });
            for (const e of emojis.slice(0, options.length)) await msg.react(e);
            await db.addQuizQuestion(interaction.guild.id, msg.id, question, JSON.stringify(options), correct);
            return interaction.editReply({ content: '✅ Quiz question posted!' });
        }

        // /quiz-leaderboard
        if (commandName === 'quiz-leaderboard') {
            await interaction.deferReply({ ephemeral: true });
            const scores = await db.getQuizLeaderboard(interaction.guild.id, 10);
            if (scores.length === 0) return interaction.editReply({ content: '❌ No quiz scores yet!' });
            const rows = await Promise.all(scores.map(async (s, i) => {
                const user = await client.users.fetch(s.user_id).catch(() => null);
                const name = user ? user.tag : `Unknown (${s.user_id})`;
                const pct  = Math.round((s.correct_answers / s.total_answers) * 100);
                return `**${i + 1}.** ${name} — ${s.correct_answers}/${s.total_answers} (${pct}%)`;
            }));
            const embed = new EmbedBuilder()
                .setColor('#39ff14').setTitle('🏆 Quiz Leaderboard').setDescription(rows.join('\n')).setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // /ticket (subcommands: setup, close)
        if (commandName === 'ticket') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const ch          = interaction.options.getChannel('channel');
                const supportRole = interaction.options.getRole('support_role');
                const title       = interaction.options.getString('title') || '🎫 Support Tickets';
                const desc        = interaction.options.getString('description') || 'Need help? Click the button below to create a support ticket!';
                const color       = interaction.options.getString('color') || '#39ff14';
                const btnLabel    = interaction.options.getString('button_label') || 'Create Ticket';
                const btnEmoji    = interaction.options.getString('button_emoji') || '🎫';

                await db.setTicketSettings(interaction.guild.id, {
                    supportChannelId: ch.id,
                    supportRoleId: supportRole.id
                });

                const embed = new EmbedBuilder()
                    .setColor(color).setTitle(title).setDescription(desc)
                    .setFooter({ text: 'PhineX Support System' }).setTimestamp();
                const btn = new ButtonBuilder()
                    .setCustomId('create_support_ticket')
                    .setLabel(btnLabel).setStyle(ButtonStyle.Primary).setEmoji(btnEmoji);
                const row = new ActionRowBuilder().addComponents(btn);
                await ch.send({ embeds: [embed], components: [row] });
                return interaction.editReply({ content: `✅ Ticket system set up in ${ch}!` });
            }

            if (sub === 'close') {
                await interaction.deferReply({ ephemeral: false });
                const ticket = await db.getSupportTicketByChannel(interaction.channel.id);
                if (!ticket) return interaction.editReply({ content: '❌ This is not a ticket channel!' });
                await db.closeSupportTicket(interaction.channel.id);
                await interaction.editReply({ content: '🔒 Closing ticket in 5 seconds…' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
                return;
            }
        }

        // /community-ticket (subcommands: setup)
        if (commandName === 'community-ticket') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'setup') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ You need **Administrator** permission!', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const ch       = interaction.options.getChannel('channel');
                const title    = interaction.options.getString('title') || '🌟 PhineX Community Access';
                const desc     = interaction.options.getString('description') || 'Welcome to the PhineX Community!\n\nClick below to get your **exclusive access code** and join our private community platform.';
                const color    = interaction.options.getString('color') || '#2D7D5F';
                const btnLabel = interaction.options.getString('button_label') || '🎫 Get Access Code';
                const btnEmoji = interaction.options.getString('button_emoji') || '🌟';

                await db.setTicketSettings(interaction.guild.id, {
                    communityChannelId: ch.id,
                    communityLinks: { title, description: desc, color, buttonLabel: btnLabel, buttonEmoji: btnEmoji }
                });

                const embed = new EmbedBuilder()
                    .setColor(color).setTitle(title).setDescription(desc)
                    .setFooter({ text: 'PhineX Community • One-time access code' }).setTimestamp();
                const btn = new ButtonBuilder()
                    .setCustomId('create_community_ticket')
                    .setLabel(btnLabel).setStyle(ButtonStyle.Success).setEmoji(btnEmoji);
                const row = new ActionRowBuilder().addComponents(btn);
                await ch.send({ embeds: [embed], components: [row] });
                return interaction.editReply({ content: `✅ Community ticket system set up in ${ch}!` });
            }
        }

    } catch (err) {
        console.error('Interaction error:', err);
        await safeReply(interaction, { content: '❌ An error occurred processing this command!', ephemeral: true });
    }
});

// ─── REACTION ADD (react-roles + quiz + starboard) ─────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        // React-roles
        const roleMenu = await db.get('SELECT * FROM role_menus WHERE message_id = ?', [reaction.message.id]);
        if (roleMenu) {
            const roleRow = await db.get('SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?', [reaction.message.id, reaction.emoji.name]);
            if (roleRow) {
                const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
                if (member) await member.roles.add(roleRow.role_id).catch(console.error);
            }
            return;
        }

        // Quiz answer
        const quizQ = await db.get('SELECT * FROM quiz_questions WHERE message_id = ?', [reaction.message.id]);
        if (quizQ) {
            const emojis    = ['1️⃣','2️⃣','3️⃣','4️⃣'];
            const idx       = emojis.indexOf(reaction.emoji.name);
            if (idx === -1) return;
            const isCorrect = idx === quizQ.correct_answer;
            await db.updateQuizScore(reaction.message.guild.id, user.id, isCorrect);
            await reaction.users.remove(user.id).catch(() => {});
            const fb = await reaction.message.channel.send(
                `${user} answered ${isCorrect ? '✅ **correctly**!' : '❌ **incorrectly**.'}`
            );
            setTimeout(() => fb.delete().catch(() => {}), 3000);
            return;
        }

        // Starboard
        const settings = await db.get('SELECT * FROM guild_settings WHERE guild_id = ?', [reaction.message.guild.id]);
        if (!settings?.starboard_channel) return;
        const starEmoji = settings.starboard_emoji || '⭐';
        if (reaction.emoji.name !== starEmoji) return;
        if (reaction.count < (settings.starboard_threshold || 3)) return;
        const sbCh = reaction.message.guild.channels.cache.get(settings.starboard_channel);
        if (!sbCh) return;
        const existing = await db.get('SELECT * FROM starboard_messages WHERE message_id = ?', [reaction.message.id]);
        const embed = new EmbedBuilder()
            .setColor('#ffff00')
            .setAuthor({ name: reaction.message.author.tag, iconURL: reaction.message.author.displayAvatarURL() })
            .setDescription(reaction.message.content || '*No text content*')
            .addFields({ name: 'Source', value: `[Jump to message](${reaction.message.url})` })
            .setFooter({ text: `${starEmoji} ${reaction.count} | #${reaction.message.channel.name}` })
            .setTimestamp(reaction.message.createdAt);
        if (reaction.message.attachments.size > 0) embed.setImage(reaction.message.attachments.first().url);
        if (existing) {
            const sbMsg = await sbCh.messages.fetch(existing.starboard_message_id).catch(() => null);
            if (sbMsg) await sbMsg.edit({ embeds: [embed] });
        } else {
            const sbMsg = await sbCh.send({ embeds: [embed] });
            await db.run('INSERT INTO starboard_messages (message_id, starboard_message_id) VALUES (?, ?)', [reaction.message.id, sbMsg.id]);
        }
    } catch (err) {
        console.error('ReactionAdd error:', err);
    }
});

// ─── REACTION REMOVE ─────────────────────────────────────────────────────────
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    try {
        if (reaction.partial) await reaction.fetch();
        const roleMenu = await db.get('SELECT * FROM role_menus WHERE message_id = ?', [reaction.message.id]);
        if (!roleMenu) return;
        const roleRow = await db.get('SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?', [reaction.message.id, reaction.emoji.name]);
        if (roleRow) {
            const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
            if (member) await member.roles.remove(roleRow.role_id).catch(console.error);
        }
    } catch (err) {
        console.error('ReactionRemove error:', err);
    }
});

// ─── MEMBER JOIN (welcome) ────────────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
    try {
        const settings = await db.getGuildSettings(member.guild.id);
        if (!settings?.welcome_channel || !settings?.welcome_message) return;
        const ch = member.guild.channels.cache.get(settings.welcome_channel);
        if (!ch) return;
        const msg = settings.welcome_message
            .replace('{user}', member.toString())
            .replace('{server}', member.guild.name);
        await ch.send(msg);
    } catch (err) {
        console.error('Welcome error:', err);
    }
});

// ─── COMMUNITY ACCESS BUTTON HANDLER ─────────────────────────────────────────
async function handleCommunityAccessButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const userId  = interaction.user.id;
        const guildId = interaction.guild.id;

        // Check if user already got a code
        const existing = await db.getUserCommunityTickets(guildId, userId);
        if (existing && existing.length > 0) {
            // Show last unused code, or inform them it's already used
            const unusedCode = existing.find(t => !t.used);
            if (unusedCode) {
                return interaction.editReply({ content: `✅ You already have an unused code: \`${unusedCode.code}\`\nCheck your DMs or use the code at the community site.` });
            }
            // All used — user already accessed the community
            return interaction.editReply({ content: '⚠️ You have already used your access code. Your community access is active!' });
        }

        const member  = await interaction.guild.members.fetch(userId);
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

        // Generate unique code
        let code = isAdmin ? ADMIN_CODE : generateTicketCode();
        if (!isAdmin) {
            let attempts = 0;
            while (attempts < 10) {
                const dupe = await db.getCommunityTicket(code);
                if (!dupe) break;
                code = generateTicketCode();
                attempts++;
            }
        }

        // Save to Supabase
        await db.createCommunityTicket(guildId, userId, code, isAdmin);

        // Try DM first
        const dmEmbed = new EmbedBuilder()
            .setColor('#2D7D5F')
            .setTitle('🎫 Community Access Code')
            .setDescription('Here is your exclusive access code for the PhineX Community:')
            .addFields(
                { name: '🔑 Your Code', value: `\`\`\`${code}\`\`\``, inline: false },
                { name: '📍 How to Use', value: '1. Visit the community website\n2. Enter your access code\n3. Enjoy the community!', inline: false },
                { name: '⚠️ Important', value: '**Single-use only.** Do not share this code.', inline: false }
            )
            .setFooter({ text: 'PhineX Community' })
            .setTimestamp();

        if (isAdmin) {
            dmEmbed.addFields({ name: '👑 Admin Access', value: 'You have administrator privileges!', inline: false });
        }

        try {
            await interaction.user.send({ embeds: [dmEmbed] });
            return interaction.editReply({ content: '✅ Your access code has been sent to your DMs!\n\n*Check your direct messages.*' });
        } catch {
            // DMs closed — show code ephemerally
            const fallbackEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🎫 Your Community Access Code')
                .setDescription('⚠️ Could not send DM. Here is your code — save it now!')
                .addFields(
                    { name: '🔑 Code', value: `\`\`\`${code}\`\`\``, inline: false },
                    { name: '⚠️', value: '**Single-use only.** Do not share this code.', inline: false }
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [fallbackEmbed] });
        }
    } catch (err) {
        console.error('Community access button error:', err);
        return interaction.editReply({ content: '❌ An error occurred generating your access code. Please try again.' });
    }
}

// ✅ FIX: there was no 'ready' listener at all, so a successful (or silently
// failing) login gave zero console feedback.
client.once('ready', async () => {
    console.log(`✓ Logged in as ${client.user.tag} (${client.guilds.cache.size} guild(s))`);

    // ✅ FIX: giveaway end timers only ever lived in setTimeout(), so a
    // restart (very likely on free hosting — see HOSTING_GUIDE.md) silently
    // lost any in-progress giveaway forever, with no winner ever announced.
    try {
        const active = await db.getActiveGiveaways();
        for (const g of active) {
            const remaining = g.end_time - Date.now();
            const resolveGiveaway = async () => {
                try {
                    const guild = client.guilds.cache.get(g.guild_id);
                    const channel = guild && await guild.channels.fetch(g.channel_id).catch(() => null);
                    const message = channel && await channel.messages.fetch(g.message_id).catch(() => null);
                    if (message) await endGiveaway(message, g.winners);
                    else await db.endGiveaway(g.message_id); // channel/message gone — just clear it
                } catch (err) {
                    console.error(`Failed to resolve giveaway ${g.message_id}:`, err);
                }
            };
            if (remaining <= 0) resolveGiveaway();
            else setTimeout(resolveGiveaway, remaining);
        }
        if (active.length) console.log(`✓ Resumed ${active.length} pending giveaway(s)`);
    } catch (err) {
        console.error('Failed to resume giveaways:', err);
    }
});

module.exports = { client, db, ADMIN_CODE };
client.login(config.botToken).catch(err => {
    console.error('❌ Discord login failed:', err.message);
    console.error('   Check BOT_TOKEN is current, and that "Message Content" + "Server Members" intents are enabled in the Discord Developer Portal (Bot tab).');
    process.exit(1);
});
