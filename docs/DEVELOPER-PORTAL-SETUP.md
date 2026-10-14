# Discord Developer Portal setup

The project is ready before a Discord application exists. Complete these steps when you are ready to connect it.

## 1. Create the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select **New Application** and name it `SDMC`.
3. On **General Information**, upload `assets/branding/sdmc-logo.png` as the application icon.
4. Copy the **Application ID** into `DISCORD_CLIENT_ID` in `.env`.

## 2. Configure the bot

1. Open the **Bot** page for the application.
2. Set the username to `SDMC Bot` and upload the SDMC logo if Discord does not reuse the application icon.
3. Create or reset the token, then copy it into `DISCORD_TOKEN` in `.env`.
4. Leave privileged gateway intents disabled for now. The foundation only needs the standard Guilds intent.

Treat the token like a password. If it is ever posted, streamed, or committed, reset it immediately.

## 3. Install it in the development server

1. Open **Installation** in the Developer Portal.
2. Enable the `applications.commands` and `bot` scopes for a guild install.
3. Grant only these initial bot permissions:
   - View Channels
   - Send Messages
   - Attach Files
   - Manage Roles (required for `/roster sync`)
4. Use the generated installation link and select the development Discord server.

The permissions can be expanded later when a feature genuinely requires them.

## 4. Add the development server ID

1. In Discord, enable **Developer Mode** under **User Settings → Advanced**.
2. Right-click the development server and choose **Copy Server ID**.
3. Paste it into `DISCORD_GUILD_ID` in `.env`.

Guild command registration updates quickly and is best for development. When the bot is ready for wider use, remove `DISCORD_GUILD_ID` and run the deploy command again to register commands globally.

## 5. Register and run

```powershell
Copy-Item .env.example .env
npm install
npm run database:setup
npm run commands:deploy
npm run dev
```

The bot should log in, report the registered commands, and expose the `/about`, `/member`, `/ping`, and `/roster` command groups in the server.
