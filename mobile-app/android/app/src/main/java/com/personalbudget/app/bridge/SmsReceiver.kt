package com.personalbudget.app.bridge

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.personalbudget.app.MainActivity
import com.personalbudget.app.R
import org.json.JSONArray
import org.json.JSONObject

/**
 * Catches bank SMS as they arrive, even when the app is closed: an SMS that reads like money going out (debited,
 * spent, paid … with an amount, and not an OTP) is kept (the last [MAX_KEPT]) for the app to offer as an expense,
 * a notification says so (tapping it opens the app), and a running app is told at once. Detection can be turned off
 * in the app's settings.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!prefs(context).getBoolean(KEY_ENABLED, false)) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val sender = parts[0].displayOriginatingAddress ?: ""
        val body = parts.joinToString("") { it.displayMessageBody ?: "" }
        if (!looksLikeDebit(body)) return
        val at = parts[0].timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
        val sms = JSONObject().put("id", "sms-$at-${body.hashCode()}").put("sender", sender).put("body", body).put("at", at)
        add(context, sms)
        notify(context, sms)
        BudgetBridgeModule.emitSms(sms.toString())
    }

    companion object {
        const val KEY_ENABLED = "enabled"
        private const val KEY_PENDING = "pending"
        private const val CHANNEL = "bank_sms"
        private const val MAX_KEPT = 50
        /** An amount: after Rs / INR / ₹, or "debited by 500.00" as SBI writes it. */
        private val AMOUNT = Regex("(?i)((rs\\.?|inr|₹)\\s*:?\\s*[0-9][0-9,]*(\\.\\d{1,2})?|\\b(by|for|with|of)\\s+[0-9][0-9,]*\\.\\d{1,2}\\b)")
        /** Money going out, in the words Indian banks and card issuers use. */
        private val DEBIT = Regex("(?i)\\b(debited|debit|spent|withdrawn|withdrawal|paid|payment|purchase[ds]?|sent|deducted|charged|transferred|trf|txn|transaction|used|dr|billed|withdraw)\\b")
        /** Not money gone: codes, reminders, requests, failures and refunds. */
        private val NOT = Regex("(?i)(\\botp\\b|one[- ]?time password|verification code|\\bwill be (debited|deducted|charged)|to be debited|\\bis due\\b|\\bdue (on|date|by)\\b|min(imum)?\\.? (amt|amount) due|total (amt|amount) due|collect request|has requested|requested (money|rs|inr)|payment request|\\bdeclined\\b|\\bfailed\\b|unsuccessful|\\breversed\\b|\\brefund(ed)?\\b|e-?mandate .*(registered|created|set up)|bill (is )?generated|statement (is )?generated|cashback|\\boffer\\b|t&c|pre-?approved|\\beligible\\b|apply now|\\bwin\\b|\\bvoucher\\b)")
        /** Credited, without anything going out (salary, a refund, money received). */
        private val CREDIT_ONLY = Regex("(?i)\\b(credited|received|deposited)\\b")

        fun looksLikeDebit(body: String): Boolean {
            if (!AMOUNT.containsMatchIn(body) || NOT.containsMatchIn(body)) return false
            val debit = DEBIT.find(body) ?: return false
            val credit = CREDIT_ONLY.find(body)
            // "Rs 500 credited to your A/c …" with "debit" only later in a footer is money in
            return credit == null || debit.range.first < credit.range.first || Regex("(?i)\\b(debited|spent|withdrawn|sent|paid|deducted|purchase)\\b").containsMatchIn(body)
        }

        fun prefs(context: Context): SharedPreferences = context.getSharedPreferences("pb_sms", Context.MODE_PRIVATE)

        @Synchronized
        fun pending(context: Context): JSONArray = JSONArray(prefs(context).getString(KEY_PENDING, "[]"))

        @Synchronized
        fun add(context: Context, sms: JSONObject) {
            val list = pending(context)
            for (i in 0 until list.length()) if (list.getJSONObject(i).optString("id") == sms.getString("id")) return
            list.put(sms)
            val kept = JSONArray()
            for (i in maxOf(0, list.length() - MAX_KEPT) until list.length()) kept.put(list.get(i))
            prefs(context).edit().putString(KEY_PENDING, kept.toString()).apply()
        }

        @Synchronized
        fun remove(context: Context, ids: Set<String>) {
            val list = pending(context)
            val kept = JSONArray()
            for (i in 0 until list.length()) {
                val o = list.getJSONObject(i)
                if (o.optString("id") !in ids) kept.put(o)
            }
            prefs(context).edit().putString(KEY_PENDING, kept.toString()).apply()
        }

        fun cancelNotifications(context: Context, ids: Set<String>) {
            val nm = NotificationManagerCompat.from(context)
            ids.forEach { nm.cancel(it.hashCode()) }
        }

        private fun notify(context: Context, sms: JSONObject) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bank SMS", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Money going out, detected in a bank SMS, to record as an expense" })
            }
            val body = sms.getString("body")
            val amount = AMOUNT.find(body)?.value ?: "A payment"
            val open = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("smsId", sms.getString("id"))
            }
            val pi = PendingIntent.getActivity(context, sms.getString("id").hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_expense)
                .setContentTitle("$amount spent · record it?")
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setColor(0xFF0B7CBD.toInt())
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pi)
                .build()
            nm.notify(sms.getString("id").hashCode(), n)
        }
    }
}
