# SDMC Discord Bot

The official Discord bot for **Sacred Disciples Motorcycle Club** in NoKey FiveM.

The bot is built with TypeScript, discord.js, and Discord Components V2. Every user-facing bot response uses the shared SDMC visual system:

- Primary: `#2A213A`
- Secondary: `#000000`
- Club mark: `assets/branding/sdmc-logo.png`

## Requirements

- Node.js 22.12 or newer
- A Discord application and bot token
- A Discord server where you can install the bot

## First-time setup

Follow [the Developer Portal setup guide](docs/DEVELOPER-PORTAL-SETUP.md) and [Google Sheets setup guide](docs/GOOGLE-SHEETS-SETUP.md), then:

1. Copy `.env.example` to `.env`.
2. Add the Discord and Google service account credentials.
3. Install dependencies with `npm install`.
4. Prepare the database tabs with `npm run database:setup`.
5. Register the slash commands with `npm run commands:deploy`.
6. Start the development bot with `npm run dev`.

Never commit `.env` or share the bot token.

## Commands included

Every command and management control is restricted to the Discord role configured by `SDMC_FOUNDER_ROLE_ID`. Ballot buttons are intentionally available to server members after a Founder opens a vote.

- `/about` — Displays the club identity and initial bot information.
- `/church` — Opens the private church console for attendance, discussion topics, and final meeting minutes with an automatic discussion thread and Google Sheets attendance history.
- `/member register` — Registers an in-game name and automatically captures Discord identity and join dates.
- `/member view` — Displays a member profile.
- `/member edit` — Uses controlled rank/status dropdowns, synchronizes mapped Discord rank roles, or permanently deletes a member and their private notes after confirmation; every change is audited.
- `/member notes` — Views or adds private staff notes.
- `/ping` — Confirms that the bot and Discord connection are healthy.
- `/roster view` — Displays the paginated active roster.
- `/roster sync` — Previews and synchronizes configured Discord rank roles.
- `/treasurer overview` — Shows Money and Dirty Money balances, totals gained/spent, and current dues progress.
- `/treasurer transaction` — Records income or expenses against either fund with a category, description, and optional related member.
- `/treasurer ledger` — Displays recent financial activity with optional fund filtering.
- `/treasurer dues` — Records a member dues payment and automatically adds it to treasury income.
- `/treasurer dues-report` — Shows paid and unpaid roster members for a monthly dues period.
- `/vote` — Opens a 15- or 30-second ballot in the configured vote channel and publishes the final result with progress bars.

Treasury commands are available to Founders and to members holding the active Discord role mapped to the `Treasurer` rank in the `Ranks` tab. Financial responses are private to the command user.

Church topics, final minutes, and votes are routed through `SDMC_CHURCH_TOPICS_CHANNEL_ID`, `SDMC_CHURCH_MINUTES_CHANNEL_ID`, and `SDMC_VOTES_CHANNEL_ID`. The supplied defaults point to the official SDMC channels.

## Useful scripts

| Command                   | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `npm run dev`             | Run the bot locally with automatic restarts  |
| `npm run commands:deploy` | Register slash commands with Discord         |
| `npm run database:setup`  | Create and format the Google Sheets database |
| `npm run check`           | Type-check the project                       |
| `npm run lint`            | Run static code checks                       |
| `npm run test`            | Run the automated tests                      |
| `npm run build`           | Compile the production build                 |
| `npm start`               | Run the compiled production build            |

## Project layout

```text
assets/branding/       SDMC brand assets
docs/                  Setup and operating guides
src/commands/          Slash command modules
src/config/            Environment and theme configuration
src/ui/                Reusable Components V2 layouts
src/index.ts           Bot startup and interaction routing
src/register-commands.ts  Slash command registration
tests/                 Automated tests
```

## Components V2 standard

New features should build responses with the helpers in `src/ui`. Do not add legacy embeds or plain message responses. Centralizing the layout keeps the purple accent, typography, spacing, and error states consistent across the bot.
