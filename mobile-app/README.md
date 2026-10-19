# Personal Budget · Android app

A React Native app (Android first, iOS later) for the Personal Budget server in the folder above. It keeps your
accounts, statements and expenses on the phone, so it works without the server, and syncs when the server is reachable.

## What it does

- **Accounts:** your own accounts with their balances, grouped as banks, cards, cash and wallets, savings and
  investments, and loans and dues. Construction, Host a Chit and EMI accounts are **hidden by default**. Turn each
  group on under *Settings → Accounts shown*. There you can also show **only chosen accounts**. Hidden accounts are
  not listed, not offered to pay from and not kept offline. Tap an account for its statement. Lines are collapsed;
  tap one to see its full description, the other account, the amounts, the balance after it, and to add evidence.
- **Expenses:** short rows by day. Tap a row to see every detail and its evidence, and to change or delete it while
  it waits. Search by shop, category, account, reference or amount.
- **Recording an expense (+):** the amount, the day, the category (type to search, or pick from the most used), the
  account, what it was for, the shop, a reference and notes. **Evidence:** take a photo of the bill or attach an
  image or PDF. It is kept on the phone and uploaded to the expense at the next sync, then deleted from the phone.
  The account's balance goes down at once, marked *waiting*, until it is synced.
- **Chits:** the chits you are a member of, with progress, overdue instalments, the next due date, what is still to
  pay and their value now. Open a chit to see its instalments and **pay one**: choose the account and date, and
  enter the dividend, which comes off what you pay. This works offline too. The account's balance goes down at once,
  and the server books the payment once at the next sync.
- **More → Balance sheet:** net worth, assets, liabilities and equity by group (tap a group to see its accounts),
  plus debt to assets, liquidity, emergency-fund months and monthly spend. A copy is kept for offline use.
- **More → Bank SMS:** detects debit SMS from Indian banks and cards: SBI, HDFC, ICICI, Axis, Kotak, BoB, PNB, Union,
  Canara, IDFC FIRST, IndusInd, Yes, Federal, Paytm, SBI Card, Amex and others. It covers UPI, card, ATM, IMPS/NEFT
  and NACH/auto-debit messages. Credits, OTPs, bill reminders, *will be debited*, failed or declined payments, collect
  requests, refunds and offers are ignored. The app asks you to record each debit, even when it is closed (a
  notification opens it). The page shows whether Android allows SMS access, and can scan the last 7 or 30 days.
  *Test an SMS* shows what the app reads from a pasted message.
  **On a phone, if SMS are not detected:** Android 13 and later block SMS permission for apps installed from an APK.
  Open *Bank SMS → Open app settings*, tap ⋮ → *Allow restricted settings*, then go to *Permissions → SMS → Allow*
  and also allow *Notifications*. On Xiaomi, Realme, Oppo and Vivo phones, also allow *Autostart* and set battery
  to *No restrictions*.
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
| `GET /api/app/snapshot?days=` | Every account with its balance and group, the expense categories, the latest expenses |
| `GET /api/app/accounts/{id}/statement?days=` | An account's statement |
| `POST /api/app/expenses/sync` | `{expenses, chitPayments}` recorded on the phone, each with the app's own id |
| `POST /api/attachments?entryId=` (or `pendingId=`) | Evidence for an expense (multipart `file`) |
| `GET /api/reports/balance-sheet` | The balance sheet |

The server remembers each synced id permanently (`data/app_sync_keys.tbl`). An expense sent again, for example after
a dropped connection, is answered `DUPLICATE` and is not booked twice. A user whose expenses need approval gets
`PENDING`, and the expense waits under Approvals.

To share the server through ngrok: `ngrok http 8080`, then enter the `https://…ngrok-free.app` address in the app.

## Build

You need Node 22 or later, JDK 17–21 and the Android SDK (build-tools 36, NDK 28; the paths are in `android/local.properties`).

```bash
cd mobile-app
npm install
cd android
./gradlew assembleRelease        # Windows: gradlew.bat assembleRelease
```

The APKs are in `android/app/build/outputs/apk/release/`: `app-arm64-v8a-release.apk` for almost every current phone, or `app-universal-release.apk`. Copies are kept in `apk/`. Copy it to the phone and install it (allow
installing from this source). During development, use `npm start` and `npx react-native run-android` with a phone
connected over USB debugging.

The release build is signed with the template's debug key, which is fine for installing the app yourself. Before
putting it on Play, make a key of your own (see React Native's *Publishing to Google Play Store*). Google Play also
asks for a declaration before it accepts an app that reads SMS.

The architectures built are in `android/gradle.properties` (`reactNativeArchitectures`): arm64-v8a and armeabi-v7a
for phones, and x86_64 for the emulator.

## Code

```
App.tsx                 the tabs (Accounts, Expenses, +, Chits, More), the add-expense sheet, the "record this SMS?" prompt
src/data.ts             types, the size-limited store, the server client, sync, balances with what waits
src/state.tsx           the app's state and actions (useApp), when to sync, the SMS queue
src/sms.ts              reading bank SMS: amount, account, shop, reference, date, category
src/native.ts           the Android module (store and SMS) from JavaScript
src/evidence.tsx        taking / attaching evidence, thumbnails
src/screens/*           Setup, Accounts, AccountDetail, Expenses, AddExpense, Chits, More, BalanceSheet, Detected (bank SMS), Settings
src/ui.tsx, theme.ts    building blocks, icons (lucide), colours
android/app/src/main/java/com/personalbudget/app/bridge/
                        BudgetBridgeModule (store, SMS), SmsReceiver (catches bank SMS, notifies)
```

Tests: `npm test`. These cover the SMS parser (debit and non-debit messages from many Indian banks), money
formatting, which accounts are shown, and the balances shown before a sync.

iOS comes later. Apple does not let apps read SMS, so on iPhone that part will be replaced by Shortcuts automations
or by pasting a message. The app falls back to keeping its data in memory until an iOS store is added
(`src/native.ts`).
