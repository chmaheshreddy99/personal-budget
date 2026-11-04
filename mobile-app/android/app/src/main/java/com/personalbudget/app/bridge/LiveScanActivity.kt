package com.personalbudget.app.bridge

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Scanning a long bill like a video: the camera reads the bill continuously while it is moved slowly from the top to
 * the bottom; every frame's rows are merged into what was read so far ([RowMerger.addFrame]), so a bill longer than
 * the screen is read whole. A few frames are kept as photos (evidence for the expense). Done returns the rows
 * ("rows", JSON) and the photos ("frames", JSON paths); nothing leaves the phone.
 */
class LiveScanActivity : AppCompatActivity() {

    private lateinit var preview: PreviewView
    private lateinit var count: TextView
    private lateinit var tail: TextView
    private lateinit var torchButton: Button
    private val merger = RowMerger()
    private val frames = mutableListOf<String>()
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var camera: Camera? = null
    private var torch = false
    @Volatile private var busy = false
    @Volatile private var lastRun = 0L
    @Volatile private var lastSnap = 0L
    @Volatile private var finished = false
    private var delivered = false

    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) startCamera() else {
            setResult(RESULT_CANCELED, Intent().putExtra("error", "The camera is needed to scan the bill: allow it in the app's settings"))
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(layout())
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else askCamera.launch(Manifest.permission.CAMERA)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun layout(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
        root.addView(preview, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(36), dp(18), dp(14))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xE6061830.toInt(), 0x00061830))
        }
        top.addView(TextView(this).apply {
            text = "Scan a long bill"; setTextColor(Color.WHITE); textSize = 20f; typeface = Typeface.DEFAULT_BOLD
        })
        top.addView(TextView(this).apply {
            text = "Hold the bill flat in good light. Start at the shop's name and move slowly down to the total."
            setTextColor(0xFFD7E6F5.toInt()); textSize = 13.5f; setPadding(0, dp(4), 0, dp(8))
        })
        count = TextView(this).apply {
            text = "Looking for text…"; setTextColor(Color.WHITE); textSize = 13f; typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(5), dp(10), dp(5))
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0xFF0A74B5.toInt()) }
        }
        top.addView(count, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        root.addView(top, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.TOP))

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(28))
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xF0061830.toInt(), 0x00061830))
        }
        tail = TextView(this).apply {
            setTextColor(0xFFE8F1FA.toInt()); textSize = 12.5f; typeface = Typeface.MONOSPACE; maxLines = 4; setPadding(0, 0, 0, dp(12))
        }
        bottom.addView(tail)
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun button(label: String, bg: Int, onClick: () -> Unit) = Button(this).apply {
            text = label; setTextColor(Color.WHITE); isAllCaps = false; textSize = 15f
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(bg) }
            setOnClickListener { onClick() }
        }
        val gap = LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(8) }
        buttons.addView(button("Cancel", 0x66FFFFFF) { setResult(RESULT_CANCELED); finish() }, gap)
        torchButton = button("Light", 0x66FFFFFF) { toggleTorch() }
        buttons.addView(torchButton, LinearLayout.LayoutParams(0, dp(48), 0.8f).apply { marginEnd = dp(8) })
        buttons.addView(button("Done", 0xFF0A74B5.toInt()) { done() }, LinearLayout.LayoutParams(0, dp(48), 1.3f))
        bottom.addView(buttons)
        root.addView(bottom, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
        return root
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val p = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { analyze(it) }
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis)
            } catch (e: Exception) {
                setResult(RESULT_CANCELED, Intent().putExtra("error", "The camera could not start: ${e.message}"))
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun toggleTorch() {
        torch = !torch
        camera?.cameraControl?.enableTorch(torch)
        torchButton.text = if (torch) "Light on" else "Light"
    }

    @SuppressLint("UnsafeOptInUsageError")
    private fun analyze(proxy: ImageProxy) {
        val now = SystemClock.elapsedRealtime()
        val media = proxy.image
        if (finished || busy || now - lastRun < 400 || media == null) { proxy.close(); return }
        busy = true
        val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
        BillOcr.recognizer.process(image)
            .addOnSuccessListener { text ->
                val added = synchronized(merger) { merger.addFrame(BillOcr.rows(text)) }
                if (added >= 2 && now - lastSnap > 1500 && frames.size < 10) {
                    lastSnap = now
                    try { snapshot(proxy) } catch (_: Exception) { }
                }
                runOnUiThread { show() }
            }
            .addOnCompleteListener {
                lastRun = SystemClock.elapsedRealtime()
                busy = false
                proxy.close()
            }
    }

    /** Keeps this frame as a photo of the bill: upright, at most 1600 px, JPEG, in the app's evidence folder. */
    private fun snapshot(proxy: ImageProxy) {
        var bmp = proxy.toBitmap()
        val rotation = proxy.imageInfo.rotationDegrees.toFloat()
        val scale = minOf(1f, 1600f / maxOf(bmp.width, bmp.height))
        if (rotation != 0f || scale < 1f) {
            val m = Matrix().apply { postScale(scale, scale); postRotate(rotation) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val dir = File(filesDir, "evidence").apply { mkdirs() }
        val f = File(dir, "scan-${System.currentTimeMillis()}.jpg")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 78, it) }
        synchronized(frames) { frames.add(f.absolutePath) }
    }

    private fun show() {
        val rows = synchronized(merger) { merger.rows.toList() }
        count.text = if (rows.isEmpty()) "Looking for text…" else "${rows.size} line${if (rows.size == 1) "" else "s"} read · keep moving down"
        tail.text = rows.takeLast(4).joinToString("\n")
    }

    private fun done() {
        finished = true
        val rows = synchronized(merger) { merger.rows.toList() }
        val photos = synchronized(frames) { frames.toList() }
        delivered = true
        setResult(RESULT_OK, Intent()
            .putExtra("rows", JSONArray(rows).toString())
            .putExtra("frames", JSONArray(photos).toString()))
        finish()
    }

    override fun onDestroy() {
        finished = true
        // cancelled (Cancel or back): the photos taken are not wanted
        if (!delivered) synchronized(frames) { frames.forEach { File(it).delete() } }
        executor.shutdown()
        super.onDestroy()
    }
}
