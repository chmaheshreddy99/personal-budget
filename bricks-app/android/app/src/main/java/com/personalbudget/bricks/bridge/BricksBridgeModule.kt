package com.personalbudget.bricks.bridge

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * What the Bricks app needs from Android, as one module ("BricksBridge"):
 *  - a small key / value store in the app's own files (one file a key, written atomically): the server, the sign-in
 *    and the last screens seen, so the app opens at once and shows something when the yard has no signal;
 *  - evidence to send: a photo from the camera, or an image or PDF picked from the phone, kept in the app's files
 *    (photos turned upright and made at most 1600 px, JPEG) until it is uploaded;
 *  - evidence to check: a file from the server (signed in) saved to the cache and opened in the phone's viewer (PDFs);
 *  - printing a bill or a slip as the web app prints it: its page (brick-doc.html, print layout) handed to Android's
 *    print service, which also saves it as a PDF to share.
 */
class BricksBridgeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {

    override fun getName() = NAME

    override fun initialize() {
        super.initialize()
        context.addActivityEventListener(this)
    }

    private val io = Executors.newFixedThreadPool(2)

    // ------------------------------------------------------------------ the store

    private val dir: File by lazy { File(context.filesDir, "bkstore").apply { mkdirs() } }

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

    /** Writes the value (to a temporary file first, then in its place). */
    @ReactMethod
    fun storeSet(key: String, value: String, promise: Promise) {
        try {
            val f = fileOf(key)
            val tmp = File(dir, f.name + ".tmp")
            tmp.writeBytes(value.toByteArray(Charsets.UTF_8))
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STORE", e.message, e)
        }
    }

    @ReactMethod
    fun storeRemove(key: String, promise: Promise) {
        fileOf(key).delete()
        promise.resolve(null)
    }

    @ReactMethod
    fun storeClear(promise: Promise) {
        dir.listFiles()?.forEach { it.delete() }
        File(context.cacheDir, "evidence").listFiles()?.forEach { it.delete() }
        promise.resolve(null)
    }

    // ------------------------------------------------------------------ evidence to send

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
                if (bytes.size > MAX_BYTES) throw IllegalStateException("That file is larger than 10 MB")
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
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
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

    // ------------------------------------------------------------------ evidence to check

    /**
     * Saves a file from the server (with the given headers: the sign-in) to the cache, once per name; resolves with its
     * path. Used for the full-size photo of a piece of evidence and for PDFs, which are then opened with [openFile].
     */
    @ReactMethod
    fun download(url: String, headers: ReadableMap, name: String, promise: Promise) {
        io.execute {
            try {
                val dir = File(context.cacheDir, "evidence").apply { mkdirs() }
                val f = File(dir, name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
                if (!f.exists() || f.length() == 0L) {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.connectTimeout = 15000
                    c.readTimeout = 60000
                    val it = headers.keySetIterator()
                    while (it.hasNextKey()) { val k = it.nextKey(); c.setRequestProperty(k, headers.getString(k)) }
                    try {
                        if (c.responseCode !in 200..299) throw IllegalStateException("The server answered ${c.responseCode}")
                        val tmp = File(dir, f.name + ".part")
                        c.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
                        tmp.renameTo(f)
                    } finally {
                        c.disconnect()
                    }
                }
                promise.resolve(f.absolutePath)
            } catch (e: Exception) {
                promise.reject("DOWNLOAD", e.message ?: "The file could not be fetched", e)
            }
        }
    }

    /** Opens a file of the app's cache (a downloaded PDF or photo) in the phone's viewer. */
    @ReactMethod
    fun openFile(path: String, type: String, promise: Promise) {
        try {
            val f = File(path)
            if (!f.canonicalPath.startsWith(context.cacheDir.canonicalPath)) throw IllegalStateException("Not a file of the app")
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
            val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(Intent.createChooser(intent, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            promise.resolve(true)
        } catch (e: android.content.ActivityNotFoundException) {
            promise.reject("OPEN", "No app on the phone opens this file", e)
        } catch (e: Exception) {
            promise.reject("OPEN", e.message, e)
        }
    }

    // ------------------------------------------------------------------ printing

    /** The page being printed: kept until the print service has it (it reads the page from this view). */
    private var printing: WebView? = null

    /**
     * Prints the page at [url] (a bill or slip of brick-doc.html in its print layout) under [title], on A4. The page
     * draws itself after loading (it fetches the document), so the print starts a moment after it finished loading.
     */
    @ReactMethod
    fun printPage(url: String, title: String, userAgent: String, promise: Promise) {
        val activity = context.currentActivity
        if (activity == null) { promise.reject("PRINT", "The app is not in front"); return }
        activity.runOnUiThread {
            try {
                val view = WebView(activity)
                view.settings.javaScriptEnabled = true
                view.settings.domStorageEnabled = true
                view.settings.userAgentString = userAgent
                view.webViewClient = object : WebViewClient() {
                    private var done = false
                    override fun onPageFinished(v: WebView, u: String) {
                        if (done) return
                        done = true
                        v.postDelayed({
                            try {
                                val pm = activity.getSystemService(android.content.Context.PRINT_SERVICE) as PrintManager
                                pm.print(title, v.createPrintDocumentAdapter(title),
                                    PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
                                promise.resolve(true)
                            } catch (e: Exception) {
                                promise.reject("PRINT", e.message, e)
                            }
                        }, 1800)
                    }
                }
                printing = view
                view.loadUrl(url)
            } catch (e: Exception) {
                promise.reject("PRINT", e.message, e)
            }
        }
    }

    companion object {
        const val NAME = "BricksBridge"
        private const val REQ_CAMERA = 7401
        private const val REQ_FILES = 7402
        private const val MAX_SIDE = 1600
        private const val MAX_BYTES = 10 * 1024 * 1024
    }
}
