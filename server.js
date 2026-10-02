const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { PermissionsBitField, ChannelType } = require('discord.js');
const config = require('./config');
const D = require('./defaults');
const bot = require('./bot.js');
const db = bot.db;

const DISCORD = process.env.DISCORD_API_BASE || 'https://discord.com/api/v10';
const AUTHORIZE_URL = process.env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize'; // overridable for tests
const SECRET = config.sessionSecret;
const SECURE = config.baseUrl.startsWith('https://');
const ADMIN = 0x8n, MANAGE_GUILD = 0x20n;

// Least-privilege permission set for the bot invite (no "Administrator")
const BOT_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions',
    'UseExternalEmojis', 'ManageMessages', 'ManageChannels', 'ManageRoles', 'KickMembers', 'BanMembers', 'ModerateMembers'];
const BOT_PERMS_BITS = new PermissionsBitField(BOT_PERMS).bitfield.toString();

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const snow = v => /^\d{15,25}$/.test(String(v || ''));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const dashboardOrigin = (() => { try { return new URL(config.dashboardURL).origin; } catch { return config.baseUrl; } })();
const dashboardPage = hash => {
    try {
        const u = new URL(config.dashboardURL);
        if (u.pathname === '/' || !u.pathname) u.pathname = '/dashboard';
        u.hash = String(hash || '').replace(/^#/, '');
        return u.toString();
    } catch { return `${config.baseUrl}/dashboard${hash || ''}`; }
};
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origin === dashboardOrigin || origin === config.baseUrl)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.path.startsWith('/preview/')) res.setHeader('X-Frame-Options', 'DENY');
    next();
});
app.use(express.json({ limit: '100kb' }));

// ─── static pages (explicit list: never expose config.json or source files) ───
const page = file => (req, res, next) => {
    const p = path.join(__dirname, file);
    fs.existsSync(p) ? res.sendFile(p) : next();
};
app.get('/', page('index.html'));
app.get('/dashboard', page('dashboard.html'));
app.get('/community', page('community.html'));

app.get(['/health', '/healthz'], (req, res) => res.json({
    ok: true, bot: bot.isReady(), servers: bot.guilds.cache.size, uptimeSeconds: Math.round(process.uptime()),
    botError: bot.loginError || null
}));

// User-submitted HTML previews (from the coding channel). The sandbox CSP gives each page a throwaway
// origin, so it can never read the dashboard's login token or call our API as the user.
app.get('/preview/:id', (req, res) => {
    const p = bot.previews.get(req.params.id);
    if (!p) return res.status(404).type('text').send('Preview not found or expired.');
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals allow-popups');
    res.type('html').send(p.content);
});

// ═════════════════════════════════════════════════════════════════════════════
// OAUTH (popup flow)
// ═════════════════════════════════════════════════════════════════════════════
function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(/;\s*/)) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return null;
}
const nonceCookie = (v, maxAge) => `phx_n=${v}; Max-Age=${maxAge}; Path=/auth; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`;

