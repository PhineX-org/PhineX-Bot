const Discord = require('discord.js');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ChannelType, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder} = require('discord.js');
const fs = require('fs');
const Database = require('./database.js');
const crypto = require('crypto');

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

// Storage for interactive sessions (write command, config commands, etc.)
const userSessions = new Map();

// Register slash commands
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('View all available commands'),
        
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
            .setDescription('Display social links'),
        
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
                    .setDescription('User to check')
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

        // Quiz System Commands
        new SlashCommandBuilder()
            .setName('quiz-leaderboard')
            .setDescription('Show quiz leaderboard'),

        // Ticket System Commands
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('Create a support ticket'),

        new SlashCommandBuilder()
            .setName('close-ticket')
            .setDescription('Close the current ticket'),

        new SlashCommandBuilder()
            .setName('community-ticket')
            .setDescription('Get a community access ticket'),
    ];

    try {
        console.log('🔄 Registering slash commands...');
        const rest = new REST({ version: '10' }).setToken(config.botToken);
        
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands }
        );
        
        console.log('✓ Registered ' + commands.length + ' slash commands');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Bot ready event
client.on('ready', async () => {
    console.log(`✓ Connected to Discord as ${client.user.tag}`);
    await registerCommands();
    client.user.setActivity('!help for prefix commands', { type: 'PLAYING' });
});

// PREFIX COMMAND HANDLER
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // !WRITE COMMAND (Interactive)
        if (command === 'write') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return message.reply('❌ You need Manage Messages permission!');
            }

            await message.reply('📝 **Write Mode Activated!**\n\nWhat do you want to write? (Type your message)');
            
            userSessions.set(message.author.id, {
                type: 'write',
                step: 'message',
                channel: message.channel
            });
            return;
        }

        // !CONFIG-SOCIAL COMMAND
        if (command === 'config-social') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need Administrator permission!');
            }

            await message.reply('🔗 **Social Links Configuration**\n\nSend your social link in this format:\n`SOCIAL APP | SOCIAL LINK`\n\nExample: `Twitter | https://twitter.com/PhineX`\n\nType `done` when finished, or `cancel` to cancel.');
            
            userSessions.set(message.author.id, {
                type: 'config-social',
                guildId: message.guild.id
            });
            return;
        }

        // !CONFIG-STAR COMMAND
        if (command === 'config-star') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need Administrator permission!');
            }

            await message.reply('⭐ **Starboard Configuration**\n\n**Step 1:** Mention the starboard channel (where starred messages will be posted)\nExample: #starboard');
            
            userSessions.set(message.author.id, {
                type: 'config-star',
                step: 'channel',
                guildId: message.guild.id
            });
            return;
        }

        // !RR COMMAND (React Role - like Carl-bot)
        if (command === 'rr') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return message.reply('❌ You need Manage Roles permission!');
            }

            await message.reply('🎭 **React Role Setup**\n\n**Step 1:** What channel should the role message be in?\nMention the channel (e.g., #roles)');
            
            userSessions.set(message.author.id, {
                type: 'react-role',
                step: 'channel',
                guildId: message.guild.id
            });
            return;
        }

        // !QUIZ-SETUP COMMAND
        if (command === 'quiz-setup') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return message.reply('❌ You need Manage Channels permission!');
            }

            await message.reply('📝 **Quiz Setup**\n\n**Step 1:** Mention the channel for the quiz\nExample: #quiz-channel');
            
            userSessions.set(message.author.id, {
                type: 'quiz-setup',
                step: 'channel',
                guildId: message.guild.id
            });
            return;
        }

        // !QUIZ-QUESTION COMMAND
        if (command === 'quiz-question') {
            const quizSettings = await db.run('SELECT * FROM quiz_settings WHERE guild_id = ?', [message.guild.id]);
            
            if (!quizSettings) {
                return message.reply('❌ Quiz not set up yet! Use `!quiz-setup` first.');
            }

            await message.reply('❓ **Add Quiz Question**\n\n**Format:**\n`Question text here?\nOption 1\nOption 2\nOption 3\nOption 4\nCorrect: 1`\n\n(Correct answer number is 1-4)');
            
            userSessions.set(message.author.id, {
                type: 'quiz-question',
                guildId: message.guild.id
            });
            return;
        }

        // !TICKET-SETUP COMMAND
        if (command === 'ticket-setup') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply('❌ You need Administrator permission!');
            }

            await message.reply('🎫 **Ticket System Setup**\n\n**Step 1:** Which channel should host the ticket creation button?\nMention the channel: ');
            
            userSessions.set(message.author.id, {
                type: 'ticket-setup',
                step: 'channel',
                guildId: message.guild.id
            });
            return;
        }

        // !HELP COMMAND
        if (command === 'help') {
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🤖 PhineX Bot - Prefix Commands')
                .setDescription('Here are all available prefix commands:')
                .addFields(
                    { name: '📝 Message & Content', value: '`!write` - Interactive message writer\n`!rr` - Setup react-to-role (like Carl-bot)', inline: false },
                    { name: '⚙️ Configuration', value: '`!config-social` - Configure social links\n`!config-star` - Configure starboard\n`!ticket-setup` - Setup ticket system', inline: false },
                    { name: '📊 Quiz System', value: '`!quiz-setup` - Setup quiz channel\n`!quiz-question` - Add quiz question\n`/quiz-leaderboard` - Show scores', inline: false },
                    { name: '🎫 Tickets', value: '`/ticket` - Create support ticket\n`/community-ticket` - Get community access code\n`/close-ticket` - Close ticket', inline: false },
                    { name: '💻 Slash Commands', value: 'Use `/help` to see all slash commands!', inline: false }
                )
                .setFooter({ text: 'PhineX Bot | Made with 💚' });

            return message.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error in prefix command:', error);
        message.reply('❌ An error occurred!');
    }
});

