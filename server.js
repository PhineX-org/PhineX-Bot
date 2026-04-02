const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const Database = require('./database.js');

const app = express();
const db = new Database();
// Load config from environment variables (Railway) or config.json (local development)
let config;
try {
    if (process.env.BOT_TOKEN) {
        // Running on Railway or other cloud platform with environment variables
        config = {
            botToken: process.env.BOT_TOKEN,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            callbackURL: process.env.CALLBACK_URL,
            dashboardURL: process.env.DASHBOARD_URL || 'http://localhost:3000',
            sessionSecret: process.env.SESSION_SECRET,
            port: process.env.PORT || 3000
        };
        console.log('✓ Server loaded config from environment variables');
    } else {
        // Running locally with config.json
        config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        console.log('✓ Server loaded config from config.json');
    }
} catch (e) {
    console.error('❌ Error loading server config:', e.message);
    process.exit(1);
}

// Import Discord bot client
const bot = require('./bot.js');

// CORS Configuration for GitHub Pages
const corsOptions = {
    origin: [
        'https://phinex-org.github.io',
        'http://localhost:3000',
        config.dashboardURL
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Session configuration
app.use(session({
    secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(new DiscordStrategy({
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: config.callbackURL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    return done(null, profile);
}));

// Auth middleware
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// OAuth Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    async (req, res) => {
        // Store session in database
        const sessionId = crypto.randomBytes(32).toString('hex');
        await db.createSession(
            sessionId,
            req.user.id,
            req.user.accessToken,
            req.user.refreshToken,
            604800 // 7 days
        );
        res.redirect('https://phinex-org.github.io/PhineX-Bot/dashboard.html');
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.redirect('/');
    });
});

// API Routes
app.get('/api/user', isAuthenticated, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        discriminator: req.user.discriminator,
        avatar: req.user.avatar
    });
});