// Tiny page that hands the result to the dashboard window that opened the popup, then closes itself.
// If there is no opener (mobile, blocked popup, invite started from the landing page) it redirects instead.
function popupPage(payload, fallback, heading, sub) {
    const js = v => JSON.stringify(v).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PhineX</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07080d;color:#e4e7f0;font:16px/1.5 system-ui,sans-serif;text-align:center}
.b{padding:32px}.s{width:34px;height:34px;margin:0 auto 18px;border:3px solid #252840;border-top-color:#2de08a;border-radius:50%;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 6px}p{color:#8b90a8;margin:0}a{color:#2de08a}</style></head>
<body><div class="b"><div class="s"></div><h1>${heading}</h1><p>${sub} <a href="${fallback}">Continue</a></p></div>
<script>(function(){var msg=${js(payload)},fb=${js(fallback)};
try{if(window.opener&&!window.opener.closed){window.opener.postMessage(msg,${JSON.stringify(dashboardOrigin)});setTimeout(function(){window.close()},200);return;}}catch(e){}
setTimeout(function(){location.replace(fb)},300);})();</script></body></html>`;
}
const noStore = res => res.setHeader('Cache-Control', 'no-store');

app.get('/auth/login', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = jwt.sign({ t: 'login', n: nonce }, SECRET, { expiresIn: '10m' });
    res.setHeader('Set-Cookie', nonceCookie(nonce, 600));
    noStore(res);
    res.redirect(AUTHORIZE_URL + '?' + new URLSearchParams({
        client_id: config.clientId, response_type: 'code', scope: 'identify guilds', state, prompt: 'consent',
        redirect_uri: `${config.baseUrl}/auth/callback`
    }));
});

app.get('/auth/callback', ah(async (req, res) => {
    noStore(res);
    res.setHeader('Set-Cookie', nonceCookie('', 0));
    const fail = msg => res.send(popupPage({ type: 'phinex-auth-error', error: msg },
        dashboardPage('#error=' + encodeURIComponent(msg)), 'Login failed', msg));
    if (req.query.error) return fail('Login was cancelled.');
    try {
        const st = jwt.verify(String(req.query.state || ''), SECRET);
        if (st.t !== 'login' || !st.n || st.n !== readCookie(req, 'phx_n')) throw new Error('bad state');
    } catch { return fail('Login session expired or was tampered with. Please try again.'); }

    const tokenRes = await fetch(`${DISCORD}/oauth2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code',
            code: String(req.query.code || ''), redirect_uri: `${config.baseUrl}/auth/callback`
        })
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.access_token) {
        console.error('OAuth token exchange failed:', tokenRes.status, tok.error_description || tok.error);
        return fail(tok.error === 'invalid_client'
            ? 'The server\'s CLIENT_SECRET is wrong. The owner must reset it in the Discord Developer Portal.'
            : 'Discord rejected the login (redirect URI mismatch?). Make sure this URL is added under OAuth2 → Redirects: ' + `${config.baseUrl}/auth/callback`);
    }
    const meRes = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!meRes.ok) return fail('Could not read your Discord profile.');
    const me = await meRes.json();

    const session = jwt.sign({ id: me.id, username: me.username, name: me.global_name || me.username, avatar: me.avatar, at: tok.access_token },
        SECRET, { expiresIn: Math.min(Number(tok.expires_in) || 604800, 6 * 86400) });
    res.send(popupPage({ type: 'phinex-auth', token: session }, dashboardPage('#token=' + session), 'Logged in!', 'Returning to the dashboard…'));
}));

// Bot invite that RETURNS to us (the old invite URL had no redirect, so nothing happened after authorizing)
app.get('/invite', (req, res) => {
    const guild = snow(req.query.guild) ? String(req.query.guild) : null;
    const params = {
        client_id: config.clientId, scope: 'bot applications.commands', permissions: BOT_PERMS_BITS,
        response_type: 'code', redirect_uri: `${config.baseUrl}/auth/bot-callback`,
        state: jwt.sign({ t: 'bot', g: guild }, SECRET, { expiresIn: '15m' })
    };
    if (guild) { params.guild_id = guild; params.disable_guild_select = 'true'; }
    noStore(res);
    res.redirect(AUTHORIZE_URL + '?' + new URLSearchParams(params));
});

app.get('/auth/bot-callback', (req, res) => {
    noStore(res);
    if (req.query.error) {
        return res.send(popupPage({ type: 'phinex-bot-error', error: 'cancelled' }, dashboardPage(), 'Invite cancelled', 'Nothing was changed.'));
    }
    let state;
    try { state = jwt.verify(String(req.query.state || ''), SECRET); if (state.t !== 'bot') throw new Error('bad state'); }
    catch { return res.send(popupPage({ type: 'phinex-bot-error', error: 'Invite session expired. Please try again.' }, dashboardPage(), 'Invite expired', 'Please start the invite again.')); }
    const guildId = snow(req.query.guild_id) ? String(req.query.guild_id) : (snow(state.g) ? String(state.g) : null);
    res.send(popupPage({ type: 'phinex-bot-added', guildId }, dashboardPage(guildId ? '#added=' + guildId : ''),
        'PhineX was added!', 'Returning to the dashboard…'));
});

// ═════════════════════════════════════════════════════════════════════════════
// API middleware
// ═════════════════════════════════════════════════════════════════════════════
const buckets = new Map();
function limiter(max, windowMs) {
    return (req, res, next) => {
        const key = (req.user ? req.user.id : req.ip) + ':' + max;
        const now = Date.now();
        const b = buckets.get(key);
        if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); return next(); }
        if (++b.n > max) return next(new HttpError(429, 'Slow down — too many requests.'));
        next();
    };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k); }, 60000).unref();

function auth(req, res, next) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return next(new HttpError(401, 'Please log in.', 'session_expired'));
    try { req.user = jwt.verify(h.slice(7), SECRET); next(); }
    catch { next(new HttpError(401, 'Your session expired. Please log in again.', 'session_expired')); }
}

