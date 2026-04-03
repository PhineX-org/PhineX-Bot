const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor(dbPath = 'phinex-bot.db') {
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('✓ Connected to SQLite database');
                this.initTables();
            }
        });
    }

    initTables() {
        // Guild settings table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                welcome_channel TEXT,
                welcome_message TEXT,
                suggestions_channel TEXT,
                starboard_channel TEXT,
                starboard_emoji TEXT DEFAULT '⭐',
                starboard_threshold INTEGER DEFAULT 3
            )
        `);

        // Role menus table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS role_menus (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Role menu roles table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS role_menu_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                role_id TEXT NOT NULL,
                description TEXT
            )
        `);

        // Warnings table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Starboard messages table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS starboard_messages (
                message_id TEXT PRIMARY KEY,
                starboard_message_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Social links table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS social_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                link TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, platform)
            )
        `);

        // Quiz settings table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS quiz_settings (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                start_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Quiz questions table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                correct_answer INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Quiz scores table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS quiz_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                correct_answers INTEGER DEFAULT 0,
                total_answers INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )
        `);

        // Ticket settings table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS ticket_settings (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                support_role_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tickets table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                closed_at DATETIME
            )
        `);

        // Community tickets table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS community_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                used INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✓ Database tables initialized');
    }

    // Promisify database operations
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Guild settings methods
    async getGuildSettings(guildId) {
        return this.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]);
    }

    async setWelcomeChannel(guildId, channelId, message) {
        return this.run(
            'INSERT OR REPLACE INTO guild_settings (guild_id, welcome_channel, welcome_message) VALUES (?, ?, ?)',
            [guildId, channelId, message]
        );
    }

    async setSuggestionsChannel(guildId, channelId) {
        return this.run(
            'INSERT OR REPLACE INTO guild_settings (guild_id, suggestions_channel) VALUES (?, ?)',
            [guildId, channelId]
        );
    }

    // Role menu methods
    async createRoleMenu(guildId, channelId, messageId, title) {
        return this.run(
            'INSERT INTO role_menus (guild_id, channel_id, message_id, title) VALUES (?, ?, ?, ?)',
            [guildId, channelId, messageId, title]
        );
    }

    async getRoleMenuByMessage(messageId) {
        return this.get('SELECT * FROM role_menus WHERE message_id = ?', [messageId]);
    }

    async getLastRoleMenu(guildId) {
        return this.get(
            'SELECT * FROM role_menus WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
            [guildId]
        );
    }

    async addRoleMenuRole(messageId, emoji, roleId, description = '') {
        return this.run(
            'INSERT INTO role_menu_roles (message_id, emoji, role_id, description) VALUES (?, ?, ?, ?)',
            [messageId, emoji, roleId, description]
        );
    }

    async getRoleMenuRole(messageId, emoji) {
        return this.get(
            'SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?',
            [messageId, emoji]
        );
    }

    async getRoleMenuRoles(messageId) {
        return this.all('SELECT * FROM role_menu_roles WHERE message_id = ?', [messageId]);
    }

    // Warnings methods
    async addWarning(guildId, userId, moderatorId, reason) {
        return this.run(
            'INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)',
            [guildId, userId, moderatorId, reason]
        );
    }

    async getWarnings(guildId, userId) {
        return this.all(
            'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
            [guildId, userId]
        );
    }

    async getWarningCount(guildId, userId) {
        const result = await this.get(
            'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );
        return result ? result.count : 0;
    }

    // Starboard methods
    async addStarboardMessage(messageId, starboardMessageId) {
        return this.run(
            'INSERT INTO starboard_messages (message_id, starboard_message_id) VALUES (?, ?)',
            [messageId, starboardMessageId]
        );
    }

    async getStarboardMessage(messageId) {
        return this.get('SELECT * FROM starboard_messages WHERE message_id = ?', [messageId]);
    }

    // Social links methods
    async addSocialLink(guildId, platform, link) {
        return this.run(
            'INSERT OR REPLACE INTO social_links (guild_id, platform, link) VALUES (?, ?, ?)',
            [guildId, platform, link]
        );
    }

    async getSocialLinks(guildId) {
        return this.all('SELECT * FROM social_links WHERE guild_id = ?', [guildId]);
    }

    async removeSocialLink(guildId, platform) {
        return this.run(
            'DELETE FROM social_links WHERE guild_id = ? AND platform = ?',
            [guildId, platform]
        );
    }

    // Quiz methods
    async setQuizSettings(guildId, channelId, startMessage) {
        return this.run(
            'INSERT OR REPLACE INTO quiz_settings (guild_id, channel_id, start_message) VALUES (?, ?, ?)',
            [guildId, channelId, startMessage]
        );
    }

    async getQuizSettings(guildId) {
        return this.get('SELECT * FROM quiz_settings WHERE guild_id = ?', [guildId]);
    }

    async addQuizQuestion(guildId, messageId, question, options, correctAnswer) {
        return this.run(
            'INSERT INTO quiz_questions (guild_id, message_id, question, options, correct_answer) VALUES (?, ?, ?, ?, ?)',
            [guildId, messageId, question, options, correctAnswer]
        );
    }

    async getQuizQuestion(messageId) {
        return this.get('SELECT * FROM quiz_questions WHERE message_id = ?', [messageId]);
    }

    async updateQuizScore(guildId, userId, correct) {
        const existing = await this.get(
            'SELECT * FROM quiz_scores WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );

        if (existing) {
            return this.run(
                'UPDATE quiz_scores SET correct_answers = correct_answers + ?, total_answers = total_answers + 1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?',
                [correct ? 1 : 0, guildId, userId]
            );
        } else {
            return this.run(
                'INSERT INTO quiz_scores (guild_id, user_id, correct_answers, total_answers) VALUES (?, ?, ?, 1)',
                [guildId, userId, correct ? 1 : 0]
            );
        }
    }

    async getQuizLeaderboard(guildId, limit = 10) {
        return this.all(
            'SELECT * FROM quiz_scores WHERE guild_id = ? ORDER BY correct_answers DESC, total_answers ASC LIMIT ?',
            [guildId, limit]
        );
    }

    // Ticket methods
    async setTicketSettings(guildId, channelId, supportRoleId) {
        return this.run(
            'INSERT OR REPLACE INTO ticket_settings (guild_id, channel_id, support_role_id) VALUES (?, ?, ?)',
            [guildId, channelId, supportRoleId]
        );
    }

    async getTicketSettings(guildId) {
        return this.get('SELECT * FROM ticket_settings WHERE guild_id = ?', [guildId]);
    }

    async createTicket(guildId, userId, channelId) {
        return this.run(
            'INSERT INTO tickets (guild_id, user_id, channel_id, status) VALUES (?, ?, ?, ?)',
            [guildId, userId, channelId, 'open']
        );
    }

    async getOpenTicket(guildId, userId) {
        return this.get(
            'SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
            [guildId, userId, 'open']
        );
    }

    async getTicketByChannel(channelId) {
        return this.get('SELECT * FROM tickets WHERE channel_id = ?', [channelId]);
    }

    async closeTicket(channelId) {
        return this.run(
            'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            ['closed', channelId]
        );
    }

    async getTicketStats(guildId) {
        const total = await this.get(
            'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?',
            [guildId]
        );
        const open = await this.get(
            'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
            [guildId, 'open']
        );
        const closed = await this.get(
            'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = ?',
            [guildId, 'closed']
        );

        return {
            total: total ? total.count : 0,
            open: open ? open.count : 0,
            closed: closed ? closed.count : 0
        };
    }

    // Community tickets methods
    async createCommunityTicket(guildId, userId, code) {
        return this.run(
            'INSERT INTO community_tickets (guild_id, user_id, code) VALUES (?, ?, ?)',
            [guildId, userId, code]
        );
    }

    async getCommunityTicket(code) {
        return this.get('SELECT * FROM community_tickets WHERE code = ?', [code]);
    }

    async useCommunityTicket(code) {
        return this.run(
            'UPDATE community_tickets SET used = 1 WHERE code = ?',
            [code]
        );
    }

    // Close database connection
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('✓ Database connection closed');
                    resolve();
                }
            });
        });
    }
}

module.exports = Database;