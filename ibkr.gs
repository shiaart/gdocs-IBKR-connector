// ─── PRIVATE CONFIG ──────────────────────────────────────────────────────────
// Define getConnectorConfig() in a separate, private Apps Script file.
// Copy config.example.gs to config.private.gs locally and keep it out of Git.
var CONFIG;

function loadConnectorConfig() {
  if (typeof getConnectorConfig !== 'function') {
    throw new Error('Add a private getConnectorConfig() file to this Apps Script project. No sheets were updated.');
  }
  var config = getConnectorConfig();
  if (!config || !Array.isArray(config.ibkrAccounts) ||
      typeof config.positionsSheet !== 'string' || !config.positionsSheet ||
      typeof config.cashSheet !== 'string' || !config.cashSheet ||
      !Number.isInteger(config.positionsHeaderRow) ||
      !Number.isInteger(config.positionCapacity) ||
      !Number.isInteger(config.summaryCurrencyCapacity) ||
      config.positionCapacity < 1 || config.summaryCurrencyCapacity < 1 ||
      config.positionsHeaderRow - 2 <= 5 + config.summaryCurrencyCapacity) {
    throw new Error('Invalid private connector config or overlapping fixed ranges. No sheets were updated.');
  }
  config.baseSummaryCurrencyByAccount = config.baseSummaryCurrencyByAccount || {};
  return config;
}

var FLEX_REQUEST_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest';
var FLEX_FETCH_URL = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement';
var FLEX_FETCH_OPTIONS = {
  headers: { 'User-Agent': 'GoogleAppsScript/IBKRConnector' },
  muteHttpExceptions: true,
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function syncAll() {
  syncIBKR();
}

// Run manually to prepare tabs before Flex credentials are available.
// Calling it again only fills missing tabs and leaves existing data alone.
function setupConnector() {
  CONFIG = loadConnectorConfig();
  initializeManagedSheets(configuredAccountIds(false));
}

function syncIBKR() {
  CONFIG = loadConnectorConfig();
  var positionRows = [];
  var cashRows = [];
  var accountIds = configuredAccountIds(true);
  autoSetupEmptySpreadsheet(accountIds);
  requireManagedSheets(accountIds);
  var accounts = CONFIG.ibkrAccounts.filter(function(account) { return account.accountIds.length; });

  accounts.forEach(function(account) {
    var xml = fetchFlexStatement(account);
    if (!xml) return;

    var root = XmlService.parse(xml).getRootElement();
    var reportedIds = readReportedAccountIds(root);
    account.accountIds.forEach(function(id) {
      if (!reportedIds[id]) {
        throw new Error(account.name + ' Flex report is missing configured account ' + id +
          '. No imported data was written.');
      }
    });
    positionRows = positionRows.concat(readPositions(root, account.name).filter(function(row) {
      return account.accountIds.indexOf(row[1]) !== -1;
    }));
    cashRows = cashRows.concat(readCash(root, account.name).filter(function(row) {
      return account.accountIds.indexOf(row[1]) !== -1;
    }));
  });

  var accountData = prepareAccountData(positionRows, cashRows, accountIds);
  requireManagedSheetSizes(accountIds, positionRows.length, cashRows.length);
  writeSheet(CONFIG.positionsSheet, POSITION_HEADERS, positionRows).hideSheet();
  writeSheet(CONFIG.cashSheet, CASH_HEADERS, cashRows).hideSheet();
  writeAccountSheets(accountData);
}

function isConfiguredAccount(account) {
  return typeof account.token === 'string' && !!account.token.trim() &&
    !/^REPLACE_WITH_/.test(account.token) &&
    typeof account.queryId === 'string' && !!account.queryId.trim() &&
    !/^REPLACE_WITH_/.test(account.queryId);
}

function configuredAccountIds(requireCredentials) {
  var ids = {};
  var accountIds = [];
  CONFIG.ibkrAccounts.forEach(function(account) {
    if (!Array.isArray(account.accountIds)) throw new Error(account.name + ': accountIds must be an array.');
    if (requireCredentials && account.accountIds.length && !isConfiguredAccount(account)) {
      throw new Error(account.name + ': add a Flex token and Query ID before syncing. No sheets were updated.');
    }
    account.accountIds.forEach(function(id) {
      if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
        throw new Error(account.name + ': enter each account ID as an exact, non-empty string.');
      }
      if (/^(ACCOUNT_ID_|REPLACE_WITH_)/.test(id)) {
        throw new Error(account.name + ': replace the example account ID before creating tabs.');
      }
      if (ids[id]) throw new Error('Account ' + id + ' is configured more than once.');
      ids[id] = true;
      accountIds.push(id);
    });
  });
  if (!Object.keys(ids).length) throw new Error('Add the fixed IBKR account numbers to CONFIG.ibkrAccounts[].accountIds.');
  return accountIds;
}

