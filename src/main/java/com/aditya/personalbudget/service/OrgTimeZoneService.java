package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.TextStyle;
import java.util.List;
import java.util.Locale;

/**
 * The organization's time zone (Settings, Organization): the zone its times are recorded and shown in. Times saved
 * before a change keep the clock time they were recorded with.
 */
@Service
public class OrgTimeZoneService {

    private final OrganizationRepository organizations;

    public OrgTimeZoneService(OrganizationRepository organizations) {
        this.organizations = organizations;
        OrgClock.install(id -> organizations.findById(id).map(Organization::getTimeZone).orElse(null));
    }

    /**
     * @param timeZone   the zone set for the organization (null: none, the server's applies)
     * @param effective  the zone in use
     * @param serverTimeZone the server's own zone
     * @param now        the time now in the zone in use
     */
    public record TimeZoneView(String timeZone, String effective, String effectiveLabel, String serverTimeZone, LocalDateTime now) {
    }

    public record TimeZoneRequest(String timeZone) {
    }

    /** A zone to choose from: its id, and a label with the current UTC offset ("(UTC+05:30) Asia/Kolkata"). */
    public record ZoneOption(String id, String label) {
    }

    public TimeZoneView view() {
        Organization org = organizations.findById(UserContext.tenantId()).orElseThrow();
        ZoneId zone = OrgClock.zone();
        return new TimeZoneView(org.getTimeZone(), zone.getId(), label(zone), ZoneId.systemDefault().getId(), OrgClock.now());
    }

    @Transactional
    public TimeZoneView save(TimeZoneRequest request) {
        String id = request.timeZone() == null || request.timeZone().isBlank() ? null : request.timeZone().trim();
        if (id != null) {
            try {
                id = ZoneId.of(id).getId();
            } catch (DateTimeException e) {
                throw new BusinessException("Unknown time zone: " + request.timeZone());
            }
        }
        Organization org = organizations.findById(UserContext.tenantId()).orElseThrow();
        org.setTimeZone(id);
        organizations.save(org);
        OrgClock.forget();
        return view();
    }

    /** Every region zone ("Asia/Kolkata", "Europe/London" ...), by UTC offset now, then name. */
    public List<ZoneOption> zones() {
        return ZoneId.getAvailableZoneIds().stream()
                .filter(id -> id.contains("/") && !id.startsWith("Etc/") && !id.startsWith("SystemV/"))
                .map(ZoneId::of)
                .sorted((a, b) -> {
                    int byOffset = Integer.compare(offsetSeconds(a), offsetSeconds(b));
                    return byOffset != 0 ? byOffset : a.getId().compareTo(b.getId());
                })
                .map(z -> new ZoneOption(z.getId(), label(z)))
                .toList();
    }

    private static int offsetSeconds(ZoneId zone) {
        return ZonedDateTime.now(zone).getOffset().getTotalSeconds();
    }

    static String label(ZoneId zone) {
        String offset = ZonedDateTime.now(zone).getOffset().getId();
        return "(UTC" + ("Z".equals(offset) ? "+00:00" : offset) + ") " + zone.getId().replace('_', ' ')
                + " · " + zone.getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }
}
