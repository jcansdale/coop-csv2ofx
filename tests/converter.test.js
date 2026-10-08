(async function () {
  "use strict";
  const c = typeof module !== "undefined" ? require("../converter.js") : globalThis.CoopConverter;
  const results = [];
  function assert(condition, message) { if (!condition) throw new Error(message); }
  async function test(name, run) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  function rejects(run, message) {
    try { run(); } catch (error) { assert(error.message.includes(message), error.message); return; }
    throw new Error("Expected an error");
  }
  async function rejectsAsync(run, message) {
    try { await run(); } catch (error) { assert(error.message.includes(message), error.message); return; }
    throw new Error("Expected an error");
  }
  const csv = '\uFEFFDate,Description,Debit,Credit,Balance\r\n01/02/2026,"Shop, ""Corner""",12.34,,100.00\r\n02/02/2026,Salary,,"1,234.56",1334.56\r\n02/02/2026,Salary,,"1,234.56",2569.12\r\n';
  const table = c.readTable(csv);
  const mapping = { ...c.suggestMapping(table.headers), dateFormat: "uk" };
  const transactions = c.convert(table, mapping);
  const account = { sortCode: "12-34-56", number: "12345678", type: "CHECKING", balance: "2569.12", balanceDate: "2026-02-02" };
  const now = new Date("2026-02-03T09:10:11Z");
  await test("BOM, CRLF, quoted commas and escaped quotes", () => {
    assert(table.records.length === 3, "Wrong count");
    assert(transactions[0].description === 'Shop, "Corner"', "Description changed");
    assert(transactions[0].amount === -1234n && transactions[1].amount === 123456n, "Wrong amounts");
  });
  await test("Quoted multiline fields and blank records", () => {
    const data = c.readTable('Date,Description,Amount\n\n01/02/2026,"Line one\nLine two",-1.20\n,,\n');
    assert(data.records.length === 1 && data.records[0].values[1] === "Line one\nLine two", "Multiline parsing failed");
  });
  await test("Malformed quotes, widths, headings and empty files fail", () => {
    rejects(() => c.parseCSV('a,"unfinished'), "closing quote");
    rejects(() => c.parseCSV('"a"x,b'), "unexpected");
    rejects(() => c.parseCSV('a"b,c'), "unexpected");
    rejects(() => c.readTable("Date,Description,Amount\n01/02/2026,X,1,2"), "expected 3");
    rejects(() => c.readTable("Date,Date,Amount\nx,x,1"), "Duplicate");
    rejects(() => c.readTable(""), "header");
    rejects(() => c.readTable("Date,,Amount\nx,x,1"), "non-empty");
    rejects(() => c.readTable("Date,Description,Amount\n"), "No transaction");
  });
  await test("Explicit preamble header selection", () => {
    assert(c.readTable("Statement\nDate,Description,Amount\n01/02/2026,X,1", 2).records[0].record === 3, "Wrong source record");
  });
  await test("Third-party reported Co-op personal headings (synthetic data)", () => {
    const personal = c.readTable('Date,Description,Type,Money In,Money Out,Balance\n01/02/2026,"Corner shop, lunch",DEB,,12.34,100.00\n02/02/2026,Salary,CR,"1,234.56",,1334.56');
    const suggested = c.suggestMapping(personal.headers);
    assert(suggested.mode === "split" && suggested.credit === 3 && suggested.debit === 4, "Personal columns not recognised");
    const rows = c.convert(personal, { ...suggested, dateFormat: "uk" });
    assert(rows[0].amount === -1234n && rows[1].amount === 123456n, "Wrong personal debit/credit signs");
    assert(rows[0].description === "Corner shop, lunch", "Description changed");
  });
  await test("Exact money arithmetic and supported currency forms", () => {
    assert(c.parseMoney("-£1,234.5") === -123450n, "Currency failed");
    assert(c.parseMoney("(GBP 12.34)") === -1234n, "Parentheses failed");
    assert(c.money(c.parseMoney("0.10") + c.parseMoney("0.20")) === "0.30", "Precision failed");
    assert(c.money(c.parseMoney("-0.00")) === "0.00", "Negative zero");
    for (const amount of ["", "1,23", "12.345", "1e3", "NaN", "(-1)", "12CR", "1.234,56", "9999999999999"]) rejects(() => c.parseMoney(amount), amount === "9999999999999" ? "too large" : "Invalid");
  });
  await test("Strict UK/ISO dates and leap years", () => {
    assert(c.parseDate("29/02/2024", "uk") === "20240229", "Leap year");
    assert(c.parseDate("2026-10-08", "iso") === "20261008", "ISO");
    for (const date of ["29/02/2025", "31/04/2026", "00/01/2026", "01/13/2026", "01/02/26", "01/02-2026"]) rejects(() => c.parseDate(date, "uk"), "Invalid");
  });
  await test("No partial export for bad rows or ambiguous mappings", () => {
    const bad = c.readTable("Date,Description,Debit,Credit\n01/02/2026,X,-1,\n31/02/2026,Y,1,\n01/02/2026,Z,1,2");
    rejects(() => c.convert(bad, mapping), "3 invalid");
    rejects(() => c.convert(table, { ...mapping, debit: mapping.credit }), "different column");
    rejects(() => c.convert(table, { ...mapping, date: -1 }), "Select every");
    rejects(() => c.convert(c.readTable("Date,Description,Amount\n01/02/2026,,1"), { date: 0, description: 1, amount: 2, mode: "signed", dateFormat: "uk" }), "Description is empty");
    rejects(() => c.convert(c.readTable(`Date,Description,Amount\n01/02/2026,${"x".repeat(256)},1`), { date: 0, description: 1, amount: 2, mode: "signed", dateFormat: "uk" }), "255-character");
  });
  await test("Signed amounts and zero transactions", () => {
    const data = c.readTable("Date,Description,Amount\n02/02/2026,Credit,2\n01/02/2026,Debit,-1\n03/02/2026,Zero,0");
    const rows = c.convert(data, { ...c.suggestMapping(data.headers), dateFormat: "uk" });
    assert(rows[0].amount === -100n && rows[1].amount === 200n && rows[2].amount === 0n, "Signed conversion");
  });
  await test("OFX header, escaping, ledger and date range", async () => {
    const xml = await c.createOFX(transactions, account, now);
    assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "XML declaration missing");
    assert(xml.includes('VERSION="211"'), "Wrong OFX version");
    assert(xml.includes("<DTSERVER>20260203T091011") === false, "Invalid date syntax");
    assert(xml.includes("<DTSERVER>20260203091011[0:GMT]"), "Wrong server date");
    assert(xml.includes("<TRNAMT>-12.34</TRNAMT>"), "Wrong debit");
    assert(xml.includes("Shop, &quot;Corner&quot;"), "Escaping");
    assert(xml.includes("<BANKID>123456</BANKID>"), "Sort code normalization");
    assert(xml.includes("<BALAMT>2569.12</BALAMT>"), "Real ledger balance");
    assert(xml.includes("<DTSTART>20260201120000[0:GMT]") && xml.includes("<DTEND>20260202120000[0:GMT]"), "Wrong range");
    if (typeof DOMParser !== "undefined") {
      const document = new DOMParser().parseFromString(xml, "application/xml");
      assert(!document.querySelector("parsererror"), "Invalid XML");
      assert(document.querySelectorAll("STMTTRN").length === 3, "Wrong XML transaction count");
    }
  });
  await test("Account-scoped, stable IDs preserve identical payments", async () => {
    const ids = xml => Array.from(xml.matchAll(/<FITID>(.*?)<\/FITID>/g), match => match[1]);
    const first = ids(await c.createOFX(transactions, account, now));
    const again = ids(await c.createOFX(transactions, account, now));
    const reordered = ids(await c.createOFX([...transactions].reverse(), account, now));
    const other = ids(await c.createOFX(transactions, { ...account, number: "87654321" }, now));
    assert(new Set(first).size === 3, "Duplicate IDs");
    assert(JSON.stringify(first) === JSON.stringify(again), "Unstable IDs");
    assert(JSON.stringify([...first].sort()) === JSON.stringify(reordered.sort()), "IDs depend on row order");
    assert(first.every((id, index) => id !== other[index]), "Not account-scoped");
    assert(first[1].endsWith("-1") && first[2].endsWith("-2"), "Occurrence suffix");
  });
  await test("Balance/account errors fail explicitly", async () => {
    await rejectsAsync(() => c.createOFX(transactions, { ...account, balance: "" }), "Invalid amount");
    await rejectsAsync(() => c.createOFX(transactions, { ...account, balanceDate: "2026-02-01" }), "cannot be before");
    await rejectsAsync(() => c.createOFX(transactions, { ...account, number: "123" }), "eight digits");
    await rejectsAsync(() => c.createOFX(transactions, { ...account, sortCode: "123" }), "six digits");
    await rejectsAsync(() => c.createOFX(transactions, { ...account, type: "OTHER" }), "supported");
  });
  await test("XML metacharacters and invalid controls", async () => {
    const xml = await c.createOFX([{ ...transactions[0], description: "A & B <sale> 'test'" }], account);
    assert(xml.includes("A &amp; B &lt;sale&gt; &apos;test&apos;"), "XML escaping failed");
    await rejectsAsync(() => c.createOFX([{ ...transactions[0], description: "bad\u0000" }], account), "cannot be represented");
  });
  globalThis.testResults = results;
  if (typeof module !== "undefined") {
    results.forEach(result => console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? ": " + result.error : ""}`));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } else {
    document.getElementById("results").textContent = results.map(result => `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? ": " + result.error : ""}`).join("\n");
  }
})();
