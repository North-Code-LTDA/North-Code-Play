package com.northcode.play;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;
import com.getcapacitor.plugin.util.ICapacitorHttpUrlConnection;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Plugin Android dedicado para cache persistente de imagens e capas (Etapa 1).
 *
 * Responsabilidades:
 * - Armazena imagens persistentes em diretório privado dedicado (<filesDir>/nc_image_cache/),
 *   completamente separado do diretório temporário de catálogos (<cacheDir>/nc_catalog_transfers/).
 * - Persiste um índice local (index_v1.json) com chave determinística SHA-256, nome do arquivo,
 *   tamanho em bytes, Content-Type, ETag, Last-Modified, Cache-Control, createdAt e lastAccessedAt.
 * - Valida estritamente código HTTP (200 ou 304 com entrada prévia válida), Content-Type de imagem,
 *   assinatura binária (magic bytes JPEG/PNG/WebP/GIF/BMP/ICO/AVIF/SVG), tamanho > 0, integridade
 *   com Content-Length quando informado e ausência de Cache-Control: no-store.
 * - Deduplica downloads concorrentes para a mesma chave/URL.
 * - Aplica orçamento configurável em bytes (padrão 120 MB) com remoção LRU das entradas menos
 *   recentemente acessadas.
 * - Suporta limpeza completa no logout com incremento de época (sessionEpoch) para impedir que
 *   downloads em andamento iniciados antes do logout gravem arquivos tardiamente.
 */
@CapacitorPlugin(name = "ImageDiskCache")
public class ImageDiskCachePlugin extends Plugin {

    public static final String IMAGE_CACHE_SUBDIR_NAME = "nc_image_cache";
    private static final String INDEX_FILE_NAME = "index_v1.json";
    private static final int STREAM_BUFFER_SIZE = 16384;
    private static final long DEFAULT_MAX_BYTES = 120L * 1024L * 1024L;
    private static final long MIN_MAX_BYTES = 1024L;
    private static final Pattern SAFE_IMAGE_FILE_NAME_PATTERN = Pattern.compile(
        "^img_[a-f0-9]{64}\\.(?:jpg|png|webp|gif|bmp|ico|avif|svg|bin)$"
    );

    private final ExecutorService downloadExecutor = Executors.newFixedThreadPool(4);
    private final Object indexLock = new Object();
    private final ConcurrentHashMap<String, CacheEntry> entriesByKey = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, InFlightDownload> inFlightByKey = new ConcurrentHashMap<>();
    private final AtomicLong configuredMaxBytes = new AtomicLong(DEFAULT_MAX_BYTES);
    private final AtomicLong totalStoredBytes = new AtomicLong(0L);
    private final AtomicLong evictedEntriesCount = new AtomicLong(0L);
    private final AtomicLong corruptedRecoveriesCount = new AtomicLong(0L);
    private final AtomicInteger sessionEpoch = new AtomicInteger(1);
    private volatile boolean initialized = false;

    private static final class CacheEntry {
        final String key;
        final String fileName;
        final long byteSize;
        final String contentType;
        final String etag;
        final String lastModified;
        final String cacheControl;
        final long createdAtMs;
        volatile long lastAccessedAtMs;

        CacheEntry(
            String key,
            String fileName,
            long byteSize,
            String contentType,
            String etag,
            String lastModified,
            String cacheControl,
            long createdAtMs,
            long lastAccessedAtMs
        ) {
            this.key = key;
            this.fileName = fileName;
            this.byteSize = byteSize;
            this.contentType = contentType != null ? contentType : "image/jpeg";
            this.etag = etag;
            this.lastModified = lastModified;
            this.cacheControl = cacheControl;
            this.createdAtMs = createdAtMs;
            this.lastAccessedAtMs = lastAccessedAtMs;
        }

