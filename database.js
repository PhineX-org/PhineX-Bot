const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'phinex.db'), (err) => {
            if (err) {
                console.error('❌ Database connection error:', err);
            } else {
                console.log('✅ Connected to SQLite database');
                this.initialize();
            }
        });
    }

    initialize() {
        this.db.serialize(() => {
            // Guild Settings Table (updated with new fields)
            this.db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                prefix TEXT DEFAULT '!',
                starboard_channel TEXT,
                starboard_threshold INTEGER DEFAULT 3,
                starboard_emoji TEXT DEFAULT '⭐',
                welcome_channel TEXT,
                welcome_message TEXT,
                log_channel TEXT,
                auto_role TEXT,
                suggestions_channel TEXT,
                social_links TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Warnings Table
            this.db.run(`CREATE TABLE IF NOT EXISTS warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Moderation Logs Table
            this.db.run(`CREATE TABLE IF NOT EXISTS moderation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Giveaways Table
            this.db.run(`CREATE TABLE IF NOT EXISTS giveaways (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                prize TEXT NOT NULL,
                winners INTEGER DEFAULT 1,
                end_time DATETIME NOT NULL,
                ended BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Starboard Messages Table
            this.db.run(`CREATE TABLE IF NOT EXISTS starboard_messages (
                original_message_id TEXT PRIMARY KEY,
                starboard_message_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Role Menus Table (NEW)
            this.db.run(`CREATE TABLE IF NOT EXISTS role_menus (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL UNIQUE,
                channel_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Role Menu Roles Table (NEW)
            this.db.run(`CREATE TABLE IF NOT EXISTS role_menu_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // User Sessions for Dashboard
            this.db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            console.log('✅ Database tables initialized');
        });
    }

    // Guild Settings Methods
    getGuildSettings(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    }

    updateGuildSettings(guildId, settings) {
        return new Promise((resolve, reject) => {
            const keys = Object.keys(settings);
            const values = Object.values(settings);
            const setClause = keys.map(key => `${key} = ?`).join(', ');

            this.db.run(
                `INSERT INTO guild_settings (guild_id, ${keys.join(', ')}) 
                 VALUES (?, ${keys.map(() => '?').join(', ')})
                 ON CONFLICT(guild_id) DO UPDATE SET ${setClause}, updated_at = CURRENT_TIMESTAMP`,
                [guildId, ...values, ...values],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // Warning Methods
    addWarning(guildId, userId, moderatorId, reason) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
                [guildId, userId, moderatorId, reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getWarnings(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC',
                [guildId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    clearWarnings(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM warnings WHERE guild_id = ? AND user_id = ?',
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // Moderation Logs
    logModeration(guildId, userId, action, moderatorId, reason) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO moderation_logs (guild_id, user_id, action, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
                [guildId, userId, action, moderatorId, reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getModerationLogs(guildId, limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM moderation_logs WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?',
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Giveaway Methods
    createGiveaway(guildId, messageId, channelId, prize, winners, endTime) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO giveaways (guild_id, message_id, channel_id, prize, winners, end_time) VALUES (?, ?, ?, ?, ?, ?)',
                [guildId, messageId, channelId, prize, winners, new Date(endTime).toISOString()],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getGiveaway(messageId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM giveaways WHERE message_id = ?', [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    }

    endGiveaway(messageId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE giveaways SET ended = 1 WHERE message_id = ?',
                [messageId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // Starboard Methods
    addStarboardMessage(originalMessageId, starboardMessageId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO starboard_messages (original_message_id, starboard_message_id) VALUES (?, ?)',
                [originalMessageId, starboardMessageId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getStarboardMessage(originalMessageId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM starboard_messages WHERE original_message_id = ?',
                [originalMessageId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Role Menu Methods
    createRoleMenu(guildId, messageId, channelId, title) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO role_menus (guild_id, message_id, channel_id, title) VALUES (?, ?, ?, ?)',
                [guildId, messageId, channelId, title],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getLastRoleMenu(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM role_menus WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    getRoleMenuByMessage(messageId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM role_menus WHERE message_id = ?',
                [messageId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    getRoleMenus(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM role_menus WHERE guild_id = ? ORDER BY created_at DESC',
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    addRoleMenuRole(messageId, roleId, emoji, description) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO role_menu_roles (message_id, role_id, emoji, description) VALUES (?, ?, ?, ?)',
                [messageId, roleId, emoji, description],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getRoleMenuRole(messageId, emoji) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?',
                [messageId, emoji],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    getRoleMenuRoles(messageId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM role_menu_roles WHERE message_id = ?',
                [messageId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Session Methods for Dashboard
    createSession(sessionId, userId, accessToken, refreshToken, expiresIn) {
        return new Promise((resolve, reject) => {
            const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
            this.db.run(
                'INSERT INTO user_sessions (session_id, user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?)',
                [sessionId, userId, accessToken, refreshToken, expiresAt],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM user_sessions WHERE session_id = ?', [sessionId], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    }

    deleteSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM user_sessions WHERE session_id = ?', [sessionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });
    }
}

module.exports = Database;
