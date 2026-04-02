const Discord = require('discord.js');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ChannelType, REST, Routes } = require('discord.js');
const fs = require('fs');
const Database = require('./database.js');

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
        console.log('✓ Loaded config from environment variables');
    } else {
        // Running locally with config.json
        config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        console.log('✓ Loaded config from config.json');
    }
} catch (e) {
    console.error('❌ Error loading config:', e.message);
    process.exit(1);
}

// Text fonts/styles for fancy messages
const FONTS = {
    'normal': (text) => text,
    'bold': (text) => text.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 97 && code <= 122) return String.fromCharCode(code + 119743);
        if (code >= 65 && code <= 90) return String.fromCharCode(code + 119743);
        if (code >= 48 && code <= 57) return String.fromCharCode(code + 120734);
        return c;
    }).join(''),
    'italic': (text) => text.split('').map(c => {
        const code = c.charCodeAt(0);
        if (code >= 97 && code <= 122) return String.fromCharCode(code + 119795);
        if (code >= 65 && code <= 90) return String.fromCharCode(code + 119795);
        return c;
    }).join(''),
    'monospace': (text) => '`' + text + '`',
    'strikethrough': (text) => '~~' + text + '~~',
    'underline': (text) => '__' + text + '__',
    'spoiler': (text) => '||' + text + '||'
};

