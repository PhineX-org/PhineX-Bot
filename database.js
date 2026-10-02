const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');

class Database {
    constructor(dbPath = 'phinex-bot.db') {
        // SQLite (local persistence — role menus, warnings, quiz, starboard, social links, giveaways)
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ SQLite error:', err);
            } else {
                console.log('✓ SQLite connected');
                this.initTables();
            }
        });

        // Supabase (tickets, community tickets)
        // ✅ FIX: _env.example already listed SUPABASE_SERVICE_KEY but nothing
        // ever read it — this server-side client used the anon key only. If
        // you tighten RLS (recommended, see supabase_rls_hardening.sql), the
        // backend needs the *service role* key to keep working, since it's a
        // trusted context that already enforces its own checks (admin code,
        // single-use tickets, Discord OAuth on the dashboard). The anon key
        // stays public/client-safe for community.html's direct reads.
        let supabaseUrl = process.env.SUPABASE_URL;
        let supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_ANON_KEY) {
            console.warn('⚠️  SUPABASE_SERVICE_KEY not set — falling back to the anon key server-side. This is fine with the default (permissive) RLS policies, but will break ticket/admin features if you lock RLS down. See supabase_rls_hardening.sql.');
        }

        if (!supabaseUrl && global.supabaseConfig) {
            supabaseUrl = global.supabaseConfig.url;
            supabaseKey = global.supabaseConfig.key;
        }

        if (supabaseUrl && supabaseKey) {
            this.supabase = createClient(supabaseUrl, supabaseKey);
            console.log('✓ Supabase connected');
        } else {
            console.warn('⚠️  Supabase credentials missing — community ticket features limited');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SQLite TABLE INIT
    // ═══════════════════════════════════════════════════════════════════════════
    initTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                welcome_channel TEXT,
                welcome_message TEXT,
                welcome_role TEXT,
                leave_channel TEXT,
                leave_message TEXT,
                suggestions_channel TEXT,
                starboard_channel TEXT,
                starboard_emoji TEXT DEFAULT '⭐',
                starboard_threshold INTEGER DEFAULT 3,
                log_channel TEXT,
                automod TEXT,
                leveling TEXT,
                logging TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS role_menus (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS role_menu_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                role_id TEXT NOT NULL,
                description TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS warnings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS mod_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS starboard_messages (
                message_id TEXT PRIMARY KEY,
                starboard_message_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS social_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                platform TEXT NOT NULL,
                link TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, platform)
            )`,
            `CREATE TABLE IF NOT EXISTS quiz_settings (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                start_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS quiz_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                correct_answer INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS quiz_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                correct_answers INTEGER DEFAULT 0,
                total_answers INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,
            `CREATE TABLE IF NOT EXISTS giveaways (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                prize TEXT,
                winners INTEGER DEFAULT 1,
                end_time INTEGER,
                ended INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS coding_channels (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                auto_execute INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const sql of tables) {
            this.db.run(sql, err => {
                if (err) console.error('Table init error:', err.message);
            });
        }
        const additions = [
            ['welcome_role', 'TEXT'], ['leave_channel', 'TEXT'], ['leave_message', 'TEXT'],
            ['log_channel', 'TEXT'], ['automod', 'TEXT'], ['leveling', 'TEXT'], ['logging', 'TEXT']
        ];
        this.db.all('PRAGMA table_info(guild_settings)', (err, cols = []) => {
            if (err) return console.error('Settings migration inspect failed:', err.message);
            const existing = new Set(cols.map(c => c.name));
            for (const [name, type] of additions) if (!existing.has(name)) {
                this.db.run(`ALTER TABLE guild_settings ADD COLUMN ${name} ${type}`, e => {
                    if (e) console.error(`Settings migration failed for ${name}:`, e.message);
                });
            }
        });
        console.log('✓ SQLite tables ready');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SQLite PROMISE WRAPPERS
    // ═══════════════════════════════════════════════════════════════════════════
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    ping() {
        return this.get('SELECT 1 AS ok');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GUILD SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════
    async getGuildSettings(guildId) {
        const row = await this.get('SELECT * FROM guild_settings WHERE guild_id = ?', [guildId]);
        if (!row) return { guild_id: guildId, welcome_channel: null, welcome_message: null, welcome_role: null, leave_channel: null, leave_message: null, suggestions_channel: null, starboard_channel: null, starboard_emoji: '⭐', starboard_threshold: 3, log_channel: null, automod: null, leveling: null, logging: null };
        for (const key of ['automod', 'leveling', 'logging']) if (typeof row[key] === 'string') {
            try { row[key] = JSON.parse(row[key]); } catch { row[key] = null; }
        }
        return row;
    }

    async updateGuildSettings(guildId, updates = {}) {
        updates = { ...updates };
        for (const key of ['automod', 'leveling', 'logging']) if (updates[key] && typeof updates[key] !== 'string') updates[key] = JSON.stringify(updates[key]);
        const existing = await this.getGuildSettings(guildId);
        if (!existing) {
            const cols   = ['guild_id', ...Object.keys(updates)];
            const vals   = [guildId, ...Object.values(updates)];
            const placeholders = vals.map(() => '?').join(', ');
            return this.run(
                `INSERT INTO guild_settings (${cols.join(', ')}) VALUES (${placeholders})`,
                vals
            );
        } else {
            const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            const result = await this.run(
                `UPDATE guild_settings SET ${setClauses} WHERE guild_id = ?`,
                [...Object.values(updates), guildId]
            );
            if (!result.changes) {
                const cols = ['guild_id', ...Object.keys(updates)];
                const vals = [guildId, ...Object.values(updates)];
                return this.run(`INSERT INTO guild_settings (${cols.join(', ')}) VALUES (${vals.map(() => '?').join(', ')})`, vals);
            }
            return result;
        }
    }

    async setWelcomeChannel(guildId, channelId, message) {
        return this.updateGuildSettings(guildId, { welcome_channel: channelId, welcome_message: message });
    }

    async setSuggestionsChannel(guildId, channelId) {
        return this.updateGuildSettings(guildId, { suggestions_channel: channelId });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ROLE MENUS
    // ═══════════════════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════════════════
    // WARNINGS & MOD LOGS
    // ═══════════════════════════════════════════════════════════════════════════
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
        const row = await this.get(
            'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );
        return row ? row.count : 0;
    }

    async logModeration(guildId, userId, type, moderatorId, reason) {
        return this.run(
            'INSERT INTO mod_logs (guild_id, user_id, type, moderator_id, reason) VALUES (?, ?, ?, ?, ?)',
            [guildId, userId, type, moderatorId, reason]
        );
    }

    // ✅ FIX: was missing — referenced in server.js /api/guild/:guildId/logs
    async getModerationLogs(guildId, limit = 50) {
        return this.all(
            'SELECT * FROM mod_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
            [guildId, limit]
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STARBOARD
    // ═══════════════════════════════════════════════════════════════════════════
    async addStarboardMessage(messageId, starboardMessageId) {
        return this.run(
            'INSERT INTO starboard_messages (message_id, starboard_message_id) VALUES (?, ?)',
            [messageId, starboardMessageId]
        );
    }

    async getStarboardMessage(messageId) {
        return this.get('SELECT * FROM starboard_messages WHERE message_id = ?', [messageId]);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SOCIAL LINKS
    // ═══════════════════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════════════════
    // QUIZ
    // ═══════════════════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════════════════
    // GIVEAWAYS
    // ═══════════════════════════════════════════════════════════════════════════
    async createGiveaway(guildId, messageId, channelId, prize, winners, endTime) {
        return this.run(
            'INSERT INTO giveaways (guild_id, message_id, channel_id, prize, winners, end_time) VALUES (?, ?, ?, ?, ?, ?)',
            [guildId, messageId, channelId, prize, winners, endTime]
        );
    }

    async getActiveGiveaways() {
        return this.all('SELECT * FROM giveaways WHERE ended = 0');
    }

    async endGiveaway(messageId) {
        return this.run('UPDATE giveaways SET ended = 1 WHERE message_id = ?', [messageId]);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — TICKET SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════
    async setTicketSettings(guildId, settings) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const payload = {
            guild_id: guildId,
            updated_at: new Date().toISOString()
        };
        if (settings.supportChannelId  !== undefined) payload.support_channel_id   = settings.supportChannelId;
        if (settings.supportRoleId     !== undefined) payload.support_role_id      = settings.supportRoleId;
        if (settings.communityChannelId !== undefined) payload.community_channel_id = settings.communityChannelId;
        if (settings.communityLinks    !== undefined) payload.community_links      = JSON.stringify(settings.communityLinks);

        const { data, error } = await this.supabase
            .from('ticket_settings')
            .upsert(payload, { onConflict: 'guild_id' })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async getTicketSettings(guildId) {
        if (!this.supabase) return null;
        const { data, error } = await this.supabase
            .from('ticket_settings')
            .select('*')
            .eq('guild_id', guildId)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data?.community_links && typeof data.community_links === 'string') {
            try { data.community_links = JSON.parse(data.community_links); } catch { /* ignore */ }
        }
        return data;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — COMMUNITY TICKETS
    // ═══════════════════════════════════════════════════════════════════════════
    async createCommunityTicket(guildId, userId, code, isAdmin = false) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('community_tickets')
            .insert({ guild_id: guildId, user_id: userId, code, is_admin: isAdmin, used: false })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async getCommunityTicket(code) {
        if (!this.supabase) return null;
        const { data, error } = await this.supabase
            .from('community_tickets')
            .select('*')
            .eq('code', code)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        return data;
    }

    async getUserCommunityTickets(guildId, userId) {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('community_tickets')
            .select('*')
            .eq('guild_id', guildId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error && error.code !== 'PGRST116') throw error;
        return data || [];
    }

    async useCommunityTicket(code) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('community_tickets')
            .update({ used: true, used_at: new Date().toISOString() })
            .eq('code', code)
            .eq('used', false)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — SUPPORT TICKETS
    // ═══════════════════════════════════════════════════════════════════════════
    async createSupportTicket(guildId, userId, channelId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('support_tickets')
            .insert({ guild_id: guildId, user_id: userId, channel_id: channelId, status: 'open' })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async getOpenSupportTicket(guildId, userId) {
        if (!this.supabase) return null;
        const { data, error } = await this.supabase
            .from('support_tickets')
            .select('*')
            .eq('guild_id', guildId)
            .eq('user_id', userId)
            .eq('status', 'open')
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async getSupportTicketByChannel(channelId) {
        if (!this.supabase) return null;
        const { data, error } = await this.supabase
            .from('support_tickets')
            .select('*')
            .eq('channel_id', channelId)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async closeSupportTicket(channelId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('support_tickets')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .eq('channel_id', channelId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — COMMUNITY POSTS
    // ═══════════════════════════════════════════════════════════════════════════
    async createPost(guildId, authorId, authorName, title, content, imageUrl = null) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('community_posts')
            .insert({ guild_id: guildId, author_id: authorId, author_name: authorName, title, content, image_url: imageUrl, likes: 0 })
            .select().single();
        if (error) throw error;
        return data;
    }

    async getPosts(guildId, limit = 50, offset = 0) {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('community_posts').select('*').eq('guild_id', guildId)
            .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (error) throw error;
        return data || [];
    }

    // ✅ FIX: was missing — referenced in server.js /api/community/posts/:postId/like
    async getPost(postId) {
        if (!this.supabase) return null;
        const { data, error } = await this.supabase
            .from('community_posts')
            .select('*')
            .eq('id', postId)
            .single();
        if (error && error.code !== 'PGRST116') throw error;
        return data;
    }

    // ✅ FIX: was missing
    async deletePost(postId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        // Delete likes and comments first
        await this.supabase.from('community_post_likes').delete().eq('post_id', postId);
        await this.supabase.from('community_comments').delete().eq('post_id', postId);
        const { error } = await this.supabase
            .from('community_posts')
            .delete()
            .eq('id', postId);
        if (error) throw error;
    }

    // ✅ FIX: was missing — referenced in server.js /api/community/posts/:postId/like
    async likePost(postId, userId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        // Insert like record (ignore duplicate)
        await this.supabase
            .from('community_post_likes')
            .upsert({ post_id: postId, user_id: userId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
        // Increment likes counter
        const { data: post } = await this.supabase.from('community_posts').select('likes').eq('id', postId).single();
        const { error } = await this.supabase
            .from('community_posts')
            .update({ likes: (post?.likes || 0) + 1 })
            .eq('id', postId);
        if (error) throw error;
    }

    // ✅ FIX: was missing
    async unlikePost(postId, userId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        await this.supabase
            .from('community_post_likes')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', userId);
        const { data: post } = await this.supabase.from('community_posts').select('likes').eq('id', postId).single();
        const { error } = await this.supabase
            .from('community_posts')
            .update({ likes: Math.max(0, (post?.likes || 1) - 1) })
            .eq('id', postId);
        if (error) throw error;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — COMMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ✅ FIX: was missing — referenced in server.js
    async getComments(postId) {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('community_comments')
            .select('*')
            .eq('post_id', postId)
            .is('parent_id', null)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    // ✅ FIX: was missing
    async createComment(postId, authorId, authorName, content, parentId = null) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const payload = { post_id: postId, author_id: authorId, author_name: authorName, content };
        if (parentId) payload.parent_id = parentId;
        const { data, error } = await this.supabase
            .from('community_comments')
            .insert(payload)
            .select().single();
        if (error) throw error;
        return data;
    }

    // ✅ FIX: was missing
    async deleteComment(commentId) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        // Delete replies first
        await this.supabase.from('community_comments').delete().eq('parent_id', commentId);
        const { error } = await this.supabase
            .from('community_comments')
            .delete()
            .eq('id', commentId);
        if (error) throw error;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPABASE — CHAT MESSAGES
    // ═══════════════════════════════════════════════════════════════════════════
    async createChatMessage(guildId, channelType, authorId, authorName, content) {
        if (!this.supabase) throw new Error('Supabase not initialized');
        const { data, error } = await this.supabase
            .from('community_chat_messages')
            .insert({ guild_id: guildId, channel_type: channelType, author_id: authorId, author_name: authorName, content })
            .select().single();
        if (error) throw error;
        return data;
    }

    // ✅ FIX: server.js already passed a 4th `offset` argument for pagination,
    // but it was silently dropped here — every "page" returned the same
    // most-recent `limit` messages.
    async getChatMessages(guildId, channelType, limit = 100, offset = 0) {
        if (!this.supabase) return [];
        const { data, error } = await this.supabase
            .from('community_chat_messages').select('*')
            .eq('guild_id', guildId).eq('channel_type', channelType)
            .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (error) throw error;
        return (data || []).reverse();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CODING CHANNELS
    // ═══════════════════════════════════════════════════════════════════════════
    async setCodingChannel(guildId, channelId) {
        return this.run(
            `INSERT OR REPLACE INTO coding_channels (guild_id, channel_id, auto_execute) VALUES (?, ?, 1)`,
            [guildId, channelId]
        );
    }

    async getCodingChannel(guildId) {
        return this.get(`SELECT * FROM coding_channels WHERE guild_id = ?`, [guildId]);
    }

    async removeCodingChannel(guildId) {
        return this.run(`DELETE FROM coding_channels WHERE guild_id = ?`, [guildId]);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLOSE
    // ═══════════════════════════════════════════════════════════════════════════
    close() {
        return new Promise((resolve, reject) => {
            this.db.close(err => {
                if (err) reject(err);
                else { console.log('✓ Database closed'); resolve(); }
            });
        });
    }
}

module.exports = Database;
