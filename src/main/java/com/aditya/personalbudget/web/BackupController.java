package com.aditya.personalbudget.web;

import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.BackupService;
import com.aditya.personalbudget.service.BackupService.BackupInfo;
import com.aditya.personalbudget.service.BackupService.RestoreResult;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/**
 * Backups of the whole installation (Settings, Backup): list, create, download, delete and restore. They hold every
 * organization's data, so only a platform admin (super admin) reaches them.
 */
@RestController
@RequestMapping("/api/admin/backups")
@RequiresPermission(Permission.MANAGE_TENANTS)
public class BackupController {

    private final BackupService backups;

    public BackupController(BackupService backups) {
        this.backups = backups;
    }

    public record BackupList(String folder, List<BackupInfo> backups) {
    }

    public record CreateRequest(boolean includeFiles) {
    }

    @GetMapping
    public BackupList list() {
        return new BackupList(backups.folder().toString(), backups.list());
    }

    @PostMapping
    public BackupInfo create(@RequestBody(required = false) CreateRequest request) {
        return backups.create(request != null && request.includeFiles());
    }

    @GetMapping("/{name}")
    public ResponseEntity<Resource> download(@PathVariable String name) {
        var file = backups.file(name);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(name).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(new FileSystemResource(file));
    }

    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable String name) {
        backups.delete(name);
        return ResponseEntity.noContent().build();
    }

    /** Restores a backup kept on the server: every table is replaced (the data before it is backed up first). */
    @PostMapping("/{name}/restore")
    public RestoreResult restore(@PathVariable String name) {
        return backups.restore(name);
    }

    /** Restores an uploaded backup file (it is kept in the backup folder as well). */
    @PostMapping(path = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public RestoreResult restoreUpload(@RequestPart("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new BusinessException("Choose a backup file (.json) to restore");
        }
        try (InputStream in = file.getInputStream()) {
            return backups.restoreUpload(in, file.getOriginalFilename());
        }
    }
}
