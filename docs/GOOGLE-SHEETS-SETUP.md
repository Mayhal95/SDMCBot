# Google Sheets database setup

The SDMC bot uses the [SDMC | Main](https://docs.google.com/spreadsheets/d/1WaAwMsCw5wA1vXklryjri8CIri5gxJxoRc60jWAbj3A/edit) workbook as its source of truth.

## 1. Create a Google service account

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project for the SDMC bot.
3. Enable the **Google Sheets API**.
4. Open **IAM & Admin → Service Accounts** and create a service account.
5. Open the service account, create a JSON key, and download it.

The downloaded key is a secret. Never commit it or upload it to Discord.

## 2. Add the credentials to `.env`

Copy the service account's `client_email` and `private_key` values into the local `.env` file:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=sdmc-bot@example-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=1WaAwMsCw5wA1vXklryjri8CIri5gxJxoRc60jWAbj3A
```

Keep the private key in quotes and retain the literal `\n` sequences.

## 3. Share and unprotect the workbook

1. Share the workbook with the service account email as an **Editor**.
2. In Google Sheets, open **Data → Protect sheets and ranges**.
3. Remove protection from the blank `Sheet1` tab, or allow the service account to edit it.

The current workbook rejected schema creation because the connected account could not edit the protected tab.

## 4. Create the database schema

Run:

```powershell
npm run database:setup
```

This safely creates and formats these tabs without overwriting a conflicting header row:

- `Members` — member identity, in-game name, rank, status, and automatically captured dates
- `Ranks` — rank names mapped to Discord Role IDs
- `Member Notes` — private staff notes
- `Audit Log` — registration, edits, removals, notes, and roster-sync history
- `Church Meetings` — one archive row for every published church meeting and its Discord links
- `Church Attendance` — one present/absent row per tracked roster member for every meeting
- `Treasury Transactions` — an immutable income and expense ledger for Money and Dirty Money
- `Dues Payments` — member dues history linked to automatically created treasury transactions

The `Church Attendance` status column accepts `Present`, `Absent`, `Excused`, or `Late`. Publishing final minutes from `/church` automatically snapshots the current active roster, marks the selected attendees present, and marks the remaining tracked members absent. Selected Discord users who are not yet registered are still saved as present with an `Unregistered` roster status.

Use `/treasurer transaction` for money gained or spent. Use `/treasurer dues` for dues so the bot writes both the dues payment and its linked income transaction together. `/treasurer dues-report` compares payments for a `YYYY-MM` period against the active roster.

## 5. Configure rank synchronization

In the `Ranks` tab, add one row for each club rank:

| Rank         | Level | Discord Role ID           | Active | Notes    |
| ------------ | ----: | ------------------------- | ------ | -------- |
| Example Rank |     1 | Paste the Discord role ID | TRUE   | Optional |

The rank text must match the member's Rank value. `/roster sync` only manages roles listed here and leaves all unrelated Discord roles untouched.