app.get('/api/guilds', isAuthenticated, async (req, res) => {
    try {
        // Get user's guilds from Discord API
        const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: {
                'Authorization': `Bearer ${req.user.accessToken}`
            }
        });

        const guilds = await response.json();
        
        // Filter guilds where user has MANAGE_GUILD permission
        const managedGuilds = guilds.filter(guild => {
            const permissions = BigInt(guild.permissions);
            return (permissions & BigInt(0x20)) === BigInt(0x20); // MANAGE_GUILD
        });

        // Check which guilds have the bot
        const botGuilds = bot.guilds.cache.map(g => g.id);
        
        const guildsWithBotStatus = managedGuilds.map(guild => ({
            ...guild,
            hasBot: botGuilds.includes(guild.id),
            inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}&permissions=8&scope=bot%20applications.commands&guild_id=${guild.id}`
        }));

        res.json(guildsWithBotStatus);
    } catch (error) {
        console.error('Error fetching guilds:', error);
        res.status(500).json({ error: 'Failed to fetch guilds' });
    }
});

app.get('/api/guild/:guildId', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    
    // Verify user has access to this guild
    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: {
            'Authorization': `Bearer ${req.user.accessToken}`
        }
    });
    const guilds = await response.json();
    const hasAccess = guilds.some(g => g.id === guildId && (BigInt(g.permissions) & BigInt(0x20)) === BigInt(0x20));

    if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const guild = bot.guilds.cache.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'Guild not found or bot not in guild' });
        }

        const settings = await db.getGuildSettings(guildId);
        const roles = guild.roles.cache.map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
            position: r.position,
            mentionable: r.mentionable
        })).sort((a, b) => b.position - a.position);

        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 2) // Text or Voice
            .map(c => ({
                id: c.id,
                name: c.name,
                type: c.type === 0 ? 'text' : 'voice',
                position: c.position
            }))
            .sort((a, b) => a.position - b.position);

        res.json({
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL(),
                memberCount: guild.memberCount
            },
            settings: settings || {},
            roles,
            channels
        });
    } catch (error) {
        console.error('Error fetching guild data:', error);
        res.status(500).json({ error: 'Failed to fetch guild data' });
    }
});

app.post('/api/guild/:guildId/settings', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    const settings = req.body;

    try {
        await db.updateGuildSettings(guildId, settings);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

app.post('/api/guild/:guildId/role/create', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    const { name, color, permissions } = req.body;

    try {
        const guild = bot.guilds.cache.get(guildId);
        const role = await guild.roles.create({
            name,
            color: color || '#99AAB5',
            permissions: permissions || []
        });

        res.json({ success: true, role: { id: role.id, name: role.name, color: role.hexColor } });
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({ error: 'Failed to create role' });
    }
});

app.delete('/api/guild/:guildId/role/:roleId', isAuthenticated, async (req, res) => {
    const { guildId, roleId } = req.params;

    try {
        const guild = bot.guilds.cache.get(guildId);
        const role = guild.roles.cache.get(roleId);
        
        if (!role) {
            return res.status(404).json({ error: 'Role not found' });
        }

        await role.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting role:', error);
        res.status(500).json({ error: 'Failed to delete role' });
    }
});

app.post('/api/guild/:guildId/channel/create', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    const { name, type } = req.body;

    try {
        const guild = bot.guilds.cache.get(guildId);
        const channel = await guild.channels.create({
            name,
            type: type === 'voice' ? 2 : 0
        });

        res.json({ success: true, channel: { id: channel.id, name: channel.name, type: channel.type } });
    } catch (error) {
        console.error('Error creating channel:', error);
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

app.delete('/api/guild/:guildId/channel/:channelId', isAuthenticated, async (req, res) => {
    const { guildId, channelId } = req.params;

    try {
        const guild = bot.guilds.cache.get(guildId);
        const channel = guild.channels.cache.get(channelId);
        
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        await channel.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting channel:', error);
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

app.post('/api/guild/:guildId/member/:userId/ban', isAuthenticated, async (req, res) => {
    const { guildId, userId } = req.params;
    const { reason } = req.body;

    try {
        const guild = bot.guilds.cache.get(guildId);
        await guild.members.ban(userId, { reason: reason || 'No reason provided' });
        await db.logModeration(guildId, userId, 'ban', req.user.id, reason);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error banning user:', error);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

app.post('/api/guild/:guildId/member/:userId/kick', isAuthenticated, async (req, res) => {
    const { guildId, userId } = req.params;
    const { reason } = req.body;

    try {
        const guild = bot.guilds.cache.get(guildId);
        const member = await guild.members.fetch(userId);
        await member.kick(reason || 'No reason provided');
        await db.logModeration(guildId, userId, 'kick', req.user.id, reason);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error kicking user:', error);
        res.status(500).json({ error: 'Failed to kick user' });
    }
});

app.post('/api/guild/:guildId/member/:userId/warn', isAuthenticated, async (req, res) => {
    const { guildId, userId } = req.params;
    const { reason } = req.body;

    try {
        await db.addWarning(guildId, userId, req.user.id, reason || 'No reason provided');
        const warnings = await db.getWarnings(guildId, userId);
        
        res.json({ success: true, warnings: warnings.length });
    } catch (error) {
        console.error('Error warning user:', error);
        res.status(500).json({ error: 'Failed to warn user' });
    }
});

app.get('/api/guild/:guildId/warnings/:userId', isAuthenticated, async (req, res) => {
    const { guildId, userId } = req.params;

    try {
        const warnings = await db.getWarnings(guildId, userId);
        res.json({ warnings });
    } catch (error) {
        console.error('Error fetching warnings:', error);
        res.status(500).json({ error: 'Failed to fetch warnings' });
    }
});

app.get('/api/guild/:guildId/logs', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    try {
        const logs = await db.getModerationLogs(guildId, limit);
        res.json({ logs });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Social Links API
app.post('/api/guild/:guildId/social', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;
    const socialLinks = req.body;

    try {
        await db.updateGuildSettings(guildId, {
            social_links: JSON.stringify(socialLinks)
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating social links:', error);
        res.status(500).json({ error: 'Failed to update social links' });
    }
});

app.get('/api/guild/:guildId/social', isAuthenticated, async (req, res) => {
    const { guildId } = req.params;

    try {
        const settings = await db.getGuildSettings(guildId);
        const socialLinks = settings && settings.social_links ? JSON.parse(settings.social_links) : {};
        res.json({ socialLinks });
    } catch (error) {
        console.error('Error fetching social links:', error);
        res.status(500).json({ error: 'Failed to fetch social links' });
    }
});

// Start server
const PORT = config.port || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Dashboard server running on http://localhost:${PORT}`);
    console.log(`🔗 Frontend URL: ${config.dashboardURL}`);
    console.log(`🔐 OAuth Callback: ${config.callbackURL}`);
});
