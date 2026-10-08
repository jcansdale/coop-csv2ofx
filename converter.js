/* Shared by the browser and the dependency-free test runner. */
(function (root) {
  "use strict";

  function parseCSV(input) {
    const text = input.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    function endField() { row.push(field); field = ""; closed = false; }
    function endRow() { endField(); rows.push(row); row = []; }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else { field += c; }
      } else if (c === ",") { endField(); }
      else if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        endRow();
      } else if (c === '"' && field === "" && !closed) { quoted = true; }
      else {
        if (closed || c === '"') throw new Error(`Malformed CSV near record ${rows.length + 1}: unexpected text or quote.`);
        field += c;
      }
    }
    if (quoted) throw new Error("Malformed CSV: an opening quote has no closing quote.");
    if (field !== "" || row.length || closed) endRow();
    return rows;
  }

  function readTable(text, headerRow = 1) {
    const rows = parseCSV(text);
    if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > rows.length) throw new Error("Choose a valid header record number.");
    const headers = rows[headerRow - 1].map(value => value.trim());
    if (headers.length < 3 || headers.some(value => !value)) throw new Error("The header must contain at least three non-empty, comma-separated column names.");
    if (new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error("Duplicate column headings are ambiguous. Please use unique headings.");
    const records = [];
    rows.slice(headerRow).forEach((values, index) => {
      if (values.every(value => value.trim() === "")) return;
      const record = headerRow + index + 1;
      if (values.length !== headers.length) throw new Error(`CSV record ${record}: expected ${headers.length} columns, found ${values.length}. Check quoted commas and footer rows.`);
      records.push({ values, record });
    });
    if (!records.length) throw new Error("No transaction records found after the header.");
    return { headers, records };
  }

  function suggestMapping(headers) {
    const aliases = {
      date: ["date", "transaction date", "posting date"],
      description: ["description", "transaction description", "details", "narrative", "customer reference"],
      amount: ["amount", "transaction amount"],
      debit: ["debit", "debits", "money out", "paid out", "withdrawal", "withdrawals"],
      credit: ["credit", "credits", "money in", "paid in", "deposit", "deposits"]
    };
    const mapping = {};
    for (const [key, names] of Object.entries(aliases)) {
      const matches = headers.map((name, index) => names.includes(name.toLowerCase().replace(/\s+/g, " ").trim()) ? index : -1).filter(index => index >= 0);
      mapping[key] = matches.length === 1 ? matches[0] : -1;
    }
    mapping.mode = mapping.amount === -1 && mapping.debit !== -1 && mapping.credit !== -1 ? "split" : "signed";
    return mapping;
  }

  function parseDate(value, format) {
    let year, month, day;
    const text = value.trim();
    const match = format === "uk" ? /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(text) :
      format === "iso" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
    if (!match) throw new Error(`Invalid date "${text}". Use the selected date format with a four-digit year.`);
    if (format === "uk") { day = Number(match[1]); month = Number(match[3]); year = Number(match[4]); }
    else { year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`Invalid calendar date "${text}".`);
    return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  }

  function parseMoney(value) {
    let text = value.trim();
    let negative = false;
    if (text.startsWith("(") && text.endsWith(")")) { negative = true; text = text.slice(1, -1).trim(); }
    const match = /^([+-]?)(?:£\s*|GBP\s*)?((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{1,2}))?$/.exec(text);
    if (!match || (negative && match[1])) throw new Error(`Invalid amount "${value}". Use pounds and pence, e.g. -1234.56 or 1,234.56.`);
    const cents = BigInt(match[2].replace(/,/g, "")) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
    if (cents > 99999999999999n) throw new Error("Amount is too large.");
    return negative || match[1] === "-" ? -cents : cents;
  }

  function money(cents) {
    const magnitude = cents < 0n ? -cents : cents;
    return `${cents < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
  }

  function validText(value) {
    if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value)) throw new Error("Description contains characters that cannot be represented in XML.");
    return value;
  }

  function convert(table, mapping) {
    if (!["signed", "split"].includes(mapping.mode)) throw new Error("Choose an amount mode.");
    const keys = ["date", "description", ...(mapping.mode === "signed" ? ["amount"] : ["debit", "credit"])];
    const columns = keys.map(key => mapping[key]);
    if (columns.some(index => !Number.isInteger(index) || index < 0 || index >= table.headers.length)) throw new Error("Select every required column before previewing.");
    if (new Set(columns).size !== columns.length) throw new Error("Each mapped field must use a different column.");
    const errors = [], transactions = [];
    for (const { values, record } of table.records) {
      try {
        const date = parseDate(values[mapping.date], mapping.dateFormat);
        const description = validText(values[mapping.description].trim());
        if (!description) throw new Error("Description is empty.");
        if (description.length > 255) throw new Error("Description exceeds OFX's 255-character memo limit. Shorten it locally before exporting.");
        let amount;
        if (mapping.mode === "signed") amount = parseMoney(values[mapping.amount]);
        else {
          const outText = values[mapping.debit].trim(), inText = values[mapping.credit].trim();
          if (!outText && !inText) throw new Error("Both money out and money in are blank.");
          const debit = outText ? parseMoney(outText) : 0n, credit = inText ? parseMoney(inText) : 0n;
          if (debit < 0n || credit < 0n) throw new Error("Separate money out/in values must be non-negative.");
          if (debit !== 0n && credit !== 0n) throw new Error("Both money out and money in contain non-zero amounts.");
          amount = credit - debit;
        }
        transactions.push({ date, description, amount, record });
      } catch (error) { errors.push(`Record ${record}: ${error.message}`); }
    }
    if (errors.length) throw new Error(`${errors.length} invalid transaction record(s). Nothing was exported.\n${errors.slice(0, 20).join("\n")}${errors.length > 20 ? "\nOnly the first 20 errors are shown." : ""}`);
    if (!transactions.length) throw new Error("No transactions to export.");
    return transactions.sort((a, b) => a.date.localeCompare(b.date));
  }

  function escapeXML(value) {
    return validText(String(value)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  async function createOFX(transactions, account, now = new Date()) {
    if (!transactions.length) throw new Error("Validate transactions before exporting.");
    const sortCode = account.sortCode.trim().replace(/-/g, "");
    const accountNumber = account.number.trim();
    if (!/^\d{6}$/.test(sortCode)) throw new Error("Sort code must contain six digits, with optional hyphens.");
    if (!/^\d{8}$/.test(accountNumber)) throw new Error("Account number must contain eight digits.");
    if (!["CHECKING", "SAVINGS"].includes(account.type)) throw new Error("Choose a supported account type.");
    const balance = parseMoney(account.balance);
    const balanceDate = parseDate(account.balanceDate, "iso");
    const start = transactions.reduce((date, item) => item.date < date ? item.date : date, transactions[0].date);
    const end = transactions.reduce((date, item) => item.date > date ? item.date : date, transactions[0].date);
    if (balanceDate < end) throw new Error("The closing balance date cannot be before the latest transaction.");
    if (!globalThis.crypto?.subtle) throw new Error("This browser cannot securely generate transaction IDs. Use a modern browser over HTTPS or localhost.");
    const occurrences = new Map();
    const transactionXML = [];
    for (const item of transactions) {
      if (!item.description || item.description.length > 255) throw new Error("OFX descriptions must contain between 1 and 255 characters.");
      // Occurrence suffixes preserve identical payments without depending on CSV row order.
      const identity = JSON.stringify([sortCode, accountNumber, account.type, "GBP", item.date, money(item.amount), item.description]);
      const occurrence = (occurrences.get(identity) || 0) + 1;
      occurrences.set(identity, occurrence);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      transactionXML.push(`<STMTTRN><TRNTYPE>${item.amount < 0n ? "DEBIT" : "CREDIT"}</TRNTYPE><DTPOSTED>${item.date}120000[0:GMT]</DTPOSTED><TRNAMT>${money(item.amount)}</TRNAMT><FITID>${hash}-${occurrence}</FITID><NAME>${escapeXML(item.description.slice(0, 32).replace(/[\uD800-\uDBFF]$/, ""))}</NAME><MEMO>${escapeXML(item.description)}</MEMO></STMTTRN>`);
    }
    const serverDate = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>${serverDate}[0:GMT]</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>0</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><STMTRS>
<CURDEF>GBP</CURDEF><BANKACCTFROM><BANKID>${sortCode}</BANKID><ACCTID>${accountNumber}</ACCTID><ACCTTYPE>${account.type}</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>${start}120000[0:GMT]</DTSTART><DTEND>${end}120000[0:GMT]</DTEND>
${transactionXML.join("\n")}
</BANKTRANLIST><LEDGERBAL><BALAMT>${money(balance)}</BALAMT><DTASOF>${balanceDate}120000[0:GMT]</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;
  }

  const api = { parseCSV, readTable, suggestMapping, parseDate, parseMoney, money, convert, createOFX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CoopConverter = api;
})(globalThis);
