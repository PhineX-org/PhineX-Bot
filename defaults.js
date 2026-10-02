const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};
const asArray = value => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 100) : [];

const DEFAULT_AUTOMOD = {
    enabled: false, blockInvites: false, blockLinks: false,
    badWords: [], maxMentions: 0,
    spam: { enabled: false, messages: 5, seconds: 8 },
    action: 'delete', timeoutMinutes: 10, ignoredChannels: [], ignoredRoles: [],
    warnThreshold: 0, thresholdAction: 'timeout', thresholdMinutes: 10
};
const DEFAULT_LEVELING = {
    enabled: false, xpMin: 5, xpMax: 15, cooldown: 60, announce: 'channel', channelId: null,
    message: '{user} reached level {level}!', roleRewards: [], ignoredChannels: []
};
const DEFAULT_LOGGING = { joins: false, leaves: false, messageDeletes: false, messageEdits: false, moderation: true };

function sanitizeAutomod(input = {}) {
    const a = input && typeof input === 'object' ? input : {};
    const spam = a.spam && typeof a.spam === 'object' ? a.spam : {};
    return {
        enabled: !!a.enabled, blockInvites: !!a.blockInvites, blockLinks: !!a.blockLinks,
        badWords: asArray(a.badWords).map(w => w.trim().slice(0, 80)).filter(Boolean).slice(0, 100),
        maxMentions: clamp(a.maxMentions, 0, 50, 0),
        spam: { enabled: !!spam.enabled, messages: clamp(spam.messages, 2, 30, 5), seconds: clamp(spam.seconds, 2, 60, 8) },
        action: ['delete', 'warn', 'timeout'].includes(a.action) ? a.action : 'delete',
        timeoutMinutes: clamp(a.timeoutMinutes, 1, 40320, 10),
        ignoredChannels: asArray(a.ignoredChannels), ignoredRoles: asArray(a.ignoredRoles),
        warnThreshold: clamp(a.warnThreshold, 0, 20, 0),
        thresholdAction: ['timeout', 'kick', 'ban'].includes(a.thresholdAction) ? a.thresholdAction : 'timeout',
        thresholdMinutes: clamp(a.thresholdMinutes, 1, 40320, 10)
    };
}
function sanitizeLeveling(input = {}) {
    const l = input && typeof input === 'object' ? input : {};
    const rewards = Array.isArray(l.roleRewards) ? l.roleRewards.slice(0, 50).map(r => ({ level: clamp(r.level, 1, 500, 1), roleId: String(r.roleId || '') })).filter(r => r.roleId) : [];
    return { enabled: !!l.enabled, xpMin: clamp(l.xpMin, 1, 500, 5), xpMax: clamp(l.xpMax, 1, 1000, 15), cooldown: clamp(l.cooldown, 5, 3600, 60), announce: ['channel', 'dm', 'off'].includes(l.announce) ? l.announce : 'channel', channelId: l.channelId ? String(l.channelId) : null, message: String(l.message || DEFAULT_LEVELING.message).slice(0, 300), roleRewards: rewards, ignoredChannels: asArray(l.ignoredChannels) };
}
function sanitizeLogging(input = {}) {
    const l = input && typeof input === 'object' ? input : {};
    return { joins: !!l.joins, leaves: !!l.leaves, messageDeletes: !!l.messageDeletes, messageEdits: !!l.messageEdits, moderation: l.moderation !== false };
}
function int(value, min, max, fallback) { return clamp(value, min, max, fallback); }
function levelFromXp(xp) { const x = Math.max(0, Number(xp) || 0); const level = Math.floor(Math.sqrt(x / 100)); return { level, progress: x - level * level * 100, next: (level + 1) * (level + 1) * 100 }; }
function defaults() { return { welcome_channel: null, welcome_message: null, welcome_role: null, leave_channel: null, leave_message: null, suggestions_channel: null, starboard_channel: null, starboard_emoji: '⭐', starboard_threshold: 3, log_channel: null, automod: { ...DEFAULT_AUTOMOD, spam: { ...DEFAULT_AUTOMOD.spam } }, leveling: { ...DEFAULT_LEVELING, roleRewards: [] }, logging: { ...DEFAULT_LOGGING } }; }
module.exports = { DEFAULT_AUTOMOD, DEFAULT_LEVELING, DEFAULT_LOGGING, sanitizeAutomod, sanitizeLeveling, sanitizeLogging, int, levelFromXp, defaults };