        JSONObject toJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("key", key);
                obj.put("fileName", fileName);
                obj.put("byteSize", byteSize);
                obj.put("contentType", contentType);
                obj.put("etag", etag != null ? etag : JSONObject.NULL);
                obj.put("lastModified", lastModified != null ? lastModified : JSONObject.NULL);
                obj.put("cacheControl", cacheControl != null ? cacheControl : JSONObject.NULL);
                obj.put("createdAtMs", createdAtMs);
                obj.put("lastAccessedAtMs", lastAccessedAtMs);
            } catch (Exception ignored) {
                // Ignora falha de serialização individual
            }
            return obj;
        }
    }

    private static final class InFlightDownload {
        final String key;
        final int epochAtStart;
        final List<PluginCall> waitingCalls = new ArrayList<>();
        volatile CapacitorHttpUrlConnection connection;
        volatile boolean finished = false;

        InFlightDownload(String key, int epochAtStart, PluginCall initialCall) {
            this.key = key;
            this.epochAtStart = epochAtStart;
            this.waitingCalls.add(initialCall);
        }

        void abortConnection() {
            CapacitorHttpUrlConnection conn = this.connection;
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                    // Ignora falha ao desconectar
                }
            }
        }
    }

    @Override
    public void load() {
        super.load();
        downloadExecutor.execute(this::ensureInitialized);
    }

    @Override
    protected void handleOnDestroy() {
        downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private File getPersistentImageCacheDir() throws IOException {
        if (getContext() == null || getContext().getFilesDir() == null) {
            throw new IOException("Diretório privado de arquivos indisponível.");
        }
        File baseFilesDir = getContext().getFilesDir().getCanonicalFile();
        File dir = new File(baseFilesDir, IMAGE_CACHE_SUBDIR_NAME);
        if (!dir.exists() && !dir.mkdirs() && !dir.exists()) {
            throw new IOException("Não foi possível criar o diretório de cache persistente de imagens.");
        }
        File canonicalDir = dir.getCanonicalFile();
        File parent = canonicalDir.getParentFile();
        if (
            parent == null ||
            !parent.equals(baseFilesDir) ||
            !IMAGE_CACHE_SUBDIR_NAME.equals(canonicalDir.getName())
        ) {
            throw new IOException("Diretório de cache de imagens fora de getFilesDir().");
        }
        return canonicalDir;
    }

    private File resolveValidatedImageFile(String fileName) throws IOException {
        if (fileName == null || !SAFE_IMAGE_FILE_NAME_PATTERN.matcher(fileName).matches()) {
            return null;
        }
        File cacheDir = getPersistentImageCacheDir();
        File candidate = new File(cacheDir, fileName).getCanonicalFile();
        File parent = candidate.getParentFile();
        if (parent == null || !parent.equals(cacheDir) || !fileName.equals(candidate.getName())) {
            return null;
        }
        return candidate;
    }

    private static void safeDeleteFile(File file) {
        if (file == null) return;
        try {
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (Exception ignored) {
            // Ignora erro de remoção
        }
    }

    private static String computeSha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            }
            return sb.toString();
        } catch (Exception ex) {
            return Integer.toHexString(input.hashCode());
        }
    }

    private static String extensionForContentType(String contentType, byte[] headerBytes, int headerLen) {
        if (headerLen >= 3 && (headerBytes[0] & 0xFF) == 0xFF && (headerBytes[1] & 0xFF) == 0xD8 && (headerBytes[2] & 0xFF) == 0xFF) {
            return "jpg";
        }
        if (
            headerLen >= 8 &&
            (headerBytes[0] & 0xFF) == 0x89 &&
            headerBytes[1] == 0x50 &&
            headerBytes[2] == 0x4E &&
            headerBytes[3] == 0x47
        ) {
            return "png";
        }
        if (
            headerLen >= 12 &&
            headerBytes[0] == 'R' &&
            headerBytes[1] == 'I' &&
            headerBytes[2] == 'F' &&
            headerBytes[3] == 'F' &&
            headerBytes[8] == 'W' &&
            headerBytes[9] == 'E' &&
            headerBytes[10] == 'B' &&
            headerBytes[11] == 'P'
        ) {
            return "webp";
        }
        if (
            headerLen >= 6 &&
            headerBytes[0] == 'G' &&
            headerBytes[1] == 'I' &&
            headerBytes[2] == 'F' &&
            headerBytes[3] == '8'
        ) {
            return "gif";
        }
        String lower = contentType != null ? contentType.toLowerCase(Locale.ROOT) : "";
        if (lower.contains("jpeg") || lower.contains("jpg")) return "jpg";
        if (lower.contains("png")) return "png";
        if (lower.contains("webp")) return "webp";
        if (lower.contains("gif")) return "gif";
        if (lower.contains("avif")) return "avif";
        if (lower.contains("bmp")) return "bmp";
        if (lower.contains("svg")) return "svg";
        if (lower.contains("icon") || lower.contains("ico")) return "ico";
        return "jpg";
    }

    /**
     * Verifica se os primeiros bytes correspondem a um formato real de imagem (magic bytes)
     * e rejeita páginas HTML, JSON de erro ou texto plano disfarçados de HTTP 200.
     */
    private static boolean hasValidImageSignature(byte[] header, int len, String contentType) {
        if (header == null || len < 4) {
            return false;
        }
        // Rejeitar explicitamente textos de erro JSON ou HTML
        int offset = 0;
        while (
            offset < len &&
            (header[offset] == ' ' ||
                header[offset] == '\t' ||
                header[offset] == '\r' ||
                header[offset] == '\n')
        ) {
            offset++;
        }
        if (offset < len) {
            byte firstNonWs = header[offset];
            if (firstNonWs == '{' || firstNonWs == '[') {
                return false;
            }
            if (firstNonWs == '<') {
                String snippet = new String(
                    header,
                    offset,
                    Math.min(len - offset, 64),
                    StandardCharsets.UTF_8
                ).toLowerCase(Locale.ROOT);
                String lowerCt = contentType != null ? contentType.toLowerCase(Locale.ROOT) : "";
                if (lowerCt.contains("svg") && snippet.contains("<svg")) {
                    return true;
                }
                return false;
            }
        }

        // JPEG: FF D8 FF
        if ((header[0] & 0xFF) == 0xFF && (header[1] & 0xFF) == 0xD8 && (header[2] & 0xFF) == 0xFF) {
            return true;
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
            len >= 8 &&
            (header[0] & 0xFF) == 0x89 &&
            header[1] == 0x50 &&
            header[2] == 0x4E &&
            header[3] == 0x47 &&
            header[4] == 0x0D &&
            header[5] == 0x0A &&
            header[6] == 0x1A &&
            header[7] == 0x0A
        ) {
            return true;
        }
        // WebP: RIFF....WEBP
        if (
            len >= 12 &&
            header[0] == 'R' &&
            header[1] == 'I' &&
            header[2] == 'F' &&
            header[3] == 'F' &&
            header[8] == 'W' &&
            header[9] == 'E' &&
            header[10] == 'B' &&
            header[11] == 'P'
        ) {
            return true;
        }
        // GIF: GIF87a ou GIF89a
        if (
            len >= 6 &&
            header[0] == 'G' &&
            header[1] == 'I' &&
            header[2] == 'F' &&
            header[3] == '8' &&
            (header[4] == '7' || header[4] == '9') &&
            header[5] == 'a'
        ) {
            return true;
        }
        // BMP: BM
        if (header[0] == 'B' && header[1] == 'M') {
            return true;
        }
        // ICO: 00 00 01 00
        if (header[0] == 0x00 && header[1] == 0x00 && header[2] == 0x01 && header[3] == 0x00) {
            return true;
        }
        // AVIF / HEIC ISO BMFF: ....ftyp
        if (
            len >= 12 &&
            header[4] == 'f' &&
            header[5] == 't' &&
            header[6] == 'y' &&
            header[7] == 'p'
        ) {
            return true;
        }
        return false;
    }

    private static boolean isAllowedImageContentType(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            // Alguns provedores IPTV retornam application/octet-stream ou omitem Content-Type;
            // nesses casos a validação binária por magic bytes decide se é imagem real.
            return true;
        }
        String lower = contentType.toLowerCase(Locale.ROOT).trim();
        if (
            lower.startsWith("text/html") ||
            lower.startsWith("text/plain") ||
            lower.startsWith("application/json") ||
            lower.startsWith("application/xml") ||
            lower.startsWith("text/xml")
        ) {
            return false;
        }
        return (
            lower.startsWith("image/") ||
            lower.startsWith("application/octet-stream") ||
            lower.startsWith("binary/octet-stream")
        );
    }

    private static boolean hasNoStoreDirective(String cacheControl) {
        if (cacheControl == null || cacheControl.isEmpty()) {
            return false;
        }
        return cacheControl.toLowerCase(Locale.ROOT).contains("no-store");
    }

    private void ensureInitialized() {
        if (initialized) return;
        synchronized (indexLock) {
            if (initialized) return;
            try {
                File cacheDir = getPersistentImageCacheDir();
                File indexFile = new File(cacheDir, INDEX_FILE_NAME);
                entriesByKey.clear();
                long sumBytes = 0L;

                if (indexFile.exists() && indexFile.isFile()) {
                    try {
                        byte[] raw = readAllBytesBounded(indexFile, 8 * 1024 * 1024);
                        if (raw != null && raw.length > 0) {
                            JSONObject root = new JSONObject(new String(raw, StandardCharsets.UTF_8));
                            JSONArray arr = root.optJSONArray("entries");
                            if (arr != null) {
                                for (int i = 0; i < arr.length(); i++) {
                                    JSONObject item = arr.optJSONObject(i);
                                    if (item == null) continue;
                                    String key = item.optString("key", "");
                                    String fileName = item.optString("fileName", "");
                                    long byteSize = item.optLong("byteSize", 0L);
                                    if (
                                        key.length() != 64 ||
                                        !SAFE_IMAGE_FILE_NAME_PATTERN.matcher(fileName).matches() ||
                                        byteSize <= 0L
                                    ) {
                                        continue;
                                    }
                                    File imgFile = resolveValidatedImageFile(fileName);
                                    if (
                                        imgFile == null ||
                                        !imgFile.exists() ||
                                        !imgFile.isFile() ||
                                        imgFile.length() <= 0L
                                    ) {
                                        safeDeleteFile(imgFile);
                                        continue;
                                    }
                                    long actualLength = imgFile.length();
                                    CacheEntry entry = new CacheEntry(
                                        key,
                                        fileName,
                                        actualLength,
                                        item.optString("contentType", "image/jpeg"),
                                        item.isNull("etag") ? null : item.optString("etag", null),
                                        item.isNull("lastModified")
                                            ? null
                                            : item.optString("lastModified", null),
                                        item.isNull("cacheControl")
                                            ? null
                                            : item.optString("cacheControl", null),
                                        item.optLong("createdAtMs", System.currentTimeMillis()),
                                        item.optLong("lastAccessedAtMs", System.currentTimeMillis())
                                    );
                                    entriesByKey.put(key, entry);
                                    sumBytes += actualLength;
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        // Se o índice estiver corrompido, reconstrói limpando órfãos
                        entriesByKey.clear();
                        sumBytes = 0L;
                    }
                }

                // Remover arquivos órfãos ou temporários (.tmp) não referenciados pelo índice
                File[] allFiles = cacheDir.listFiles();
                if (allFiles != null) {
                    Set<String> validNames = ConcurrentHashMap.newKeySet();
                    for (CacheEntry e : entriesByKey.values()) {
                        validNames.add(e.fileName);
                    }
                    for (File f : allFiles) {
                        if (f == null || !f.isFile()) continue;
                        String name = f.getName();
                        if (INDEX_FILE_NAME.equals(name)) continue;
                        if (!validNames.contains(name)) {
                            safeDeleteFile(f);
                        }
                    }
                }

                totalStoredBytes.set(sumBytes);
                enforceBudgetLocked();
                persistIndexLocked();
            } catch (Exception ignored) {
                // Ignora falha de inicialização; tentará novamente sob demanda
            } finally {
                initialized = true;
            }
        }
    }

    private static byte[] readAllBytesBounded(File file, int maxBytes) throws IOException {
        long len = file.length();
        if (len <= 0L || len > maxBytes) {
            return null;
        }
        byte[] data = new byte[(int) len];
        try (FileInputStream fis = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int r = fis.read(data, offset, data.length - offset);
                if (r == -1) break;
                offset += r;
            }
            if (offset != data.length) {
                return null;
            }
        }
        return data;
    }

    private void persistIndexLocked() {
        try {
            File cacheDir = getPersistentImageCacheDir();
            File tempIndex = new File(cacheDir, INDEX_FILE_NAME + ".tmp");
            File finalIndex = new File(cacheDir, INDEX_FILE_NAME);

            JSONObject root = new JSONObject();
            root.put("version", 1);
            root.put("maxBytes", configuredMaxBytes.get());
            root.put("totalBytes", totalStoredBytes.get());
            JSONArray arr = new JSONArray();
            for (CacheEntry entry : entriesByKey.values()) {
                arr.put(entry.toJson());
            }
            root.put("entries", arr);

            byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream fos = new FileOutputStream(tempIndex, false)) {
                fos.write(bytes);
                fos.flush();
            }
            safeDeleteFile(finalIndex);
            //noinspection ResultOfMethodCallIgnored
            tempIndex.renameTo(finalIndex);
        } catch (Exception ignored) {
            // Ignora falha ao persistir índice
        }
    }

    private void enforceBudgetLocked() {
        long maxBytes = Math.max(MIN_MAX_BYTES, configuredMaxBytes.get());
        if (totalStoredBytes.get() <= maxBytes && entriesByKey.size() <= 1) {
            return;
        }
        if (totalStoredBytes.get() <= maxBytes) {
            return;
        }

        List<CacheEntry> sorted = new ArrayList<>(entriesByKey.values());
        Collections.sort(
            sorted,
            new Comparator<CacheEntry>() {
                @Override
                public int compare(CacheEntry a, CacheEntry b) {
                    return Long.compare(a.lastAccessedAtMs, b.lastAccessedAtMs);
                }
            }
        );

        for (CacheEntry candidate : sorted) {
            if (totalStoredBytes.get() <= maxBytes) {
                break;
            }
            CacheEntry removed = entriesByKey.remove(candidate.key);
            if (removed != null) {
                totalStoredBytes.addAndGet(-removed.byteSize);
                if (totalStoredBytes.get() < 0L) {
                    totalStoredBytes.set(0L);
                }
                evictedEntriesCount.incrementAndGet();
                try {
                    File f = resolveValidatedImageFile(removed.fileName);
                    safeDeleteFile(f);
                } catch (Exception ignored) {
                    // Ignora falha de remoção individual
                }
            }
        }
    }

    private static String getHeaderIgnoreCase(ICapacitorHttpUrlConnection connection, String targetName) {
        String direct = connection.getHeaderField(targetName);
        if (direct != null) return direct;
        String lower = connection.getHeaderField(targetName.toLowerCase(Locale.ROOT));
        if (lower != null) return lower;
        if (connection instanceof CapacitorHttpUrlConnection) {
            Map<String, List<String>> fields = ((CapacitorHttpUrlConnection) connection).getHeaderFields();
            if (fields != null) {
                for (Map.Entry<String, List<String>> entry : fields.entrySet()) {
                    if (entry.getKey() != null && targetName.equalsIgnoreCase(entry.getKey())) {
                        List<String> values = entry.getValue();
                        if (values != null && !values.isEmpty()) {
                            return values.get(0);
                        }
                    }
                }
            }
        }
        return null;
    }

    private static Long parseContentLength(ICapacitorHttpUrlConnection connection) {
        String raw = getHeaderIgnoreCase(connection, "Content-Length");
        if (raw == null) return null;
        try {
            long parsed = Long.parseLong(raw.trim());
            return parsed >= 0L ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    @PluginMethod
    public void getHydratedIndex(final PluginCall call) {
        downloadExecutor.execute(() -> {
            ensureInitialized();
            try {
                File cacheDir = getPersistentImageCacheDir();
                JSObject ret = new JSObject();
                ret.put("cacheDir", cacheDir.getPath());
                ret.put("maxBytes", configuredMaxBytes.get());
                ret.put("totalBytes", totalStoredBytes.get());
                ret.put("evictedEntriesCount", evictedEntriesCount.get());
                ret.put("corruptedRecoveriesCount", corruptedRecoveriesCount.get());

                JSArray entriesArray = new JSArray();
                synchronized (indexLock) {
                    for (CacheEntry entry : entriesByKey.values()) {
                        File imgFile = resolveValidatedImageFile(entry.fileName);
                        if (imgFile != null && imgFile.exists() && imgFile.length() > 0L) {
                            JSObject item = new JSObject();
                            item.put("key", entry.key);
                            item.put("fileName", entry.fileName);
                            item.put("filePath", imgFile.getPath());
                            item.put("byteSize", entry.byteSize);
                            item.put("contentType", entry.contentType);
                            item.put("lastAccessedAtMs", entry.lastAccessedAtMs);
                            entriesArray.put(item);
                        }
                    }
                }
                ret.put("entries", entriesArray);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("Falha ao hidratar índice do cache de imagens.", "HYDRATE_ERROR");
            }
        });
    }

    @PluginMethod
    public void configureCache(final PluginCall call) {
        Long maxBytesOpt = call.getLong("maxBytes");
        if (maxBytesOpt != null && maxBytesOpt >= MIN_MAX_BYTES) {
            configuredMaxBytes.set(maxBytesOpt);
        }
        downloadExecutor.execute(() -> {
            ensureInitialized();
            synchronized (indexLock) {
                enforceBudgetLocked();
                persistIndexLocked();
            }
            JSObject ret = new JSObject();
            ret.put("maxBytes", configuredMaxBytes.get());
            ret.put("totalBytes", totalStoredBytes.get());
            ret.put("storedEntriesCount", entriesByKey.size());
            ret.put("evictedEntriesCount", evictedEntriesCount.get());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void invalidateImage(final PluginCall call) {
        final String urlString = call.getString("url", "");
        final String rawKey = call.getString("key", "");
        final boolean isCorruptionRecovery = Boolean.TRUE.equals(
            call.getBoolean("corruptedRecovery", false)
        );
        final String key = (rawKey != null && rawKey.length() == 64)
            ? rawKey
            : computeSha256Hex(urlString != null ? urlString.trim() : "");

        downloadExecutor.execute(() -> {
            ensureInitialized();
            boolean removed = false;
            synchronized (indexLock) {
                CacheEntry existing = entriesByKey.remove(key);
                if (existing != null) {
                    removed = true;
                    totalStoredBytes.addAndGet(-existing.byteSize);
                    if (totalStoredBytes.get() < 0L) {
                        totalStoredBytes.set(0L);
                    }
                    try {
                        File f = resolveValidatedImageFile(existing.fileName);
                        safeDeleteFile(f);
                    } catch (Exception ignored) {
                        // Ignora falha ao deletar arquivo inválido
                    }
                    persistIndexLocked();
                }
            }
            if (isCorruptionRecovery) {
                corruptedRecoveriesCount.incrementAndGet();
            }
            JSObject ret = new JSObject();
            ret.put("removed", removed);
            ret.put("totalBytes", totalStoredBytes.get());
            ret.put("corruptedRecoveriesCount", corruptedRecoveriesCount.get());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void clearAll(final PluginCall call) {
        // Incrementa a época imediatamente para impedir que downloads em andamento gravem após logout
        final int newEpoch = sessionEpoch.incrementAndGet();

        for (InFlightDownload inflight : inFlightByKey.values()) {
            inflight.abortConnection();
        }

        downloadExecutor.execute(() -> {
            ensureInitialized();
            synchronized (indexLock) {
                entriesByKey.clear();
                totalStoredBytes.set(0L);
                try {
                    File cacheDir = getPersistentImageCacheDir();
                    File[] files = cacheDir.listFiles();
                    if (files != null) {
                        for (File f : files) {
                            safeDeleteFile(f);
                        }
                    }
                } catch (Exception ignored) {
                    // Ignora falha ao limpar pasta
                }
                persistIndexLocked();
            }
            JSObject ret = new JSObject();
            ret.put("cleared", true);
            ret.put("epoch", newEpoch);
            ret.put("totalBytes", 0L);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void acquireImage(final PluginCall call) {
        final String urlString = call.getString("url", "");
        final boolean forceRefresh = Boolean.TRUE.equals(call.getBoolean("forceRefresh", false));
        final boolean revalidate = Boolean.TRUE.equals(call.getBoolean("revalidate", false));
        final Integer connectTimeout = call.getInt("connectTimeout", 10000);
        final Integer readTimeout = call.getInt("readTimeout", 15000);

        if (urlString == null || urlString.trim().isEmpty()) {
            call.reject("URL de imagem inválida.", "INVALID_URL");
            return;
        }

        final String trimmedUrl = urlString.trim();
        final String key = computeSha256Hex(trimmedUrl);
        final int requestEpoch = sessionEpoch.get();

        downloadExecutor.execute(() -> {
            ensureInitialized();

            if (sessionEpoch.get() != requestEpoch) {
                call.reject("Sessão encerrada durante solicitação de imagem.", "SESSION_CLEARED");
                return;
            }

            CacheEntry cachedEntry = entriesByKey.get(key);
            if (cachedEntry != null && !forceRefresh && !revalidate) {
                try {
                    File imgFile = resolveValidatedImageFile(cachedEntry.fileName);
                    if (imgFile != null && imgFile.exists() && imgFile.isFile() && imgFile.length() > 0L) {
                        cachedEntry.lastAccessedAtMs = System.currentTimeMillis();
                        File cacheDir = getPersistentImageCacheDir();
                        JSObject hitResult = new JSObject();
                        hitResult.put("hit", true);
                        hitResult.put("revalidated304", false);
                        hitResult.put("bypassedNoStore", false);
                        hitResult.put("key", key);
                        hitResult.put("fileName", cachedEntry.fileName);
                        hitResult.put("filePath", imgFile.getPath());
                        hitResult.put("cacheDir", cacheDir.getPath());
                        hitResult.put("byteSize", cachedEntry.byteSize);
                        hitResult.put("contentType", cachedEntry.contentType);
                        hitResult.put("totalBytes", totalStoredBytes.get());
                        hitResult.put("storedEntriesCount", entriesByKey.size());
                        hitResult.put("evictedEntriesCount", evictedEntriesCount.get());
                        call.resolve(hitResult);
                        return;
                    } else {
                        synchronized (indexLock) {
                            CacheEntry stale = entriesByKey.remove(key);
                            if (stale != null) {
                                totalStoredBytes.addAndGet(-stale.byteSize);
                                if (totalStoredBytes.get() < 0L) totalStoredBytes.set(0L);
                                safeDeleteFile(imgFile);
                                persistIndexLocked();
                            }
                        }
                    }
                } catch (Exception ignored) {
                    // Prossegue para download sob demanda
                }
            }

            // Coalescência / deduplicação nativa de requisições simultâneas para a mesma chave
            InFlightDownload inflightToRun = null;
            synchronized (inFlightByKey) {
                InFlightDownload existingInflight = inFlightByKey.get(key);
                if (existingInflight != null && !existingInflight.finished && existingInflight.epochAtStart == requestEpoch) {
                    existingInflight.waitingCalls.add(call);
                    return;
                }
                inflightToRun = new InFlightDownload(key, requestEpoch, call);
                inFlightByKey.put(key, inflightToRun);
            }

            executeNetworkImageFetch(
                inflightToRun,
                trimmedUrl,
                key,
                cachedEntry,
                forceRefresh,
                connectTimeout,
                readTimeout
            );
        });
    }

    private void executeNetworkImageFetch(
        final InFlightDownload inflight,
        final String urlString,
        final String key,
        final CacheEntry previousEntry,
        final boolean forceRefresh,
        final Integer connectTimeout,
        final Integer readTimeout
    ) {
        CapacitorHttpUrlConnection connection = null;
        File tempFile = null;

        try {
            if (sessionEpoch.get() != inflight.epochAtStart) {
                rejectAllWaiting(inflight, "Sessão encerrada antes do download.", "SESSION_CLEARED");
                return;
            }

            URL url = new URL(urlString);
            String protocol = url.getProtocol() != null
                ? url.getProtocol().toLowerCase(Locale.ROOT)
                : "";
            if (!"http".equals(protocol) && !"https".equals(protocol)) {
                rejectAllWaiting(inflight, "Protocolo não suportado para imagem.", "INVALID_PROTOCOL");
                return;
            }

            Bridge currentBridge = getBridge();
            JSObject headers = new JSObject();
            headers.put("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");

            if (!forceRefresh && previousEntry != null) {
                if (previousEntry.etag != null && !previousEntry.etag.isEmpty()) {
                    headers.put("If-None-Match", previousEntry.etag);
                }
                if (previousEntry.lastModified != null && !previousEntry.lastModified.isEmpty()) {
                    headers.put("If-Modified-Since", previousEntry.lastModified);
                }
            }

            if (currentBridge != null && currentBridge.getConfig() != null) {
                String overriddenUa = currentBridge.getConfig().getOverriddenUserAgentString();
                if (overriddenUa != null) {
                    headers.put("User-Agent", overriddenUa);
                }
            }

            HttpRequestHandler.HttpURLConnectionBuilder builder =
                new HttpRequestHandler.HttpURLConnectionBuilder()
                    .setUrl(url)
                    .setMethod("GET")
                    .setHeaders(headers)
                    .setConnectTimeout(connectTimeout)
                    .setReadTimeout(readTimeout)
                    .setDisableRedirects(false)
                    .openConnection();

            connection = builder.build();
            inflight.connection = connection;

            if (
                currentBridge != null &&
                !Boolean.TRUE.equals(HttpRequestHandler.isDomainExcludedFromSSL(currentBridge, url))
            ) {
                connection.setSSLSocketFactory(currentBridge);
            }

            connection.connect();
            int statusCode = connection.getResponseCode();

            if (sessionEpoch.get() != inflight.epochAtStart) {
                rejectAllWaiting(inflight, "Sessão encerrada durante conexão.", "SESSION_CLEARED");
                return;
            }

            // Revalidação condicional HTTP 304 Not Modified com entrada local íntegra
            if (statusCode == 304 && previousEntry != null) {
                File prevFile = resolveValidatedImageFile(previousEntry.fileName);
                if (prevFile != null && prevFile.exists() && prevFile.length() > 0L) {
                    previousEntry.lastAccessedAtMs = System.currentTimeMillis();
                    synchronized (indexLock) {
                        persistIndexLocked();
                    }
                    File cacheDir = getPersistentImageCacheDir();
                    JSObject res304 = new JSObject();
                    res304.put("hit", true);
                    res304.put("revalidated304", true);
                    res304.put("bypassedNoStore", false);
                    res304.put("key", key);
                    res304.put("fileName", previousEntry.fileName);
                    res304.put("filePath", prevFile.getPath());
                    res304.put("cacheDir", cacheDir.getPath());
                    res304.put("byteSize", previousEntry.byteSize);
                    res304.put("contentType", previousEntry.contentType);
                    res304.put("totalBytes", totalStoredBytes.get());
                    res304.put("storedEntriesCount", entriesByKey.size());
                    res304.put("evictedEntriesCount", evictedEntriesCount.get());
                    resolveAllWaiting(inflight, res304);
                    return;
                }
            }

            // Rejeitar qualquer status diferente de HTTP 200 OK (inclusive 206, 4xx, 5xx)
            if (statusCode != 200) {
                rejectAllWaiting(
                    inflight,
                    "Provedor de imagem retornou HTTP " + statusCode,
                    "HTTP_" + statusCode
                );
                return;
            }

            String contentType = getHeaderIgnoreCase(connection, "Content-Type");
            String cacheControl = getHeaderIgnoreCase(connection, "Cache-Control");
            String etag = getHeaderIgnoreCase(connection, "ETag");
            String lastModified = getHeaderIgnoreCase(connection, "Last-Modified");
            Long declaredLength = parseContentLength(connection);

            if (!isAllowedImageContentType(contentType)) {
                rejectAllWaiting(
                    inflight,
                    "Content-Type inválido para imagem: " + contentType,
                    "INVALID_CONTENT_TYPE"
                );
                return;
            }

            // Se o servidor exigir Cache-Control: no-store, não persistir em disco
            if (hasNoStoreDirective(cacheControl)) {
                JSObject bypassRes = new JSObject();
                bypassRes.put("hit", false);
                bypassRes.put("revalidated304", false);
                bypassRes.put("bypassedNoStore", true);
                bypassRes.put("key", key);
                bypassRes.put("fileName", JSONObject.NULL);
                bypassRes.put("filePath", JSONObject.NULL);
                bypassRes.put("byteSize", 0L);
                bypassRes.put("contentType", contentType != null ? contentType : "image/jpeg");
                bypassRes.put("totalBytes", totalStoredBytes.get());
                bypassRes.put("storedEntriesCount", entriesByKey.size());
                bypassRes.put("evictedEntriesCount", evictedEntriesCount.get());
                resolveAllWaiting(inflight, bypassRes);
                return;
            }

            File cacheDir = getPersistentImageCacheDir();
            tempFile = new File(
                cacheDir,
                "tmp_" + key + "_" + Thread.currentThread().getId() + ".tmp"
            );

            byte[] headerBytes = new byte[64];
            int headerLen = 0;
            long bytesWritten = 0L;

            try (
                InputStream is = connection.getInputStream();
                FileOutputStream fos = new FileOutputStream(tempFile, false)
            ) {
                byte[] buffer = new byte[STREAM_BUFFER_SIZE];
                int readCount;
                while ((readCount = is.read(buffer)) != -1) {
                    if (sessionEpoch.get() != inflight.epochAtStart || Thread.currentThread().isInterrupted()) {
                        throw new IOException("SESSION_ABORTED");
                    }
                    if (headerLen < headerBytes.length) {
                        int toCopy = Math.min(readCount, headerBytes.length - headerLen);
                        System.arraycopy(buffer, 0, headerBytes, headerLen, toCopy);
                        headerLen += toCopy;
                    }
                    fos.write(buffer, 0, readCount);
                    bytesWritten += readCount;
                }
                fos.flush();
            }

            if (sessionEpoch.get() != inflight.epochAtStart) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(inflight, "Sessão encerrada antes de finalizar imagem.", "SESSION_CLEARED");
                return;
            }

            if (bytesWritten <= 0L) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(inflight, "Corpo da imagem vazio (0 bytes).", "EMPTY_BODY");
                return;
            }

            if (declaredLength != null && declaredLength > 0L && bytesWritten != declaredLength) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(
                    inflight,
                    "Download truncado: esperado " + declaredLength + " bytes, recebido " + bytesWritten,
                    "TRUNCATED_BODY"
                );
                return;
            }

            if (!hasValidImageSignature(headerBytes, headerLen, contentType)) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(
                    inflight,
                    "Assinatura binária inválida (resposta não é uma imagem íntegra).",
                    "INVALID_IMAGE_SIGNATURE"
                );
                return;
            }

            String ext = extensionForContentType(contentType, headerBytes, headerLen);
            String finalFileName = "img_" + key + "." + ext;
            File finalFile = resolveValidatedImageFile(finalFileName);
            if (finalFile == null) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(inflight, "Nome de arquivo final inválido.", "INVALID_FILE_NAME");
                return;
            }

            synchronized (indexLock) {
                if (sessionEpoch.get() != inflight.epochAtStart) {
                    safeDeleteFile(tempFile);
                    rejectAllWaiting(inflight, "Sessão encerrada antes da gravação no índice.", "SESSION_CLEARED");
                    return;
                }

                CacheEntry oldEntry = entriesByKey.remove(key);
                if (oldEntry != null) {
                    totalStoredBytes.addAndGet(-oldEntry.byteSize);
                    if (totalStoredBytes.get() < 0L) totalStoredBytes.set(0L);
                    if (!finalFileName.equals(oldEntry.fileName)) {
                        File oldFile = resolveValidatedImageFile(oldEntry.fileName);
                        safeDeleteFile(oldFile);
                    }
                }

                safeDeleteFile(finalFile);
                if (!tempFile.renameTo(finalFile)) {
                    safeDeleteFile(tempFile);
                    rejectAllWaiting(inflight, "Falha ao mover imagem para o cache persistente.", "RENAME_ERROR");
                    return;
                }

                long nowMs = System.currentTimeMillis();
                CacheEntry newEntry = new CacheEntry(
                    key,
                    finalFileName,
                    bytesWritten,
                    contentType != null ? contentType : ("image/" + ext),
                    etag,
                    lastModified,
                    cacheControl,
                    nowMs,
                    nowMs
                );
                entriesByKey.put(key, newEntry);
                totalStoredBytes.addAndGet(bytesWritten);
                enforceBudgetLocked();
                persistIndexLocked();
            }

            File verifiedFinal = resolveValidatedImageFile(finalFileName);
            if (verifiedFinal == null || !verifiedFinal.exists()) {
                rejectAllWaiting(
                    inflight,
                    "Imagem excedeu o orçamento total configurado do cache.",
                    "BUDGET_EXCEEDED"
                );
                return;
            }

            JSObject successRes = new JSObject();
            successRes.put("hit", false);
            successRes.put("revalidated304", false);
            successRes.put("bypassedNoStore", false);
            successRes.put("key", key);
            successRes.put("fileName", finalFileName);
            successRes.put("filePath", verifiedFinal.getPath());
            successRes.put("cacheDir", cacheDir.getPath());
            successRes.put("byteSize", bytesWritten);
            successRes.put("contentType", contentType != null ? contentType : ("image/" + ext));
            successRes.put("totalBytes", totalStoredBytes.get());
            successRes.put("storedEntriesCount", entriesByKey.size());
            successRes.put("evictedEntriesCount", evictedEntriesCount.get());
            resolveAllWaiting(inflight, successRes);
        } catch (SocketTimeoutException timeoutEx) {
            safeDeleteFile(tempFile);
            rejectAllWaiting(inflight, "Tempo limite esgotado ao baixar imagem.", "TIMEOUT");
        } catch (Exception ex) {
            safeDeleteFile(tempFile);
            rejectAllWaiting(
                inflight,
                "Falha de rede ao baixar imagem: " + (ex.getMessage() != null ? ex.getMessage() : "erro"),
                "NETWORK_ERROR"
            );
        } finally {
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                    // Ignora erro ao desconectar
                }
            }
            safeDeleteFile(tempFile);
        }
    }

    private void resolveAllWaiting(InFlightDownload inflight, JSObject payload) {
        List<PluginCall> calls;
        synchronized (inFlightByKey) {
            inflight.finished = true;
            inFlightByKey.remove(inflight.key, inflight);
            calls = new ArrayList<>(inflight.waitingCalls);
            inflight.waitingCalls.clear();
        }
        for (int i = 0; i < calls.size(); i++) {
            PluginCall c = calls.get(i);
            try {
                JSObject copy = new JSObject(payload.toString());
                copy.put("deduplicated", i > 0);
                c.resolve(copy);
            } catch (Exception ex) {
                c.resolve(payload);
            }
        }
    }

    private void rejectAllWaiting(InFlightDownload inflight, String message, String code) {
        List<PluginCall> calls;
        synchronized (inFlightByKey) {
            inflight.finished = true;
            inFlightByKey.remove(inflight.key, inflight);
            calls = new ArrayList<>(inflight.waitingCalls);
            inflight.waitingCalls.clear();
        }
        for (PluginCall c : calls) {
            try {
                c.reject(message, code);
            } catch (Exception ignored) {
                // Ignora erro ao rejeitar chamada individual
            }
        }
    }
}