const guildCache = new Map(); // userId -> { t, list }
async function userGuilds(user, force = false) {
    const c = guildCache.get(user.id);
    if (!force && c && Date.now() - c.t < 30000) return c.list;
    const r = await fetch(`${DISCORD}/users/@me/guilds`, { headers: { Authorization: `Bearer ${user.at}` } });
    if (r.status === 401) throw new HttpError(401, 'Your Discord session expired. Please log in again.', 'session_expired');
    if (r.status === 429 && c) return c.list;
    if (!r.ok) throw new HttpError(502, 'Discord is not responding right now. Try again in a moment.');
    const list = (await r.json()).filter(g => g.owner || (BigInt(g.permissions) & (ADMIN | MANAGE_GUILD)) !== 0n);
    guildCache.set(user.id, { t: Date.now(), list });
    return list;
}

// Every /api/guild/:guildId/* route goes through this: the user must manage the server AND the bot must be in it.
const requireGuild = ah(async (req, res, next) => {
    const list = await userGuilds(req.user);
    if (!list.some(g => g.id === req.params.guildId)) throw new HttpError(403, 'You need the Manage Server permission in that server.');
    const guild = bot.guilds.cache.get(req.params.guildId);
    if (!guild) throw new HttpError(404, 'PhineX is not in that server yet.', 'no_bot');
    req.guild = guild;
    next();
});

const guildRoute = (...h) => [auth, requireGuild, ...h];

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════
const CH_TYPES = { [ChannelType.GuildText]: 'text', [ChannelType.GuildAnnouncement]: 'announcement', [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GuildStageVoice]: 'stage', [ChannelType.GuildCategory]: 'category', [ChannelType.GuildForum]: 'forum' };

const userDTO = u => ({ id: u.id, username: u.username, avatar: u.displayAvatarURL({ size: 64 }), bot: u.bot, createdAt: u.createdTimestamp });
const memberDTO = m => ({
    id: m.id, username: m.user.username, displayName: m.displayName, bot: m.user.bot,
    avatar: m.displayAvatarURL({ size: 64 }), joinedAt: m.joinedTimestamp,
    roles: m.roles.cache.filter(r => r.id !== m.guild.id).sort((a, b) => b.position - a.position).first(4)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
    timedOutUntil: m.communicationDisabledUntilTimestamp || null,
    owner: m.id === m.guild.ownerId, moderatable: m.moderatable, kickable: m.kickable, bannable: m.bannable
});

async function resolveUsers(ids) {
    const out = {};
    await Promise.all([...new Set(ids)].slice(0, 40).map(async id => {
        const u = bot.users.cache.get(id) || await bot.users.fetch(id).catch(() => null);
        if (u) out[id] = { username: u.username, avatar: u.displayAvatarURL({ size: 32 }) };
    }));
    return out;
}

// Role hierarchy: the dashboard user must outrank the target, exactly like inside Discord.
async function hierarchyError(guild, actorId, target) {
    if (target.id === guild.ownerId) return 'You cannot moderate the server owner.';
    if (target.id === bot.user.id) return 'I cannot moderate myself.';
    if (target.id === actorId) return 'You cannot moderate yourself.';
    if (actorId === guild.ownerId) return null;
    const actor = await guild.members.fetch(actorId).catch(() => null);
    if (!actor) return 'You must be a member of this server to moderate from the dashboard.';
    if (actor.roles.highest.position <= target.roles.highest.position) return 'That member has a role equal to or higher than yours.';
    return null;
}

const text = (v, max, name, { required = false } = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (required && !s) throw new HttpError(400, `${name} is required.`);
    if (s.length > max) throw new HttpError(400, `${name} must be ${max} characters or fewer.`);
    return s;
};
const strictInt = (v, min, max, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}.`);
    return n;
};
const hex = (v, d) => (/^#?[0-9a-f]{6}$/i.test(String(v || '')) ? (String(v).startsWith('#') ? v : '#' + v) : d);
const httpsUrl = (v, name) => {
    if (!v) return null;
    try { const u = new URL(v); if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString(); } catch { /* fallthrough */ }
    throw new HttpError(400, `${name} must be a valid http(s) URL.`);
};

function textChannel(guild, id) {
    const ch = guild.channels.cache.get(String(id));
    if (!ch || !ch.isTextBased() || ch.isVoiceBased()) throw new HttpError(400, 'Pick a valid text channel.');
    const perms = ch.permissionsFor(guild.members.me);
    if (!perms || !perms.has(['ViewChannel', 'SendMessages'])) throw new HttpError(400, `I can't send messages in #${ch.name}. Give me View Channel + Send Messages there.`);
    return ch;
}