// Register slash commands
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('View all available commands'),
        
        new SlashCommandBuilder()
            .setName('write')
            .setDescription('Send a custom message to a channel')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send the message to')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('The message to send')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('Embed color (hex code like #FF0000)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('font')
                    .setDescription('Text style/font')
                    .addChoices(
                        { name: 'Normal', value: 'normal' },
                        { name: 'Bold', value: 'bold' },
                        { name: 'Italic', value: 'italic' },
                        { name: 'Monospace', value: 'monospace' },
                        { name: 'Strikethrough', value: 'strikethrough' },
                        { name: 'Underline', value: 'underline' },
                        { name: 'Spoiler', value: 'spoiler' }
                    )
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('poll')
            .setDescription('Create a poll')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send the poll to')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('question')
                    .setDescription('Poll question')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('options')
                    .setDescription('Poll options separated by | (e.g., Option1 | Option2 | Option3)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('Poll embed color (hex code)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('duration')
                    .setDescription('Poll duration in minutes')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('social')
            .setDescription('Display social links')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send the social links to')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('giveaway')
            .setDescription('Start a giveaway')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to host the giveaway')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('duration')
                    .setDescription('Duration (e.g., 1h, 30m, 2d)')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('winners')
                    .setDescription('Number of winners')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('prize')
                    .setDescription('Prize description')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('rolemenu')
            .setDescription('Create a role selection menu')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send the role menu')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('Title for the role menu')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('description')
                    .setDescription('Description')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('addrole-menu')
            .setDescription('Add a role to the role menu (last created)')
            .addRoleOption(option =>
                option.setName('role')
                    .setDescription('Role to add')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('emoji')
                    .setDescription('Emoji for this role')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('description')
                    .setDescription('Description')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('announce')
            .setDescription('Make an announcement')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel to send announcement')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('Announcement title')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('Announcement message')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('Embed color (hex code)')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('ping_everyone')
                    .setDescription('Ping @everyone?')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('starboard')
            .setDescription('Configure starboard')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Starboard channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('threshold')
                    .setDescription('Number of stars required (default: 3)')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('emoji')
                    .setDescription('Custom emoji (default: ⭐)')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('suggest')
            .setDescription('Submit a suggestion')
            .addStringOption(option =>
                option.setName('suggestion')
                    .setDescription('Your suggestion')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('setup-suggestions')
            .setDescription('Setup suggestions channel')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Channel for suggestions')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('welcome')
            .setDescription('Setup welcome messages')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('Welcome channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('Welcome message (use {user} for mention, {server} for server name)')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Ban a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to ban')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for ban')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('kick')
            .setDescription('Kick a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to kick')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for kick')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Warn a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to warn')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for warning')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('Check warnings for a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to check warnings for')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('clear-warnings')
            .setDescription('Clear all warnings for a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to clear warnings for')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('serverinfo')
            .setDescription('Display server information'),
        
        new SlashCommandBuilder()
            .setName('userinfo')
            .setDescription('Display user information')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to get info about')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('avatar')
            .setDescription('Get user avatar')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to get avatar of')
                    .setRequired(false)),
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.botToken);

    try {
        console.log('🔄 Started refreshing slash commands...');
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands },
        );
        console.log('✅ Successfully reloaded slash commands!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

client.on('ready', async () => {
    console.log(`✅ PhineX Bot is online as ${client.user.tag}`);
    client.user.setActivity('/help | PhineX Dashboard', { type: 'Watching' });
    await registerCommands();
});

// Slash Command Handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    try {
        if (commandName === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle('🤖 PhineX Bot Commands')
                .setDescription('Powerful server management with slash commands!')
                .addFields(
                    { name: '📝 Message Commands', value: '`/write` - Send custom messages\n`/announce` - Make announcements\n`/social` - Display social links', inline: false },
                    { name: '📊 Interactive', value: '`/poll` - Create polls\n`/suggest` - Submit suggestions', inline: false },
                    { name: '🎁 Engagement', value: '`/giveaway` - Start giveaways\n`/rolemenu` - Create role menus\n`/starboard` - Setup starboard', inline: false },
                    { name: '🔨 Moderation', value: '`/ban` `/kick` `/warn` - Moderation\n`/warnings` - Check warnings\n`/clear-warnings` - Clear warnings', inline: false },
                    { name: '⚙️ Setup', value: '`/setup-suggestions` - Setup suggestions\n`/welcome` - Setup welcome messages', inline: false },
                    { name: 'ℹ️ Info', value: '`/serverinfo` `/userinfo` `/avatar` - Get info', inline: false },
                    { name: '🌐 Dashboard', value: `[Visit Dashboard](${config.dashboardURL})`, inline: false }
                )
                .setFooter({ text: 'PhineX Bot - Your Server Control Center' })
                .setTimestamp();

            return interaction.reply({ embeds: [helpEmbed] });
        }

        if (commandName === 'write') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ You need Manage Messages permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const color = options.getString('color') || '#00ffff';
            const font = options.getString('font') || 'normal';

            const styledMessage = FONTS[font](message);

            const embed = new EmbedBuilder()
                .setDescription(styledMessage)
                .setColor(color)
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            return interaction.reply({ content: `✅ Message sent to ${channel}!`, ephemeral: true });
        }

        if (commandName === 'poll') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return interaction.reply({ content: '❌ You need Manage Messages permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const question = options.getString('question');
            const optionsString = options.getString('options');
            const color = options.getString('color') || '#00ffff';
            const duration = options.getInteger('duration');

            const pollOptions = optionsString.split('|').map(o => o.trim()).filter(o => o.length > 0);

            if (pollOptions.length < 2 || pollOptions.length > 10) {
                return interaction.reply({ content: '❌ Please provide 2-10 options!', ephemeral: true });
            }

            const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            let description = pollOptions.map((opt, i) => `${emoji[i]} ${opt}`).join('\n\n');
            
            if (duration) {
                const endTime = Date.now() + (duration * 60 * 1000);
                description += `\n\n⏱️ **Ends:** <t:${Math.floor(endTime / 1000)}:R>`;
            }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📊 ' + question)
                .setDescription(description)
                .setFooter({ text: `Poll by ${interaction.user.tag}` })
                .setTimestamp();

            const pollMsg = await channel.send({ embeds: [embed] });
            for (let i = 0; i < pollOptions.length; i++) {
                await pollMsg.react(emoji[i]);
            }

            return interaction.reply({ content: `✅ Poll created in ${channel}!`, ephemeral: true });
        }

        if (commandName === 'social') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const settings = await db.getGuildSettings(interaction.guild.id);
            const socialLinks = settings && settings.social_links ? JSON.parse(settings.social_links) : {};

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle('🌐 Our Social Links')
                .setDescription('Connect with us on our social platforms!')
                .setThumbnail(interaction.guild.iconURL())
                .setTimestamp();

            if (Object.keys(socialLinks).length === 0) {
                embed.addFields({ name: '⚠️ No Social Links', value: 'Configure social links in the dashboard!' });
            } else {
                if (socialLinks.website) embed.addFields({ name: '🌐 Website', value: socialLinks.website, inline: true });
                if (socialLinks.twitter) embed.addFields({ name: '🐦 Twitter', value: socialLinks.twitter, inline: true });
                if (socialLinks.youtube) embed.addFields({ name: '📺 YouTube', value: socialLinks.youtube, inline: true });
                if (socialLinks.instagram) embed.addFields({ name: '📷 Instagram', value: socialLinks.instagram, inline: true });
                if (socialLinks.discord) embed.addFields({ name: '💬 Discord', value: socialLinks.discord, inline: true });
                if (socialLinks.github) embed.addFields({ name: '💻 GitHub', value: socialLinks.github, inline: true });
            }

            await channel.send({ embeds: [embed] });
            return interaction.reply({ content: `✅ Social links sent to ${channel}!`, ephemeral: true });
        }

        if (commandName === 'giveaway') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const duration = options.getString('duration');
            const winners = options.getInteger('winners');
            const prize = options.getString('prize');

            const ms = parseDuration(duration);
            const endTime = Date.now() + ms;

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎉 GIVEAWAY 🎉')
                .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\nReact with 🎉 to enter!`)
                .setFooter({ text: `Hosted by ${interaction.user.tag}` })
                .setTimestamp(endTime);

            const giveawayMsg = await channel.send({ embeds: [embed] });
            await giveawayMsg.react('🎉');
            await db.createGiveaway(interaction.guild.id, giveawayMsg.id, channel.id, prize, winners, endTime);
            setTimeout(() => endGiveaway(giveawayMsg, winners), ms);

            return interaction.reply({ content: `✅ Giveaway started in ${channel}!`, ephemeral: true });
        }

        if (commandName === 'rolemenu') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.reply({ content: '❌ You need Manage Roles permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const title = options.getString('title');
            const description = options.getString('description') || 'React to get your roles!';

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle(title)
                .setDescription(description)
                .setFooter({ text: 'React to get your role!' })
                .setTimestamp();

            const msg = await channel.send({ embeds: [embed] });
            await db.createRoleMenu(interaction.guild.id, msg.id, channel.id, title);

            return interaction.reply({ content: `✅ Role menu created! Use \`/addrole-menu\` to add roles.`, ephemeral: true });
        }

        if (commandName === 'addrole-menu') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.reply({ content: '❌ You need Manage Roles permission!', ephemeral: true });
            }

            const role = options.getRole('role');
            const emoji = options.getString('emoji');
            const description = options.getString('description') || role.name;

            const roleMenu = await db.getLastRoleMenu(interaction.guild.id);
            if (!roleMenu) {
                return interaction.reply({ content: '❌ No role menu found! Create one first with `/rolemenu`.', ephemeral: true });
            }

            await db.addRoleMenuRole(roleMenu.message_id, role.id, emoji, description);

            const channel = interaction.guild.channels.cache.get(roleMenu.channel_id);
            const message = await channel.messages.fetch(roleMenu.message_id);
            await message.react(emoji);

            return interaction.reply({ content: `✅ Added ${role.name} with ${emoji} to role menu!`, ephemeral: true });
        }

        if (commandName === 'announce') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const title = options.getString('title');
            const message = options.getString('message');
            const color = options.getString('color') || '#ff0000';
            const pingEveryone = options.getBoolean('ping_everyone') || false;

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📢 ' + title)
                .setDescription(message)
                .setFooter({ text: `Announced by ${interaction.user.tag}` })
                .setTimestamp();

            await channel.send({ 
                content: pingEveryone ? '@everyone' : '',
                embeds: [embed] 
            });

            return interaction.reply({ content: `✅ Announcement sent to ${channel}!`, ephemeral: true });
        }

        if (commandName === 'starboard') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const threshold = options.getInteger('threshold') || 3;
            const emoji = options.getString('emoji') || '⭐';

            await db.updateGuildSettings(interaction.guild.id, {
                starboard_channel: channel.id,
                starboard_threshold: threshold,
                starboard_emoji: emoji
            });

            return interaction.reply({ content: `✅ Starboard set to ${channel} with ${threshold} ${emoji} threshold!`, ephemeral: true });
        }

        if (commandName === 'suggest') {
            const suggestion = options.getString('suggestion');
            const settings = await db.getGuildSettings(interaction.guild.id);

            if (!settings || !settings.suggestions_channel) {
                return interaction.reply({ content: '❌ Suggestions not set up! Ask an admin to use `/setup-suggestions`.', ephemeral: true });
            }

            const channel = interaction.guild.channels.cache.get(settings.suggestions_channel);
            if (!channel) {
                return interaction.reply({ content: '❌ Suggestions channel not found!', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle('💡 New Suggestion')
                .setDescription(suggestion)
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setFooter({ text: `User ID: ${interaction.user.id}` })
                .setTimestamp();

            const msg = await channel.send({ embeds: [embed] });
            await msg.react('👍');
            await msg.react('👎');

            return interaction.reply({ content: '✅ Your suggestion has been submitted!', ephemeral: true });
        }

        if (commandName === 'setup-suggestions') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            await db.updateGuildSettings(interaction.guild.id, { suggestions_channel: channel.id });

            return interaction.reply({ content: `✅ Suggestions channel set to ${channel}!`, ephemeral: true });
        }

        if (commandName === 'welcome') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return interaction.reply({ content: '❌ You need Manage Server permission!', ephemeral: true });
            }

            const channel = options.getChannel('channel');
            const message = options.getString('message');

            await db.updateGuildSettings(interaction.guild.id, {
                welcome_channel: channel.id,
                welcome_message: message
            });

            return interaction.reply({ content: `✅ Welcome messages set up in ${channel}!`, ephemeral: true });
        }

        // Moderation Commands
        if (commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: '❌ You need Ban Members permission!', ephemeral: true });
            }

            const user = options.getUser('user');
            const reason = options.getString('reason') || 'No reason provided';

            try {
                await interaction.guild.members.ban(user.id, { reason });
                await db.logModeration(interaction.guild.id, user.id, 'ban', interaction.user.id, reason);

                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔨 User Banned')
                    .setDescription(`**User:** ${user.tag}\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed] });
            } catch (error) {
                return interaction.reply({ content: '❌ Failed to ban user!', ephemeral: true });
            }
        }

        if (commandName === 'kick') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return interaction.reply({ content: '❌ You need Kick Members permission!', ephemeral: true });
            }

            const user = options.getUser('user');
            const reason = options.getString('reason') || 'No reason provided';

            try {
                const member = await interaction.guild.members.fetch(user.id);
                await member.kick(reason);
                await db.logModeration(interaction.guild.id, user.id, 'kick', interaction.user.id, reason);

                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('👢 User Kicked')
                    .setDescription(`**User:** ${user.tag}\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`)
                    .setTimestamp();

                return interaction.reply({ embeds: [embed] });
            } catch (error) {
                return interaction.reply({ content: '❌ Failed to kick user!', ephemeral: true });
            }
        }

        if (commandName === 'warn') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: '❌ You need Moderate Members permission!', ephemeral: true });
            }

            const user = options.getUser('user');
            const reason = options.getString('reason') || 'No reason provided';

            await db.addWarning(interaction.guild.id, user.id, interaction.user.id, reason);
            const warnings = await db.getWarnings(interaction.guild.id, user.id);

            const embed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle('⚠️ User Warned')
                .setDescription(`**User:** ${user.tag}\n**Reason:** ${reason}\n**Total Warnings:** ${warnings.length}\n**Moderator:** ${interaction.user.tag}`)
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'warnings') {
            const user = options.getUser('user') || interaction.user;
            const warnings = await db.getWarnings(interaction.guild.id, user.id);

            if (warnings.length === 0) {
                return interaction.reply({ content: `✅ ${user.tag} has no warnings!`, ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor('#ffff00')
                .setTitle(`⚠️ Warnings for ${user.tag}`)
                .setDescription(warnings.map((w, i) => `**${i + 1}.** ${w.reason} - <@${w.moderator_id}> (${new Date(w.timestamp).toLocaleDateString()})`).join('\n'))
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'clear-warnings') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: '❌ You need Moderate Members permission!', ephemeral: true });
            }

            const user = options.getUser('user');
            await db.clearWarnings(interaction.guild.id, user.id);

            return interaction.reply({ content: `✅ All warnings cleared for ${user.tag}!`, ephemeral: true });
        }

        if (commandName === 'serverinfo') {
            const guild = interaction.guild;

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle(`📊 ${guild.name}`)
                .setThumbnail(guild.iconURL())
                .addFields(
                    { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
                    { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                    { name: '✨ Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
                    { name: '🚀 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
                    { name: '📝 Channels', value: `${guild.channels.cache.size}`, inline: true },
                    { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true }
                )
                .setFooter({ text: `Server ID: ${guild.id}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'userinfo') {
            const user = options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id);

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle(`👤 ${user.tag}`)
                .setThumbnail(user.displayAvatarURL({ size: 256 }))
                .addFields(
                    { name: '🆔 User ID', value: user.id, inline: true },
                    { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '📥 Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: '🎭 Roles', value: member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r).join(', ') || 'None', inline: false },
                    { name: '🤖 Bot', value: user.bot ? 'Yes' : 'No', inline: true }
                )
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'avatar') {
            const user = options.getUser('user') || interaction.user;

            const embed = new EmbedBuilder()
                .setColor('#00ffff')
                .setTitle(`${user.tag}'s Avatar`)
                .setImage(user.displayAvatarURL({ size: 1024 }))
                .setFooter({ text: `Requested by ${interaction.user.tag}` })
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred!', ephemeral: true });
        }
    }
});

