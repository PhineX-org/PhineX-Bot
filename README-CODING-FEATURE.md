# 💻 PhineX Bot — Coding Channel Feature

## 🎯 Overview

The **Coding Channel** feature transforms any Discord channel into an interactive code execution environment. When you send code in a configured channel, the bot automatically:

- **Executes** terminal-based code (JavaScript, Python, Bash) and shows output in chat
- **Serves** web code (HTML/CSS/JS) as live previews with local URLs
- **Auto-detects** programming languages from code blocks
- **Displays** results in beautiful embeds with syntax highlighting

---

## 🚀 Quick Start

### 1. Setup a Coding Channel

```
!setup-coding
```

Then mention the channel you want to configure (e.g., `#coding`)

### 2. Send Code

Just send code in a code block with language tags:

````
```python
print("Hello from PhineX Bot!")
for i in range(5):
    print(f"Count: {i}")
```
````

The bot will automatically execute it and show the output!

---

## 📋 Supported Languages

### **Terminal Execution** (Shows output in chat)
- **JavaScript/JS** — Node.js execution
- **Python** — Python 3 execution  
- **Bash/Shell** — Shell script execution

### **Web Preview** (Serves local URL)
- **HTML** — Full web pages
- **CSS** — Stylesheets (combined with HTML)
- **JavaScript** — Client-side scripts (combined with HTML)

---

## 💡 Usage Examples

### Example 1: Python Script
````
```python
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        print(a, end=' ')
        a, b = b, a + b

fibonacci(10)
```
````

**Bot Response:**
```
✅ Code Executed Successfully
Language: PYTHON

📤 Output
0 1 1 2 3 5 8 13 21 34
```

---

### Example 2: JavaScript
````
```javascript
const numbers = [1, 2, 3, 4, 5];
const sum = numbers.reduce((a, b) => a + b, 0);
console.log(`Sum: ${sum}`);
console.log(`Average: ${sum / numbers.length}`);
```
````

**Bot Response:**
```
✅ Code Executed Successfully
Language: JAVASCRIPT

📤 Output
Sum: 15
Average: 3
```

---

### Example 3: HTML Web Page
````
```html
<!DOCTYPE html>
<html>
<head>
    <title>PhineX Demo</title>
    <style>
        body {
            background: #050508;
            color: #39ff14;
            font-family: 'Courier New', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
        }
        h1 {
            font-size: 3em;
            text-shadow: 0 0 20px #39ff14;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 PhineX Bot</h1>
        <p>Live code preview powered by Discord!</p>
    </div>
</body>
</html>
```
````

**Bot Response:**
```
🌐 Web Preview Ready
Language: HTML
Preview: http://localhost:8080/preview_1234567890.html

*Open this link in your browser to see the preview*
```

---

### Example 4: Multi-Block Web Code

You can send HTML, CSS, and JS in separate blocks:

````
```html
<div id="app">
    <h1>Click Counter</h1>
    <button id="btn">Click Me!</button>
    <p>Clicks: <span id="count">0</span></p>
</div>
```

```css
#app {
    text-align: center;
    padding: 50px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 15px;
}

button {
    padding: 15px 30px;
    font-size: 18px;
    background: #39ff14;
    border: none;
    border-radius: 5px;
    cursor: pointer;
}
```

```javascript
let count = 0;
document.getElementById('btn').addEventListener('click', () => {
    count++;
    document.getElementById('count').textContent = count;
});
```
````

The bot will automatically combine them into a single preview!

---

## 🔧 Technical Details

### **Web Server**
- Runs on `http://localhost:8080`
- Automatically started with the bot
- Serves HTML previews with unique URLs
- Files auto-expire after 1 hour

### **Code Execution**
- **Timeout:** 10 seconds max
- **Temp Files:** Stored in `/tmp/code_*.{ext}`
- **Auto-cleanup:** Temp files deleted after execution
- **Sandboxing:** Code runs in the bot's environment (use with trusted users!)

