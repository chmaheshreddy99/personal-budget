package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.OrgClock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.module.SimpleModule;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * Every date-time the API sends is on the signed-in organization's clock, and every one it receives is taken as on
 * that clock: recorded times are kept in the storage zone ({@link OrgClock}) and turned into the organization's zone
 * here, at the edge, so the whole UI (and the Android app) shows the organization's local times without converting
 * anything itself. Dates (no time of day) are left as they are. Outside a signed-in request nothing is converted.
 */
@Configuration
public class OrgTimeJson {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    /** Registered with the application's JSON mapper (Spring Boot picks up every JacksonModule bean). */
    @Bean
    public SimpleModule organizationTimeModule() {
        SimpleModule module = new SimpleModule("organization-time");
        module.addSerializer(LocalDateTime.class, new ValueSerializer<>() {
            @Override
            public void serialize(LocalDateTime value, JsonGenerator gen, SerializationContext ctxt) {
                gen.writeString(ISO.format(OrgClock.toOrg(value)));
            }
        });
        module.addDeserializer(LocalDateTime.class, new ValueDeserializer<>() {
            @Override
            public LocalDateTime deserialize(JsonParser p, DeserializationContext ctxt) {
                if (p.currentToken() != JsonToken.VALUE_STRING) {
                    return (LocalDateTime) ctxt.handleUnexpectedToken(LocalDateTime.class, p);
                }
                String text = p.getString().trim();
                if (text.isEmpty()) {
                    return null;
                }
                try {
                    // "2026-10-23T14:05", with seconds or fractions; a trailing Z or offset is not expected
                    return OrgClock.fromOrg(LocalDateTime.parse(text.endsWith("Z") ? text.substring(0, text.length() - 1) : text));
                } catch (DateTimeParseException e) {
                    return (LocalDateTime) ctxt.handleWeirdStringValue(LocalDateTime.class, text, "not a date and time: " + e.getMessage());
                }
            }
        });
        return module;
    }
}