function managedSheetNames(accountIds) {
  var names = accountIds.concat([CONFIG.positionsSheet, CONFIG.cashSheet]);
  names.reduce(function(seen, name) {
    if (seen[name]) throw new Error('Managed sheet name is configured more than once: ' + name);
    seen[name] = true;
    return seen;
  }, {});
  return names;
}

function isBlankSheet(sheet) {
  return sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
}

function autoSetupEmptySpreadsheet(accountIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var names = managedSheetNames(accountIds);
  if (sheets.length === 1 && isBlankSheet(sheets[0]) &&
      names.every(function(name) { return !ss.getSheetByName(name); })) {
    initializeManagedSheets(accountIds);
  }
}

function initializeManagedSheets(accountIds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = managedSheetNames(accountIds);
  var sheets = ss.getSheets();
  var reusable = sheets.length === 1 && isBlankSheet(sheets[0]) &&
    names.indexOf(sheets[0].getName()) === -1 ? sheets[0] : null;

  accountIds.forEach(function(id) {
    var sheet = ss.getSheetByName(id);
    if (!sheet && reusable) {
      sheet = reusable.setName(id);
      reusable = null;
    } else if (!sheet) {
      sheet = ss.insertSheet(id);
    }
    ensureMinimumSheetSize(sheet, CONFIG.positionsHeaderRow + CONFIG.positionCapacity,
      POSITION_HEADERS.length);
    if (!isBlankSheet(sheet)) return;
    sheet.getRange(1, 1).setValue(id).setFontSize(14).setFontWeight('bold');
    sheet.getRange(2, 4).setValue('Cash is shown in its reported currency; no FX conversion');
    sheet.getRange(4, 1).setValue('Cash by currency').setFontWeight('bold');
    sheet.getRange(5, 1, 1, 3).setValues([['Currency', 'Cash', 'Settled cash']]);
    styleAccountHeaderRow(sheet, 5, 3);
    sheet.getRange(CONFIG.positionsHeaderRow - 2, 1, 1, 2).setValues([
      ['Position data rows', 'A' + (CONFIG.positionsHeaderRow + 1) +
        ':M' + (CONFIG.positionsHeaderRow + CONFIG.positionCapacity)],
    ]);
    sheet.getRange(CONFIG.positionsHeaderRow, 1, 1, POSITION_HEADERS.length)
      .setValues([POSITION_HEADERS]);
    styleAccountHeaderRow(sheet, CONFIG.positionsHeaderRow, POSITION_HEADERS.length);
    sheet.setFrozenRows(2);
  });

  [
    { name: CONFIG.positionsSheet, headers: POSITION_HEADERS },
    { name: CONFIG.cashSheet, headers: CASH_HEADERS },
  ].forEach(function(item) {
    var sheet = ss.getSheetByName(item.name) || ss.insertSheet(item.name);
    if (isBlankSheet(sheet)) {
      ensureMinimumSheetSize(sheet, 1, item.headers.length);
      sheet.getRange(1, 1, 1, item.headers.length).setValues([item.headers]);
      styleHeaderRow(sheet, 1, item.headers.length);
    }
    sheet.hideSheet();
  });
}

function requireManagedSheets(accountIds) {
  var names = managedSheetNames(accountIds);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var missing = names.filter(function(name) { return !ss.getSheetByName(name); });
  if (missing.length) throw new Error('Missing tabs: ' + missing.join(', ') +
    '. Run setupConnector() to add them; the daily sync does not add tabs to an existing sheet.');
}

