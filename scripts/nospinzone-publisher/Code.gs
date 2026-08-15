const NSZ = Object.freeze({
  SHEET_NAME: 'QUEUE',
  STATUS_APPROVED: 'APPROVED',
  STATUS_POSTED: 'POSTED',
  STATUS_REVIEW: 'YELLOW_REVIEW',
  X_POST_URL: 'https://api.x.com/2/tweets',
  MAX_POST_CHARS: 280,
  PUBLISHING_PREFIX: 'PUBLISHING|',
  POSTED_PREFIX: 'POSTED VIA X API|',
  ERROR_PREFIX: 'PUBLISH_FAILED|'
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NoSpinZone Publisher')
    .addItem('Verify setup', 'verifySetup')
    .addItem('Dry run approved posts', 'dryRunApprovedPosts')
    .addItem('Publish approved posts now', 'publishApprovedPosts')
    .addSeparator()
    .addItem('Install 5-minute trigger', 'installFiveMinuteTrigger')
    .addItem('Remove publisher triggers', 'removePublisherTriggers')
    .addToUi();
}

function verifySetup() {
  const sheet = getQueueSheet_();
  const headers = getHeaderMap_(sheet);
  const requiredHeaders = [
    'ID', 'DRAFT_POST', 'STATUS', 'SCHEDULE_TIME', 'BUFFER_POST_ID', 'RESULT'
  ];
  const missingHeaders = requiredHeaders.filter(h => headers[h] === undefined);
  if (missingHeaders.length) {
    throw new Error('Missing QUEUE headers: ' + missingHeaders.join(', '));
  }

  const props = PropertiesService.getScriptProperties();
  const requiredSecrets = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET'
  ];
  const missingSecrets = requiredSecrets.filter(k => !props.getProperty(k));
  if (missingSecrets.length) {
    throw new Error(
      'Missing Script Properties: ' + missingSecrets.join(', ') +
      '. Add them in Apps Script > Project Settings > Script properties.'
    );
  }

  SpreadsheetApp.getActive().toast('QUEUE + X credentials are configured.', 'NoSpinZone', 5);
  return {
    queueSheet: sheet.getName(),
    requiredHeadersPresent: true,
    xSecretsPresent: true
  };
}

function dryRunApprovedPosts() {
  const sheet = getQueueSheet_();
  const headers = getHeaderMap_(sheet);
  const values = sheet.getDataRange().getValues();
  const eligible = [];
  const now = new Date();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const status = cell_(row, headers, 'STATUS');
    if (String(status).trim() !== NSZ.STATUS_APPROVED) continue;

    const bufferPostId = String(cell_(row, headers, 'BUFFER_POST_ID') || '').trim();
    const result = String(cell_(row, headers, 'RESULT') || '').trim();
    const scheduleTime = cell_(row, headers, 'SCHEDULE_TIME');
    const text = String(cell_(row, headers, 'DRAFT_POST') || '').trim();
    const id = String(cell_(row, headers, 'ID') || '').trim();

    const reason = eligibilityBlockReason_(text, bufferPostId, result, scheduleTime, now);
    if (!reason) {
      eligible.push({ row: r + 1, id: id, chars: text.length, text: text });
    }
  }

  Logger.log(JSON.stringify(eligible, null, 2));
  SpreadsheetApp.getActive().toast(
    eligible.length + ' APPROVED post(s) eligible. Check Execution log for details.',
    'NoSpinZone dry run',
    6
  );
  return eligible;
}

