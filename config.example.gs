// Copy this file to config.private.gs, replace the examples, and do not commit it.
// Add config.private.gs as a second file in the spreadsheet's Apps Script project.
// Each accountIds entry becomes an account tab name during setup.
// The name field is only a label for a Flex login; it is not a tab name.
// Run setupConnector() before credentials are ready, or run syncAll() once
// with completed credentials in a new, empty Google Sheet.
function getConnectorConfig() {
  return {
    ibkrAccounts: [
      {
        name: 'account1',
        token: 'REPLACE_WITH_TOKEN_1',
        queryId: 'REPLACE_WITH_QUERY_ID_1',
        accountIds: ['ACCOUNT_ID_1'],
      },
      {
        name: 'account2',
        token: 'REPLACE_WITH_TOKEN_2',
        queryId: 'REPLACE_WITH_QUERY_ID_2',
        accountIds: ['ACCOUNT_ID_2'],
      },
    ],
    positionsSheet: 'IBKR Positions',
    cashSheet: 'IBKR Cash',
    positionsHeaderRow: 42,
    positionCapacity: 50,
    summaryCurrencyCapacity: 10,
    // Only needed for accounts whose Cash Report contains BASE_SUMMARY alone.
    // Example: ACCOUNT_ID_2: 'GBP'
    baseSummaryCurrencyByAccount: {},
  };
}