function requireManagedSheetSizes(accountIds, positionCount, cashCount) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  accountIds.forEach(function(id) {
    var sheet = ss.getSheetByName(id);
    var minRows = CONFIG.positionsHeaderRow + CONFIG.positionCapacity;
    if (sheet.getMaxRows() < minRows || sheet.getMaxColumns() < POSITION_HEADERS.length) {
      throw new Error(id + ' needs at least ' + minRows + ' rows and ' +
        POSITION_HEADERS.length + ' columns. Run setupConnector() before syncing.');
    }
  });
  ensureMinimumSheetSize(ss.getSheetByName(CONFIG.positionsSheet), positionCount + 1,
    POSITION_HEADERS.length);
  ensureMinimumSheetSize(ss.getSheetByName(CONFIG.cashSheet), cashCount + 1,
    CASH_HEADERS.length);
}

function ensureMinimumSheetSize(sheet, minRows, minColumns) {
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < minColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minColumns - sheet.getMaxColumns());
  }
}

function readReportedAccountIds(root) {
  var ids = {};
  root.getChildren('FlexStatements').forEach(function(container) {
    container.getChildren('FlexStatement').forEach(function(stmt) {
      var id = attr(stmt, 'accountId');
      if (id) ids[id] = true;
      var positions = stmt.getChild('OpenPositions');
      if (positions) positions.getChildren('OpenPosition').forEach(function(row) {
        id = attr(row, 'accountId');
        if (id) ids[id] = true;
      });
      var cash = stmt.getChild('CashReport');
      if (cash) cash.getChildren('CashReportCurrency').forEach(function(row) {
        id = attr(row, 'accountId');
        if (id) ids[id] = true;
      });
    });
  });
  return ids;
}

// ─── FLEX API ────────────────────────────────────────────────────────────────

function fetchFlexStatement(account) {
  // Step 1: request the statement and get a reference code
  var reqUrl = FLEX_REQUEST_URL + '?v=3&t=' + account.token + '&q=' + account.queryId;
  var reqRes = UrlFetchApp.fetch(reqUrl, FLEX_FETCH_OPTIONS);
  var reqDoc = XmlService.parse(reqRes.getContentText());
  var reqRoot = reqDoc.getRootElement();

  var status = reqRoot.getChildText('Status');
  if (status !== 'Success') {
    throw new Error(
      account.name + ' Flex request failed (' + reqRoot.getChildText('ErrorCode') + '): ' +
      reqRoot.getChildText('ErrorMessage')
    );
  }

  var refCode = reqRoot.getChildText('ReferenceCode');
  // Step 2: poll until the statement is ready (IBKR queues it server-side)
  var fetchUrl = FLEX_FETCH_URL + '?v=3&t=' + account.token + '&q=' + refCode;
  for (var i = 0; i < 10; i++) {
    Utilities.sleep(2000);
    var stmtRes = UrlFetchApp.fetch(fetchUrl, FLEX_FETCH_OPTIONS);
    var body = stmtRes.getContentText();
    if (body.indexOf('<FlexQueryResponse') !== -1) {
      return body;
    }
    // Still generating — IBKR returns a short XML with Status=Warn
  }

  throw new Error(account.name + ' statement timed out. Try again in a moment.');
}

// ─── POSITIONS ───────────────────────────────────────────────────────────────

var POSITION_HEADERS = [
  'Login', 'Account', 'Symbol', 'Description', 'Asset Class', 'Currency',
  'Quantity', 'Mark Price', 'Market Value', 'Avg Cost', 'Unrealized P&L',
  'Unrealized P&L %', 'Last Updated',
];

function readPositions(root, loginName) {
  var rows   = [];
  var now    = new Date();

  // OpenPosition elements may sit inside FlexStatements > FlexStatement > OpenPositions
  var stmts = root.getChildren('FlexStatements');
  stmts.forEach(function(stmts_) {
    stmts_.getChildren('FlexStatement').forEach(function(stmt) {
      var openPos = stmt.getChild('OpenPositions');
      if (!openPos) return;
      openPos.getChildren('OpenPosition').forEach(function(p) {
        var qty      = parseFloat(p.getAttribute('position') ? p.getAttribute('position').getValue() : 0);
        var avgCost  = parseFloat(attr(p, 'costBasisPrice'));
        var mktVal   = parseFloat(attr(p, 'positionValue'));
        var markPx   = parseFloat(attr(p, 'markPrice'));
        var cost     = qty * avgCost;
        var uPnl     = parseFloat(attr(p, 'fifoPnlUnrealized'));
        var uPnlPct  = cost !== 0 ? (uPnl / Math.abs(cost)) * 100 : 0;

        rows.push([
          loginName,
          attr(p, 'accountId') || attr(stmt, 'accountId'),
          attr(p, 'symbol'),
          attr(p, 'description'),
          attr(p, 'assetCategory'),
          attr(p, 'currency'),
          qty,
          markPx,
          mktVal,
          avgCost,
          uPnl,
          uPnlPct,
          now,
        ]);
      });
    });
  });

  return rows;
}

