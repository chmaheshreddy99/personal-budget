# Personal Budget

A multi-tenant, double-entry personal finance application: accounts, expenses and income, chit funds,
journals, budgets, balance sheet, reports and forecast.

- **Backend:** Java 21, Spring Boot 4.1, Gradle (Groovy DSL)
- **Storage:** one tab-separated `.tbl` file per table in `./data`, no database
- **UI:** plain HTML, CSS and JavaScript modules with no frameworks or CDNs. Icons and charts are hand-written SVG.

## Run

```bash
./gradlew bootRun          # Windows: gradlew.bat bootRun
```

Open <http://localhost:8080> and sign in as `admin` / `admin@123`.
The first start creates a default household and fills it with six months of demo data.
Set `budget.seed.demo-data: false` in `application.yml` to start empty.
Delete the `data` folder to start over.

```bash
./gradlew test             # storage constraints, rollback, accounting invariants
./gradlew bootJar          # build/libs/personal-budget-1.0.0.jar
```

## Features

| Area | What it does |
|---|---|
| Dashboard | Quick actions (expense, income, transfer, lend, owe, the next chit installment, voucher), KPIs, a 0-100 financial health score with ranked insights, and a panel grid you **customize** (show, hide, order and size): income vs expenses, net worth, spending mix, budgets, coming up, recent activity, chits to maturity, cash & cards, allocation, this month's cash flow. |
| Expenses | Quick periods (today, this week, this month, last month) with the rest behind **⋯**, type chips (expenses, paid for, lent, to collect), and more filters on demand (category, paid from, amount range). The **smart search** understands `>500`, `<2k`, `500-2000`, `#groceries`, `@hdfc`, `is:lent`, `is:open`, `is:overdue` plus plain words. The list is flat by default; **By day** groups it with daily totals (remembered). A collapsed row is one compact entry: the category as an icon, the description with the shop or person grayed on the right, and one quiet line with the category, the paying account's icon, and reference and notes as icons (their text in the tooltip). Click a row to see its details, notes and journal in place. The right pane holds the period summary, a category donut (click a slice to filter), where the money went, the spending trend and who owes you. The add-expense dialog has three modes (expense, paid for someone, lent money), the eight most used categories as tiles (the rest under **All**, or type in *Find a category* and press Enter; the description suggests a category from past expenses), only the accounts you can pay from, optional notes and a live budget check. Its suggestions only come from entries of the same kind: the expense form never offers chit installments, repayments or other feature postings. **Refund** records money back on an expense (part or all, into the account that paid or another, with proof); **Reverse** cancels an expense recorded by mistake with a linked mirror entry (dated on the expense by default). The list shows the original amount struck through next to what still counts, with a *Part refunded*, *Refunded* or *Reversed* chip (reversed rows are struck through and greyed); `is:refunded` and `is:reversed` filter them, and each refund or reversal can be undone from the expanded row. A refunded or reversed expense cannot be edited or deleted until that is undone. |
| Income | Every source of income for a period (this month, last month, this quarter, this year, this financial year, 12 months, **All**, or any **Range** of dates): totals with earned vs passive split, a source list to filter by, what was received, the 12-month trend, the mix and insights. **Chit gains** are income: dividends with each installment and, at payout, whatever you receive above what you paid in (paid 5,00,000, received 5,70,000: 70,000 of chit gains), booked to Income under the *Chit Gains* category; a dedicated card shows booked, realised and still-to-come gains per chit. |
| Money owed | **Owed to you**: money lent or paid for someone, under Receivables. **You owe**: money borrowed or a bill to pay later, under Payables. Both have a status (open, partly repaid, settled, written off / waived, overdue), part payments that settle interest first, **simple** or **compound** interest, net payable today and on the due date, and the month-by-month schedule (with the year). The account's People pane shows totals, overdue, collected / paid this month and the age of open amounts; reminders can be copied or sent on WhatsApp. Money owed to you is under **To collect** in Expenses and money you owe under **You owe**; Expenses is the one place an item is managed (edit, repayments, interest posting, write-off). Elsewhere (journal, account statements, the Receivables / Payables account) an entry of the item expands to a single line saying what it is: the loan, a *partial* or *final* repayment (which one, its principal / interest split and what is still owed), or a month of interest (period and account). **More** shows the journal lines and where the item stands; **Details** opens the whole lifecycle and interest schedule read-only in an overlay, with that entry highlighted, and **Manage in Expenses** from there. Repayments are named *Partial repayment* or *Final repayment* in the journal and statements. Evidence is only fetched for entries that have some. |
| Journal | The **Day book**: register with one-click date ranges (30 days, month, 3 / 6 months, financial year, last FY, 12 months, all, custom), filters and Excel / PDF export. A row is just the date, the entry (an icon tells its kind: expense, income, transfer, chit payment, money lent, repayment, interest, refund, reversal…; the kind is the tooltip), the movement (debit → credit) and the amount. Entry numbers and the rest show when the row is expanded, and search finds an entry by its number (`EX-000123`) or id (`#123`). Click a row (or ↑ ↓ and Enter) to expand a compact strip of its debit (green) and credit (red) postings and when it was recorded. Manual vouchers can be edited, duplicated or deleted. Entries posted by a feature are locked (see below). Quick expense, income and transfer, plus shortcuts to lend, collect, borrow, repay, pay a card bill or book a bill to pay later. Multi-line journal vouchers. |
| Accounts | 30 account types: bank, cash, wallet, FD, RD, PPF/EPF, MF, stocks, bonds, gold, silver, real estate, vehicle, insurance, chit, receivable, loan given, credit card, six loan types, payable, and more. Opening balances post automatically. Planning chips across the top: net worth, safety net (months of spending covered), this month's cash flow, debt load, interest paid vs earned per month, card usage, invested share, owed vs owe, maturities and idle money. The left pane lists every account by class, with search and a class filter; **↑ / ↓** move through them and **← / →** change the class. Each account has buttons that fit it (spend, receive, transfer, pay bill, pay EMI, lend, owe), and the statement has one-click date ranges, a search box (description, the other side, entry number or `#id`), the kind of each entry as an icon instead of a type column, and Excel / PDF export. The selected account gets a branded banner, metrics and its statement, named for the account (Bank statement, Card statement, Cash book, Passbook, Loan statement, Spending history…). A **Timeline** switch groups the statement by month or by party. Receivable accounts also list who owes you. |
| Chits | A compact portfolio strip: paid in, interest so far, net gain (expected, plus realised when **Include matured** is on), **take home now** (the installments actually paid plus the interest they have earned up to today; unpaid installments do not count, and "if you wait" is what maturity adds after paying the rest), future value, still to pay and next due. The *with matured* switch sits in the portfolio tile; the strip also shows the portfolio's return (weighted by money paid in) against a 7% FD. The passbook shows Dividend and Cash paid columns only for chits that have dividends. Slim chit rows on the left show each chit's **compound** (effective annual) and **simple-equivalent** return and the interest earned; the selected chit shows a branded banner, key figures and how it compares with a 7% FD. Installments are **booked on their due date** whenever they are paid (the actual payment date is kept for reference) and their interest starts that day. Each chit can have a **default payment account**. With the organizer's UPI ID, every installment gets a scannable UPI QR with a compact note. A month-by-month interest schedule shows compound and simple interest side by side. The selected chit shows four key figures (paid in, still to pay, take home now, net gain at maturity) and one slim line of returns; installments carry **Pay** only where it is due (the next one and any overdue), and the **Details** tab adds a timeline (term passed vs paid), money (contribution, cash after dividends, average and best dividend), returns and insights (on-time record, dividends, vs FD, lifting now vs waiting, commission). The passbook exports to Excel / PDF, and the printer button opens the chit summary. |
| Budgets | One month at a time (← / → between months). Budget cards look like the chit and account cards (spent, limit and what is left, status, used %, pace bar, a one-line hint and the change against the 3-month average). A **budget score** out of 100 (budgets on course, the month against the total budget, months kept within budget) and an **Across months** card: six months of spending against the budget, the streak of months within budget, budgets that keep going over (with a realistic limit) or stay far under (with what trimming them frees per year), spending without a budget, this month against the usual, and the share taken by committed payments. Tiles across the top: spent against the budget with today's pace, projected, left, committed still to pay, free to spend, safe per day, budget health and spending without a budget. The selected budget shows its progress and details above **only its transactions**, and the right pane its analysis (by weekday, first vs second half of the month, the top places), trend and insights. A month without budgets offers **Copy last month** (committed payments included). Two kinds: a **spending limit** per category, and a **committed payment** that has to be made without fail (rent, school fees, an EMI) by a day of the month, shown as paid, part paid, due, due soon or overdue. Spending limits are judged by **pace**: the rest of the month is projected from what that category usually costs from today on (last 3 months), scaled up if this month runs hotter; bills paid once a month count as done once paid, so an early bill is not mistaken for overspending. Each card says where it stands in one sentence (*Heading for ₹11,533; keep to ₹147/day*). The **watch list** turns it into a few plain warnings, most urgent first, each with what to do: over budget (and which budget has room to cover it), on course to overshoot (daily average, when the limit will be crossed, the safe amount per day), overdue or due-soon commitments, the month as a whole, money committed but not yet paid, spending outside any budget. |
| Recurring | Salary, EMIs and SIPs kept from earlier versions still feed the forecast; payments you must make each month are now committed budgets. |
| Balance sheet | Assets = Liabilities + Equity on any date. Three compact cards on top: assets and liabilities with their parts, net worth with how it is funded and the safety net. Groups with one account show as a single row and the asset and liability mix sits under equity. A side pane starts with **suggestions** (overdrawn accounts, safety net, costly debt, idle cash, concentration, money to collect), then the net-worth trend, health checks and the biggest moves. |
| Reports | **Insights**: a period against the one just before it, with highlights to act on (savings rate, categories that grew, budgets overrun, idle money, card use, overdue or best-yielding chits, the heaviest spending day), the income vs spending trend, top payees and largest expenses. **Categories**: every expense and income category with change, share, budget use, typical and largest entry, and a trend line. **Accounts**: opening, money in, money out, closing and last activity per account, with idle accounts and the biggest movers. **Chits**: paid in, dividends, value today, return per year, expected gain and next due per chit. **Chit summary**: the chits you pick (remembered) together, written for the organizer: how many and what they are worth, paid in, cash paid after dividends, still to pay, what comes back and the gain; chit by chit, by organizer, paid in the last 12 months, due in the next 12 and every installment; **Print summary** gives an A4 document. Then the statements: income statement, trial balance, cash flow and expense analysis. |
| Forecast | 6 to 36 months of cash and net worth, with what-if sliders for income and expenses, and every running chit on its way to maturity (distance to maturity, term passed, paid in, value now, take home now, maturity value, compound and simple return). **Chit outlook**: expected gain, gain realised, what the portfolio earns per month now, the **maturity runway** (each chit from start to maturity with today marked), the portfolio value month by month, dues against payouts, gains by year, and **wait or lift** per chit: the yearly return you earn by holding to maturity instead of lifting today (giving up the take-home value, paying the remaining installments, receiving the maturity amount), compared with a 7% FD, with a plain recommendation. **Chit illustrator**: auction model (bid discount, commission, dividend, cash paid) showing the prize, net gain or cost and effective rate for lifting in each month. **Interest calculator**: lump sum, monthly deposit or loan EMI, compound vs simple and in today's money. |
| Settings | Add, rename, hide or delete expense and income categories (with this month, the 3-month average and use count); lay out the dashboard; view preferences; the keyboard shortcut list; **Mobile app** (its address, a QR code to open it, who may use it). |
| Users & roles | Users and roles, tenants, the permission matrix, and the user's own profile and password. For each user an admin picks the **sections shared** (Dashboard, Expenses, Income, Journal, Accounts, Chits, Budgets, Balance sheet, Reports, Forecast), whether they may use the **mobile version**, and which sections they get there. Opened from the user menu (top right), not the main menu. |
| Mobile version | A lighter app for phones at `/m/` (the address is set by an admin in Settings → Mobile app): Home (net worth, cash & bank, spent this month against the budget, income, money to collect, what is due next, the latest entries), Expenses (today, this month, last month, to collect; add an expense in a few taps), Accounts (balances and recent statements), Chits (progress, paid in, still to pay, take home now, installments), Budgets and Income. It signs in on its own (its session is kept apart from the full site's) and shows only the sections shared for mobile. Account statements go back as far as needed (1 month to **All**, 60 entries at a time with *Show more*), money in green and out in orange, and each entry shows which account was debited (**Dr**) and which credited (**Cr**). An expense can carry its bill: **Camera** (with crop) or **Upload**; through an access link with approval the evidence travels with it and lands on the posted entry when approved. |
| Activity | **Who changed what.** Every change (add, edit, delete, payment, reversal, approval), sign-in and opened access link, by day: who, what in words (*Paid installment #7 · Shriram Gold 5L · ₹21,676*), which section and from where (full site, mobile version or an access link). Filters by period, person, section and text with **Clear filters**, a summary (changes, people, busiest section, link activity, deletions) and Excel / PDF export. For admins and managers (permission *Approve entries*). |
| Access links | **Temporary access without an account.** An admin makes a link to the mobile version for a person (a driver, a helper, family on a trip): for how long (1 hour to 30 days), which sections, **View only** or **Recorder** (may add expenses) and, for a recorder, **maker-checker**. The link is shown once with a QR code, copy and WhatsApp share; only a hash is stored. It stops working when it expires, and **Revoke** (or **Revoke all**) ends it at once, even on a phone where it is open. A link session can never reach balances, history or settings beyond its sections, cannot change anything but add expenses, and shows who it is for and when it ends. |
| Approvals | **Maker-checker.** Expenses recorded through a link with approval wait under Activity → Approvals (a badge on the menu shows how many). A checker approves them, correcting amount, date, category, account or description if needed, and only then are they posted (the note says who recorded it); or rejects them with a reason. The person with the link sees what is waiting, approved or rejected. |
| Gifts | Gifts **given** and **received** and **donations**, kept as a register beside the books (a gift is not income): to or from whom, relation, occasion, what it was (cash, gold, silver, an item, other) with grams / pieces and purity, its value (an estimate for anything but cash), how cash moved, 80G for donations, notes and photos / receipts (camera or upload). Cash given can also be booked as an expense from an account (e.g. under *Gifts & Donations*) and stays in step when edited or deleted. The page shows given, received and the balance, gold and silver in grams, donations (and how much has 80G receipts); the **give and take** with each person or family; every gift by year; occasions; **to return the favour** (people who gave more than they received); insights (typical wedding gift, where most goes, donations without 80G, gifts without a photo). Filters by given / received / donations, year, person and text with Clear; Excel / PDF export. |
| Documents | Scanned documents of the family: Aadhaar, PAN, passport, voter ID, driving licence, ration card, birth and marriage certificates, educational certificates, bank passbooks, property, vehicle RC, insurance, medical, employment and others, for each person (with relation). Each has its number (masked until revealed, one-tap copy), issuer, issue and expiry dates, notes and the scans (camera or upload). The page shows what expires within 6 months or has expired, documents without a scan, an **essentials checklist** per person (Aadhaar, PAN, passport, voter ID, licence: tap a missing one to add it), and cards with the scan. **Share**: a temporary link for whoever asked (valid 1 hour to 30 days, view only or with download, stop it any time, each opening counted) sent by WhatsApp, e-mail, QR or copy; the page behind it shows the scans with a "shared with …" watermark and nothing else of the household. Or send the files themselves through the device's share sheet. Also on the mobile version (Documents tab). |
| Export | Every section exports to **Excel** (a real `.xlsx` with a title, a frozen bold header with filters, money as numbers and dates as dates, one sheet per table) and **PDF** (a clean A4 document opened in the browser's print dialog: choose *Save as PDF*), and CSV. |
| Evidence | Photos, scans and PDFs on any entry: expenses, transfers, income, journal vouchers, chit payments and payouts, money lent or borrowed, bills and repayments. In the dialog: **Camera** (live preview, rear camera first, then a crop editor), **Upload** (several files), paste a screenshot (Ctrl+V) or drop files. The crop editor has drag handles, rotate, **Auto** (finds the receipt on the table and trims around it) and **Document** (crisp black on white, like a scan). Photos are resized to at most 2200 px before upload. Under an expanded entry the evidence shows as small thumbnails (add more in place); a click opens a full-screen viewer with zoom, pan, rotate, previous / next, a caption, download and delete. Rows with evidence show a 📎 count. |

**Keyboard.** Outside text boxes: **E** expense, **I** income, **T** transfer, **L** lend, **B** borrowed / bill, **N** any transaction,
**V** journal voucher, **1–0** jump to Dashboard, Expenses, Income, Journal, Accounts, Chits, Budgets, Balance sheet, Reports, Forecast,
**,** settings, **/** search, **R** refresh, **?** the shortcut map. On every page **↑ / ↓** move through the list (Enter opens) and
**← / →** step through periods, months or filters. The footer shows the main keys; click it for the full map.

**Footer.** A live status bar shows spending today and this month against the budget, cash and bank, money to collect,
card dues, the next scheduled payment and net worth. Each item opens its page.
The footer also shows the data store (tables and size), the last posting, shortcuts and a clock.

**Locked postings.** Only manual journal vouchers are edited in the journal.
An entry posted by a feature is locked wherever it appears, including the journal and every account statement.
That covers expenses, transfers, income, chit payments, opening balances, money lent and repayments.
The expanded row simply offers no edit buttons and links to the screen that manages it.
- **Expenses** are edited or deleted in Expenses.
- **Lent and paid-for items** are managed in their lifecycle panel.
- **Transfers, income and recurring postings** are corrected with **Reverse**, which posts a mirror-image entry linked to the original.

**Autocomplete everywhere.** Text boxes suggest values from your own history: descriptions, payees, references, institutions, names and notes.
Picking a past description also fills in the accounts and usual amount from that entry.
Long drop-downs such as account pickers become searchable lists with icons and balances.

**Full detail when expanded.** Expanded rows and the details overlay wrap long names and notes instead of cutting them with "…".
The Journal, Expenses, Income, account statements, budget transactions and Activity have a **Clear filters** button whenever a filter is set.

**Quiet scrollbars.** Scrollbars stay hidden and appear only while a panel is scrolling.

**Phones and tablets.** The same app adapts to the screen: below 1100 px the pages stack into one scrolling column
(charts keep a fixed height, long lists keep their own scroll); on phones the menu opens from the button at the top left,
figures go two across, forms one across, dialogs open as full-width sheets, tables scroll sideways and inputs use 16 px text
so iOS does not zoom. Touch screens show the buttons that desktop reveals on hover. The light theme (`css/lite.css`), its slightly
deeper glacier finish (`css/glacier.css`) and the phone / tablet rules (`css/responsive.css`) only override the base styles.

**Always fresh UI files.** Static files are served with `Cache-Control: no-cache` and a content ETag (or Last-Modified),
so the browser checks before reusing its copy and gets a cheap `304` when nothing changed. A new build shows up on the next
page load without version strings or hard refreshes.

## Architecture

```
com.aditya.personalbudget
├── storage      Tab-separated file database (TsvDataStore, TsvTable, TsvRepository, TsvTransactionManager)
├── domain       JPA-annotated entities + enums (AccountType, VoucherType, ChitStatus …)
├── repository   One Spring Data style repository per table
├── service      Ledger (posting rules), accounts, chits, budgets, recurring, reports, dashboard, forecast
├── security     Sessions, UserContext (tenant scoping), RolePolicy matrix, @RequiresPermission
├── web          REST controllers under /api
├── dto          Request / response records
└── config       Properties, transaction manager, MVC config, first-run seeding

resources/static
├── index.html            App shell with the top menu and sign-in screen
├── css/                  theme (tokens) → layout → components → views
└── js/
    ├── core/             api, store, format, ui toolkit, icons, charts
    ├── components/       transaction dialogs, shared by every page
    └── views/            one module per page, each exporting render(container, params)
```

### Storage: one `.tbl` file per table

Each file starts with a header row of column names, followed by one row per line, tab-separated.
An empty cell means NULL. Tabs and line breaks inside text are escaped.
Columns are matched by header name, so new entity fields stay backward compatible.

Entities carry the standard JPA annotations, and the store enforces them on every write:

| Constraint | Declared with |
|---|---|
| Primary key, auto-generated | `@Id @GeneratedValue` |
| NOT NULL, LENGTH | `@Column(nullable = false, length = 100)` |
| UNIQUE, single column | `@Column(unique = true)` |
| UNIQUE, composite | `@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "name"}))` |
| FOREIGN KEY, ON DELETE RESTRICT | `@References(Account.class)` |
| CHECK | Bean validation such as `@Positive`, `@Pattern` or `@Email` |

Repositories implement Spring Data's `ListCrudRepository`, so services use the familiar `save`, `findById`,
`findAll` and `deleteById`. Derived finders such as `findByTenantId` are a few lines of Java each.
Nothing is cached between requests: the files are the only copy of the data.
- **Reads.** A GET request reads each table it needs from disk once and reuses that copy until the request ends.
  It holds a shared lock, so it never sees half of someone else's save. A GET request cannot change data.
- **Writes.** Services use the normal `@Transactional` annotation. A transaction takes an exclusive lock
  (a JVM lock plus an OS file lock on `data/.lock`, so two server processes on the same folder also queue),
  reads the tables it touches fresh from disk, and writes the changed files atomically (temp file, then rename)
  on commit. On failure nothing is written.
- **Ids** come from `data/sequences.properties` and are never handed out twice.
- **Evidence files** live in `data/attachments/<tenant>/` under random names, with a small JPEG thumbnail per image.
  The type is checked from the file's first bytes (JPEG, PNG, WebP, GIF, PDF), the same file is kept once per entry,
  and the files go with their entry when it is deleted.
- **No lost updates.** Edited rows carry a `@Version`. Every edit form sends the version it was loaded with.
  If someone saved the row in between, the save is refused with HTTP 409 ("changed by someone else"),
  and the page reloads the current values.
- **Live updates.** After every commit the server announces the changed tables on `/api/events`
  (server-sent events). Every open browser redraws its current page with fresh numbers, so a change made in
  one login shows in the others within a second or two. While a dialog is open, the redraw waits until it closes.

### Accounting model

Every money movement is a balanced journal: at least two lines, and total debit equals total credit.
Balances are never stored. They are always derived from journal lines.

| Event | Journal |
|---|---|
| Expense | Dr Expenses *[category]*, Cr bank, card, cash or Payables |
| Income | Dr bank or cash, Cr Income *[category]* |
| Transfer, lending, borrowing, card bill | Dr destination, Cr source |
| Opening balance | Dr asset and Cr Opening Balance Equity, or the reverse for a liability |
| Chit installment | Dr Chit Funds *[chit]* for the full due amount, Cr bank for the cash paid, Cr Income *[Chit Gains]* for the dividend |
| Chit payout | Dr bank, Cr Chit Funds *[chit]* for the paid-in amount plus remaining dues. The difference goes to Income *[Chit Gains]* or Expenses *[Chit Commission & Discount]*. |
| Money lent / paid for someone | Dr Receivables, Cr bank, card or cash |
| Repayment (full or partial) | Dr bank (principal + interest), Cr Receivables (principal), Cr Income *[Interest]* (interest) |
| Write-off | Dr Expenses *[Gifts & Donations by default]*, Cr Receivables for whatever is still owed |
| Reversal | The original lines with debit and credit swapped, linked to the entry it reverses |

**Categories, not accounts.** Spending and earnings are split by *category*, which is carried on the journal line.
There is one **Expenses** account and one **Income** account, so the chart of accounts holds only real things:
Cash, Receivables, Chit Funds, Payables, Opening Balance Equity, Income, Expenses, plus your own banks, cards,
loans and investments. Every chit is a sub-ledger of the one **Chit Funds** account (its lines carry the chit),
and the balance sheet still shows one row per chit, a prized chit with dues left as a liability.
New tenants start with 8 income and 21 expense categories; add, rename or hide them in Settings.
Categories the app posts to by itself (interest, chit gains, loan interest, chit discount, miscellaneous)
are marked *system* and cannot be deleted.

**Upgrading older data.** Books from earlier versions (one account per category and per chit) are converted
once at startup: every table file is first copied to `data/backup-<date-time>/`, then each old expense or income
account becomes a category, each chit account merges into Chit Funds, and the journal lines, budgets, recurring
items, bills and write-offs are re-pointed. It runs in a single transaction, and every balance stays the same.

Chit returns are computed this way:
- **Rate.** The chit's own annual rate when set, otherwise the rate implied by its maturity value. The implied rate is the IRR of paying the installment N times and receiving the maturity amount one month later.
- **Month-by-month interest.** Each installment joins the balance on the day it is paid. Exactly one month later, interest is computed.
- **Compound interest** is the balance × the monthly rate. It is added to the balance before the next installment joins.
- **Simple interest** is the installments paid so far × the monthly rate. It is never added back.
- With the implied rate, compound interest ends exactly at maturity value − total contribution.

Money lent or owed at interest accrues **per month** by default: every whole month earns exactly rate ÷ 12, whether it has
28, 30 or 31 days, and part of a month counts in 30-day months (30/360). Set `budget.interest.day-count: ACTUAL` to count
actual days / 365 instead. Interest is **simple** (on the principal only) or **compound**, where each month's unpaid interest
joins the balance on the loan's monthly anniversary.

**Interest posted every month.** Tick *Post the interest every month* on money lent or owed (on by default when there is a
rate). Each finished month is then booked on its anniversary, by a job that runs at startup and every night:
Dr Receivables / Cr Income *[Interest]* for money owed to you, Dr Expenses *[Loan Interest]* / Cr Payables for money you owe.
*Post* on any earned month of the interest table (or *Post N months* in the panel) books finished months by hand, and the last posted month can be undone while unpaid.
Posted interest goes to the item's own Receivables / Payables account by default; when posting you can pick another (an *Interest receivable* asset, a loan account) and make it the item's default, or change the default under *Posts to*.
The interest account can also be a **bank, cash or wallet** account (or, for money you owe, the card it is paid from):
each month's interest is then booked as *received* (or *paid*) there on the spot, so nothing stays owed for it.
The account can be chosen when the money is lent or borrowed (optional; Receivables / Payables by default).
Each posted month has **Reverse** in the interest table (latest month first), which removes its entry so it can be posted again.
Repayments settle posted interest from whichever accounts it was booked to, oldest month first. A long lifecycle stays compact: posted months fold into one line and older events sit behind one click.
A later repayment settles the posted interest first (it reduces Receivables / Payables instead of being booked again),
and the item stays open until both the principal and the posted interest are cleared.
A repayment pays the interest due first and then reduces the principal.
The schedule shows every month from the day the money was lent, up to the settlement, the due date or three months ahead.

### Multi-tenancy and roles

A tenant is an isolated set of books. Every row carries a `tenantId`, and every query is scoped by the
signed-in user's tenant. Anyone can create a new household from the sign-in screen and becomes its admin.

The roles are Super Admin, Admin, Manager, Accountant, Member and Viewer. The matrix lives in `RolePolicy.java`,
and the server checks it on **every** request:
- Each write endpoint declares what it needs with `@RequiresPermission`. A write without one is refused,
  unless it is marked `@SelfService` (sign out, change your own password).
- Any read needs at least `VIEW`.
- A **Viewer** can open every page and report but cannot change anything. The UI hides the add, edit and delete
  buttons, and the server answers 403 if a change is attempted anyway.
- Tenant management is restricted to Super Admin.
- On top of the role, a call must belong to a **section shared** with the user (`FeaturePolicy.java`): a change needs the
  section that owns it (a chit payment needs Chits, a budget needs Budgets), a read is open to every section whose screen
  shows that data (the expense dialog shows the budget, so Expenses may read budgets). Accounts, categories, suggestions,
  attachments and the footer figures stay open to everyone. A session opened by the mobile version only reaches the user's
  mobile sections, and signing in there is refused when mobile access is off. An admin cannot limit their own access.
- A session opened with an **access link** (`access_links.tbl`, token hashed) acts as a Viewer or a Member limited to the
  link's sections, may only add expenses (recorder) and sign out, and ends when the link expires or is revoked.
  With maker-checker its expenses go to `pending_entries.tbl` until a checker approves them.
- Every successful change is written to `activity_log.tbl` (who, from where, what in words); the log never blocks a change.

Sessions are stored in `user_sessions.tbl` as a SHA-256 hash of the token, so they survive a restart and work
across server processes. The user, their role and their tenant are re-read on every request: a role change,
a deactivated user or a deactivated tenant takes effect immediately. After 5 wrong passwords in a row
the account is locked for 10 minutes.

## Configuration (`application.yml`)

| Key | Default | Meaning |
|---|---|---|
| `budget.data-dir` | `data` | Folder holding the `.tbl` files |
| `budget.security.session-hours` | `12` | How long a session stays valid |
| `budget.security.default-user-role` | `ADMIN` | Role for users created without one |
| `budget.interest.day-count` | `MONTHLY` | Interest per month, 30-day months (`MONTHLY`) or actual days / 365 (`ACTUAL`) |
| `budget.attachments.max-file-mb` | `10` | Largest evidence file accepted |
| `budget.attachments.max-per-entry` | `12` | Most evidence files on one entry |
| `budget.security.max-failed-logins` | `5` | Wrong passwords in a row before the account is locked |
| `budget.security.lock-minutes` | `10` | How long a locked account stays locked |
| `budget.seed.*` | `admin` / `admin@123`, tenant `home`, `INR`, demo data on | First-start seeding |

The address of the mobile version is kept in `data/app-settings.properties` (`mobile.path`, default `m`) and changed in
Settings → Mobile app; it is read on every request, so a new address works at once.