// ═════════════════════════════════════════════════════════════════════════════
// API routes
// ═════════════════════════════════════════════════════════════════════════════
app.use('/api', limiter(240, 60000));

app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username, name: req.user.name, avatar: req.user.avatar }));

app.get('/api/guilds', auth, ah(async (req, res) => {
    const list = await userGuilds(req.user, req.query.refresh === '1');
    res.json(list.map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner, hasBot: bot.guilds.cache.has(g.id) }))
        .sort((a, b) => Number(b.hasBot) - Number(a.hasBot) || a.name.localeCompare(b.name)));
}));

// The dashboard polls this after the invite popup so it knows the moment the bot has joined.
app.get('/api/guild/:guildId/status', auth, ah(async (req, res) => {
    const list = await userGuilds(req.user, true);
    if (!list.some(g => g.id === req.params.guildId)) throw new HttpError(403, 'You need the Manage Server permission in that server.');
    res.json({ hasBot: bot.guilds.cache.has(req.params.guildId) });
}));

// Writes get a tighter budget than reads
app.use('/api', (req, res, next) => (req.method === 'GET' ? next() : limiter(90, 60000)(req, res, next)));

app.get('/api/guild/:guildId', ...guildRoute(ah(async (req, res) => {
    const g = req.guild;
    const me = g.members.me || await g.members.fetchMe();
    const channels = [...g.channels.cache.values()].filter(c => CH_TYPES[c.type])
        .map(c => ({ id: c.id, name: c.name, type: CH_TYPES[c.type], parentId: c.parentId, position: c.rawPosition }))
        .sort((a, b) => a.position - b.position);
    const roles = [...g.roles.cache.values()].filter(r => r.id !== g.id)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed, editable: r.editable, members: r.members.size }))
        .sort((a, b) => b.position - a.position);
    const rawSettings = await db.getGuildSettings(g.id);
    const baseSettings = D.defaults();
    const settings = { ...baseSettings, ...rawSettings,
        automod: { ...baseSettings.automod, ...(rawSettings.automod || {}), spam: { ...baseSettings.automod.spam, ...(rawSettings.automod?.spam || {}) } },
        leveling: { ...baseSettings.leveling, ...(rawSettings.leveling || {}), roleRewards: rawSettings.leveling?.roleRewards || baseSettings.leveling.roleRewards },
        logging: { ...baseSettings.logging, ...(rawSettings.logging || {}) }
    };
    delete settings.guild_id; delete settings.updated_at;
    const want = { ViewChannel: 'View Channels', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links', ManageMessages: 'Manage Messages',
        ManageChannels: 'Manage Channels', ManageRoles: 'Manage Roles', KickMembers: 'Kick Members', BanMembers: 'Ban Members',
        ModerateMembers: 'Timeout Members', AddReactions: 'Add Reactions', ReadMessageHistory: 'Read Message History' };
    res.json({
        guild: { id: g.id, name: g.name, icon: g.icon, memberCount: g.memberCount, ownerId: g.ownerId,
            boosts: g.premiumSubscriptionCount || 0, createdAt: g.createdTimestamp },
        channels, roles, settings,
        botMissing: Object.entries(want).filter(([k]) => !me.permissions.has(k)).map(([, v]) => v),
        botTopRole: me.roles.highest.position,
        bot: { ping: Math.round(bot.ws.ping), uptimeSeconds: Math.round(process.uptime()), servers: bot.guilds.cache.size }
    });
})));

