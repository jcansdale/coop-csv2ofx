"use strict";

const $ = id => document.getElementById(id);
const converter = globalThis.CoopConverter;
let table = null;
let transactions = null;
let revision = 0;
let previewPage = 0;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function setMotion(paused) {
  document.body.dataset.motion = paused ? "paused" : "on";
  $("motion").setAttribute("aria-pressed", String(paused));
  $("motion").textContent = paused ? "Resume animations" : "Pause animations";
}
setMotion(reducedMotion.matches);
reducedMotion.addEventListener("change", event => setMotion(event.matches));
$("motion").addEventListener("click", () => setMotion(document.body.dataset.motion !== "paused"));

function invalidate() {
  revision++;
  globalThis.SpacePatrol.lock();
  transactions = null;
  $("preview-section").hidden = true;
  $("confirm").checked = false;
  $("transactions").replaceChildren();
  $("summary").textContent = "";
  $("page-info").textContent = "";
  $("status").textContent = "";
  $("error").hidden = true;
}

function report(error) {
  $("error").textContent = error.message;
  $("error").hidden = false;
  $("status").textContent = "";
}

function showMode() {
  const split = $("amount-mode").value === "split";
  $("signed-field").hidden = split;
  $("debit-field").hidden = !split;
  $("credit-field").hidden = !split;
}

function renderPreview(page = 0) {
  previewPage = page;
  const start = page * 100;
  $("transactions").replaceChildren();
  for (const item of transactions.slice(start, start + 100)) {
    const row = document.createElement("tr");
    const date = `${item.date.slice(6, 8)}/${item.date.slice(4, 6)}/${item.date.slice(0, 4)}`;
    for (const value of [date, item.description, converter.money(item.amount)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    row.lastElementChild.className = "number";
    $("transactions").append(row);
  }
  $("page-info").textContent = `${start + 1}–${Math.min(start + 100, transactions.length)} of ${transactions.length}`;
  $("previous-page").disabled = page === 0;
  $("next-page").disabled = start + 100 >= transactions.length;
}
$("previous-page").addEventListener("click", () => { if (transactions && previewPage > 0) renderPreview(previewPage - 1); });
$("next-page").addEventListener("click", () => { if (transactions && (previewPage + 1) * 100 < transactions.length) renderPreview(previewPage + 1); });

function resetSource() {
  invalidate();
  table = null;
  $("mapping-section").hidden = true;
}

for (const id of ["file", "encoding", "header-row"]) $(id).addEventListener("change", resetSource);
for (const id of ["date-column", "description-column", "amount-mode", "amount-column", "debit-column", "credit-column", "date-format"]) {
  $(id).addEventListener("change", () => { invalidate(); showMode(); });
}
for (const id of ["sort-code", "account-number", "account-type", "balance", "balance-date"]) {
  $(id).addEventListener("input", () => { revision++; $("confirm").checked = false; $("status").textContent = ""; });
}

$("load").addEventListener("click", async () => {
  resetSource();
  const current = revision;
  $("load").disabled = true;
  $("status").textContent = "Reading your CSV...";
  try {
    const file = $("file").files[0];
    if (!file) throw new Error("Choose a CSV file first.");
    if (file.size > 5 * 1024 * 1024) throw new Error("The CSV exceeds the 5 MB limit.");
    const buffer = await file.arrayBuffer();
    if (current !== revision) return;
    let text;
    try { text = new TextDecoder($("encoding").value, { fatal: true }).decode(buffer); }
    catch (error) { throw new Error(`Unable to decode this file as ${$("encoding").value}. Try the other encoding. ${error.message}`); }
    table = converter.readTable(text, Number($("header-row").value));
    const mapping = converter.suggestMapping(table.headers);
    for (const key of ["date", "description", "amount", "debit", "credit"]) {
      const select = $(`${key}-column`);
      select.replaceChildren(new Option("Choose a column", "-1"));
      table.headers.forEach((header, index) => select.add(new Option(header, String(index))));
      select.value = String(mapping[key]);
    }
    $("amount-mode").value = mapping.mode;
    showMode();
    $("mapping-section").hidden = false;
    $("status").textContent = `${table.records.length} records read. Check the suggested columns, then validate.`;
  } catch (error) { if (current === revision) report(error); }
  finally { $("load").disabled = false; }
});

$("preview").addEventListener("click", () => {
  invalidate();
  try {
    if (!table) throw new Error("Read your CSV first.");
    const mapping = { mode: $("amount-mode").value, dateFormat: $("date-format").value };
    for (const key of ["date", "description", "amount", "debit", "credit"]) mapping[key] = Number($(`${key}-column`).value);
    transactions = converter.convert(table, mapping);
    const total = transactions.reduce((sum, item) => sum + item.amount, 0n);
    $("summary").textContent = `${transactions.length} validated transactions. Net movement: GBP ${converter.money(total)} (not your closing balance).`;
    renderPreview();
    $("preview-section").hidden = false;
    $("status").textContent = "Preview ready. Check the statement and enter its account and closing balance details.";
  } catch (error) { report(error); }
});

$("converter-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("error").hidden = true;
  const current = revision;
  $("download").disabled = true;
  $("status").textContent = "Generating your OFX file...";
  try {
    if (!transactions || !$("confirm").checked) throw new Error("Validate and confirm the preview before downloading.");
    const ofx = await converter.createOFX(transactions, {
      sortCode: $("sort-code").value, number: $("account-number").value, type: $("account-type").value,
      balance: $("balance").value, balanceDate: $("balance-date").value
    });
    if (current !== revision) return;
    const url = URL.createObjectURL(new Blob([ofx], { type: "application/x-ofx;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "coop-statement.ofx";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("status").textContent = "OFX download requested. Your banking data has not been uploaded.";
    globalThis.SpacePatrol.unlock();
  } catch (error) { if (current === revision) report(error); }
  finally { $("download").disabled = false; }
});

$("clear").addEventListener("click", () => {
  $("converter-form").reset();
  resetSource();
  for (const key of ["date", "description", "amount", "debit", "credit"]) $(`${key}-column`).replaceChildren();
  $("error").textContent = "";
  $("status").textContent = "Banking data cleared from this page. Downloaded files are not deleted.";
  $("file").focus();
});
