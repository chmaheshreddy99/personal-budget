package com.aditya.personalbudget.web;

import com.aditya.personalbudget.service.AttachmentService.FileContent;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;

/** Serves an agreement's ID proof: inline, never sniffed, sandboxed and never cached outside the browser. */
final class AgreementFiles {

    private AgreementFiles() {
    }

    static ResponseEntity<byte[]> inline(FileContent f) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(f.fileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                .cacheControl(CacheControl.noStore())
                .body(f.bytes());
    }
}
