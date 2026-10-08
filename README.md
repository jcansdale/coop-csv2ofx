# Co-op CSV to OFX

A static, browser-only CSV to OFX converter intended for Co-operative Bank personal online banking exports. No backend, runtime dependencies, uploads, analytics, cookies, local storage or third-party scripts. Files, mappings and account details are held in page memory only. GitHub receives ordinary page requests, not the CSV or account details.

The interface has an original Space Invaders-inspired arcade theme: neon pixel aliens, a patrolling ship, laser trails and drifting stars, made entirely with local HTML/CSS. **Pause animations** stops decorative motion; the page starts paused when your device requests reduced motion. No game assets, external fonts or sound are loaded.

## Format evidence and limitations

**The exact current Co-op "Personal Online Banking Format" CSV schema has not been independently verified.** Public information found about Co-op exports concerned business banking or tools that scrape statements; it is not evidence for the personal CSV format. This project does not claim a guaranteed bank-specific parser. The inputs in the tests are entirely synthetic, not bank-provided samples.

The converter suggests columns by their headings but requires you to check the mapping and preview. It supports:

- Comma-separated CSV with a header, optional introductory records (choose the header record number), quoted commas, escaped quotes, multiline fields, BOM and LF/CRLF endings.
- Explicit UTF-8 or Windows-1252 encoding; no silent encoding fallback.
- A date, a description, and either one signed amount column or separate positive money-out/money-in columns. Additional columns, such as a running balance, are not exported.
- UK day-first dates (`DD/MM/YYYY` or `DD-MM-YYYY`) and explicitly selected ISO dates (`YYYY-MM-DD`); four-digit years, real calendar dates and GBP pounds/pence.
- Amounts such as `-12.34`, `"1,234.56"`, `-£12.34`, `GBP 12.34`, or `(12.34)`. Decimal-comma, CR/DR suffixes, semicolon delimiters and two-digit years are not guessed.

Unsupported or ambiguous files must be adjusted locally or explicitly mapped. Footer records and invalid transactions cause an error, not partial output. All rows are validated; the on-page preview displays the first 100. File size is capped at 5 MB.

Descriptions longer than OFX's 255-character memo limit are rejected rather than silently truncated. The full supported description is written to the memo; the transaction name is limited to 32 characters for OFX compatibility.

## Use

1. Select your CSV, encoding and header record; click **Read CSV**.
2. Check every column, the amount mode and date format; click **Validate & preview**.
3. Compare the transactions with your bank statement, including debit/credit signs.
4. Enter the six-digit sort code, eight-digit account number, account type, actual closing balance and its date. The balance date must not precede the latest transaction. The tool never invents a balance from transaction totals.
5. Confirm the details, then download `coop-statement.ofx`. Import a small file into your finance software first and verify the results.

Output is UTF-8 OFX 2.1.1 XML with GBP currency, statement dates, a bank account, transactions and an actual ledger balance supplied by you. Transaction dates use noon UTC to reduce date shifts in importers. Compatibility with every importer is not guaranteed; some legacy software accepts only OFX 1.x.

Amounts use integer pence rather than floating-point arithmetic. SHA-256 transaction IDs include account identity, date, amount and description; identical transactions get occurrence suffixes rather than being collapsed. Reimporting the same data with the same account and mapping gives the same IDs. **Overlapping exports that contain different subsets of identical same-day payments cannot be reliably deduplicated without bank-issued transaction identifiers.** Check such imports manually; changing account details or descriptions also changes IDs.

Use **Clear banking data** or close the page to discard page-held data. Downloaded CSV/OFX files remain on your device. Treat both as sensitive. Browser extensions, browser session restoration and your local device are outside the tool's control.

## Publish on GitHub Pages

After merging this change into `main`:

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open **Actions → Deploy GitHub Pages → Run workflow** on `main` if the initial push ran before Pages was enabled. Later pushes to `main` deploy automatically, only after tests pass.
4. Visit the deployment URL shown by the workflow, normally <https://jcansdale.github.io/coop-csv2ofx/>.

The workflow publishes only `index.html`, `styles.css`, `converter.js` and `app.js`, not test fixtures or repository metadata. A pull request runs tests but does not publish the website. Deployment uses GitHub's Pages environment and minimal deployment permissions. No build step or package installation is needed.

## Develop and test

Use Node.js 22 or later:

```sh
npm test
```

Serve the repository with any local static HTTP server to use the site. Modern browsers and HTTPS (or localhost) are required for SHA-256 IDs. `tests/index.html` also runs the synthetic tests in a browser and checks the generated XML with its native XML parser.

This is an independent project, not affiliated with or endorsed by The Co-operative Bank.
