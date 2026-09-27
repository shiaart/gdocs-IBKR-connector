# IBKR Flex to Google Sheets

Reusable Google Apps Script for importing IBKR Flex cash and open positions into a fixed set of account-number tabs. The public script has no account IDs, tokens, query IDs, or account-specific currency assumptions.

## Why use it

This connector gives people who follow several IBKR portfolios one Google Sheet for routine cash and position checks. Configure a Flex Query for each authorised login, list its account IDs in the private config, and schedule the script to refresh the same account tabs each day. You can then build formulas or a separate dashboard around fixed ranges without signing in to Client Portal for every routine review.

It can be useful for a household with separate logins, a team overseeing portfolios for several people or companies, or anyone who prefers spreadsheet-based reporting. The Flex Web Service retrieves saved reports using a token and Query ID; [IBKR says a token can be set to remain active from six hours to one year](https://www.interactivebrokers.com/docs/web-api/flex-web-service/client-portal-configuration/enable-and-create-access-token). A saved query can be reused for scheduled runs while its token remains valid. Renew the token when it expires or is replaced.

For a reporting workflow, share the resulting Sheet only with viewers who need it, and keep the Flex token and private configuration with the maintainer. People reviewing the Sheet do not need your IBKR login credentials. [IBKR describes Flex Web Service as report retrieval without using those credentials in each request](https://www.interactivebrokers.com/docs/web-api/flex-web-service/client-portal-configuration). The Sheet contains financial information, so apply appropriate Google Sheets sharing permissions.

## Files

- `ibkr.gs` — shareable connector code.
- `config.example.gs` — shareable configuration template with `account1` and `account2` examples.
- `config.private.gs` — your local configuration, excluded by `.gitignore`. Replace its credential placeholders before use.

Do not add `config.private.gs`, a token, or a query ID to a public repository. The `.gitignore` allowlist keeps only the four reviewed project files eligible for normal staging. Review any file before adding it to the allowlist; `.gitignore` does not remove files that were already committed or added with `git add -f`.

## Start from an empty Google Sheet

1. Create a new Google Sheet. Leave its single blank tab in place.
2. Copy `config.example.gs` to `config.private.gs`. Replace `ACCOUNT_ID_1`, `ACCOUNT_ID_2`, and any other account ID examples with real account numbers. Add or remove login objects as needed. The `name` values such as `account1` are only labels; **each value in `accountIds` becomes an account tab name**. One Flex query can include several accounts available to that login.
3. Open **Extensions → Apps Script** in that Sheet. Add `ibkr.gs` and your private `config.private.gs` as separate script files. Keep the private file out of GitHub. If using a deployment tool, configure it to upload the private file from your machine.
4. Run `setupConnector()` once and grant Apps Script access when prompted. It needs account IDs, but it does **not** need a token or Query ID yet. On a blank spreadsheet, it renames the blank tab for the first account, creates the other account tabs, creates `IBKR Positions` and `IBKR Cash`, and writes the fixed headers. It sizes new account tabs for the configured position range. Running it again leaves existing data and tab order alone while adding any newly configured account tabs.
5. [Create the Flex Query and token](#configure-the-ibkr-flex-query) for each login, then fill the `token` and `queryId` fields in your private config. Run `syncAll()` and inspect the results and execution log. Once that succeeds, run `installDailyTrigger()` once to schedule daily syncs.

If you already filled in account IDs, tokens, and Query IDs, you can skip step 4: the first `syncAll()` automatically initializes a genuinely empty, single-tab Sheet. Later scheduled syncs only use the existing tabs. If a required tab is missing from a previously initialized Sheet, the sync stops and tells you to run `setupConnector()` explicitly. It does not silently recreate tabs on a daily run.

An Apps Script daily trigger runs in Google's cloud. It cannot read a config file that exists only on your computer. The local private file is the source you keep out of Git; a copy must be installed in your private Apps Script project for automatic runs.

## Fixed layout

The account tab names come only from `accountIds` in the private config. The setup step creates those exact tabs once; regular syncs never rename or reorder them. Accounts present in a Flex report but absent from `accountIds` are ignored. A missing tab in an initialized Sheet, missing credentials, missing configured account in the Flex report, insufficient account-tab size, more than `positionCapacity` positions, or more than `summaryCurrencyCapacity` currencies stops the sync before importing data. The two script-managed raw tabs can grow as the report grows.

With the example settings, each account tab uses:

| Range | Contents |
|---|---|
| `A1`, `D1:D2` | Account ID and sync notes |
| `A4:C15` | Cash currencies and balances; up to 10 currencies |
| `A40:B40` | Position range label |
| `A42:M42` | Position headers |
| `A43:M92` | 50 reserved position rows |

The script refreshes the generated cash range and position range on each sync. It leaves the rows between them available for your own formulas and notes. The account tab's columns and fixed row ranges remain stable, but a particular currency or security can move to a different row as holdings change. Match by currency or symbol in downstream formulas instead of relying on an item's row number.

`IBKR Positions` and `IBKR Cash` are raw, script-managed tabs that setup creates and the connector hides after writing. Their row counts can grow with the report.

## Configure the IBKR Flex Query

For each IBKR login used in `ibkrAccounts`:

1. In Client Portal, go to **Reporting / Performance & Reports → Flex Queries**. Create an **Activity Flex Query** (not a Trade Confirmation query). In its **Sections**, add **Open Positions** and **Cash Report**. IBKR's [Activity Flex Query guide](https://www.ibkrguides.com/student-trading-lab-professor/en-us/activityflex.htm) shows the section and field selection flow.
2. Select these fields. The connector reads these values from the XML; extra fields are unnecessary:

   | Section | Fields to select |
   |---|---|
   | Open Positions | Account ID, Currency, Asset Class, Symbol, Description, Quantity, Mark Price, Position Value, Cost Basis Price, FIFO Unrealized PNL |
   | Cash Report | Account ID, Currency, Ending Cash, Ending Settled Cash |

   Set **Open Positions level of detail to Summary** if the option is offered. Select **Account ID**, not an alias in its place, so the report matches `accountIds` exactly. IBKR defines these fields in its [Open Positions](https://www.ibkrguides.com/reportingreference/reportguide/open%20positionsfq.htm) and [Cash Report](https://www.ibkrguides.com/reportingreference/reportguide/cash%20reportfq.htm) references.
3. Under **Delivery Configuration**, select every account ID assigned to this login in your private config, choose **XML**, and set **Period: Last Business Day** for daily holdings. Save the query, then open its details and copy the displayed **Query ID** into that login's `queryId`. IBKR describes these settings in its [query creation guide](https://www.ibkrguides.com/student-trading-lab-professor/en-us/activityflex.htm).
4. Open **Flex Queries → Flex Web Service Configuration** for that login, enable the service, choose a token lifetime that covers your scheduled runs (IBKR permits up to one year), and select **Generate New Token**. Copy the current token into that login's `token`. A new token invalidates the old one, and the default expiry may be only six hours; renew the private config when a token expires. See IBKR's [Flex Web Service setup guide](https://www.ibkrguides.com/brokerportal/performanceandstatements/flex3.htm) and [token lifetime reference](https://www.interactivebrokers.com/docs/web-api/flex-web-service/client-portal-configuration/enable-and-create-access-token).
5. Test the saved query in Client Portal and check that the XML includes the configured accounts, cash rows, and any expected positions. The connector uses IBKR's [Flex Web Service v3 request flow](https://www.interactivebrokers.com/docs/web-api/api-reference/send-request) to retrieve it.

Each login needs its own valid token and Query ID. Keep them in the private config only. Account IDs are fixed in that config; the connector does not add accounts discovered in the Flex report.

Some Cash Reports provide only `BASE_SUMMARY`. For those accounts, set the account ID's actual base currency in `baseSummaryCurrencyByAccount`. When detailed currencies are present, the connector uses those instead of double counting the summary. The connector maps the IBKR cash label `RUS` to `RUB` in the account cash table; the raw tab keeps the reported label.

## Reliability

The connector checks the fixed account list, required tabs, sheet size, and row capacities before importing data. `setupConnector()` intentionally creates missing tabs; `syncAll()` does this automatically only for a genuinely empty, single-tab Sheet. Check the Apps Script execution result and sync time when relying on a daily update. Flex delivery, permissions, or an unexpected Sheets write error can still interrupt a run; the connector does not provide an atomic transaction across all tabs.
