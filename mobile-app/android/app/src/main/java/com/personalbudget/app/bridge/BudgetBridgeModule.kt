package com.personalbudget.app.bridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference

/**
 * What the app needs from Android, as one module ("BudgetBridge"):
 *  - a small key / value store in the app's own files (one file a key, written atomically), with the bytes used, so
 *    the app can keep what it shows offline within the size set in its settings;
 *  - bank SMS: detection on or off, the SMS caught while the app was closed (see [SmsReceiver]), and reading the
 *    recent inbox; a new SMS is also sent to the running app as the "BudgetSms" event;
 *  - evidence: a photo from the camera, or an image or PDF picked from the phone, kept in the app's own files
 *    (photos turned upright and made at most 1600 px, JPEG) until it is uploaded.
 */
class BudgetBridgeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {

    override fun getName() = NAME

    override fun initialize() {
        super.initialize()
        current = WeakReference(context)
        context.addActivityEventListener(this)
    }

    override fun invalidate() {
        if (current?.get() === context) current = null
        super.invalidate()
    }

    // ------------------------------------------------------------------ the store

    private val dir: File by lazy { File(context.filesDir, "pbstore").apply { mkdirs() } }

    private fun fileOf(key: String) = File(dir, key.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")

    @ReactMethod
    fun storeGet(key: String, promise: Promise) {
        try {
            val f = fileOf(key)
            promise.resolve(if (f.exists()) f.readText(Charsets.UTF_8) else null)
        } catch (e: Exception) {
            promise.reject("STORE", e.message, e)
        }
    }

    /** Writes the value (to a temporary file first, then in its place); resolves with its size in bytes. */
    @ReactMethod
    fun storeSet(key: String, value: String, promise: Promise) {
        try {
            val f = fileOf(key)
            val tmp = File(dir, f.name + ".tmp")
            val bytes = value.toByteArray(Charsets.UTF_8)
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
            promise.resolve(bytes.size.toDouble())
        } catch (e: Exception) {
            promise.reject("STORE", e.message, e)
        }
    }

    @ReactMethod
    fun storeRemove(key: String, promise: Promise) {
        fileOf(key).delete()
        promise.resolve(null)
    }

    /** Every stored key with its size in bytes, as JSON: {"key": bytes, ...}. */
    @ReactMethod
    fun storeSizes(promise: Promise) {
        val out = JSONObject()
        dir.listFiles()?.filter { it.name.endsWith(".json") }?.forEach { out.put(it.name.removeSuffix(".json"), it.length()) }
        promise.resolve(out.toString())
    }

    @ReactMethod
    fun storeClear(promise: Promise) {
        dir.listFiles()?.forEach { it.delete() }
        promise.resolve(null)
    }

    // ------------------------------------------------------------------ bank SMS

    @ReactMethod
    fun smsSetEnabled(enabled: Boolean, promise: Promise) {
        SmsReceiver.prefs(context).edit().putBoolean(SmsReceiver.KEY_ENABLED, enabled).apply()
        promise.resolve(enabled)
    }

    /** The bank SMS caught and not yet dealt with, as a JSON array of {id, sender, body, at}. */
    @ReactMethod
    fun smsPending(promise: Promise) {
        promise.resolve(SmsReceiver.pending(context).toString())
    }

    /** Forgets the given SMS ids (recorded or dismissed in the app); a JSON array of ids. */
    @ReactMethod
    fun smsDone(idsJson: String, promise: Promise) {
        val ids = JSONArray(idsJson).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
        SmsReceiver.remove(context, ids)
        SmsReceiver.cancelNotifications(context, ids)
        promise.resolve(null)
    }

    /** The inbox of the last [days] days (at most [limit]), newest first: a JSON array of {id, sender, body, at}. */
    @ReactMethod
    fun smsRecent(days: Double, limit: Double, promise: Promise) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("PERMISSION", "Reading SMS is not allowed")
            return
        }
        try {
            val since = System.currentTimeMillis() - (days * 86_400_000L).toLong()
            val out = JSONArray()
            context.contentResolver.query(Uri.parse("content://sms/inbox"), arrayOf("_id", "address", "body", "date"),
                "date >= ?", arrayOf(since.toString()), "date DESC")?.use { c ->
                while (c.moveToNext() && out.length() < limit.toInt()) {
                    val body = c.getString(2) ?: continue
                    if (!SmsReceiver.looksLikeDebit(body)) continue
                    out.put(JSONObject().put("id", "inbox-" + c.getLong(0)).put("sender", c.getString(1) ?: "")
                        .put("body", body).put("at", c.getLong(3)))
                }
            }
            promise.resolve(out.toString())
        } catch (e: Exception) {
            promise.reject("SMS", e.message, e)
        }
    }

    // ------------------------------------------------------------------ evidence

    private var pending: Promise? = null
    private var captureFile: File? = null
    private val evidenceDir: File by lazy { File(context.filesDir, "evidence").apply { mkdirs() } }

    /** source: "camera" (a photo now) or "files" (an image or a PDF already on the phone). Resolves with {path, name, type, size}, or null. */
    @ReactMethod
    fun pickEvidence(source: String, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) { promise.reject("EVIDENCE", "The app is not in front"); return }
        if (pending != null) { promise.reject("EVIDENCE", "Already picking"); return }
        try {
            val intent = if (source == "camera") {
                val dir = File(context.cacheDir, "capture").apply { mkdirs() }
                val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
                captureFile = f
                val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                Intent(Intent.ACTION_GET_CONTENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
                    .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
            }
            pending = promise
            activity.startActivityForResult(intent, if (source == "camera") REQ_CAMERA else REQ_FILES)
        } catch (e: Exception) {
            pending = null
            promise.reject("EVIDENCE", if (source == "camera") "No camera app to take the photo" else e.message, e)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_CAMERA && requestCode != REQ_FILES) return
        val promise = pending ?: return
        pending = null
        if (resultCode != Activity.RESULT_OK) { promise.resolve(null); return }
        try {
            val out = if (requestCode == REQ_CAMERA) {
                val f = captureFile ?: throw IllegalStateException("No photo")
                saveImage(f.inputStream().use { it.readBytes() }).also { f.delete() }
            } else {
                val uri = data?.data ?: throw IllegalStateException("Nothing picked")
                val type = context.contentResolver.getType(uri) ?: ""
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw IllegalStateException("Cannot read it")
                if (type == "application/pdf") {
                    val f = File(evidenceDir, "doc-${System.currentTimeMillis()}.pdf")
                    f.writeBytes(bytes)
                    describe(f, displayName(uri) ?: f.name, "application/pdf")
                } else saveImage(bytes)
            }
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("EVIDENCE", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent) {}

    /** A photo turned upright (its EXIF orientation), at most 1600 px on its long side, as a JPEG in the app's files. */
    private fun saveImage(bytes: ByteArray): WritableMap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("That is not a photo")
        val rotation = try {
            when (ExifInterface(bytes.inputStream()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (_: Exception) { 0f }
        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(bmp.width, bmp.height))
        if (rotation != 0f || scale < 1f) {
            val m = Matrix().apply { postScale(scale, scale); postRotate(rotation) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val f = File(evidenceDir, "photo-${System.currentTimeMillis()}.jpg")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        return describe(f, f.name, "image/jpeg")
    }

    private fun describe(f: File, name: String, type: String): WritableMap = Arguments.createMap().apply {
        putString("path", f.absolutePath); putString("name", name); putString("type", type); putDouble("size", f.length().toDouble())
    }

    private fun displayName(uri: Uri): String? = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }

    /** Removes a piece of evidence kept by the app (once uploaded, or dropped). */
    @ReactMethod
    fun fileDelete(path: String, promise: Promise) {
        val f = File(path)
        promise.resolve(f.canonicalPath.startsWith(context.filesDir.canonicalPath) && f.delete())
    }

    /** Bytes taken by the evidence waiting to be uploaded. */
    @ReactMethod
    fun evidenceSize(promise: Promise) {
        promise.resolve((evidenceDir.listFiles()?.sumOf { it.length() } ?: 0L).toDouble())
    }

    /** Whether the app may read and receive SMS, and post notifications: {receive, read, notify}. */
    @ReactMethod
    fun smsPermissions(promise: Promise) {
        val ok = { p: String -> ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED }
        promise.resolve(Arguments.createMap().apply {
            putBoolean("receive", ok(Manifest.permission.RECEIVE_SMS))
            putBoolean("read", ok(Manifest.permission.READ_SMS))
            putBoolean("notify", android.os.Build.VERSION.SDK_INT < 33 || ok(Manifest.permission.POST_NOTIFICATIONS))
            putBoolean("enabled", SmsReceiver.prefs(context).getBoolean(SmsReceiver.KEY_ENABLED, false))
        })
    }

    /** Opens the app's page in the phone's settings (to allow restricted settings and the SMS permission). */
    @ReactMethod
    fun openAppSettings(promise: Promise) {
        try {
            context.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SETTINGS", e.message, e)
        }
    }

    /**
     * Opens a upi://pay link in one UPI app (Google Pay, PhonePe ...) by its package; when that app is not installed,
     * its Play Store page. Resolves "APP" or "STORE".
     */
    @ReactMethod
    fun openUpi(link: String, pkg: String, promise: Promise) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve("APP")
        } catch (e: android.content.ActivityNotFoundException) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e2: android.content.ActivityNotFoundException) {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            promise.resolve("STORE")
        } catch (e: Exception) {
            promise.reject("UPI", e.message, e)
        }
    }

    companion object {
        const val NAME = "BudgetBridge"
        private const val REQ_CAMERA = 7301
        private const val REQ_FILES = 7302
        private const val MAX_SIDE = 1600
        const val EVENT_SMS = "BudgetSms"
        @Volatile
        var current: WeakReference<ReactApplicationContext>? = null

        /** Tells the running app about a new bank SMS (when it is running). */
        fun emitSms(json: String) {
            val ctx = current?.get() ?: return
            if (!ctx.hasActiveReactInstance()) return
            try {
                ctx.emitDeviceEvent(EVENT_SMS, json)
            } catch (_: Exception) {
            }
        }
    }
}