// ── settings (every field validated; unknown keys are ignored, so no column-name injection) ──
app.post('/api/guild/:guildId/settings', ...guildRoute(ah(async (req, res) => {
    const g = req.guild, b = req.body || {}, out = {};
    const chan = k => { if (!(k in b)) return; const v = b[k]; if (v === '' || v === null) return void (out[k] = null);
        if (!snow(v) || !g.channels.cache.has(String(v))) throw new HttpError(400, `Invalid channel for ${k}.`); out[k] = String(v); };
    const role = k => { if (!(k in b)) return; const v = b[k]; if (v === '' || v === null) return void (out[k] = null);
        if (!snow(v) || !g.roles.cache.has(String(v))) throw new HttpError(400, `Invalid role for ${k}.`); out[k] = String(v); };
    ['welcome_channel', 'leave_channel', 'suggestions_channel', 'starboard_channel', 'log_channel'].forEach(chan);
    role('welcome_role');
    if ('welcome_message' in b) out.welcome_message = text(b.welcome_message, 1000, 'Welcome message') || null;
    if ('leave_message' in b) out.leave_message = text(b.leave_message, 1000, 'Leave message') || null;
    if ('starboard_emoji' in b) out.starboard_emoji = text(b.starboard_emoji, 64, 'Starboard emoji') || '⭐';
    if ('starboard_threshold' in b) out.starboard_threshold = D.int(b.starboard_threshold, 1, 50, 3);
    if ('automod' in b) out.automod = D.sanitizeAutomod(b.automod);
    if ('leveling' in b) out.leveling = D.sanitizeLeveling(b.leveling);
    if ('logging' in b) out.logging = D.sanitizeLogging(b.logging);
    if (!Object.keys(out).length) throw new HttpError(400, 'Nothing to save.');
    await db.updateGuildSettings(g.id, out);
    const s = await db.getGuildSettings(g.id); delete s.guild_id; delete s.updated_at;
    res.json({ success: true, settings: s });
})));

// ── members & moderation ──
app.get('/api/guild/:guildId/members', ...guildRoute(ah(async (req, res) => {
    const q = text(String(req.query.q || ''), 32, 'Search');
    let list;
    if (snow(q)) { const m = await req.guild.members.fetch(q).catch(() => null); list = m ? [m] : []; }
    else if (q) list = [...(await req.guild.members.search({ query: q, limit: 15 })).values()];
    else list = [...(await req.guild.members.list({ limit: 15 })).values()];
    res.json({ members: list.map(memberDTO) });
})));

app.get('/api/guild/:guildId/member/:userId', ...guildRoute(ah(async (req, res) => {
    const g = req.guild, id = req.params.userId;
    if (!snow(id)) throw new HttpError(400, 'That is not a valid user ID.');
    const member = await g.members.fetch(id).catch(() => null);
    const user = member ? member.user : await bot.users.fetch(id).catch(() => null);
    if (!user) throw new HttpError(404, 'No Discord user with that ID.');
    const ban = member ? null : await g.bans.fetch(id).catch(() => null);
    const warnings = await db.getWarnings(g.id, id);
    res.json({ user: userDTO(user), member: member ? memberDTO(member) : null, banned: ban ? { reason: ban.reason || null } : null, warnings });
})));

const ACTIONS = ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban'];
app.post('/api/guild/:guildId/mod/:action', ...guildRoute(ah(async (req, res) => {
    const g = req.guild, action = req.params.action, b = req.body || {};
    if (!ACTIONS.includes(action)) throw new HttpError(404, 'Unknown action.');
    if (!snow(b.userId)) throw new HttpError(400, 'Enter a valid user ID.');
    const id = String(b.userId);
    const reason = text(b.reason, 400, 'Reason') || 'No reason provided';
    const audit = `${reason} (dashboard: ${req.user.username})`;
    const member = await g.members.fetch(id).catch(() => null);

    if (member) { const err = await hierarchyError(g, req.user.id, member); if (err) throw new HttpError(403, err); }
    const needMember = () => { if (!member) throw new HttpError(404, 'That user is not in this server.'); };

    let message;
    if (action === 'warn') {
        needMember();
        await db.addWarning(g.id, id, req.user.id, reason);
        message = `Warned ${member.user.username} (${await db.getWarningCount(g.id, id)} total).`;
    } else if (action === 'timeout') {
        needMember();
        const mins = strictInt(b.minutes, 1, 40320, 'Timeout minutes');
        if (!member.moderatable) throw new HttpError(403, 'I cannot timeout that member (their role is above mine, or they are an admin).');
        await member.timeout(mins * 60000, audit);
        await db.logModeration(g.id, id, 'timeout', req.user.id, `${reason} (${mins} min)`);
        message = `Timed out ${member.user.username} for ${mins} minute(s).`;
    } else if (action === 'untimeout') {
        needMember();
        await member.timeout(null, audit);
        await db.logModeration(g.id, id, 'untimeout', req.user.id, reason);
        message = `Removed the timeout from ${member.user.username}.`;
    } else if (action === 'kick') {
        needMember();
        if (!member.kickable) throw new HttpError(403, 'I cannot kick that member (their role is above mine).');
        await member.kick(audit);
        await db.logModeration(g.id, id, 'kick', req.user.id, reason);
        message = `Kicked ${member.user.username}.`;
    } else if (action === 'ban') {
        if (member && !member.bannable) throw new HttpError(403, 'I cannot ban that member (their role is above mine).');
        await g.members.ban(id, { reason: audit, deleteMessageSeconds: D.int(b.deleteDays, 0, 7, 0) * 86400 });
        await db.logModeration(g.id, id, 'ban', req.user.id, reason);
        message = 'Banned the user.';
    } else {
        await g.bans.remove(id, audit);
        await db.logModeration(g.id, id, 'unban', req.user.id, reason);
        message = 'Unbanned the user.';
    }
    res.json({ success: true, message });
})));