// Handle reaction role additions
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Error fetching reaction:', error);
            return;
        }
    }

    // Check if this is a role menu message
    const roleMenu = await db.getRoleMenuByMessage(reaction.message.id);
    if (roleMenu) {
        const role = await db.getRoleMenuRole(reaction.message.id, reaction.emoji.name);
        if (role) {
            try {
                const member = await reaction.message.guild.members.fetch(user.id);
                await member.roles.add(role.role_id);
            } catch (error) {
                console.error('Error adding role:', error);
            }
        }
        return;
    }

    // Starboard System (improved)
    const settings = await db.getGuildSettings(reaction.message.guild.id);
    if (!settings || !settings.starboard_channel) return;

    const starEmoji = settings.starboard_emoji || '⭐';
    if (reaction.emoji.name !== starEmoji) return;

    const count = reaction.count;
    if (count < settings.starboard_threshold) return;

    const starboardChannel = reaction.message.guild.channels.cache.get(settings.starboard_channel);
    if (!starboardChannel) return;

    const existingStar = await db.getStarboardMessage(reaction.message.id);

    const embed = new EmbedBuilder()
        .setColor('#ffff00')
        .setAuthor({ name: reaction.message.author.tag, iconURL: reaction.message.author.displayAvatarURL() })
        .setDescription(reaction.message.content || '*No text content*')
        .addFields({ name: 'Source', value: `[Jump to message](${reaction.message.url})` })
        .setFooter({ text: `${starEmoji} ${count} | ${reaction.message.channel.name}` })
        .setTimestamp(reaction.message.createdAt);

    if (reaction.message.attachments.size > 0) {
        embed.setImage(reaction.message.attachments.first().url);
    }

    if (existingStar) {
        try {
            const starMsg = await starboardChannel.messages.fetch(existingStar.starboard_message_id);
            await starMsg.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Error updating starboard message:', error);
        }
    } else {
        try {
            const starMsg = await starboardChannel.send({ embeds: [embed] });
            await db.addStarboardMessage(reaction.message.id, starMsg.id);
        } catch (error) {
            console.error('Error creating starboard message:', error);
        }
    }
});