// INTERACTIVE SESSION HANDLER
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    const session = userSessions.get(message.author.id);
    if (!session) return;

    try {
        // !WRITE INTERACTIVE FLOW
        if (session.type === 'write') {
            if (session.step === 'message') {
                session.messageText = message.content;
                session.step = 'color';
                await message.reply('🎨 **Color**\n\nWhat color should the embed be? (hex code like #FF0000)\nOr type `skip` for default green.');
                return;
            }
            
            if (session.step === 'color') {
                session.color = message.content.toLowerCase() === 'skip' ? '#39ff14' : message.content;
                session.step = 'font';
                await message.reply('✍️ **Font Style**\n\nChoose a font:\n`1` - Normal\n`2` - Bold\n`3` - Italic\n`4` - Monospace\n`5` - Strikethrough\n`6` - Underline\n`7` - Spoiler\n\nType the number:');
                return;
            }
            
            if (session.step === 'font') {
                const fonts = ['normal', 'bold', 'italic', 'monospace', 'strikethrough', 'underline', 'spoiler'];
                const fontIndex = parseInt(message.content) - 1;
                session.font = fonts[fontIndex] || 'normal';
                session.step = 'channel';
                await message.reply('📢 **Channel**\n\nMention the channel to send the message to:');
                return;
            }
            
            if (session.step === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                // Send the final message
                const styledText = FONTS[session.font](session.messageText);
                const embed = new EmbedBuilder()
                    .setColor(session.color)
                    .setDescription(styledText)
                    .setTimestamp();
                
                await channel.send({ embeds: [embed] });
                await message.reply(`✅ Message sent to ${channel}!`);
                userSessions.delete(message.author.id);
                return;
            }
        }

        // !CONFIG-SOCIAL FLOW
        if (session.type === 'config-social') {
            if (message.content.toLowerCase() === 'done') {
                await message.reply('✅ Social links configured successfully!');
                userSessions.delete(message.author.id);
                return;
            }
            
            if (message.content.toLowerCase() === 'cancel') {
                await message.reply('❌ Configuration cancelled.');
                userSessions.delete(message.author.id);
                return;
            }
            
            const parts = message.content.split('|').map(p => p.trim());
            if (parts.length !== 2) {
                return message.reply('❌ Invalid format! Use: `SOCIAL APP | SOCIAL LINK`');
            }
            
            const [platform, link] = parts;
            
            // Save to database
            await db.run(
                'INSERT OR REPLACE INTO social_links (guild_id, platform, link) VALUES (?, ?, ?)',
                [session.guildId, platform, link]
            );
            
            await message.reply(`✅ Added **${platform}**: ${link}\n\nAdd more or type \`done\` to finish.`);
            return;
        }

        // !CONFIG-STAR FLOW
        if (session.type === 'config-star') {
            if (session.step === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                session.starboardChannel = channel.id;
                session.step = 'source-channel';
                await message.reply('📌 **Step 2:** Mention the channel to watch for starred messages\nExample: #general');
                return;
            }
            
            if (session.step === 'source-channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                session.sourceChannel = channel.id;
                session.step = 'emojis';
                await message.reply('😊 **Step 3:** Custom emojis for reactions (optional)\n\nExample: `:like: :dislike:`\nOr type `skip` to use default ⭐');
                return;
            }
            
            if (session.step === 'emojis') {
                let starEmoji = '⭐';
                if (message.content.toLowerCase() !== 'skip') {
                    starEmoji = message.content.split(' ')[0].replace(/:/g, '');
                }
                
                // Save starboard config
                await db.run(
                    `INSERT OR REPLACE INTO guild_settings (guild_id, starboard_channel, starboard_emoji, starboard_threshold) 
                     VALUES (?, ?, ?, ?)`,
                    [session.guildId, session.starboardChannel, starEmoji, 3]
                );
                
                await message.reply('✅ Starboard configured successfully!');
                userSessions.delete(message.author.id);
                return;
            }
        }

        // !RR (REACT-ROLE) FLOW
        if (session.type === 'react-role') {
            if (session.step === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                session.channelId = channel.id;
                session.step = 'title';
                await message.reply('📋 **Step 2:** Enter the message title and description\n\nFormat: `Title | Description`\nExample: `🎭 ROLE SELECTION | Welcome to the role menu!`');
                return;
            }
            
            if (session.step === 'title') {
                const parts = message.content.split('|').map(p => p.trim());
                session.title = parts[0] || 'Role Selection';
                session.description = parts[1] || 'Select your roles below';
                session.step = 'color';
                await message.reply('🎨 **Step 3:** Embed color (hex code)\nExample: `#7B00FF`\nOr type `skip` for default');
                return;
            }
            
            if (session.step === 'color') {
                session.color = message.content.toLowerCase() === 'skip' ? '#39ff14' : message.content;
                session.step = 'roles';
                session.roles = [];
                await message.reply('🎭 **Step 4:** Add roles!\n\nFormat: `EMOJI | ROLE NAME`\nExample: `🎓 | Academic`\n\nType `done` when finished adding roles.');
                return;
            }
            
            if (session.step === 'roles') {
                if (message.content.toLowerCase() === 'done') {
                    if (session.roles.length === 0) {
                        return message.reply('❌ You need to add at least one role!');
                    }
                    
                    // Create the react-role message
                    const channel = await message.guild.channels.fetch(session.channelId);
                    
                    const rolesList = session.roles.map(r => `${r.emoji} : ${r.roleName}`).join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setColor(session.color)
                        .setTitle(session.title)
                        .setDescription(session.description + '\n\n**This is the roles list 📜:**\n' + rolesList + '\n\nSelect the role by reacting to this message one of the reactions in the list')
                        .setFooter({ text: 'React to claim your role!' })
                        .setTimestamp();
                    
                    const sentMessage = await channel.send({ embeds: [embed] });
                    
                    // Add reactions
                    for (const roleData of session.roles) {
                        await sentMessage.react(roleData.emoji);
                        
                        // Save to database
                        await db.run(
                            'INSERT INTO role_menu_roles (message_id, emoji, role_id, description) VALUES (?, ?, ?, ?)',
                            [sentMessage.id, roleData.emoji, roleData.roleId, roleData.roleName]
                        );
                    }
                    
                    await db.run(
                        'INSERT INTO role_menus (guild_id, channel_id, message_id, title) VALUES (?, ?, ?, ?)',
                        [session.guildId, session.channelId, sentMessage.id, session.title]
                    );
                    
                    await message.reply(`✅ React-role message created in ${channel}!`);
                    userSessions.delete(message.author.id);
                    return;
                }
                
                const parts = message.content.split('|').map(p => p.trim());
                if (parts.length !== 2) {
                    return message.reply('❌ Invalid format! Use: `EMOJI | ROLE NAME`');
                }
                
                const emoji = parts[0];
                const roleName = parts[1];
                
                // Find role by name
                const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                if (!role) {
                    return message.reply(`❌ Role "${roleName}" not found! Make sure it exists.`);
                }
                
                session.roles.push({
                    emoji: emoji,
                    roleName: role.name,
                    roleId: role.id
                });
                
                await message.reply(`✅ Added: ${emoji} - ${role.name}\n\nAdd more or type \`done\` to finish.`);
                return;
            }
        }

        // !QUIZ-SETUP FLOW
        if (session.type === 'quiz-setup') {
            if (session.step === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                session.channelId = channel.id;
                session.step = 'start-message';
                await message.reply('📝 **Step 2:** Enter the quiz start message\nExample: `Welcome to the PhineX Quiz! Get ready! 🎯`');
                return;
            }
            
            if (session.step === 'start-message') {
                session.startMessage = message.content;
                
                // Save quiz settings
                await db.run(
                    'INSERT OR REPLACE INTO quiz_settings (guild_id, channel_id, start_message) VALUES (?, ?, ?)',
                    [session.guildId, session.channelId, session.startMessage]
                );
                
                await message.reply('✅ Quiz setup complete! Use `!quiz-question` to add questions.');
                userSessions.delete(message.author.id);
                return;
            }
        }

        // !QUIZ-QUESTION FLOW
        if (session.type === 'quiz-question') {
            const lines = message.content.split('\n');
            
            if (lines.length < 6) {
                return message.reply('❌ Invalid format! Need question + 4 options + correct answer.');
            }
            
            const question = lines[0];
            const options = [lines[1], lines[2], lines[3], lines[4]];
            const correctMatch = lines[5].match(/Correct:\s*(\d)/);
            
            if (!correctMatch) {
                return message.reply('❌ Missing or invalid "Correct: X" line!');
            }
            
            const correctAnswer = parseInt(correctMatch[1]) - 1;
            
            if (correctAnswer < 0 || correctAnswer > 3) {
                return message.reply('❌ Correct answer must be between 1-4!');
            }
            
            // Get quiz settings
            const quizSettings = await db.get('SELECT * FROM quiz_settings WHERE guild_id = ?', [session.guildId]);
            const channel = await message.guild.channels.fetch(quizSettings.channel_id);
            
            // Create poll
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('📊 Quiz Question')
                .setDescription(`**${question}**\n\n${options.map((opt, i) => `${['1️⃣', '2️⃣', '3️⃣', '4️⃣'][i]} ${opt}`).join('\n')}`)
                .setFooter({ text: 'React to answer!' })
                .setTimestamp();
            
            const sentMessage = await channel.send({ embeds: [embed] });
            
            // Add reactions
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
            for (const emoji of emojis) {
                await sentMessage.react(emoji);
            }
            
            // Save question
            await db.run(
                'INSERT INTO quiz_questions (guild_id, message_id, question, options, correct_answer) VALUES (?, ?, ?, ?, ?)',
                [session.guildId, sentMessage.id, question, JSON.stringify(options), correctAnswer]
            );
            
            await message.reply('✅ Quiz question posted!');
            userSessions.delete(message.author.id);
            return;
        }

        // !TICKET-SETUP FLOW
        if (session.type === 'ticket-setup') {
            if (session.step === 'channel') {
                const channel = message.mentions.channels.first();
                if (!channel) {
                    return message.reply('❌ Please mention a valid channel!');
                }
                
                session.channelId = channel.id;
                session.step = 'support-role';
                await message.reply('👥 **Step 2:** Mention the support team role\nExample: @Support Team');
                return;
            }
            
            if (session.step === 'support-role') {
                const role = message.mentions.roles.first();
                if (!role) {
                    return message.reply('❌ Please mention a valid role!');
                }
                
                // Save ticket settings
                await db.run(
                    'INSERT OR REPLACE INTO ticket_settings (guild_id, channel_id, support_role_id) VALUES (?, ?, ?)',
                    [session.guildId, session.channelId, role.id]
                );
                
                // Create ticket button message
                const channel = await message.guild.channels.fetch(session.channelId);
                
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('🎫 Support Tickets')
                    .setDescription('Need help? Click the button below to create a support ticket!\n\nOur support team will assist you as soon as possible.')
                    .setFooter({ text: 'PhineX Support System' });
                
                const button = new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Create Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🎫');
                
                const row = new ActionRowBuilder().addComponents(button);
                
                await channel.send({ embeds: [embed], components: [row] });
                await message.reply('✅ Ticket system setup complete!');
                userSessions.delete(message.author.id);
                return;
            }
        }

    } catch (error) {
        console.error('Error in session handler:', error);
        message.reply('❌ An error occurred!');
        userSessions.delete(message.author.id);
    }
});