app.get('/api/guild/:guildId/bans', ...guildRoute(ah(async (req, res) => {
    const bans = await req.guild.bans.fetch({ limit: 100 });
    res.json({ bans: [...bans.values()].map(b => ({ id: b.user.id, username: b.user.username, avatar: b.user.displayAvatarURL({ size: 32 }), reason: b.reason })) });
})));

app.get('/api/guild/:guildId/logs', ...guildRoute(ah(async (req, res) => {
    const limit = D.int(req.query.limit, 1, 200, 50);
    let logs = await db.getModerationLogs(req.guild.id, 200);
    if (req.query.type) logs = logs.filter(l => l.type === String(req.query.type));
    logs = logs.slice(0, limit);
    res.json({ logs, users: await resolveUsers(logs.flatMap(l => [l.user_id, l.moderator_id])) });
})));

app.get('/api/guild/:guildId/warnings/:userId', ...guildRoute(ah(async (req, res) => {
    if (!snow(req.params.userId)) throw new HttpError(400, 'That is not a valid user ID.');
    const warnings = await db.getWarnings(req.guild.id, req.params.userId);
    res.json({ warnings, users: await resolveUsers([req.params.userId, ...warnings.map(w => w.moderator_id)]) });
})));
app.delete('/api/guild/:guildId/warnings/:userId', ...guildRoute(ah(async (req, res) => {
    if (!snow(req.params.userId)) throw new HttpError(400, 'That is not a valid user ID.');
    await db.clearWarnings(req.guild.id, req.params.userId);
    await db.logModeration(req.guild.id, req.params.userId, 'clearwarns', req.user.id, 'Warnings cleared (dashboard)');
    res.json({ success: true });
})));
app.delete('/api/guild/:guildId/warning/:id', ...guildRoute(ah(async (req, res) => {
    await db.deleteWarning(req.guild.id, parseInt(req.params.id, 10));
    res.json({ success: true });
})));

// ── roles & channels ──
app.post('/api/guild/:guildId/roles', ...guildRoute(ah(async (req, res) => {
    const b = req.body || {};
    const role = await req.guild.roles.create({ name: text(b.name, 100, 'Role name', { required: true }), color: hex(b.color, '#99aab5'),
        hoist: !!b.hoist, mentionable: !!b.mentionable, reason: `Created from dashboard by ${req.user.username}` });
    res.json({ success: true, role: { id: role.id, name: role.name, color: role.hexColor, position: role.position, managed: false, editable: role.editable, members: 0 } });
})));
app.delete('/api/guild/:guildId/roles/:roleId', ...guildRoute(ah(async (req, res) => {
    const g = req.guild, role = g.roles.cache.get(req.params.roleId);
    if (!role || role.id === g.id) throw new HttpError(404, 'Role not found.');
    if (role.managed) throw new HttpError(400, 'That role is managed by an integration and cannot be deleted.');
    if (!role.editable) throw new HttpError(403, 'That role is above my highest role. Move my role up in Server Settings → Roles.');
    if (req.user.id !== g.ownerId) {
        const actor = await g.members.fetch(req.user.id).catch(() => null);
        if (!actor || actor.roles.highest.position <= role.position) throw new HttpError(403, 'You can only delete roles below your highest role.');
    }
    await role.delete(`Deleted from dashboard by ${req.user.username}`);
    res.json({ success: true });
})));

const NEW_CH = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory, announcement: ChannelType.GuildAnnouncement };
app.post('/api/guild/:guildId/channels', ...guildRoute(ah(async (req, res) => {
    const b = req.body || {};
    if (!(b.type in NEW_CH)) throw new HttpError(400, 'Invalid channel type.');
    const name = text(b.name, 100, 'Channel name', { required: true });
    const opts = { name, type: NEW_CH[b.type], reason: `Created from dashboard by ${req.user.username}` };
    if (b.parentId && req.guild.channels.cache.get(String(b.parentId))?.type === ChannelType.GuildCategory && b.type !== 'category') opts.parent = String(b.parentId);
    const ch = await req.guild.channels.create(opts);
    res.json({ success: true, channel: { id: ch.id, name: ch.name, type: CH_TYPES[ch.type], parentId: ch.parentId, position: ch.rawPosition } });
})));
app.delete('/api/guild/:guildId/channels/:channelId', ...guildRoute(ah(async (req, res) => {
    const ch = req.guild.channels.cache.get(req.params.channelId);
    if (!ch) throw new HttpError(404, 'Channel not found.');
    if (!ch.deletable) throw new HttpError(403, 'I do not have permission to delete that channel.');
    await ch.delete(`Deleted from dashboard by ${req.user.username}`);
    res.json({ success: true });
})));

