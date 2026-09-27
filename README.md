# IBKR Flex to Google Sheets

Reusable Google Apps Script for importing IBKR Flex cash and open positions into a fixed set of account-number tabs. The public script has no account IDs, tokens, query IDs, or account-specific currency assumptions.

## Files

- `ibkr.gs` — shareable connector code.
- `config.example.gs` — shareable configuration template with `account1` and `account2` examples.
- `config.private.gs` — your local configuration, excluded by `.gitignore`. Replace its credential placeholders before use.

Do not add `config.private.gs`, a token, or a query ID to a public repository. The `.gitignore` allowlist keeps only the four reviewed project files eligible for normal staging. Review any file before adding it to the allowlist; `.gitignore` does not remove files that were already committed or added with `git add -f`.

## First-time setup in an empty Google Sheet

1. Copy `config.example.gs` to `config.private.gs`. Replace the example Flex tokens, Query IDs, and `accountIds` with your own. Add or remove login objects as needed. One Flex query may cover several account IDs if it includes them all. The `name` values such as `account1` are only labels; **the values in `accountIds` are the required tab names**.
2. In the empty Google Sheet, rename its default `Sheet1` tab to one of your account IDs. Use the **+** button at the bottom to add one tab for every other ID in `accountIds`. Then add two more tabs named exactly `IBKR Positions` and `IBKR Cash`. For example, if `accountIds` contains `ACCOUNT_ID_1` and `ACCOUNT_ID_2`, the sheet needs those two account tabs and the two raw tabs. Replace the example IDs with real account numbers before use.
3. Check tab sizes. With the example layout, each account tab needs at least **92 rows and 13 columns (A:M)**. In general it needs `positionsHeaderRow + positionCapacity` rows. The two raw tabs also need enough rows for the downloaded positions and cash records. Add rows manually if needed; the script does not grow sheets.
4. Open **Extensions → Apps Script** and add both `ibkr.gs` and your private `config.private.gs` as separate script files. Keep the private file out of a public GitHub repository. If using a deployment tool, configure it to upload the private file from your machine.
5. Run `syncAll()` once and inspect the results and execution log. If a required tab is missing or too small, the run stops with an error telling you what to fix. Once the first sync succeeds, run `installDailyTrigger()` once to schedule daily syncs.

**After setup:** Every manual or scheduled sync reuses those exact tabs. It never creates a tab on the first run or on later runs, never renames a tab, and never changes tab order. New accounts require you to add their IDs to the private config and create their tabs yourself before the next sync.

An Apps Script daily trigger runs in Google's cloud. It cannot read a config file that exists only on your computer. The local private file is the source you keep out of Git; a copy must be installed in your private Apps Script project for automatic runs.

## Fixed layout

The account tab names come only from `accountIds` in the private config. Accounts present in a Flex report but absent from `accountIds` are ignored. A missing tab, missing credentials, missing configured account in the Flex report, insufficient sheet size, more than `positionCapacity` positions, or more than `summaryCurrencyCapacity` currencies stops the sync before writing.

With the example settings, each account tab uses:

| Range | Contents |
|---|---|
| `A1`, `D1:D2` | Account ID and sync notes |
| `A4:C15` | Cash currencies and balances; up to 10 currencies |
| `A40:B40` | Position range label |
| `A42:M42` | Position headers |
| `A43:M92` | 50 reserved position rows |

The script refreshes the generated cash range and position range on each sync. It leaves the rows between them available for your own formulas and notes. The account tab's columns and fixed row ranges remain stable, but a particular currency or security can move to a different row as holdings change. Match by currency or symbol in downstream formulas instead of relying on an item's row number.

`IBKR Positions` and `IBKR Cash` are raw, script-managed tabs that the connector hides after writing. Their row counts change with the report. They are also required to exist before the first sync.

## Flex query

Create an Activity Flex Query in XML format with **Open Positions** and **Cash Report** sections. Cash Report needs Account ID, Currency, Ending Cash, and Ending Settled Cash. Set the report period to Last Business Day if you want daily holdings. Provide each login's token and Query ID in the private config.

Some Cash Reports provide only `BASE_SUMMARY`. For those accounts, set the account ID's actual base currency in `baseSummaryCurrencyByAccount`. When detailed currencies are present, the connector uses those instead of double counting the summary. The connector maps the IBKR cash label `RUS` to `RUB` in the account cash table; the raw tab keeps the reported label.

## Reliability

The connector checks the fixed account list, required tabs, sheet size, and row capacities before writing. Check the Apps Script execution result and sync time when relying on a daily update. Flex delivery, permissions, or an unexpected Sheets write error can still interrupt a run; the connector does not provide an atomic transaction across all tabs.
