# Bricks · Android app for the grey blocks business

A React Native app (Android) for **Brick Management** on the Personal Budget server in the folder above. It is a
separate app from `mobile-app/` (package `com.personalbudget.bricks`), so both can be installed on the same phone.

## What it shows: only what the web app gives

An admin chooses the app's screens in the **web app → Settings → Bricks app**:

- **On / off** for the business, and three switches: **approve on the phone**, **record on the phone** (off: the app
  only shows), **evidence on the phone** (camera and files).
- **Screens by role**: a role gets every screen its Brick Management permissions open until you choose otherwise. A
  screen the role's permissions do not reach can never be given.
- **People**: each user gets their role's screens, screens of their own, or no app.

The app reads its screens from `GET /api/bricks/app/profile` when it starts, when it comes back to the front and every
minute. The server checks **every call** an app session makes against the screens given (`BrickAppService.refusal`),
so a change on the web reaches the phones at their next step. An app session cannot reach the personal-finance side
at all.

| Screen | What |
|---|---|
| Approvals | Requests waiting for a checker: why each needs one, the order as asked (prices against the lowest and MRP), the **evidence** (photos full screen, PDFs in the phone's viewer), the history. **Approve** (optional word) or **reject with a reason** (required, with common reasons to tap). Makers answer a rejection with a comment and more evidence, or withdraw. |
| Orders | Search and filter; an order's blocks, trips, payments; call the customer, map, bill PDF, share the customer's link; free delivery, cancel. **New order** with customer suggestions; a price below the lowest goes to a checker. |
| Deliveries | Open orders by when the next trip is due; each trip moves loading → dispatched → on the way → delivered (with the count that arrived). |
| Payments | Payments customers reported (verify the UPI reference, then confirm or turn down) and what is still to collect. |
| Stock | Blocks by type (ready, curing, booked, free to sell) and raw material left, with low-stock warnings. |
| Production | Batches; **record a batch** (good and broken by type, the raw material counted after it). |
| Purchases & expenses | Raw material bills and production expenses, each with a **photo of the bill**. |
| Team & pay | As the web app's Payments: for a week (or a month of salaries) everyone with pay due, what they earned, the advance to take back and **what to pay**. Pay one: pick the work, the wage, a bonus and the advances taken back, **see the slip before it is made** (the web app's slip, marked DRAFT), then record the payment and get the slip. Advances owed (give one), slips paid lately. |
| Cash & bank · Dashboard · Reports | For roles that see the money. |
| Alerts | New orders, requests and their decisions, signed deliveries; each opens what it is about. |

A maker's change that needs a checker is answered by the server with 202; the app says "sent for approval".

**Bills, invoices and slips are the web app's own.** The phone opens `brick-doc.html` on the server in a WebView: the
page draws the document with the web app's renderer (`js/core/brick-docs.js`) and styles, so it is the same document,
digital signature checked. **Print** hands the same page, laid out for one A4 sheet as the web app prints it, to
Android's print service (a printer, or *Save as PDF* to share).

**Orders taken on the phone alert the web app** (a pop-up, a chime and the order read out), also when the office is
signed in as the same person: a notice made from the Bricks app reaches its maker's web sessions too.

## Build

Node 22+, JDK 17–21, the Android SDK (build-tools 36, NDK 28). Put the SDK path in `android/local.properties`
(`sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`).

```bash
cd bricks-app
npm ci
npm test            # unit tests
npx tsc --noEmit    # types
cd android
./gradlew assembleRelease        # Windows: gradlew.bat assembleRelease
```

APKs: `android/app/build/outputs/apk/release/` (copies named `bricks-*.apk` are kept in `apk/`).
`bricks-arm64-v8a-release.apk` fits almost every current phone; `bricks-universal-release.apk` runs anywhere.
The release is signed with the template's debug key: fine for installing yourself, make your own key before Play.

## Code

```
App.tsx              sign-in gate, the bottom bar (Home, the 3 screens most needed, More), screens stacked over it
src/api.ts           the server client (login as client "bricks", uploads), what is kept on the phone
src/state.tsx        session, profile, set-up, toasts; useLoad: a screen's last answer first, then fresh
src/nav.tsx          tabs and the screen stack, Back
src/modules.ts       the screens the web app can give: names, icons, the bottom bar's order
src/evidence.tsx     evidence: thumbnails, full-screen viewer, PDFs, camera / files, uploads
src/screens/*        Login, Home, Approvals, Orders, Deliveries (+ Payments), Production (+ Stock), Purchases, Team (pay run, pay one),
                     Doc (bills and slips as the web app shows them), Finance, More
android/.../bridge/  BricksBridgeModule: the store, camera / files, downloading and opening evidence, printing documents
```
