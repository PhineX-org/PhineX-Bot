// ═══════════════════════════════════════════════════════════════════════════
// deploy-commands.js
//
// bot.js handles 27 slash commands inside client.on('interactionCreate', ...)
// but nothing in the project ever registered those commands with Discord's
// API — SlashCommandBuilder/REST/Routes were imported in bot.js but never
// used. Discord only shows/sends interactions for commands that have been
// explicitly registered, so every /command was invisible until this script
// is run once (and again any time a command's name/options change).
//
// Usage:
//   node deploy-commands.js            → registers GLOBAL commands
//                                         (can take up to ~1 hour to appear)
//   GUILD_ID=xxxxxxxxxxxx node deploy-commands.js
//                                       → registers commands to ONE guild
//                                         (appears instantly — best for dev)
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

// ─── CONFIG (same loading pattern as bot.js / server.js) ───────────────────
let config;
if (process.env.BOT_TOKEN) {
    config = {
        botToken: process.env.BOT_TOKEN,
        clientId: process.env.CLIENT_ID
    };
} else {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
}

if (!config.botToken || !config.clientId) {
    console.error('❌ Missing botToken/clientId. Set BOT_TOKEN + CLIENT_ID env vars, or fill config.json.');
    process.exit(1);
}

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

// ─── COMMAND DEFINITIONS ─────────────────────────────────────────────────────
const commands = [

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all PhineX Bot commands'),

    new SlashCommandBuilder()
        .setName('send-message')
        .setDescription('Send a formatted code block to a channel via a popup editor')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('language').setDescription('Code block language (e.g. javascript, python)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('social')
        .setDescription('Show this server\'s social links'),

    new SlashCommandBuilder()
        .setName('addsocial')
        .setDescription('Add a social link')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('platform').setDescription('Platform name, e.g. Twitter').setRequired(true))
        .addStringOption(o => o.setName('link').setDescription('Full URL').setRequired(true)),

    new SlashCommandBuilder()
        .setName('removesocial')
        .setDescription('Remove a social link')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('platform').setDescription('Platform name to remove').setRequired(true)),

    new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a reaction poll')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post the poll').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
        .addStringOption(o => o.setName('options').setDescription('2-10 options separated by |').setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #39ff14').setRequired(false))
        .addIntegerOption(o => o.setName('duration').setDescription('Auto-close after this many minutes').setMinValue(1).setRequired(false)),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Post a formatted announcement')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to announce in').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Announcement body').setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #ff0000').setRequired(false))
        .addBooleanOption(o => o.setName('ping_everyone').setDescription('Ping @everyone?').setRequired(false)),

    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start a giveaway')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to host the giveaway').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('e.g. 30s, 10m, 1h, 2d').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setMinValue(1).setRequired(true))
        .addStringOption(o => o.setName('prize').setDescription('What are you giving away?').setRequired(true)),

    new SlashCommandBuilder()
        .setName('rolemenu')
        .setDescription('Create a reaction role menu')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post the menu').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Menu title').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Menu description').setRequired(false)),

    new SlashCommandBuilder()
        .setName('addrole-menu')
        .setDescription('Add a role to the most recently created role menu')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji users react with').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Shown next to the role').setRequired(false)),

    new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion')
        .addStringOption(o => o.setName('suggestion').setDescription('Your suggestion').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setup-suggestions')
        .setDescription('Set the channel suggestions are posted to')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Suggestions channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true)),

    new SlashCommandBuilder()
        .setName('setup-welcome')
        .setDescription('Configure welcome messages')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Welcome channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Use {user} and {server} as placeholders').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setup-starboard')
        .setDescription('Configure the starboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Starboard channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji to track (default ⭐)').setRequired(false))
        .addIntegerOption(o => o.setName('threshold').setDescription('Reactions needed (default 3)').setMinValue(1).setRequired(false)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Time out a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('User to time out').setRequired(true))
        .addIntegerOption(o => o.setName('duration').setDescription('Minutes (max 40320 = 28 days)').setMinValue(1).setMaxValue(40320).setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View a member\'s warnings')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)),

    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Bulk-delete recent messages (max 100, under 14 days old)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete').setMinValue(1).setMaxValue(100).setRequired(true)),

    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Show server statistics'),

    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Show information about a user')
        .addUserOption(o => o.setName('user').setDescription('User to look up (default: you)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('setup-quiz')
        .setDescription('Configure the quiz channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Quiz channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
        .addStringOption(o => o.setName('start_message').setDescription('Message shown when the quiz starts').setRequired(false)),

    new SlashCommandBuilder()
        .setName('quiz')
        .setDescription('Post a quiz question')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('question').setDescription('The question').setRequired(true))
        .addStringOption(o => o.setName('option1').setDescription('Option 1').setRequired(true))
        .addStringOption(o => o.setName('option2').setDescription('Option 2').setRequired(true))
        .addStringOption(o => o.setName('option3').setDescription('Option 3').setRequired(false))
        .addStringOption(o => o.setName('option4').setDescription('Option 4').setRequired(false))
        .addIntegerOption(o => o.setName('correct').setDescription('Which option number is correct (1-4)').setMinValue(1).setMaxValue(4).setRequired(true)),

    new SlashCommandBuilder()
        .setName('quiz-leaderboard')
        .setDescription('Show the quiz leaderboard'),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Support ticket system')
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Set up the support ticket panel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel for the ticket button').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
            .addRoleOption(o => o.setName('support_role').setDescription('Role that can see new tickets').setRequired(true))
            .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(false))
            .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
            .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(false))
            .addStringOption(o => o.setName('button_label').setDescription('Button label').setRequired(false))
            .addStringOption(o => o.setName('button_emoji').setDescription('Button emoji').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close the current ticket channel')),

    new SlashCommandBuilder()
        .setName('community-ticket')
        .setDescription('Community access-code system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Set up the community access panel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel for the access button').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true))
            .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(false))
            .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
            .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(false))
            .addStringOption(o => o.setName('button_label').setDescription('Button label').setRequired(false))
            .addStringOption(o => o.setName('button_emoji').setDescription('Button emoji').setRequired(false))),

].map(c => c.toJSON());

// ─── REGISTER ────────────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(config.botToken);

(async () => {
    try {
        console.log(`⏳ Registering ${commands.length} slash commands...`);

        const guildId = process.env.GUILD_ID;
        const route = guildId
            ? Routes.applicationGuildCommands(config.clientId, guildId)
            : Routes.applicationCommands(config.clientId);

        await rest.put(route, { body: commands });

        if (guildId) {
            console.log(`✅ Registered ${commands.length} commands to guild ${guildId} (visible immediately).`);
        } else {
            console.log(`✅ Registered ${commands.length} global commands (can take up to ~1 hour to appear everywhere).`);
        }
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
        process.exit(1);
    }
})();
