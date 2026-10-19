package com.aditya.personalbudget.storage;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Reads the standard JPA annotations of an entity class and turns them into a table definition.
 * <ul>
 *   <li>{@code @Table(name, uniqueConstraints)} - file name and composite unique keys</li>
 *   <li>{@code @Id} - primary key (auto-assigned when null)</li>
 *   <li>{@code @Column(name, nullable, length, unique)} - column constraints</li>
 *   <li>{@code @References} - foreign keys</li>
 *   <li>{@code @Version} - optimistic locking: a save based on an older version is rejected</li>
 *   <li>{@code @Transient} or the Java {@code transient} keyword - not persisted</li>
 * </ul>
 */
public final class EntityMetadata<T> {

    private final Class<T> type;
    private final String tableName;
    private final List<ColumnMeta> columns;
    private final ColumnMeta idColumn;
    private final List<List<ColumnMeta>> uniqueKeys;
    private final Constructor<T> constructor;

    private EntityMetadata(Class<T> type) {
        if (!type.isAnnotationPresent(Entity.class)) {
            throw new IllegalArgumentException(type.getName() + " is not annotated with @Entity");
        }
        this.type = type;
        this.tableName = resolveTableName(type);
        this.columns = resolveColumns(type);
        this.idColumn = columns.stream().filter(ColumnMeta::id).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(type.getName() + " has no @Id field"));
        this.uniqueKeys = resolveUniqueKeys(type, columns);
        this.constructor = resolveConstructor(type);
    }

    public static <T> EntityMetadata<T> of(Class<T> type) {
        return new EntityMetadata<>(type);
    }

    public Class<T> type() {
        return type;
    }

    public String tableName() {
        return tableName;
    }

    public List<ColumnMeta> columns() {
        return columns;
    }

    public ColumnMeta idColumn() {
        return idColumn;
    }

    /** Every unique key: single-column ({@code @Column(unique=true)}) and composite ({@code @Table}). */
    public List<List<ColumnMeta>> uniqueKeys() {
        return uniqueKeys;
    }

    /** The {@code @Version} column, when the entity has one. */
    public Optional<ColumnMeta> versionColumn() {
        return columns.stream().filter(ColumnMeta::version).findFirst();
    }

    public List<ColumnMeta> foreignKeys() {
        return columns.stream().filter(c -> c.references() != null).toList();
    }

    public T newInstance() {
        try {
            return constructor.newInstance();
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot instantiate " + type.getName(), e);
        }
    }

    /** Field-by-field copy, so callers never hold a reference to the cached row. */
    public T copy(T source) {
        T target = newInstance();
        for (ColumnMeta column : columns) {
            column.write(target, column.read(source));
        }
        return target;
    }

    // ------------------------------------------------------------------ resolution helpers

    private static String resolveTableName(Class<?> type) {
        Table table = type.getAnnotation(Table.class);
        if (table != null && !table.name().isBlank()) {
            return table.name();
        }
        return type.getSimpleName().toLowerCase();
    }

    private static List<ColumnMeta> resolveColumns(Class<?> type) {
        // Superclass fields first so the column order in the file is stable and natural.
        List<Class<?>> hierarchy = new ArrayList<>();
        for (Class<?> c = type; c != null && c != Object.class; c = c.getSuperclass()) {
            hierarchy.addFirst(c);
        }
        List<ColumnMeta> result = new ArrayList<>();
        for (Class<?> c : hierarchy) {
            for (Field field : c.getDeclaredFields()) {
                int mod = field.getModifiers();
                if (Modifier.isStatic(mod) || Modifier.isTransient(mod) || field.isAnnotationPresent(Transient.class)) {
                    continue;
                }
                field.setAccessible(true);
                result.add(toColumn(field));
            }
        }
        return List.copyOf(result);
    }

    private static ColumnMeta toColumn(Field field) {
        Column column = field.getAnnotation(Column.class);
        boolean isId = field.isAnnotationPresent(Id.class);
        String name = (column != null && !column.name().isBlank()) ? column.name() : field.getName();
        boolean nullable = !isId && (column == null || column.nullable());
        int length = column != null ? column.length() : 255;
        boolean unique = column != null && column.unique();
        References ref = field.getAnnotation(References.class);
        return new ColumnMeta(field, name, isId, nullable, length, unique, ref == null ? null : ref.value(),
                field.isAnnotationPresent(Version.class));
    }

    private static List<List<ColumnMeta>> resolveUniqueKeys(Class<?> type, List<ColumnMeta> columns) {
        Map<String, ColumnMeta> byName = columns.stream()
                .collect(Collectors.toMap(ColumnMeta::name, Function.identity()));
        List<List<ColumnMeta>> keys = new ArrayList<>();
        columns.stream().filter(ColumnMeta::unique).forEach(c -> keys.add(List.of(c)));

        Table table = type.getAnnotation(Table.class);
        if (table != null) {
            for (UniqueConstraint uc : table.uniqueConstraints()) {
                List<ColumnMeta> key = Arrays.stream(uc.columnNames()).map(n -> {
                    ColumnMeta c = byName.get(n);
                    if (c == null) {
                        throw new IllegalArgumentException(
                                "Unique constraint on unknown column " + n + " in " + type.getName());
                    }
                    return c;
                }).toList();
                keys.add(key);
            }
        }
        return List.copyOf(keys);
    }

    private static <T> Constructor<T> resolveConstructor(Class<T> type) {
        try {
            Constructor<T> ctor = type.getDeclaredConstructor();
            ctor.setAccessible(true);
            return ctor;
        } catch (NoSuchMethodException e) {
            throw new IllegalArgumentException(type.getName() + " needs a no-argument constructor", e);
        }
    }
}