// ─── CASH ────────────────────────────────────────────────────────────────────

var CASH_HEADERS = [
  'Login', 'Account', 'Currency', 'Ending Cash', 'Ending Settled Cash', 'Last Updated',
];

function readCash(root, loginName) {
  var rows = [];
  var now  = new Date();

  root.getChildren('FlexStatements').forEach(function(stmts_) {
    stmts_.getChildren('FlexStatement').forEach(function(stmt) {
      var cashReport = stmt.getChild('CashReport');
      if (!cashReport) return;
      var cashByCurrency = cashReport.getChildren('CashReportCurrency');
      var detailedRows = cashByCurrency.filter(function(c) {
        return attr(c, 'currency') !== 'BASE_SUMMARY';
      });
      // Some accounts return only BASE_SUMMARY. Use it only as a fallback so
      // reports with both detailed currencies and a summary are not double counted.
      var cashRows = detailedRows.length ? detailedRows : cashByCurrency.filter(function(c) {
        return attr(c, 'currency') === 'BASE_SUMMARY';
      });
      cashRows.forEach(function(c) {
        var accountId = attr(c, 'accountId') || attr(stmt, 'accountId');
        var currency = attr(c, 'currency');
        // Use an account's configured base currency only for a summary-only report.
        if (currency === 'BASE_SUMMARY' && CONFIG.baseSummaryCurrencyByAccount[accountId]) {
          currency = CONFIG.baseSummaryCurrencyByAccount[accountId];
        }
        rows.push([
          loginName,
          accountId,
          currency,
          numberAttr(c, 'endingCash'),
          numberAttr(c, 'endingSettledCash'),
          now,
        ]);
      });
    });
  });

  return rows;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function attr(el, name) {
  var a = el.getAttribute(name);
  return a ? a.getValue() : '';
}

function numberAttr(el, name) {
  var value = attr(el, name);
  return value === '' ? '' : parseFloat(value);
}

function writeSheet(name, headers, rows) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Missing managed tab: ' + name);

  sheet.clearContents();

  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  var data = [headers].concat(rows);
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);

  // Format header row
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1a2e');
  headerRange.setFontColor('#ffffff');

  // Format number columns
  if (name === CONFIG.positionsSheet) {
    // Quantity, Mark Price, Market Value, Avg Cost, Unrealized P&L, Unrealized P&L %
    formatColumn(sheet, rows.length, 7, '#,##0.00000');
    formatColumn(sheet, rows.length, 8, '#,##0.00');
    formatColumn(sheet, rows.length, 9, '#,##0.00');
    formatColumn(sheet, rows.length, 10, '#,##0.00');
    formatColumn(sheet, rows.length, 11, '#,##0.00');
    formatColumn(sheet, rows.length, 12, '#,##0.00"%"');
    formatColumn(sheet, rows.length, 13, 'dd/mm/yyyy hh:mm');
  } else {
    formatColumn(sheet, rows.length, 4, '#,##0.00');
    formatColumn(sheet, rows.length, 5, '#,##0.00');
    formatColumn(sheet, rows.length, 6, 'dd/mm/yyyy hh:mm');
  }

  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function formatColumn(sheet, numRows, col, format) {
  if (numRows > 0) {
    sheet.getRange(2, col, numRows, 1).setNumberFormat(format);
  }
}

