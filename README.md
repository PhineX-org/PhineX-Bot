# 🤖 PhineX Bot - Advanced Discord Server Management

![PhineX Bot](https://img.shields.io/badge/Discord-Bot-7289DA?style=for-the-badge&logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-16+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**PhineX Bot** is a powerful, feature-rich Discord bot with a modern web dashboard for complete server management. Built with Discord.js v14 and featuring slash commands for the best user experience.

## ✨ New Features in This Update

### 🎯 **All Commands Now Use Slash Commands (/)**
- Modern Discord interface with autocomplete
- Better discoverability for users
- Improved permission handling

### 📝 **New Message Commands**
- **`/write`** - Send styled messages with fonts (Bold, Italic, Monospace, Strikethrough, Underline, Spoiler) and custom colors
- **`/announce`** - Professional announcements with optional @everyone ping
- **`/social`** - Display server social links beautifully

### 📊 **Enhanced Polls**
- **Channel selection** - Send polls to specific channels
- **Custom colors** - Match your server's theme
- **Auto-end timers** - Polls automatically close and show results
- Support for up to 10 options

### 🎁 **Improved Giveaways**
- **Channel selection** - Host giveaways in dedicated channels
- Automatic winner selection
- Professional embed design

### 🎭 **Reaction Role Menus**
- **`/rolemenu`** - Create role selection menus
- **`/addrole-menu`** - Add roles with custom emojis and descriptions
- Users get/remove roles by reacting
- Perfect for server organization

### ⭐ **Better Starboard**
- **Custom emoji support** - Use any emoji, not just ⭐
- Adjustable threshold
- Shows message context and jump links
- Beautiful embed design

### 💡 **Suggestion System**
- **`/suggest`** - Submit suggestions
- **`/setup-suggestions`** - Configure suggestions channel
- Auto-react with 👍/👎 for voting
- Track community feedback

### 🎨 **7 Different Font Styles**
Transform your messages with:
- Normal, **Bold**, *Italic*, `Monospace`
- ~~Strikethrough~~, __Underline__, ||Spoiler||

## 🚀 Quick Start

### Prerequisites
- Node.js 16.0.0 or higher
- Discord Bot Token
- Discord Application ID & Secret

### Installation

1. **Clone/Download this repository**

2. **Install dependencies**
```bash
npm install
```

3. **Configure**
```bash
cp config.json.example config.json
```

Edit `config.json`:
```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "callbackURL": "https://your-backend.com/auth/discord/callback",
  "dashboardURL": "https://phinex-org.github.io/PhineX-Bot",
  "sessionSecret": "RANDOM_SECRET_STRING",
  "port": 3000
}
```

4. **Setup Discord OAuth**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Navigate to OAuth2 → Redirects
   - Add: `https://phinex-org.github.io/PhineX-Bot/auth/discord/callback`
   - **IMPORTANT**: If hosting backend separately, use your backend URL instead

5. **Start the bot**
```bash
npm start
```

## 📦 Deployment Guide

### ⚠️ Important: GitHub Pages Limitation

**GitHub Pages can ONLY serve static HTML/CSS/JS files.**  
It **CANNOT** run Node.js servers (the bot backend).

### Recommended Setup: Split Architecture

**Frontend (GitHub Pages):**
- `index.html` and `dashboard.html` served from GitHub Pages
- URL: `https://phinex-org.github.io/PhineX-Bot`

**Backend (Separate Hosting):**
- Bot + API server on Railway/Heroku/DigitalOcean
- URL: `https://your-app.railway.app` (or your chosen platform)

### Step-by-Step Deployment

#### 1. Deploy Backend (Bot + API)

**Option A: Railway (Recommended - Free tier available)**
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

**Option B: Heroku**
```bash
# Install Heroku CLI
# Then:
heroku create phinex-bot
git push heroku main
```

**Option C: DigitalOcean/AWS/VPS**
- Use PM2 for process management
- Set up reverse proxy with Nginx
- Configure SSL with Let's Encrypt

#### 2. Configure Frontend for GitHub Pages

Update your `dashboard.html` and `index.html` to point API calls to your backend:

```javascript
// Change this:
const API_URL = 'http://localhost:3000';

// To this:
const API_URL = 'https://your-backend.railway.app';
```

#### 3. Update Discord OAuth

In Discord Developer Portal:
- **Redirect URL**: `https://your-backend.railway.app/auth/discord/callback`
- The callback must point to your **backend server**, not GitHub Pages

#### 4. Update config.json

```json
{
  "callbackURL": "https://your-backend.railway.app/auth/discord/callback",
  "dashboardURL": "https://phinex-org.github.io/PhineX-Bot",
}
```

### Fixing the 404 Error

The GitHub 404 error at `https://phinex-org.github.io/auth/discord` happens because:
1. GitHub Pages is trying to serve a static page at `/auth/discord`
2. But OAuth callbacks need a **backend server** to handle them
3. Your bot backend must be hosted separately (not on GitHub Pages)

**Solution:**
1. Host bot backend on Railway/Heroku/etc.
2. Update OAuth redirect to point to backend: `https://your-backend.com/auth/discord/callback`
3. GitHub Pages only serves the frontend HTML/CSS/JS

## 📚 Complete Command List

### Setup Commands (Admin Only)
```
/setup-suggestions <channel>  - Configure suggestions
/welcome <channel> <message>  - Setup welcome messages  
/starboard <channel> [threshold] [emoji] - Configure starboard
```

### Messaging Commands
```
/write <channel> <message> [color] [font] - Send styled messages
/announce <channel> <title> <message> [color] [@everyone] - Announcements
/social <channel> - Display social links
/poll <channel> <question> <options> [color] [duration] - Create polls
```

### Engagement Commands
```
/giveaway <channel> <duration> <winners> <prize> - Start giveaway
/rolemenu <channel> <title> [description] - Create role menu
/addrole-menu <role> <emoji> [description] - Add role to menu
/suggest <suggestion> - Submit suggestion
```

### Moderation Commands
```
/ban <user> [reason] - Ban user
/kick <user> [reason] - Kick user
/warn <user> [reason] - Warn user
/warnings [user] - View warnings
/clear-warnings <user> - Clear all warnings
```

### Information Commands
```
/help - Command list
/serverinfo - Server statistics
/userinfo [user] - User information
/avatar [user] - Get avatar
```

## 🎨 Features Showcase

### Font Styles
```
Normal Text
𝗕𝗼𝗹𝗱 𝗧𝗲𝘅𝘁
𝘐𝘵𝘢𝘭𝘪𝘤 𝘛𝘦𝘹𝘵
`Monospace Text`
~~Strikethrough Text~~
__Underlined Text__
||Spoiler Text||
```

### Channel Selection
Every command that posts messages includes channel selection:
- ✅ Polls → Specific poll channel
- ✅ Giveaways → Giveaway channel
- ✅ Announcements → Announcement channel
- ✅ Social links → Anywhere you want
- ✅ Welcome messages → Welcome channel

### Role Menu System
1. Create menu: `/rolemenu #roles "Select Your Roles"`
2. Add roles: `/addrole-menu @Member 🎮 "Gaming role"`
3. Add more: `/addrole-menu @VIP ⭐ "VIP role"`
4. Users react with emoji to get roles!

## 🛠️ Dashboard Features

Access at `https://phinex-org.github.io/PhineX-Bot` (after setup):

- 🔐 OAuth2 Discord login
- 📊 Server statistics
- ⚙️ Configure all settings
- 👥 Manage roles & channels
- 📝 View moderation logs
- 🌐 Setup social links (Website, Twitter, YouTube, Instagram, Discord, GitHub)
- 📢 Configure welcome messages
- ⭐ Starboard settings

## 🔧 Troubleshooting

### Slash commands not appearing?
- Wait up to 1 hour for global commands to register
- Reinvite bot with `applications.commands` scope
- Check bot has proper permissions

### OAuth 404 Error?
- ✅ Backend server must be running (not GitHub Pages)
- ✅ Redirect URL must point to **backend** server
- ✅ Update `callbackURL` in config.json to backend URL
- ✅ GitHub Pages only serves frontend HTML

### Role menu not working?
- Bot needs Manage Roles permission
- Bot's role must be higher than assigned roles
- Verify reactions are being added

### Dashboard not connecting?
- Update API URL in frontend files to point to backend
- Check CORS configuration allows GitHub Pages domain
- Verify backend server is running

## 📝 Configuration Tips

### Social Links (via Dashboard)
```json
{
  "website": "https://yourwebsite.com",
  "twitter": "https://twitter.com/yourhandle",
  "youtube": "https://youtube.com/@yourchannel",
  "instagram": "https://instagram.com/yourhandle",
  "discord": "https://discord.gg/yourinvite",
  "github": "https://github.com/yourorg"
}
```

### Welcome Message Variables
```
{user} - Mentions the new member
{server} - Server name

Example: "Welcome {user} to {server}! 🎉"
```

## 🎯 Required Bot Permissions

```
✅ View Channels
✅ Send Messages
✅ Send Messages in Threads
✅ Embed Links
✅ Attach Files
✅ Read Message History
✅ Add Reactions
✅ Use External Emojis
✅ Manage Messages
✅ Manage Channels
✅ Manage Roles
✅ Kick Members
✅ Ban Members
✅ Moderate Members
```

**Invite Link Template:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

## 💡 Pro Tips

1. **Use channel selection** - Keep your server organized by sending different types of messages to different channels
2. **Custom colors** - Match embeds to your server's color scheme using hex codes
3. **Font variety** - Use different fonts for different purposes (Bold for important, Monospace for codes)
4. **Role menu organization** - Create separate role menus for different categories (colors, notifications, games)
5. **Auto-end polls** - Set durations to automatically close and show results

## 📞 Support & Links

- 📚 **Documentation**: Check this README
- 🐛 **Issues**: [GitHub Issues](https://github.com/phinex-org/PhineX-Bot/issues)
- 💬 **Discord**: [Support Server](#)
- 🌟 **Star this repo** if you find it helpful!

## 📄 License

MIT License - see [LICENSE](LICENSE) file

## 🤝 Contributing

Contributions welcome! Fork, create a feature branch, and submit a PR.

---

**Made with ❤️ by PhineX Organization**

⭐ Don't forget to star this repository!