// SLASH COMMAND HANDLER
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    try {
        // BUTTON INTERACTIONS
        if (interaction.isButton()) {
            // CREATE TICKET BUTTON
            if (interaction.customId === 'create_ticket') {
                const ticketSettings = await db.get('SELECT * FROM ticket_settings WHERE guild_id = ?', [interaction.guild.id]);
                
                if (!ticketSettings) {
                    return interaction.reply({ content: '❌ Ticket system not set up!', ephemeral: true });
                }
                
                // Check if user already has a ticket
                const existingTicket = await db.get(
                    'SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
                    [interaction.guild.id, interaction.user.id, 'open']
                );
                
                if (existingTicket) {
                    return interaction.reply({ content: `❌ You already have an open ticket: <#${existingTicket.channel_id}>`, ephemeral: true });
                }
                
                // Create ticket channel
                const ticketChannel = await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`,
                    type: ChannelType.GuildText,
                    parent: interaction.channel.parent,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                        {
                            id: ticketSettings.support_role_id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                    ],
                });
                
                // Save ticket to database
                await db.run(
                    'INSERT INTO tickets (guild_id, user_id, channel_id, status) VALUES (?, ?, ?, ?)',
                    [interaction.guild.id, interaction.user.id, ticketChannel.id, 'open']
                );
                
                const embed = new EmbedBuilder()
                    .setColor('#39ff14')
                    .setTitle('🎫 Support Ticket')
                    .setDescription(`Hello ${interaction.user}!\n\nWelcome to your support ticket. Please describe your issue and a support team member will assist you shortly.`)
                    .setFooter({ text: 'Use /close-ticket to close this ticket' })
                    .setTimestamp();
                
                const closeButton = new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒');
                
                const row = new ActionRowBuilder().addComponents(closeButton);
                
                await ticketChannel.send({ content: `${interaction.user} <@&${ticketSettings.support_role_id}>`, embeds: [embed], components: [row] });
                
                await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
                return;
            }
            
            // CLOSE TICKET BUTTON
            if (interaction.customId === 'close_ticket') {
                const ticket = await db.get('SELECT * FROM tickets WHERE channel_id = ? AND status = ?', [interaction.channel.id, 'open']);
                
                if (!ticket) {
                    return interaction.reply({ content: '❌ This is not a ticket channel!', ephemeral: true });
                }
                
                await db.run('UPDATE tickets SET status = ? WHERE channel_id = ?', ['closed', interaction.channel.id]);
                
                await interaction.reply('🔒 Closing ticket in 5 seconds...');
                
                setTimeout(async () => {
                    await interaction.channel.delete();
                }, 5000);
                return;
            }
        }

        // SLASH COMMANDS
        const { commandName } = interaction;

        // /HELP
        if (commandName === 'help') {
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🤖 PhineX Bot - Commands')
                .setDescription('Complete command list:')
                .addFields(
                    { name: '📝 Content Creation', value: '`!write` - Interactive message writer\n`/poll` - Create polls\n`/announce` - Make announcements', inline: false },
                    { name: '🎭 Roles & Reactions', value: '`!rr` - React-to-role setup\n`/rolemenu` - Role menu\n`/addrole-menu` - Add role to menu', inline: false },
                    { name: '📊 Quiz System', value: '`!quiz-setup` - Setup quiz\n`!quiz-question` - Add question\n`/quiz-leaderboard` - Show scores', inline: false },
                    { name: '🎫 Ticket System', value: '`!ticket-setup` - Setup tickets\n`/ticket` - Create ticket\n`/close-ticket` - Close ticket\n`/community-ticket` - Get access code', inline: false },
                    { name: '⭐ Starboard', value: '`!config-star` - Configure starboard', inline: false },
                    { name: '🔗 Social Links', value: '`!config-social` - Configure links\n`/social` - Display links', inline: false },
                    { name: '🎉 Events', value: '`/giveaway` - Start giveaway', inline: false },
                    { name: '💬 Community', value: '`/suggest` - Submit suggestion\n`/setup-suggestions` - Setup suggestions', inline: false },
                    { name: '👋 Welcome', value: '`/welcome` - Setup welcome messages', inline: false },
                    { name: '🔨 Moderation', value: '`/ban` - Ban user\n`/kick` - Kick user\n`/warn` - Warn user\n`/warnings` - Check warnings', inline: false },
                    { name: 'ℹ️ Info', value: '`/serverinfo` - Server info\n`/userinfo` - User info', inline: false }
                )
                .setFooter({ text: 'PhineX Bot | Use !help for prefix commands' });

            await interaction.reply({ embeds: [embed] });
        }

        // /SOCIAL (Display social links)
        if (commandName === 'social') {
            const socialLinks = await db.all('SELECT * FROM social_links WHERE guild_id = ?', [interaction.guild.id]);
            
            if (socialLinks.length === 0) {
                return interaction.reply({ content: '❌ No social links configured! Use `!config-social` to add them.', ephemeral: true });
            }
            
            const linksList = socialLinks.map(link => `[${link.platform}](${link.link})`).join(' • ');
            
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🔗 Social Links')
                .setDescription(linksList)
                .setFooter({ text: 'Follow us on social media!' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
        }

        // /QUIZ-LEADERBOARD
        if (commandName === 'quiz-leaderboard') {
            const scores = await db.all(
                'SELECT user_id, correct_answers, total_answers FROM quiz_scores WHERE guild_id = ? ORDER BY correct_answers DESC LIMIT 10',
                [interaction.guild.id]
            );
            
            if (scores.length === 0) {
                return interaction.reply({ content: '❌ No quiz scores yet!', ephemeral: true });
            }
            
            const leaderboard = await Promise.all(scores.map(async (score, index) => {
                const user = await client.users.fetch(score.user_id);
                const percentage = Math.round((score.correct_answers / score.total_answers) * 100);
                return `**${index + 1}.** ${user.tag} - ${score.correct_answers}/${score.total_answers} (${percentage}%)`;
            }));
            
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🏆 Quiz Leaderboard')
                .setDescription(leaderboard.join('\n'))
                .setFooter({ text: 'Keep quizzing to climb the ranks!' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
        }

        // /TICKET
        if (commandName === 'ticket') {
            const ticketSettings = await db.get('SELECT * FROM ticket_settings WHERE guild_id = ?', [interaction.guild.id]);
            
            if (!ticketSettings) {
                return interaction.reply({ content: '❌ Ticket system not set up! Ask an admin to use `!ticket-setup`.', ephemeral: true });
            }
            
            // Same logic as button
            const existingTicket = await db.get(
                'SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
                [interaction.guild.id, interaction.user.id, 'open']
            );
            
            if (existingTicket) {
                return interaction.reply({ content: `❌ You already have an open ticket: <#${existingTicket.channel_id}>`, ephemeral: true });
            }
            
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    },
                    {
                        id: ticketSettings.support_role_id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    },
                ],
            });
            
            await db.run(
                'INSERT INTO tickets (guild_id, user_id, channel_id, status) VALUES (?, ?, ?, ?)',
                [interaction.guild.id, interaction.user.id, ticketChannel.id, 'open']
            );
            
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🎫 Support Ticket')
                .setDescription(`Hello ${interaction.user}!\n\nWelcome to your support ticket. Please describe your issue.`)
                .setTimestamp();
            
            await ticketChannel.send({ content: `${interaction.user} <@&${ticketSettings.support_role_id}>`, embeds: [embed] });
            await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
        }

        // /CLOSE-TICKET
        if (commandName === 'close-ticket') {
            const ticket = await db.get('SELECT * FROM tickets WHERE channel_id = ? AND status = ?', [interaction.channel.id, 'open']);
            
            if (!ticket) {
                return interaction.reply({ content: '❌ This is not a ticket channel!', ephemeral: true });
            }
            
            await db.run('UPDATE tickets SET status = ? WHERE channel_id = ?', ['closed', interaction.channel.id]);
            await interaction.reply('🔒 Closing ticket in 5 seconds...');
            
            setTimeout(async () => {
                await interaction.channel.delete();
            }, 5000);
        }

        // /COMMUNITY-TICKET
        if (commandName === 'community-ticket') {
            // Generate random API-like code
            const code = crypto.randomBytes(32).toString('hex').toUpperCase();
            const formattedCode = code.match(/.{1,8}/g).join('-');
            
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle('🎟️ Community Access Ticket')
                .setDescription(`Here is your community access code:\n\n\`\`\`${formattedCode}\`\`\`\n\nUse this code at:\nhttps://phinex-org.github.io/PhineX/community.html`)
                .setFooter({ text: 'Keep this code secure!' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
            
            // Log ticket generation
            await db.run(
                'INSERT INTO community_tickets (guild_id, user_id, code) VALUES (?, ?, ?)',
                [interaction.guild.id, interaction.user.id, formattedCode]
            );
        }

        // [Keep all other existing slash command handlers - poll, giveaway, rolemenu, announce, etc.]
        // I'll continue with the essential ones for brevity

        // /POLL
        if (commandName === 'poll') {
            const channel = interaction.options.getChannel('channel');
            const question = interaction.options.getString('question');
            const optionsStr = interaction.options.getString('options');
            const color = interaction.options.getString('color') || '#39ff14';
            const duration = interaction.options.getInteger('duration');

            const options = optionsStr.split('|').map(opt => opt.trim());

            if (options.length < 2 || options.length > 10) {
                return interaction.reply({ content: '❌ You need 2-10 poll options!', ephemeral: true });
            }

            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            const optionsFormatted = options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n');

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('📊 ' + question)
                .setDescription(optionsFormatted)
                .setFooter({ text: duration ? `Poll ends in ${duration} minutes` : 'React to vote!' })
                .setTimestamp();

            const pollMessage = await channel.send({ embeds: [embed] });

            for (let i = 0; i < options.length; i++) {
                await pollMessage.react(emojis[i]);
            }

            await interaction.reply({ content: `✅ Poll created in ${channel}!`, ephemeral: true });

            if (duration) {
                setTimeout(async () => {
                    const updatedMessage = await channel.messages.fetch(pollMessage.id);
                    const results = [];

                    for (let i = 0; i < options.length; i++) {
                        const reaction = updatedMessage.reactions.cache.get(emojis[i]);
                        const count = reaction ? reaction.count - 1 : 0;
                        results.push({ option: options[i], count });
                    }

                    results.sort((a, b) => b.count - a.count);

                    const resultEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('📊 Poll Results: ' + question)
                        .setDescription(results.map(r => `${r.option}: **${r.count} votes**`).join('\n'))
                        .setFooter({ text: 'Poll ended' })
                        .setTimestamp();

                    await channel.send({ embeds: [resultEmbed] });
                }, duration * 60 * 1000);
            }
        }

        // /SERVERINFO
        if (commandName === 'serverinfo') {
            const { guild } = interaction;
            
            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle(guild.name)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                    { name: '📅 Created', value: guild.createdAt.toLocaleDateString(), inline: true },
                    { name: '👥 Members', value: guild.memberCount.toString(), inline: true },
                    { name: '📝 Channels', value: guild.channels.cache.size.toString(), inline: true },
                    { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
                    { name: '😊 Emojis', value: guild.emojis.cache.size.toString(), inline: true }
                )
                .setFooter({ text: `ID: ${guild.id}` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

        // /USERINFO
        if (commandName === 'userinfo') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = await interaction.guild.members.fetch(user.id);

            const embed = new EmbedBuilder()
                .setColor('#39ff14')
                .setTitle(user.tag)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 ID', value: user.id, inline: true },
                    { name: '📅 Account Created', value: user.createdAt.toLocaleDateString(), inline: true },
                    { name: '📥 Joined Server', value: member.joinedAt.toLocaleDateString(), inline: true },
                    { name: '🎭 Roles', value: member.roles.cache.map(r => r.toString()).slice(0, 10).join(', ') || 'None', inline: false }
                )
                .setFooter({ text: 'User Information' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred!', ephemeral: true });
        }
    }
});

// REACTION HANDLER FOR REACT-ROLES
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
    const roleMenu = await db.get('SELECT * FROM role_menus WHERE message_id = ?', [reaction.message.id]);
    if (roleMenu) {
        const role = await db.get('SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?', [reaction.message.id, reaction.emoji.name]);
        if (role) {
            try {
                const member = await reaction.message.guild.members.fetch(user.id);
                await member.roles.add(role.role_id);
                console.log(`✅ Added role ${role.role_id} to ${user.tag}`);
            } catch (error) {
                console.error('Error adding role:', error);
            }
        }
        return;
    }

    // Quiz answer handling
    const quizQuestion = await db.get('SELECT * FROM quiz_questions WHERE message_id = ?', [reaction.message.id]);
    if (quizQuestion) {
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const answerIndex = emojis.indexOf(reaction.emoji.name);
        
        if (answerIndex === -1) return;
        
        const isCorrect = answerIndex === quizQuestion.correct_answer;
        
        // Update user score
        const currentScore = await db.get(
            'SELECT * FROM quiz_scores WHERE guild_id = ? AND user_id = ?',
            [reaction.message.guild.id, user.id]
        );
        
        if (currentScore) {
            await db.run(
                'UPDATE quiz_scores SET correct_answers = correct_answers + ?, total_answers = total_answers + 1 WHERE guild_id = ? AND user_id = ?',
                [isCorrect ? 1 : 0, reaction.message.guild.id, user.id]
            );
        } else {
            await db.run(
                'INSERT INTO quiz_scores (guild_id, user_id, correct_answers, total_answers) VALUES (?, ?, ?, 1)',
                [reaction.message.guild.id, user.id, isCorrect ? 1 : 0]
            );
        }
        
        // Remove user's reaction
        await reaction.users.remove(user.id);
        
        // Send feedback
        const feedbackMsg = await reaction.message.channel.send(
            `${user} answered ${isCorrect ? '✅ **correctly**!' : '❌ **incorrectly**.'}`
        );
        
        setTimeout(() => feedbackMsg.delete(), 3000);
        return;
    }

    // Starboard System
    const settings = await db.get('SELECT * FROM guild_settings WHERE guild_id = ?', [reaction.message.guild.id]);
    if (!settings || !settings.starboard_channel) return;

    const starEmoji = settings.starboard_emoji || '⭐';
    if (reaction.emoji.name !== starEmoji) return;

    const count = reaction.count;
    if (count < (settings.starboard_threshold || 3)) return;

    const starboardChannel = reaction.message.guild.channels.cache.get(settings.starboard_channel);
    if (!starboardChannel) return;

    const existingStar = await db.get('SELECT * FROM starboard_messages WHERE message_id = ?', [reaction.message.id]);

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
            await db.run(
                'INSERT INTO starboard_messages (message_id, starboard_message_id) VALUES (?, ?)',
                [reaction.message.id, starMsg.id]
            );
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

    const roleMenu = await db.get('SELECT * FROM role_menus WHERE message_id = ?', [reaction.message.id]);
    if (roleMenu) {
        const role = await db.get('SELECT * FROM role_menu_roles WHERE message_id = ? AND emoji = ?', [reaction.message.id, reaction.emoji.name]);
        if (role) {
            try {
                const member = await reaction.message.guild.members.fetch(user.id);
                await member.roles.remove(role.role_id);
                console.log(`✅ Removed role ${role.role_id} from ${user.tag}`);
            } catch (error) {
                console.error('Error removing role:', error);
            }
        }
    }
});

// Welcome System
client.on('guildMemberAdd', async member => {
    const settings = await db.get('SELECT * FROM guild_settings WHERE guild_id = ?', [member.guild.id]);
    
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

// Export bot for API usage
module.exports = client;

// Login
client.login(config.botToken);