### **Language Detection**
The bot auto-detects languages based on:
- Code block language tags (` ```python `)
- Code patterns (keywords, syntax)
- File extensions in combined blocks

---

## 🎨 Response Formats

### **Successful Execution**
```
✅ Code Executed Successfully
Language: PYTHON

📤 Output
Hello World!

Executed in < 10s
```

### **Execution Error**
```
❌ Execution Failed
Language: PYTHON

Error Details
SyntaxError: invalid syntax
```

### **Timeout**
```
❌ Execution Failed
Language: JAVASCRIPT

Error Details
⏱️ Timeout: Code execution exceeded 10 seconds
```

### **Web Preview**
```
🌐 Web Preview Ready
Language: HTML
Preview: http://localhost:8080/preview_1234567890.html

Code Length: 1523 characters
Preview expires in 1 hour
```

---

## ⚙️ Configuration

### Database Table
```sql
CREATE TABLE IF NOT EXISTS coding_channels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    auto_execute INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Database Methods
```javascript
// Set coding channel
await db.setCodingChannel(guildId, channelId);

// Get coding channel
const channel = await db.getCodingChannel(guildId);

// Remove coding channel
await db.removeCodingChannel(guildId);
```

---

## 🔐 Security Considerations

⚠️ **IMPORTANT:** This feature executes arbitrary code on your server!

**Recommendations:**
1. Only enable in **trusted servers**
2. Restrict channel access to **verified users**
3. Set proper **Discord permissions** (Manage Messages, etc.)
4. Consider running the bot in a **Docker container**
5. Monitor resource usage (CPU, memory)
6. Implement **rate limiting** for production use

**For Production:**
```javascript
// Add rate limiting
const rateLimits = new Map();
const RATE_LIMIT = 5; // executions per minute

// Add before execution
const userId = message.author.id;
const now = Date.now();
const userLimit = rateLimits.get(userId) || [];
const recent = userLimit.filter(t => now - t < 60000);

if (recent.length >= RATE_LIMIT) {
    return message.reply('❌ Rate limit exceeded! Wait a minute.');
}

rateLimits.set(userId, [...recent, now]);
```

---

## 🛠️ Advanced Features

### Custom Timeout
```javascript
// In bot.js, modify:
const CODE_EXECUTION_TIMEOUT = 30000; // 30 seconds
```

### Custom Web Server Port
```javascript
// In bot.js, modify:
const WEB_SERVER_PORT = 9000; // Change port
```

### Disable Auto-Execute
```javascript
// Future feature: Manual execution with reactions
const settings = await db.getCodingChannel(guildId);
if (!settings.auto_execute) {
    // Wait for ✅ reaction to execute
}
```

---

## 📊 Command Reference

| Command | Permission | Description |
|---------|-----------|-------------|
| `!setup-coding` | Administrator | Configure a coding channel |
| `!help` | Everyone | Show all commands |

---

## 🐛 Troubleshooting

### "Code execution failed"
- Check if Python/Node.js is installed
- Verify file permissions in `/tmp`
- Check bot logs for detailed errors

### "Web preview not loading"
- Ensure web server is running on port 8080
- Check firewall settings
- Verify the URL format

### "Language not detected"
- Always use language tags in code blocks
- Supported: `python`, `javascript`, `js`, `bash`, `sh`, `html`, `css`

---

## 📝 Files Modified

1. **bot.js** — Added coding channel handler and web server
2. **database.js** — Added `coding_channels` table and methods
3. **package.json** — No changes needed (uses existing dependencies)

---

## 🎯 Future Enhancements

- [ ] Syntax highlighting in output
- [ ] Code formatting before execution
- [ ] Multiple file execution (imports)
- [ ] Docker container execution for safety
- [ ] Output file attachments for large outputs
- [ ] Execution history and analytics
- [ ] Custom environment variables
- [ ] Package installation support
- [ ] Rate limiting per user/guild
- [ ] Manual execution mode (react to run)

---

## 📄 License

MIT License — PhineX Bot by PhineX Org

---

## 🤝 Contributing

Found a bug or want to add features? Open an issue on GitHub!

**Repository:** https://github.com/phinex-org/PhineX-Bot

---

Made with 💚 by **PhineX Org** | Powered by Discord.js v14