// ── announcements / embed sender ──
app.post('/api/guild/:guildId/send', ...guildRoute(ah(async (req, res) => {
    const b = req.body || {}, e = b.embed || {};
    const ch = textChannel(req.guild, b.channelId);
    const content = text(b.content, 2000, 'Message');
    const title = text(e.title, 256, 'Embed title'), description = text(e.description, 4000, 'Embed description');
    if (!content && !title && !description) throw new HttpError(400, 'Write a message or an embed first.');
    const payload = { allowedMentions: { parse: b.pingEveryone ? ['everyone'] : [] } };
    if (content || b.pingEveryone) payload.content = (b.pingEveryone ? '@everyone ' : '') + content;
    if (title || description) {
        payload.embeds = [{ color: parseInt(hex(e.color, '#39ff14').slice(1), 16), ...(title && { title }), ...(description && { description }),
            ...(e.footer && { footer: { text: text(e.footer, 2048, 'Footer') } }),
            ...(e.imageUrl && { image: { url: httpsUrl(e.imageUrl, 'Image URL') } }),
            ...(e.thumbnailUrl && { thumbnail: { url: httpsUrl(e.thumbnailUrl, 'Thumbnail URL') } }), timestamp: new Date().toISOString() }];
    }
    const msg = await ch.send(payload);
    res.json({ success: true, url: msg.url });
})));

// ── giveaways ──
app.get('/api/guild/:guildId/giveaways', ...guildRoute(ah(async (req, res) => {
    res.json({ giveaways: await db.getGuildGiveaways(req.guild.id, 25) });
})));
app.post('/api/guild/:guildId/giveaways', ...guildRoute(ah(async (req, res) => {
    const b = req.body || {};
    const ch = textChannel(req.guild, b.channelId);
    const prize = text(b.prize, 200, 'Prize', { required: true });
    const winners = strictInt(b.winners, 1, 20, 'Winners'), mins = strictInt(b.durationMinutes, 1, 43200, 'Duration (minutes)');
    const msg = await bot.phinex.createGiveaway(req.guild, ch.id, prize, winners, mins * 60000, req.user.username);
    res.json({ success: true, url: msg.url });
})));
app.post('/api/guild/:guildId/giveaways/:messageId/end', ...guildRoute(ah(async (req, res) => {
    const ok = await bot.phinex.endGiveawayNow(req.guild.id, req.params.messageId);
    if (!ok) throw new HttpError(404, 'That giveaway is not active.');
    res.json({ success: true });
})));

// ── tickets ──
app.get('/api/guild/:guildId/tickets', ...guildRoute(ah(async (req, res) => {
    const [settings, stats] = await Promise.all([db.getTicketSettings(req.guild.id), db.getTicketStats(req.guild.id)]);
    res.json({ settings: settings || {}, stats });
})));
app.post('/api/guild/:guildId/tickets/panel', ...guildRoute(ah(async (req, res) => {
    const b = req.body || {}, kind = b.kind === 'community' ? 'community' : 'support';
    const ch = textChannel(req.guild, b.channelId);
    if (kind === 'support' && !req.guild.roles.cache.has(String(b.roleId))) throw new HttpError(400, 'Pick the support team role.');
    await bot.phinex.postPanel(req.guild, kind, { channelId: ch.id, roleId: String(b.roleId || ''), title: text(b.title, 200, 'Title'),
        description: text(b.description, 1500, 'Description'), color: b.color, buttonLabel: text(b.buttonLabel, 80, 'Button label'), buttonEmoji: text(b.buttonEmoji, 64, 'Button emoji') });
    res.json({ success: true });
})));

