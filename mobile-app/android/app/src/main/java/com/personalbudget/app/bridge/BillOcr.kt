package com.personalbudget.app.bridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.media.ExifInterface
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Reading bills on the phone (ML Kit text recognition, on the device: nothing leaves the phone).
 * A bill is read as rows, top to bottom, the way it is printed: the words ML Kit finds are grouped by height into
 * rows and joined left to right, with two spaces where there is a gap between columns ("Milk 1L  2  56.00  112.00"),
 * so the app can tell an item's name from its quantity, rate and amount.
 *  - Words, not whole lines: ML Kit often runs one line across the name and the amount columns; its words keep the gap.
 *  - A photo taken at a small angle slants every row: the slant (the median of the lines') is taken out before the
 *    words are grouped, so an amount at the right edge stays on its item's row.
 *  - When a read does not match the bill's total, the photo is read again, cleaned up ([enhanced]): faded thermal paper
 *    gives up its decimal points to more contrast, small print to more pixels.
 */
object BillOcr {

    private data class Piece(val text: String, val left: Int, val right: Int, val top: Int, val bottom: Int) {
        val cx get() = (left + right) / 2.0
        val cy get() = (top + bottom) / 2.0
        /** The height on the page with the slant taken out. */
        var y = 0.0
    }

    val recognizer: TextRecognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }

    /** The rows of one page or camera frame, top to bottom. */
    fun rows(text: Text): List<String> {
        val lines = text.textBlocks.flatMap { it.lines }
        val pieces = lines.flatMap { l ->
            val words = l.elements.mapNotNull { e -> e.boundingBox?.let { Piece(e.text.trim(), it.left, it.right, it.top, it.bottom) } }
            words.ifEmpty { listOfNotNull(l.boundingBox?.let { Piece(l.text.trim(), it.left, it.right, it.top, it.bottom) }) }
        }.filter { it.text.isNotEmpty() }
        if (pieces.isEmpty()) return emptyList()
        val slope = slant(lines)
        pieces.forEach { it.y = it.cy - slope * it.cx }
        val heights = pieces.map { it.bottom - it.top }.sorted()
        val h = max(8, heights[heights.size / 2])
        val rows = mutableListOf<MutableList<Piece>>()
        for (p in pieces.sortedBy { it.y }) {
            val row = rows.lastOrNull()
            if (row != null && abs(p.y - row.map { it.y }.average()) < h * 0.55) row.add(p) else rows.add(mutableListOf(p))
        }
        return rows.map { r ->
            val cells = r.sortedBy { it.left }
            buildString {
                cells.forEachIndexed { i, c ->
                    // a word gap is about a third of the text's height; a column gap is wider than the text is tall
                    if (i > 0) append(if (c.left - cells[i - 1].right > h * 0.9) "  " else " ")
                    append(c.text)
                }
            }
        }.filter { it.isNotBlank() }
    }

    /**
     * A photo cleaned up for another read: "contrast" is grey with the contrast raised, "large" is also twice the size
     * (at most [MAX_ENHANCED_SIDE]). Upright: a bitmap has no EXIF for the reader to go by.
     */
    fun enhanced(file: File, pass: String): Bitmap {
        val source = BitmapFactory.decodeFile(file.absolutePath) ?: throw IllegalStateException("That is not a photo")
        val rotation = try {
            when (ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (_: Exception) { 0f }
        val side = max(source.width, source.height)
        val scale = if (pass == "large") min(2f, MAX_ENHANCED_SIDE.toFloat() / side) else 1f
        val shaped = Bitmap.createBitmap(source, 0, 0, source.width, source.height, Matrix().apply { postScale(scale, scale); postRotate(rotation) }, true)
        val out = Bitmap.createBitmap(shaped.width, shaped.height, Bitmap.Config.ARGB_8888)
        val contrast = 1.6f
        val shift = 128f * (1f - contrast)
        val grey = ColorMatrix().apply { setSaturation(0f) }
        grey.postConcat(ColorMatrix(floatArrayOf(
            contrast, 0f, 0f, 0f, shift,
            0f, contrast, 0f, 0f, shift,
            0f, 0f, contrast, 0f, shift,
            0f, 0f, 0f, 1f, 0f)))
        Canvas(out).drawBitmap(shaped, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(grey); isFilterBitmap = true })
        return out
    }

    private const val MAX_ENHANCED_SIDE = 3200

    /** How much the rows rise (or fall) per pixel to the right: the median over the long lines, at most a little. */
    private fun slant(lines: List<Text.Line>): Double {
        val slopes = lines.mapNotNull { l ->
            val c = l.cornerPoints ?: return@mapNotNull null
            if (c.size < 2) return@mapNotNull null
            val dx = (c[1].x - c[0].x).toDouble()
            if (dx < 60) null else (c[1].y - c[0].y) / dx
        }.sorted()
        return if (slopes.size < 3) 0.0 else slopes[slopes.size / 2].coerceIn(-0.25, 0.25)
    }

    /** How alike two readings of a row are, 0 to 1 (letters and digits only, case ignored). */
    fun similarity(a: String, b: String): Double {
        val x = norm(a)
        val y = norm(b)
        if (x.isEmpty() || y.isEmpty()) return 0.0
        if (x == y) return 1.0
        if (min(x.length, y.length) < 4) return 0.0
        val d = levenshtein(x, y)
        return 1.0 - d.toDouble() / max(x.length, y.length)
    }

    private fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

    private fun levenshtein(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }
}

/**
 * The rows of a bill read in pieces, put together once each, in order.
 *  - [addPage]: photos or scanned pages of one bill, top to bottom; a page that starts with the last rows of the one
 *    before (a long bill photographed in overlapping parts) is joined where they meet.
 *  - [addFrame]: camera frames while the camera moves down the bill; each frame overlaps the rows already read, so the
 *    last row it has in common shows where it is, and only what comes after that is new. A clearer reading of a row
 *    replaces a poorer one.
 */
class RowMerger {
    val rows = mutableListOf<String>()

    fun addPage(page: List<String>): Int {
        val p = page.filter { meaningful(it) }
        if (p.isEmpty()) return 0
        if (rows.isEmpty()) { rows.addAll(p); return p.size }
        // the page may begin with the end of the one before: skip up to the last of its first rows that matches it
        val tail = rows.takeLast(3)
        var skip = 0
        for (t in 0 until min(15, p.size)) {
            if (tail.any { BillOcr.similarity(p[t], it) >= 0.8 }) skip = t + 1
        }
        val fresh = p.drop(skip)
        rows.addAll(fresh)
        return fresh.size
    }

    fun addFrame(frame: List<String>): Int {
        val f = frame.filter { meaningful(it) }
        if (f.isEmpty()) return 0
        if (rows.isEmpty()) {
            if (f.size < 2) return 0
            rows.addAll(f)
            return f.size
        }
        val from = max(0, rows.size - 60)
        var lastF = -1
        var lastA = -1
        for ((i, r) in f.withIndex()) {
            var best = -1
            var score = 0.0
            for (j in max(from, lastA) until rows.size) {
                val s = BillOcr.similarity(r, rows[j])
                if (s > score) { score = s; best = j }
            }
            if (score >= 0.78) {
                lastF = i
                lastA = best
                if (score < 0.999 && r.length > rows[best].length) rows[best] = r
            }
        }
        if (lastF < 0) {
            // nothing in common: the camera moved on quickly; take a clear frame as it is
            if (f.size < 3) return 0
            rows.addAll(f)
            return f.size
        }
        if (lastA < rows.size - 3) return 0   // the camera is above the end of what is read: nothing new
        val fresh = f.drop(lastF + 1)
        rows.addAll(lastA + 1, fresh)
        return fresh.size
    }

    private fun meaningful(s: String) = s.count { it.isLetterOrDigit() } >= 2
}
