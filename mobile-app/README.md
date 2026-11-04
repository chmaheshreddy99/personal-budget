# Personal Budget · Android app

A React Native app (Android first, iOS later) for the Personal Budget server in the folder above. It keeps your
accounts, statements and expenses on the phone, so it works without the server, and syncs when the server is reachable.

## What it does

- **Accounts:** your own accounts with their balances, grouped as banks, cards, cash and wallets, savings and
  investments, and loans and dues. Construction, Host a Chit and EMI accounts are **hidden by default**. Turn each
  group on under *Settings → Accounts shown*. There you can also show **only chosen accounts**. Hidden accounts are
  not listed, not offered to pay from and not kept offline. Tap an account for its statement. Lines are collapsed;
  tap one to see its full description, the other account, the amounts, the balance after it, and to add evidence.
- **Expenses tab**, in four parts (only those shared with you show):
  - **Expenses:** short rows by day, for this month, last month, everything kept on the phone or only what is on the
    phone. The panel compares this month with the same days of last month, and **Where it went** shows the top
    categories (tap one to see only its expenses). Tap a row to see every detail and its evidence, and to change or
    delete it while it waits. Search by shop, category, account, reference, amount or an item on a bill. A bill of several
    items is **one row** with its total and how many items it has; opened, a bar shows how it splits between categories,
    then a table of item, category and amount, ending with the item count and the total. An item saved without a name
    shows as *Item 1*, *Item 2*. *Where it went* still counts each item in its own category; tapping a category
    shows the bills with something in it, with what they spent there (of the bill's total).
  - **To collect:** money **paid for someone** and money **lent**, with what is still owed, how much came back and
    when it is due (overdue first); what you borrowed or owe shows under *I owe*. Tap one for every detail and the
    money received so far. **Received back** records money that came back (all, half or any amount, interest on money
    lent, the account it came into), and **Remind** opens WhatsApp with a polite reminder.
  - **EMIs:** every EMI running (card or loan), how far it is paid, what is due this month and next, and what is still
    to pay. Tap one for the instalments to come; **Pay EMI** pays the next one (or 2, 3, 6) from the bank, or into
    the card for a card EMI.
  - **Income:** what came in this month, last month or in all, by day, with the top sources (tap one to see only it)
    and **Add income**.
- **Recording (+):** one sheet with four modes at the top: **Expense**, **Paid for** (a bill paid for someone, owed
  back), **Lent** (with an optional due date and interest a year) and **Income** (the income source and the account
  it came into). Paid for and Lent offer the people you recorded before. A bank SMS opens the same sheet, so a debit
  can be recorded as money paid for someone too. An expense takes the amount, the day, the category (type to search,
  or pick from the most used), the account, what it was for, the shop, a reference and notes. **Evidence:** take a photo of the bill or attach an
  image or PDF. It is kept on the phone and uploaded to the expense at the next sync, then deleted from the phone.
  The account's balance goes down at once, marked *waiting*, until it is synced.
- **Scan a bill** (the banner at the top of the + sheet): the phone reads a bill and suggests the expense; you check it
  and post it. Reading happens on the phone (Google ML Kit text recognition): the bill never leaves it to be read.
  - **Scan bill:** the document scanner (from Google Play services) finds the bill's edges and straightens it; several
    pages, or pictures from the gallery. Pages of a long bill photographed in overlapping parts are joined.
  - **Long bill:** reads it like a video: start at the shop's name and move the phone slowly down to the total. Every
    camera frame is merged into what was read (rows already read are recognised, only what follows is added), so a
    supermarket roll longer than the screen is read whole. *Light* turns on the torch for faded thermal paper. A few
    frames are kept as photos.
  - **From a photo:** a photo already on the phone. **Type the items:** the same review, filled in by hand.
  - **On the mobile web version** the same scanner opens from the + sheet: the same reader, categories and checks, with
    Tesseract (`static/vendor/tesseract`, in the browser) reading the photo instead of ML Kit. Its copy of `src/receipt.ts`
    is generated: after changing the reader run `npm run web:bill` (a test fails if it was forgotten).
  - **Reading the table:** a number in front of an item's words is a serial number or quantity, never an amount. Serials
    running 1, 2, 3 mark where each item starts, so a name and its numbers on separate rows are joined, and the last
    serial gives the item count. Rows where quantity × rate = amount show which column holds the amounts.
  - **Matching the read:** the read is checked against the total and item count you enter before scanning, else against
    what the bill prints. If it does not match, the app tries other readings, the smallest change first and within a fixed
    limit (60,000 readings, 3 changes): another column of numbers, a decimal point missed or moved, a comma for the point,
    `125 50` for 125.50, quantity × rate, one misread digit (only when just one row can be it), a row read twice set
    aside, a row that looked like a heading taken in. Then the photo is read again with more contrast, then larger.
    Every change shows on its item with what was read, to undo. A bill whose items add up to its own printed total is
    left alone, even when the total entered differs.
  - **Check and post:** the shop, date, account (the one this shop was paid from before, or by how it was paid: UPI,
    card, cash) and the bill number are filled in; the **bill total** shows whether the items add up. The items each
    have their name, quantity × rate, amount and a suggested **category**: what you chose before for that item or shop,
    then the kind of shop (a restaurant's dishes are Dining, a pharmacy's are Medicines, a fuel slip is Fuel), then the
    item's words (milk → Milk & Dairy, tomato → Vegetables, detergent → Household ...). Tax, delivery or service charges,
    discounts and round off are found too: when the items already make the total, the GST printed is inside the prices
    and is not added; otherwise what makes the sum come right is counted (each can be switched). **What the phone read**
    lists every row: tap one it missed to add it as an item.
  - **Itemized** posts one transaction with a line per item in its own category (or **one line per category**), so the
    budget sees groceries, household and snacks separately; tax and discount are spread over the items in proportion
    and the lines add up exactly to the bill. **One expense** posts the whole bill in one category. The photos stay as
    the expense's evidence. An itemized bill still waiting on the phone opens in the same screen to be changed.
- **Chits:** the chits you are a member of, with progress, overdue instalments, the next due date, what is still to
  pay and their value now. Open a chit to see its instalments and **pay one**: choose the account and date, and
  enter the dividend, which comes off what you pay. This works offline too. The account's balance goes down at once,
  and the server books the payment once at the next sync.
- **More → Gifts:** gifts given and received (cash, gold and silver by weight, items) by month, with what was given and
  received this year. **People** shows the give-and-take with each person; tap one to see only theirs, and record the
  next gift to or from them. **Gave a gift / Received one** records the person, relation, occasion, what it was and
  its value; cash given can also be booked as an expense from an account in a category (Gifts & Donations by
  default).
- Everything recorded on the phone (paid for, lent, money received back, income, gifts, EMIs paid) works offline like
  expenses: the account's balance moves at once, marked *waiting*, and the server books it once at the next sync.
- **More → Balance sheet:** net worth, assets, liabilities and equity by group (tap a group to see its accounts),
  plus debt to assets, liquidity, emergency-fund months and monthly spend. A copy is kept for offline use.
- **More → Bank SMS** (the **SMS edition** only, see *Build*): detects debit SMS from Indian banks and cards: SBI, HDFC, ICICI, Axis, Kotak, BoB, PNB, Union,
  Canara, IDFC FIRST, IndusInd, Yes, Federal, Paytm, SBI Card, Amex and others. It covers UPI, card, ATM, IMPS/NEFT
  and NACH/auto-debit messages. Credits, OTPs, bill reminders, *will be debited*, failed or declined payments, collect
  requests, refunds and offers are ignored. The app asks you to record each debit, even when it is closed (a
  notification opens it). The page shows whether Android allows SMS access, and can scan the last 7 or 30 days.
  *Test an SMS* shows what the app reads from a pasted message.
  **On a phone, if SMS are not detected:** Android 13 and later block SMS permission for apps installed from an APK.
  Open *Bank SMS → Open app settings*, tap ⋮ → *Allow restricted settings*, then go to *Permissions → SMS → Allow*
  and also allow *Notifications*. On Xiaomi, Realme, Oppo and Vivo phones, also allow *Autostart* and set battery
  to *No restrictions*.
- **The order of lists:** accounts, chits and budgets follow the order arranged on the web (the small lock on each list there).
- **Sync:** when the app opens, when it comes back to the front, every minute while something waits, and with
  **Sync** (or pull down). Expenses and chit payments go up first, then evidence, then fresh balances, chits, the
  balance sheet and statements come down.
- **Offline copy and Work offline:** as before. The size limit (2–50 MB) covers the offline copy. Evidence waiting to
  upload and anything else waiting to sync are never dropped.

## The server side

The app talks to the server at the address you enter: an ngrok URL such as `https://name.ngrok-free.app`, or
`http://192.168.x.x:8080` on the same Wi-Fi. It uses these endpoints:

| Call | What |
|---|---|
| `GET /api/meta/app` | Is the server there (no sign-in needed) |
| `POST /api/auth/login` | Sign in: the app keeps the token, never the password |
| `GET /api/app/snapshot?days=` | Every account with its balance and group, the expense and income categories, the latest expenses, the chits, and (for the sections shared with the user) money paid for someone or lent with what came back, the EMIs, income and gifts |
| `GET /api/app/accounts/{id}/statement?days=` | An account's statement |
| `POST /api/app/expenses/sync` | `{expenses, chitPayments, claims, repayments, incomes, gifts, emiPayments}` recorded on the phone, each with the app's own id |
| `POST /api/attachments?entryId=` (or `pendingId=`) | Evidence for an expense (multipart `file`) |
| `GET /api/reports/balance-sheet` | The balance sheet |

The server remembers each synced id permanently (`data/app_sync_keys.tbl`). An item sent again, for example after a
dropped connection, is answered `DUPLICATE` and is not booked twice. A user whose expenses need approval gets
`PENDING`, and the expense waits under Approvals; money paid for someone or lent, income, gifts and EMIs cannot wait
for approval, so for such a user they are answered `FAILED` with the reason (record them on the full site). Each item
also needs its section: Expenses (paid for, lent, money back, EMIs), Income or Gifts.

To share the server through ngrok: `ngrok http 8080`, then enter the `https://…ngrok-free.app` address in the app.

## Build

You need Node 22 or later, JDK 17–21 and the Android SDK (build-tools 36, NDK 28; the paths are in `android/local.properties`).

```bash
cd mobile-app
npm install
cd android
./gradlew assembleStandardRelease assembleSmsRelease    # Windows: gradlew.bat …
```

There are two **editions** of the same app (the same id and key, so either replaces the other when installed):

| Edition | APK | |
|---|---|---|
| **standard** | `apk/personal-budget-<version>-standard-arm64-v8a.apk` | Everything but bank SMS. It asks for **no SMS permission**, so Google Play Protect has nothing to flag. Install this one. |
| **sms** | `apk/personal-budget-<version>-sms-arm64-v8a.apk` | Adds bank SMS offered as expenses. Any app installed from an APK that reads SMS can be flagged by Play Protect ("unsafe app" / "harmful"); it is the SMS permission it warns about. |

The APKs come out in `android/app/build/outputs/apk/<edition>/release/` (`…-arm64-v8a-release.apk` for almost every
current phone, `…-universal-release.apk` for any); copies are kept in `apk/`. Copy one to the phone and install it
(allow installing from this source). During development: `npm start` and `npx react-native run-android --mode standardDebug`.

**If Play Protect still warns** when installing: it shows for apps that are not from the Play Store and not yet known to
Google. Tap *More details → Install anyway*, or send the APK to Google for a scan (*Play Protect → the gear → Improve
harmful app detection*, or the "Submit app for analysis" link in the warning). Releases are signed with the app's own
key (`android/keystore.properties`, `android/app/release.keystore`; keep both safe: an update signed with another key
cannot replace the installed app). The app asks for the camera only when the long-bill scan is first used; the
document scanner and photos go through the phone's own apps. Google Play asks for a declaration before it accepts an
app that reads SMS, so only the standard edition could go there as it is.

The architectures built are in `android/gradle.properties` (`reactNativeArchitectures`): arm64-v8a and armeabi-v7a
for phones, and x86_64 for the emulator.

## Code

```
App.tsx                 the tabs (Accounts, Expenses, +, Chits, More), the add-expense sheet, the "record this SMS?" prompt
src/data.ts             types, the size-limited store, the server client, sync, balances with what waits
src/state.tsx           the app's state and actions (useApp), when to sync, the SMS queue
src/sms.ts              reading bank SMS: amount, account, shop, reference, date, category
src/native.ts           the Android module (store, SMS, bill scanning) from JavaScript
src/receipt.ts          reading a bill's rows: shop, date, total, items (qty × rate), tax / charges / discounts, categories, learning
src/evidence.tsx        taking / attaching evidence, thumbnails
src/screens/*           Setup, Accounts, AccountDetail, Expenses (with Claims, Emis, Income), AddExpense (the record sheet), ScanBill, Chits, More,
                        Gifts, Budget, Categories, BalanceSheet, Detected (bank SMS), Settings
src/ui.tsx, theme.ts    building blocks, icons (lucide), colours
android/app/src/main/java/com/personalbudget/app/bridge/   BudgetBridgeModule (the module), BillOcr (text into rows, joining
                        pages and frames), LiveScanActivity (the long-bill camera scan), SmsReceiver (sms edition)
android/app/src/sms/    the sms edition's manifest: the SMS permissions and receiver
```

Tests: `npm test`. These cover the SMS parser (debit and non-debit messages from many Indian banks), money
formatting, which accounts are shown, and the balances shown before a sync.

iOS comes later. Apple does not let apps read SMS, so on iPhone that part will be replaced by Shortcuts automations
or by pasting a message. The app falls back to keeping its data in memory until an iOS store is added
(`src/native.ts`).
