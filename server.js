const express = require('express');
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
        config = {
            botToken: process.env.BOT_TOKEN,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            dashboardURL: process.env.DASHBOARD_URL || 'http://localhost:3000',
            port: process.env.PORT || 3000
        };
        console.log('✓ Server loaded config from environment variables');
    } else {
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

// Auth middleware – verifies Discord token via Discord API
async function authenticateDiscordToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Invalid token');
        const user = await response.json();
        req.user = user;
        req.discordToken = token;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// Routes – serve static HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API Routes (all require valid Discord token)
app.get('/api/user', authenticateDiscordToken, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        discriminator: req.user.discriminator,
        avatar: req.user.avatar
    });
});

app.get('/api/guilds', authenticateDiscordToken, async (req, res) => {
    try {
        const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { 'Authorization': `Bearer ${req.discordToken}` }
        });
        const guilds = await response.json();

        const managedGuilds = guilds.filter(guild => {
            const permissions = BigInt(guild.permissions);
            return (permissions & BigInt(0x20)) === BigInt(0x20); // MANAGE_GUILD
        });

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

app.get('/api/guild/:guildId', authenticateDiscordToken, async (req, res) => {
    const { guildId } = req.params;

    // Verify user has access to this guild
    const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { 'Authorization': `Bearer ${req.discordToken}` }
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
            .filter(c => c.type === 0 || c.type === 2)
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

app.post('/api/guild/:guildId/settings', authenticateDiscordToken, async (req, res) => {
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

app.post('/api/guild/:guildId/role/create', authenticateDiscordToken, async (req, res) => {
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

app.delete('/api/guild/:guildId/role/:roleId', authenticateDiscordToken, async (req, res) => {
    const { guildId, roleId } = req.params;
    try {
        const guild = bot.guilds.cache.get(guildId);
        const role = guild.roles.cache.get(roleId);
        if (!role) return res.status(404).json({ error: 'Role not found' });
        await role.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting role:', error);
        res.status(500).json({ error: 'Failed to delete role' });
    }
});

app.post('/api/guild/:guildId/channel/create', authenticateDiscordToken, async (req, res) => {
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

app.delete('/api/guild/:guildId/channel/:channelId', authenticateDiscordToken, async (req, res) => {
    const { guildId, channelId } = req.params;
    try {
        const guild = bot.guilds.cache.get(guildId);
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return res.status(404).json({ error: 'Channel not found' });
        await channel.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting channel:', error);
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

app.post('/api/guild/:guildId/member/:userId/ban', authenticateDiscordToken, async (req, res) => {
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

app.post('/api/guild/:guildId/member/:userId/kick', authenticateDiscordToken, async (req, res) => {
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

app.post('/api/guild/:guildId/member/:userId/warn', authenticateDiscordToken, async (req, res) => {
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

app.get('/api/guild/:guildId/warnings/:userId', authenticateDiscordToken, async (req, res) => {
    const { guildId, userId } = req.params;
    try {
        const warnings = await db.getWarnings(guildId, userId);
        res.json({ warnings });
    } catch (error) {
        console.error('Error fetching warnings:', error);
        res.status(500).json({ error: 'Failed to fetch warnings' });
    }
});

app.get('/api/guild/:guildId/logs', authenticateDiscordToken, async (req, res) => {
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

app.post('/api/guild/:guildId/social', authenticateDiscordToken, async (req, res) => {
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

app.get('/api/guild/:guildId/social', authenticateDiscordToken, async (req, res) => {
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

// Verify community access code (public endpoint - no auth required)
app.post('/api/community/verify', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Code is required' });
    }

    try {
        const ticket = await db.getCommunityTicket(code);
        
        if (!ticket) {
            return res.status(404).json({ error: 'Invalid access code' });
        }

        // Use the ticket if not already used
        if (!ticket.used) {
            await db.useCommunityTicket(code);
        }

        res.json({
            success: true,
            isAdmin: ticket.is_admin,
            userId: ticket.user_id
        });
    } catch (error) {
        console.error('Error verifying community code:', error);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

// Get community posts (requires valid community code)
app.get('/api/community/:guildId/posts', async (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const posts = await db.getPosts(guildId, limit, offset);
        res.json({ posts });
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

// Create community post (admin only)
app.post('/api/community/:guildId/posts', async (req, res) => {
    const { guildId } = req.params;
    const { authorId, authorName, title, content, imageUrl, code } = req.body;

    // Verify admin code
    if (code !== 'ADMIN26') {
        const ticket = await db.getCommunityTicket(code);
        if (!ticket || !ticket.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
    }

    try {
        const post = await db.createPost(guildId, authorId, authorName, title, content, imageUrl);
        res.json({ success: true, post });
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// Like/unlike post
app.post('/api/community/posts/:postId/like', async (req, res) => {
    const { postId } = req.params;
    const { userId, action } = req.body; // action: 'like' or 'unlike'

    try {
        if (action === 'like') {
            await db.likePost(postId, userId);
        } else {
            await db.unlikePost(postId, userId);
        }
        
        const post = await db.getPost(postId);
        res.json({ success: true, likes: post.likes });
    } catch (error) {
        console.error('Error liking post:', error);
        res.status(500).json({ error: 'Failed to like post' });
    }
});

// Get comments for a post
app.get('/api/community/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;

    try {
        const comments = await db.getComments(postId);
        res.json({ comments });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// Create comment
app.post('/api/community/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { authorId, authorName, content, parentId } = req.body;

    try {
        const comment = await db.createComment(postId, authorId, authorName, content, parentId);
        res.json({ success: true, comment });
    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({ error: 'Failed to create comment' });
    }
});

// Get chat messages
app.get('/api/community/:guildId/chat/:channelType', async (req, res) => {
    const { guildId, channelType } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const messages = await db.getChatMessages(guildId, channelType, limit, offset);
        res.json({ messages });
    } catch (error) {
        console.error('Error fetching chat messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Send chat message
app.post('/api/community/:guildId/chat/:channelType', async (req, res) => {
    const { guildId, channelType } = req.params;
    const { authorId, authorName, content, code } = req.body;

    // For admin channel, verify admin access
    if (channelType === 'admin') {
        if (code !== 'ADMIN26') {
            const ticket = await db.getCommunityTicket(code);
            if (!ticket || !ticket.is_admin) {
                return res.status(403).json({ error: 'Admin access required for this channel' });
            }
        }
    }

    try {
        const message = await db.createChatMessage(guildId, channelType, authorId, authorName, content);
        res.json({ success: true, message });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get ticket settings
app.get('/api/guild/:guildId/ticket-settings', authenticateDiscordToken, async (req, res) => {
    const { guildId } = req.params;

    try {
        const settings = await db.getTicketSettings(guildId);
        res.json({ settings });
    } catch (error) {
        console.error('Error fetching ticket settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// Get ticket statistics
app.get('/api/guild/:guildId/tickets/stats', authenticateDiscordToken, async (req, res) => {
    const { guildId } = req.params;

    try {
        // Support tickets
        const { data: supportTickets } = await db.supabase
            .from('support_tickets')
            .select('status')
            .eq('guild_id', guildId);

        // Community tickets
        const { data: communityTickets } = await db.supabase
            .from('community_tickets')
            .select('used')
            .eq('guild_id', guildId);

        const stats = {
            support: {
                total: supportTickets?.length || 0,
                open: supportTickets?.filter(t => t.status === 'open').length || 0,
                closed: supportTickets?.filter(t => t.status === 'closed').length || 0
            },
            community: {
                total: communityTickets?.length || 0,
                used: communityTickets?.filter(t => t.used).length || 0,
                unused: communityTickets?.filter(t => !t.used).length || 0
            }
        };

        res.json({ stats });
    } catch (error) {
        console.error('Error fetching ticket stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Delete post (admin only)
app.delete('/api/community/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    const { code } = req.body;

    // Verify admin code
    if (code !== 'ADMIN26') {
        const ticket = await db.getCommunityTicket(code);
        if (!ticket || !ticket.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
    }

    try {
        await db.deletePost(postId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// Delete comment (admin only)
app.delete('/api/community/comments/:commentId', async (req, res) => {
    const { commentId } = req.params;
    const { code } = req.body;

    // Verify admin code
    if (code !== 'ADMIN26') {
        const ticket = await db.getCommunityTicket(code);
        if (!ticket || !ticket.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
    }

    try {
        await db.deleteComment(commentId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// Start server
const PORT = config.port || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Dashboard server running on http://localhost:${PORT}`);
    console.log(`🔗 Frontend URL: ${config.dashboardURL}`);
});