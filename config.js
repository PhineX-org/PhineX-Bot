const fs = require('fs');
const path = require('path');
require('dotenv').config();

function readJsonConfig() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return {};
    }
}

const file = readJsonConfig();
const env = process.env;
const port = Number(env.PORT || file.port || 3000);
const baseUrl = String(env.BASE_URL || env.API_URL || file.apiURL || `http://localhost:${port}`).replace(/\/$/, '');
const dashboardURL = String(env.DASHBOARD_URL || file.dashboardURL || baseUrl).replace(/\/$/, '');
const sessionSecret = env.SESSION_SECRET || file.sessionSecret;

if (!env.NODE_ENV && !sessionSecret) {
    console.warn('⚠️ SESSION_SECRET is not configured; using a temporary development secret. Set it in production.');
}

module.exports = {
    botToken: env.BOT_TOKEN || file.botToken,
    clientId: env.CLIENT_ID || file.clientId || '1488586644821905458',
    clientSecret: env.CLIENT_SECRET || file.clientSecret,
    callbackURL: env.CALLBACK_URL || file.callbackURL || `${baseUrl}/auth/callback`,
    botInviteUrl: env.BOT_INVITE_URL || file.botInviteUrl || 'https://discord.com/oauth2/authorize?client_id=1488586644821905458&permissions=8&integration_type=0&scope=bot',
    dashboardURL,
    baseUrl,
    sessionSecret: sessionSecret || 'development-only-change-me',
    supabaseUrl: env.SUPABASE_URL || file.supabaseUrl || 'https://ycanwdrimhoohoufbmds.supabase.co',
    supabasePublicKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || file.supabaseAnonKey || file.supabasePublicKey || 'sb_publishable_0-6f075XfdAGqNd8-2zT8Q_rKAgYWWi',
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY || file.supabaseServiceKey || file.supabaseKey,
    port
};