function prepareAccountData(positionRows, cashRows, accountIds) {
  var result = {};
  accountIds.forEach(function(accountId) {
    var positions = positionRows.filter(function(row) { return row[1] === accountId; });
    var cash = cashRows.filter(function(row) { return row[1] === accountId; });
    if (positions.length > CONFIG.positionCapacity) {
      throw new Error(accountId + ' has ' + positions.length + ' positions; the fixed reference range holds ' +
        CONFIG.positionCapacity + '. Increase CONFIG.positionCapacity and your external reference before syncing.');
    }

    var byCurrency = {};
    function cashFor(currency) {
      var code = currency === 'RUS' ? 'RUB' : (currency || 'UNKNOWN');
      if (!byCurrency[code]) {
        byCurrency[code] = { cash: 0, settledCash: 0 };
      }
      return byCurrency[code];
    }
    positions.forEach(function(row) {
      cashFor(row[5]);
    });
    cash.forEach(function(row) {
      var summary = cashFor(row[2]);
      summary.cash += Number(row[3]) || 0;
      summary.settledCash += Number(row[4]) || 0;
    });

    var currencies = Object.keys(byCurrency).sort();
    if (currencies.length > CONFIG.summaryCurrencyCapacity) {
      throw new Error(accountId + ' has ' + currencies.length + ' currencies; the account summary holds ' +
        CONFIG.summaryCurrencyCapacity + '. Increase the summary space before syncing.');
    }
    var summaryRows = currencies.map(function(currency) {
      var s = byCurrency[currency];
      return [currency, s.cash, s.settledCash];
    });
    result[accountId] = { positions: positions, summaryRows: summaryRows };
  });
  return result;
}

function writeAccountSheets(accountData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var positionRow = CONFIG.positionsHeaderRow;
  Object.keys(accountData).forEach(function(accountId) {
    var data = accountData[accountId];
    var sheet = ss.getSheetByName(accountId);
    if (!sheet) throw new Error('Missing account tab: ' + accountId);

    // Refresh only generated cash and position ranges. Keep the buy plan and
    // account calculations between them intact across syncs.
    sheet.getRange(4, 1, CONFIG.summaryCurrencyCapacity + 2, 3).clearContent().clearFormat();
    sheet.getRange(positionRow, 1, CONFIG.positionCapacity + 1, POSITION_HEADERS.length).clearContent().clearFormat();
    sheet.showSheet();

    sheet.getRange(1, 1).setValue(accountId).setFontSize(14).setFontWeight('bold');
    sheet.getRange(1, 4).setValue('Last synced: ' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
    sheet.getRange(2, 4).setValue('Cash is shown in its reported currency; no FX conversion');

    sheet.getRange(4, 1).setValue('Cash by currency').setFontWeight('bold');
    var summaryHeaders = ['Currency', 'Cash', 'Settled cash'];
    sheet.getRange(5, 1, 1, summaryHeaders.length).setValues([summaryHeaders]);
    styleAccountHeaderRow(sheet, 5, summaryHeaders.length);
    if (data.summaryRows.length) {
      sheet.getRange(6, 1, data.summaryRows.length, summaryHeaders.length).setValues(data.summaryRows);
    }
    sheet.getRange(6, 2, CONFIG.summaryCurrencyCapacity, 2).setNumberFormat('#,##0.00');
    sheet.getRange(positionRow - 2, 1, 1, 2).setValues([['Position data rows',
      'A' + (positionRow + 1) + ':M' + (positionRow + CONFIG.positionCapacity)]]);

    sheet.getRange(positionRow, 1, 1, POSITION_HEADERS.length).setValues([POSITION_HEADERS]);
    styleAccountHeaderRow(sheet, positionRow, POSITION_HEADERS.length);
    if (data.positions.length) {
      sheet.getRange(positionRow + 1, 1, data.positions.length, POSITION_HEADERS.length).setValues(data.positions);
    }
    sheet.getRange(positionRow + 1, 7, CONFIG.positionCapacity, 1).setNumberFormat('#,##0.00000');
    sheet.getRange(positionRow + 1, 8, CONFIG.positionCapacity, 4).setNumberFormat('#,##0.00');
    sheet.getRange(positionRow + 1, 12, CONFIG.positionCapacity, 1).setNumberFormat('#,##0.00"%"');
    sheet.getRange(positionRow + 1, 13, CONFIG.positionCapacity, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sheet.setFrozenRows(2);
  });
}

function styleHeaderRow(sheet, row, numCols) {
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
}

function styleAccountHeaderRow(sheet, row, numCols) {
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setBackground('#dce8f6').setFontColor('#1f2937');
}

// ─── TRIGGER SETUP ───────────────────────────────────────────────────────────
// Run this once manually to install a daily trigger.

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAll') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncAll')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  console.log('Daily trigger installed. syncAll will run every day at 08:00.');
}