function publishApprovedPosts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('Publisher already running; exiting.');
    return;
  }

  try {
    verifySetup();

    const sheet = getQueueSheet_();
    const headers = getHeaderMap_(sheet);
    const values = sheet.getDataRange().getValues();
    const now = new Date();

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const status = String(cell_(row, headers, 'STATUS') || '').trim();
      if (status !== NSZ.STATUS_APPROVED) continue;

      const text = String(cell_(row, headers, 'DRAFT_POST') || '').trim();
      const id = String(cell_(row, headers, 'ID') || '').trim() || ('ROW-' + (r + 1));
      const bufferPostId = String(cell_(row, headers, 'BUFFER_POST_ID') || '').trim();
      const result = String(cell_(row, headers, 'RESULT') || '').trim();
      const scheduleTime = cell_(row, headers, 'SCHEDULE_TIME');

      const blockReason = eligibilityBlockReason_(text, bufferPostId, result, scheduleTime, now);
      if (blockReason) {
        Logger.log(id + ': skipped: ' + blockReason);
        continue;
      }

      const textHash = sha256Hex_(text);
      const props = PropertiesService.getScriptProperties();
      const priorPostId = props.getProperty('POSTED_HASH_' + textHash);
      if (priorPostId) {
        setCell_(sheet, r + 1, headers, 'STATUS', NSZ.STATUS_REVIEW);
        setCell_(
          sheet,
          r + 1,
          headers,
          'RESULT',
          'DUPLICATE_GUARD|Text hash already posted as X post ' + priorPostId
        );
        SpreadsheetApp.flush();
        continue;
      }

      // Fail closed before the network call. If the script dies after X accepts
      // the post but before the row update, the PUBLISHING marker prevents a
      // blind retry and possible duplicate.
      const attemptId = Utilities.getUuid();
      setCell_(
        sheet,
        r + 1,
        headers,
        'RESULT',
        NSZ.PUBLISHING_PREFIX + new Date().toISOString() + '|' + attemptId
      );
      SpreadsheetApp.flush();

      try {
        const created = createXPost_(text);
        props.setProperty('POSTED_HASH_' + textHash, created.id);

        setCell_(sheet, r + 1, headers, 'BUFFER_POST_ID', created.id);
        setCell_(sheet, r + 1, headers, 'STATUS', NSZ.STATUS_POSTED);
        setCell_(
          sheet,
          r + 1,
          headers,
          'RESULT',
          NSZ.POSTED_PREFIX + new Date().toISOString() + '|X_POST_ID=' + created.id
        );
        SpreadsheetApp.flush();
        Logger.log(id + ': posted as ' + created.id);
      } catch (err) {
        // Stop automatic retries. A human must inspect and re-APPROVE.
        setCell_(sheet, r + 1, headers, 'STATUS', NSZ.STATUS_REVIEW);
        setCell_(
          sheet,
          r + 1,
          headers,
          'RESULT',
          NSZ.ERROR_PREFIX + new Date().toISOString() + '|' + sanitizeError_(err)
        );
        SpreadsheetApp.flush();
        Logger.log(id + ': publish failed: ' + sanitizeError_(err));
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function installFiveMinuteTrigger() {
  removePublisherTriggers();
  ScriptApp.newTrigger('publishApprovedPosts')
    .timeBased()
    .everyMinutes(5)
    .create();
  SpreadsheetApp.getActive().toast('5-minute publisher trigger installed.', 'NoSpinZone', 5);
}

function removePublisherTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'publishApprovedPosts') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function createXPost_(text) {
  if (!text) throw new Error('DRAFT_POST is blank.');
  if (text.length > NSZ.MAX_POST_CHARS) {
    throw new Error('Post is ' + text.length + ' characters; safety limit is ' + NSZ.MAX_POST_CHARS + '.');
  }

  const props = PropertiesService.getScriptProperties();
  const consumerKey = props.getProperty('X_CONSUMER_KEY');
  const consumerSecret = props.getProperty('X_CONSUMER_SECRET');
  const accessToken = props.getProperty('X_ACCESS_TOKEN');
  const accessTokenSecret = props.getProperty('X_ACCESS_TOKEN_SECRET');

  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: Utilities.getUuid().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0'
  };

  const normalized = Object.keys(oauth)
    .sort()
    .map(k => oauthEncode_(k) + '=' + oauthEncode_(oauth[k]))
    .join('&');

  const baseString = [
    'POST',
    oauthEncode_(NSZ.X_POST_URL),
    oauthEncode_(normalized)
  ].join('&');

  const signingKey = oauthEncode_(consumerSecret) + '&' + oauthEncode_(accessTokenSecret);
  const signatureBytes = Utilities.computeHmacSha1Signature(
    baseString,
    signingKey,
    Utilities.Charset.UTF_8
  );
  oauth.oauth_signature = Utilities.base64Encode(signatureBytes);

  const authHeader = 'OAuth ' + Object.keys(oauth)
    .sort()
    .map(k => oauthEncode_(k) + '="' + oauthEncode_(oauth[k]) + '"')
    .join(', ');

  const response = UrlFetchApp.fetch(NSZ.X_POST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: authHeader
    },
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    parsed = null;
  }

  if (code !== 201 || !parsed || !parsed.data || !parsed.data.id) {
    throw new Error('X HTTP ' + code + ': ' + body.slice(0, 700));
  }

  return {
    id: String(parsed.data.id),
    text: String(parsed.data.text || text)
  };
}

function eligibilityBlockReason_(text, bufferPostId, result, scheduleTime, now) {
  if (!text) return 'blank DRAFT_POST';
  if (bufferPostId) return 'BUFFER_POST_ID already populated';
  if (result && result.indexOf(NSZ.PUBLISHING_PREFIX) === 0) {
    return 'prior attempt remains PUBLISHING; human review required';
  }
  if (result && result.indexOf(NSZ.POSTED_PREFIX) === 0) {
    return 'RESULT already marks the row posted';
  }

  if (scheduleTime) {
    let scheduled = null;
    if (Object.prototype.toString.call(scheduleTime) === '[object Date]' && !isNaN(scheduleTime)) {
      scheduled = scheduleTime;
    } else {
      const parsed = new Date(scheduleTime);
      if (!isNaN(parsed)) scheduled = parsed;
    }
    if (scheduled && scheduled.getTime() > now.getTime()) {
      return 'scheduled for future time ' + scheduled.toISOString();
    }
  }
  return '';
}

function getQueueSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This must be a spreadsheet-bound Apps Script project.');
  const sheet = ss.getSheetByName(NSZ.SHEET_NAME);
  if (!sheet) throw new Error('Missing sheet tab: ' + NSZ.SHEET_NAME);
  return sheet;
}

function getHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error('QUEUE has no columns.');
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) map[key] = i;
  });
  return map;
}

function cell_(row, headers, header) {
  const idx = headers[header];
  if (idx === undefined) throw new Error('Missing header: ' + header);
  return row[idx];
}

function setCell_(sheet, rowNumber, headers, header, value) {
  const idx = headers[header];
  if (idx === undefined) throw new Error('Missing header: ' + header);
  sheet.getRange(rowNumber, idx + 1).setValue(value);
}

function oauthEncode_(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function sanitizeError_(err) {
  const message = err && err.message ? err.message : String(err);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 900);
}