// Handle reaction role removals
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Error fetching reaction:', error);
            return;
        }
    }

    const roleMenu = await db.getRoleMenuByMessage(reaction.message.id);
    if (roleMenu) {
        const role = await db.getRoleMenuRole(reaction.message.id, reaction.emoji.name);
        if (role) {
            try {
                const member = await reaction.message.guild.members.fetch(user.id);
                await member.roles.remove(role.role_id);
            } catch (error) {
                console.error('Error removing role:', error);
            }
        }
    }
});

// Welcome System
client.on('guildMemberAdd', async member => {
    const settings = await db.getGuildSettings(member.guild.id);
    
    if (settings && settings.welcome_channel && settings.welcome_message) {
        const channel = member.guild.channels.cache.get(settings.welcome_channel);
        if (channel) {
            let message = settings.welcome_message
                .replace('{user}', `<@${member.id}>`)
                .replace('{server}', member.guild.name);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('👋 Welcome!')
                .setDescription(message)
                .setThumbnail(member.user.displayAvatarURL())
                .setFooter({ text: `Member #${member.guild.memberCount}` })
                .setTimestamp();

            channel.send({ embeds: [embed] });
        }
    }
});

// Helper Functions
function parseDuration(duration) {
    const time = parseInt(duration);
    const unit = duration.slice(-1).toLowerCase();

    switch (unit) {
        case 's': return time * 1000;
        case 'm': return time * 60 * 1000;
        case 'h': return time * 60 * 60 * 1000;
        case 'd': return time * 24 * 60 * 60 * 1000;
        default: return 60 * 60 * 1000;
    }
}

async function endGiveaway(message, winnersCount) {
    const reaction = message.reactions.cache.get('🎉');
    if (!reaction) return;

    const users = await reaction.users.fetch();
    const participants = users.filter(u => !u.bot);

    if (participants.size === 0) {
        return message.reply('❌ No valid participants!');
    }

    const winners = participants.random(Math.min(winnersCount, participants.size));
    const winnersList = Array.isArray(winners) ? winners : [winners];

    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🎉 GIVEAWAY ENDED 🎉')
        .setDescription(`**Winners:**\n${winnersList.map(w => `<@${w.id}>`).join('\n')}\n\n**Prize:** ${message.embeds[0].description.split('\n')[0].replace('**Prize:** ', '')}`)
        .setTimestamp();

    await message.edit({ embeds: [embed] });
    message.channel.send(`Congratulations ${winnersList.map(w => `<@${w.id}>`).join(', ')}! You won the giveaway! 🎉`);
}

// Export bot for API usage
module.exports = client;

// Login
client.login(config.botToken);