// ── custom commands ──
app.get('/api/guild/:guildId/commands', ...guildRoute(ah(async (req, res) => {
    res.json({ commands: (await db.getCustomCommands(req.guild.id)).map(c => ({ name: c.name, response: c.response })) });
})));
app.post('/api/guild/:guildId/commands', ...guildRoute(ah(async (req, res) => {
    const name = text(req.body && req.body.name, 30, 'Name', { required: true }).toLowerCase().replace(/^!/, '');
    if (!/^[a-z0-9_-]{1,30}$/.test(name)) throw new HttpError(400, 'Names may only contain letters, numbers, - and _.');
    if (['help', 'setup-coding', 'write', 'config-social', 'config-star', 'rr', 'quiz-setup', 'quiz-question', 'ticket-setup'].includes(name)) throw new HttpError(400, 'That name is reserved.');
    await db.addCustomCommand(req.guild.id, name, text(req.body.response, 1500, 'Response', { required: true }), req.user.id);
    res.json({ success: true });
})));
app.delete('/api/guild/:guildId/commands/:name', ...guildRoute(ah(async (req, res) => {
    await db.removeCustomCommand(req.guild.id, req.params.name);
    res.json({ success: true });
})));

// ── leveling ──
app.get('/api/guild/:guildId/leaderboard', ...guildRoute(ah(async (req, res) => {
    const rows = await db.getLevelLeaderboard(req.guild.id, D.int(req.query.limit, 1, 50, 25));
    res.json({ rows: rows.map(r => ({ ...r, ...D.levelFromXp(r.xp) })), users: await resolveUsers(rows.map(r => r.user_id)) });
})));

// ── social links ──
const SOCIAL_KEY = /^[a-z0-9 _-]{1,30}$/i;
app.get('/api/guild/:guildId/social', ...guildRoute(ah(async (req, res) => {
    const links = {};
    (await db.getSocialLinks(req.guild.id)).forEach(l => { links[l.platform] = l.link; });
    res.json({ links });
})));
app.post('/api/guild/:guildId/social', ...guildRoute(ah(async (req, res) => {
    const links = (req.body && req.body.links) || {};
    for (const [k, v] of Object.entries(links)) {
        if (!SOCIAL_KEY.test(k)) continue;
        const url = typeof v === 'string' && v.trim() ? httpsUrl(v.trim(), k) : null;
        if (url) await db.addSocialLink(req.guild.id, k, url); else await db.removeSocialLink(req.guild.id, k);
    }
    res.json({ success: true });
})));

// ═════════════════════════════════════════════════════════════════════════════
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    const DISCORD_MSG = {
        50013: [403, 'I am missing a permission for that, or the target\'s role is above mine. Check my role in Server Settings → Roles.'],
        50001: [403, 'I cannot see that channel or server resource.'], 10007: [404, 'That member is not in the server.'],
        10013: [404, 'Unknown user.'], 10011: [404, 'Unknown role.'], 10003: [404, 'Unknown channel.'], 30005: [400, 'The server has reached its role limit.'],
        30013: [400, 'The server has reached its channel limit.'], 50035: [400, 'Discord rejected one of the values you entered.']
    };
    if (err.code && DISCORD_MSG[err.code]) return res.status(DISCORD_MSG[err.code][0]).json({ error: DISCORD_MSG[err.code][1] });
    console.error(`API error on ${req.method} ${req.path}:`, err.message || err);
    if (err.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(err.message || '')) {
        return res.status(500).json({ error: 'The database tables are missing. Run supabase_schema.sql in your Supabase SQL editor.' });
    }
    if (/row-level security|permission denied|JWT/i.test(err.message || '')) {
        return res.status(500).json({ error: 'Database access denied. Set SUPABASE_SERVICE_KEY to your Supabase secret key.' });
    }
    res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(config.port, '0.0.0.0', () => {
    console.log(`🌐 Web server listening on port ${config.port}`);
    console.log(`   Site:      ${config.baseUrl}`);
    console.log(`   Dashboard: ${config.baseUrl}/dashboard`);
    console.log('   Add BOTH of these under Discord Developer Portal → OAuth2 → Redirects:');
    console.log(`     ${config.baseUrl}/auth/callback`);
    console.log(`     ${config.baseUrl}/auth/bot-callback`);
    db.ping().then(() => console.log('✓ Database reachable'), e => console.error('❌ Database check failed:', e.message, '\n   Did you run supabase_schema.sql and set SUPABASE_SERVICE_KEY?'));
});

// Render's free tier sleeps after ~15 min without web traffic; pinging ourselves keeps the bot connected.
const keepAlive = process.env.KEEP_ALIVE_URL || (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== 'false' ? `${config.baseUrl}/health` : null);
if (keepAlive) setInterval(() => fetch(keepAlive).catch(() => {}), 10 * 60 * 1000).unref();
