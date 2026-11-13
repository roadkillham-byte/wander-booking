// Apps Script adapter for the dashboard store (docs/contract.md). Put this file, rules.js and logic.js in ONE Apps Script
// project bound to its own Google Sheet (not the booking intake project). Script properties:
//   STORE_SHEET_ID  the ID of the store Sheet
//   APP_TOKEN       16+ random characters, the same value Coffee Van holds in ~/.config/coffee-van/dashboard.env
// Deploy as a web app: execute as me, access "Anyone" (the page calls it; every route checks its own token).

function storeDb_() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('STORE_SHEET_ID'));
  function sheetFor(table) {
    var name = 'dash_' + table;
    var sh = ss.getSheetByName(name);
    var headers = StoreLogic.TABLES[table];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@'); // keep "09:00" and dates as text
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
    return { sh: sh, headers: headers };
  }
  return {
    read: function (table) {
      var s = sheetFor(table);
      var last = s.sh.getLastRow();
      if (last < 2) return [];
      var values = s.sh.getRange(2, 1, last - 1, s.headers.length).getValues();
      return values.filter(function (row) { return row.join('') !== ''; }).map(function (row) {
        var obj = {};
        s.headers.forEach(function (h, i) { obj[h] = row[i] === null || row[i] === undefined ? '' : String(row[i]); });
        return obj;
      });
    },
    write: function (table, rows) {
      var s = sheetFor(table);
      var last = s.sh.getMaxRows();
      if (last > 1) s.sh.getRange(2, 1, last - 1, s.headers.length).clearContent();
      if (rows.length === 0) return;
      s.sh.getRange(2, 1, rows.length, s.headers.length).setValues(rows.map(function (r) {
        return s.headers.map(function (h) { return r[h] === null || r[h] === undefined ? '' : String(r[h]); });
      }));
    },
    append: function (table, row) {
      var s = sheetFor(table);
      s.sh.appendRow(s.headers.map(function (h) { return row[h] === null || row[h] === undefined ? '' : String(row[h]); }));
    },
    lock: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000); // one writer at a time: holds and publishes cannot interleave
      try { return fn(); } finally { lock.releaseLock(); }
    },
    env: function (name) { return PropertiesService.getScriptProperties().getProperty(name) || ''; },
  };
}

function storeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function storeNow_() { return new Date().toISOString(); }

// Every route answers JSON, even when it throws (a lock timeout, a Sheet that cannot be opened): the page then knows the store
// itself failed and says so, instead of getting an HTML error page. The owner is emailed, at most once an hour.
function storeFailure_(action, err) {
  try {
    var props = PropertiesService.getScriptProperties();
    var alert = StoreLogic.failureAlert(props.getProperty('LAST_ALERT_AT') || '', action, String(err && err.message || err), storeNow_());
    if (alert.send) {
      props.setProperty('LAST_ALERT_AT', alert.lastAlertAt);
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), alert.subject, alert.body);
    }
  } catch (ignored) { /* the answer below matters more than the mail */ }
  return storeJson_({ ok: false, error: 'store-error' });
}

// GET: health and the public prices. Everything with a token is a POST.
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  try {
    var db = storeDb_();
    if (action === 'health') return storeJson_(StoreLogic.health(db, storeNow_()));
    if (action === 'prices') return storeJson_(StoreLogic.prices(db));
    return storeJson_({ ok: false, error: 'unknown-action' });
  } catch (err) {
    return storeFailure_(action || 'get', err);
  }
}

// POST (text/plain JSON body): session, request, availability, event, publish, pending, ack.
function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return storeJson_({ ok: false, error: 'bad-json' }); }
  try {
    var db = storeDb_();
    var now = storeNow_();
    if (action === 'session') return storeJson_(StoreLogic.session(db, body.k, now));
    if (action === 'request') return storeJson_(StoreLogic.request(db, body, now));
    if (action === 'availability') return storeJson_(StoreLogic.availability(db, body, now));
    if (action === 'event') return storeJson_(StoreLogic.event(db, body, now));
    if (action === 'publish') return storeJson_(StoreLogic.publish(db, body.k, body.snapshot, now));
    if (action === 'pending') return storeJson_(StoreLogic.pending(db, body.k));
    if (action === 'ack') return storeJson_(StoreLogic.ack(db, body.k, body.ids));
    return storeJson_({ ok: false, error: 'unknown-action' });
  } catch (err) {
    return storeFailure_(action || 'post', err);
  }
}

// Run once from the Apps Script editor after deploying: Google asks you to allow the script to send you email, and a test
// message arrives. After that a store error reaches you as an email (at most one an hour).
function sendTestAlert_() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Wander Customer Portal: test alert', 'If you can read this, store errors will reach you here.');
}

// Run once from the Apps Script editor after deploying: checks that daylight saving time comes out right in this runtime.
function selfTestRules_() {
  var checks = [
    [WanderRules.sydneyEpoch('2026-12-05', '09:00'), Date.UTC(2026, 11, 4, 22, 0)],
    [WanderRules.sydneyEpoch('2026-07-05', '09:00'), Date.UTC(2026, 6, 4, 23, 0)],
    [WanderRules.sydneyEpoch('2026-04-06', '12:00'), Date.UTC(2026, 3, 6, 2, 0)],
  ];
  var bad = checks.filter(function (c) { return c[0] !== c[1]; });
  Logger.log(bad.length === 0 ? 'rules OK in this runtime' : 'rules MISMATCH: ' + JSON.stringify(bad));
}
