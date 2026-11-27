package com.northcode.play;

import android.util.Base64;
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
import java.io.ByteArrayOutputStream;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
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
 * - Usa relógio lógico monotônico (logicalAccessClock) e sincronização em lote de chaves acessadas
 *   (recentAccessedKeys / touchEntries) para garantir ordem determinística de descarte LRU mesmo
 *   quando múltiplos acessos ocorrem no mesmo milissegundo e sem exigir chamadas nativas por cartão.
 * - Valida estritamente código HTTP (200 ou 304 com entrada prévia válida), Content-Type de imagem,
 *   assinatura binária (magic bytes JPEG/PNG/WebP/GIF/BMP/ICO/AVIF/SVG), tamanho > 0, integridade
 *   com Content-Length quando informado e diretivas HTTP (Cache-Control: no-store, no-cache, max-age).
 * - Para respostas com Cache-Control: no-store, retorna os bytes validados como Data URI em memória
 *   sem gravar arquivo em disco e evitando um segundo GET pelo elemento <img>.
 * - Suporta limpeza completa e imediata no logout com incremento de época (sessionEpoch) e bloqueio
 *   sincronizado para impedir reutilização por nova sessão ou gravação tardia de downloads antigos.
 */
@CapacitorPlugin(name = "ImageDiskCache")
public class ImageDiskCachePlugin extends Plugin {

    public static final String IMAGE_CACHE_SUBDIR_NAME = "nc_image_cache";
    private static final String INDEX_FILE_NAME = "index_v1.json";
    private static final int STREAM_BUFFER_SIZE = 16384;
    private static final int HEADER_INSPECTION_BYTES = 1024;
    private static final int MAX_NO_STORE_INLINE_BYTES = 5 * 1024 * 1024;
    private static final long DEFAULT_MAX_BYTES = 120L * 1024L * 1024L;
    private static final long MIN_MAX_BYTES = 1024L;
    private static final Pattern SAFE_IMAGE_FILE_NAME_PATTERN = Pattern.compile(
        "^img_[a-f0-9]{64}\\.(?:jpg|png|webp|gif|bmp|ico|avif)$"
    );
    private static final Pattern MAX_AGE_PATTERN = Pattern.compile(
        "max-age\\s*=\\s*(\\d+)",
        Pattern.CASE_INSENSITIVE
    );

    private final ExecutorService downloadExecutor = Executors.newFixedThreadPool(4);
    private final Object indexLock = new Object();
    private final ConcurrentHashMap<String, CacheEntry> entriesByKey = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, InFlightDownload> inFlightByKey = new ConcurrentHashMap<>();
    private final AtomicLong configuredMaxBytes = new AtomicLong(DEFAULT_MAX_BYTES);
    private final AtomicLong totalStoredBytes = new AtomicLong(0L);
    private final AtomicLong evictedEntriesCount = new AtomicLong(0L);
    private final AtomicLong corruptedRecoveriesCount = new AtomicLong(0L);
    private final AtomicLong logicalAccessClock = new AtomicLong(System.currentTimeMillis());
    private final AtomicInteger sessionEpoch = new AtomicInteger(1);
    private volatile boolean initialized = false;

    private long nextLogicalAccessStamp() {
        long now = System.currentTimeMillis();
        while (true) {
            long prev = logicalAccessClock.get();
            long next = Math.max(now, prev + 1L);
            if (logicalAccessClock.compareAndSet(prev, next)) {
                return next;
            }
        }
    }

    private static final class CacheEntry {
        final String key;
        final String fileName;
        final long byteSize;
        final String contentType;
        volatile String etag;
        volatile String lastModified;
        volatile String cacheControl;
        volatile long createdAtMs;
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
            this.contentType = normalizedMimeForFileName(fileName, contentType);
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

    /**
     * Resultado centralizado da identificação real de formato de imagem por inspeção
     * limitada de cabeçalho (magic bytes / ISO BMFF ftyp / prólogo XML de SVG).
     */
    static final class IdentifiedImageFormat {
        final String format;
        final String extension;
        final String mimeType;
        final boolean persistentEligible;
        final boolean directFallbackEligible;
        final String bypassReason;

        private IdentifiedImageFormat(
            String format,
            String extension,
            String mimeType,
            boolean persistentEligible,
            boolean directFallbackEligible,
            String bypassReason
        ) {
            this.format = format;
            this.extension = extension;
            this.mimeType = mimeType;
            this.persistentEligible = persistentEligible;
            this.directFallbackEligible = directFallbackEligible;
            this.bypassReason = bypassReason;
        }

        static IdentifiedImageFormat persistent(String format, String extension, String mimeType) {
            return new IdentifiedImageFormat(format, extension, mimeType, true, false, null);
        }

        static IdentifiedImageFormat directOnly(String format, String mimeType, String bypassReason) {
            return new IdentifiedImageFormat(format, null, mimeType, false, true, bypassReason);
        }

        static IdentifiedImageFormat invalid() {
            return new IdentifiedImageFormat("INVALID", null, null, false, false, null);
        }
    }

    private static String normalizedMimeForFileName(String fileName, String fallbackContentType) {
        if (fileName != null) {
            String lowerName = fileName.toLowerCase(Locale.ROOT);
            if (lowerName.endsWith(".jpg")) return "image/jpeg";
            if (lowerName.endsWith(".png")) return "image/png";
            if (lowerName.endsWith(".webp")) return "image/webp";
            if (lowerName.endsWith(".gif")) return "image/gif";
            if (lowerName.endsWith(".bmp")) return "image/bmp";
            if (lowerName.endsWith(".ico")) return "image/x-icon";
            if (lowerName.endsWith(".avif")) return "image/avif";
        }
        if (fallbackContentType != null && !fallbackContentType.trim().isEmpty()) {
            return fallbackContentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
        }
        return "image/jpeg";
    }

    private static boolean isLegacySvgEntry(String fileName, String contentType) {
        if (fileName != null) {
            String lowerName = fileName.toLowerCase(Locale.ROOT);
            if (lowerName.endsWith(".svg") || lowerName.endsWith(".svgz")) {
                return true;
            }
        }
        if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("svg")) {
            return true;
        }
        return false;
    }

    private static boolean isValidBmpDibHeaderSize(int dibSize) {
        return (
            dibSize == 12 ||
            dibSize == 16 ||
            dibSize == 40 ||
            dibSize == 52 ||
            dibSize == 56 ||
            dibSize == 64 ||
            dibSize == 108 ||
            dibSize == 124
        );
    }

    private static String asciiFourCC(byte[] bytes, int offset) {
        return new String(bytes, offset, 4, StandardCharsets.US_ASCII);
    }

    private static boolean isAvifBrand(String brand) {
        return "avif".equals(brand) || "avis".equals(brand);
    }

    private static boolean isHeifImageBrand(String brand) {
        return (
            "heic".equals(brand) ||
            "heix".equals(brand) ||
            "hevc".equals(brand) ||
            "hevx".equals(brand) ||
            "heim".equals(brand) ||
            "heis".equals(brand) ||
            "hevm".equals(brand) ||
            "hevs".equals(brand)
        );
    }

    private static boolean isVideoContainerBrand(String brand) {
        return (
            "isom".equals(brand) ||
            "iso2".equals(brand) ||
            "mp41".equals(brand) ||
            "mp42".equals(brand) ||
            "avc1".equals(brand) ||
            "M4V ".equals(brand) ||
            "M4A ".equals(brand) ||
            "qt  ".equals(brand) ||
            "3gp4".equals(brand) ||
            "3gp5".equals(brand) ||
            "dash".equals(brand)
        );
    }

    /**
     * Classifica estritamente a box `ftyp` ISO BMFF no cabeçalho limitado:
     * - Aceita AVIF apenas quando `major_brand` é `avif`/`avis`, ou quando `major_brand` é
     *   `mif1`/`msf1` com `compatible_brands` contendo `avif`/`avis`.
     * - Mantém HEIF/HEIC fora do cache persistente, permitindo fallback direto de renderização.
     * - Rejeita MP4 e outros contêineres de vídeo/desconhecidos.
     */
    private static IdentifiedImageFormat classifyIsoBmffHeader(byte[] header, int len) {
        if (len < 16) {
            return IdentifiedImageFormat.invalid();
        }
        long boxSize =
            (((long) (header[0] & 0xFF)) << 24) |
            (((long) (header[1] & 0xFF)) << 16) |
            (((long) (header[2] & 0xFF)) << 8) |
            ((long) (header[3] & 0xFF));
        if (boxSize < 16L || boxSize > 4096L || (boxSize % 4L) != 0L) {
            return IdentifiedImageFormat.invalid();
        }

        String majorBrand = asciiFourCC(header, 8);
        if (isAvifBrand(majorBrand)) {
            return IdentifiedImageFormat.persistent("AVIF", "avif", "image/avif");
        }

        int inspectLimit = (int) Math.min((long) len, boxSize);
        boolean hasAvifCompat = false;
        boolean hasHeifCompat = false;
        boolean hasVideoCompat = false;

        for (int pos = 16; pos + 4 <= inspectLimit; pos += 4) {
            String compat = asciiFourCC(header, pos);
            if (isAvifBrand(compat)) {
                hasAvifCompat = true;
            } else if (isHeifImageBrand(compat)) {
                hasHeifCompat = true;
            } else if (isVideoContainerBrand(compat)) {
                hasVideoCompat = true;
            }
        }

        boolean isMiafContainer = "mif1".equals(majorBrand) || "msf1".equals(majorBrand);
        if (isMiafContainer && hasAvifCompat) {
            return IdentifiedImageFormat.persistent("AVIF", "avif", "image/avif");
        }
        if (isHeifImageBrand(majorBrand) || (isMiafContainer && hasHeifCompat && !hasVideoCompat)) {
            return IdentifiedImageFormat.directOnly("HEIF", "image/heif", "unrecognized_format");
        }
        return IdentifiedImageFormat.invalid();
    }

    /**
     * Inspeciona um cabeçalho textual/XML limitado para distinguir SVG válido
     * (incluindo UTF-8 BOM, `<?xml ...?>`, comentários XML e `<!DOCTYPE svg ...>`)
     * de HTML, JSON ou mensagens XML de erro.
     */
    private static boolean isValidSvgHeader(byte[] header, int startOffset, int len) {
        if (header == null || startOffset >= len) {
            return false;
        }
        int snippetLen = Math.min(len - startOffset, HEADER_INSPECTION_BYTES);
        String text = new String(header, startOffset, snippetLen, StandardCharsets.UTF_8);
        String lower = text.toLowerCase(Locale.ROOT);
        int pos = 0;
        int n = lower.length();

        for (int step = 0; step < 16 && pos < n; step++) {
            while (pos < n && Character.isWhitespace(lower.charAt(pos))) {
                pos++;
            }
            if (pos >= n || lower.charAt(pos) != '<') {
                return false;
            }
            if (lower.startsWith("<?", pos)) {
                int endPi = lower.indexOf("?>", pos + 2);
                if (endPi < 0) return false;
                pos = endPi + 2;
                continue;
            }
            if (lower.startsWith("<!--", pos)) {
                int endComment = lower.indexOf("-->", pos + 4);
                if (endComment < 0) return false;
                pos = endComment + 3;
                continue;
            }
            if (lower.startsWith("<!doctype", pos)) {
                int endDoctype = lower.indexOf('>', pos + 9);
                if (endDoctype < 0) return false;
                String doctypeBody = lower.substring(pos + 9, endDoctype).trim();
                if (!doctypeBody.startsWith("svg")) {
                    return false;
                }
                pos = endDoctype + 1;
                continue;
            }
            if (lower.startsWith("<svg", pos)) {
                int nextIdx = pos + 4;
                if (nextIdx >= n) {
                    return true;
                }
                char nextChar = lower.charAt(nextIdx);
                return (
                    Character.isWhitespace(nextChar) ||
                    nextChar == '>' ||
                    nextChar == '/'
                );
            }
            return false;
        }
        return false;
    }

    /**
     * Classificador centralizado de formato de imagem a partir de buffer limitado de cabeçalho.
     * Prioriza assinaturas binárias reais sobre o `Content-Type` informado pelo provedor:
     * - Imagens raster reconhecidas (JPEG, PNG/APNG, WebP, GIF, BMP, ICO, AVIF) são elegíveis ao
     *   cache persistente mesmo com Content-Type ausente, genérico ou divergente.
     * - SVG e formatos de imagem menos comuns (TIFF, HEIF/HEIC, JPEG XL) não entram no cache
     *   persistente, mas permitem fallback direto seguro pelo elemento `<img>`.
     * - HTML, JSON, MP4, texto plano ou bytes desconhecidos são rejeitados mesmo se o servidor
     *   enviar `Content-Type: image/*`.
     */
    static IdentifiedImageFormat identifyImageFormat(byte[] header, int len, String contentType) {
        if (header == null || len <= 0) {
            return IdentifiedImageFormat.invalid();
        }

        // 1. JPEG: FF D8 FF
        if (
            len >= 3 &&
            (header[0] & 0xFF) == 0xFF &&
            (header[1] & 0xFF) == 0xD8 &&
            (header[2] & 0xFF) == 0xFF
        ) {
            return IdentifiedImageFormat.persistent("JPEG", "jpg", "image/jpeg");
        }

        // 2. PNG / APNG: 89 50 4E 47 0D 0A 1A 0A (preserva bytes intactos)
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
            return IdentifiedImageFormat.persistent("PNG", "png", "image/png");
        }

        // 3. WebP (estático ou animado): RIFF....WEBP
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
            return IdentifiedImageFormat.persistent("WEBP", "webp", "image/webp");
        }

        // 4. GIF (estático ou animado): GIF87a ou GIF89a
        if (
            len >= 6 &&
            header[0] == 'G' &&
            header[1] == 'I' &&
            header[2] == 'F' &&
            header[3] == '8' &&
            (header[4] == '7' || header[4] == '9') &&
            header[5] == 'a'
        ) {
            return IdentifiedImageFormat.persistent("GIF", "gif", "image/gif");
        }

        // 5. BMP: 'B','M' + cabeçalho mínimo válido (bytes reservados 6..9 zerados + DIB size válido)
        if (
            len >= 14 &&
            header[0] == 'B' &&
            header[1] == 'M' &&
            header[6] == 0 &&
            header[7] == 0 &&
            header[8] == 0 &&
            header[9] == 0
        ) {
            if (len < 18) {
                return IdentifiedImageFormat.persistent("BMP", "bmp", "image/bmp");
            }
            int dibSize =
                (header[14] & 0xFF) |
                ((header[15] & 0xFF) << 8) |
                ((header[16] & 0xFF) << 16) |
                ((header[17] & 0xFF) << 24);
            if (isValidBmpDibHeaderSize(dibSize)) {
                return IdentifiedImageFormat.persistent("BMP", "bmp", "image/bmp");
            }
        }

        // 6. ICO: 00 00 01 00 + contagem de ícones > 0
        if (
            len >= 6 &&
            header[0] == 0x00 &&
            header[1] == 0x00 &&
            header[2] == 0x01 &&
            header[3] == 0x00 &&
            (header[4] != 0 || header[5] != 0)
        ) {
            return IdentifiedImageFormat.persistent("ICO", "ico", "image/x-icon");
        }

        // 7. ISO BMFF (AVIF elegível; HEIF/HEIC fallback direto; MP4 rejeitado)
        if (
            len >= 16 &&
            header[4] == 'f' &&
            header[5] == 't' &&
            header[6] == 'y' &&
            header[7] == 'p'
        ) {
            return classifyIsoBmffHeader(header, len);
        }

        // 8. Formatos menos comuns: TIFF e JPEG XL (nunca persistidos, fallback direto permitido)
        if (
            len >= 4 &&
            ((header[0] == 'I' && header[1] == 'I' && header[2] == 0x2A && header[3] == 0x00) ||
                (header[0] == 'M' && header[1] == 'M' && header[2] == 0x00 && header[3] == 0x2A))
        ) {
            return IdentifiedImageFormat.directOnly("TIFF", "image/tiff", "unrecognized_format");
        }
        if (
            (len >= 2 && (header[0] & 0xFF) == 0xFF && (header[1] & 0xFF) == 0x0A) ||
            (len >= 12 &&
                header[0] == 0x00 &&
                header[1] == 0x00 &&
                header[2] == 0x00 &&
                header[3] == 0x0C &&
                header[4] == 'J' &&
                header[5] == 'X' &&
                header[6] == 'L' &&
                header[7] == ' ' &&
                header[8] == 0x0D &&
                header[9] == 0x0A &&
                (header[10] & 0xFF) == 0x87 &&
                header[11] == 0x0A)
        ) {
            return IdentifiedImageFormat.directOnly("JXL", "image/jxl", "unrecognized_format");
        }

        // 9. Inspeção textual/XML para SVG válido (nunca persistido no cache em disco)
        int offset = 0;
        if (
            len >= 3 &&
            (header[0] & 0xFF) == 0xEF &&
            (header[1] & 0xFF) == 0xBB &&
            (header[2] & 0xFF) == 0xBF
        ) {
            offset = 3;
        }
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
                return IdentifiedImageFormat.invalid();
            }
            if (firstNonWs == '<' && isValidSvgHeader(header, offset, len)) {
                return IdentifiedImageFormat.directOnly("SVG", "image/svg+xml", "svg_direct");
            }
        }

        return IdentifiedImageFormat.invalid();
    }

    /**
     * Rejeita antecipadamente apenas Content-Types explicitamente incompatíveis com imagens
     * (HTML, JSON, JavaScript, XHTML). Content-Type ausente, genérico ou divergente é permitido
     * nesta etapa para ser decidido estritamente pela assinatura binária/SVG real.
     */
    private static boolean isExplicitlyRejectedContentType(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            return false;
        }
        String lower = contentType.split(";")[0].toLowerCase(Locale.ROOT).trim();
        return (
            lower.equals("text/html") ||
            lower.equals("application/json") ||
            lower.equals("text/javascript") ||
            lower.equals("application/javascript") ||
            lower.equals("application/xhtml+xml")
        );
    }

    private static boolean hasNoStoreDirective(String cacheControl) {
        if (cacheControl == null || cacheControl.isEmpty()) {
            return false;
        }
        return cacheControl.toLowerCase(Locale.ROOT).contains("no-store");
    }

    /**
     * Avalia se os metadados HTTP (Cache-Control: no-cache, max-age=N) exigem revalidação
     * condicional junto ao servidor antes de reutilizar o arquivo local.
     */
    private static boolean needsHttpRevalidation(CacheEntry entry, long nowMs) {
        if (entry == null) return false;
        String cc = entry.cacheControl;
        if (cc == null || cc.isEmpty()) {
            return false;
        }
        String lower = cc.toLowerCase(Locale.ROOT);
        if (lower.contains("no-cache")) {
            return true;
        }
        Matcher m = MAX_AGE_PATTERN.matcher(lower);
        if (m.find()) {
            try {
                long maxAgeSec = Long.parseLong(m.group(1));
                if (maxAgeSec <= 0L) {
                    return true;
                }
                long ageMs = Math.max(0L, nowMs - entry.createdAtMs);
                if (ageMs >= maxAgeSec * 1000L) {
                    return true;
                }
            } catch (NumberFormatException ignored) {
                // Ignora max-age malformado
            }
        }
        return false;
    }

    private void applyRecentAccessedKeysLocked(JSArray recentKeys) {
        if (recentKeys == null || recentKeys.length() == 0) {
            return;
        }
        for (int i = 0; i < recentKeys.length(); i++) {
            String k = recentKeys.optString(i, "");
            if (k != null && k.length() == 64) {
                CacheEntry entry = entriesByKey.get(k);
                if (entry != null) {
                    entry.lastAccessedAtMs = nextLogicalAccessStamp();
                }
            }
        }
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
                long maxSeenAccessMs = System.currentTimeMillis();

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
                                    String rawContentType = item.optString("contentType", "");
                                    long byteSize = item.optLong("byteSize", 0L);
                                    if (
                                        key.length() != 64 ||
                                        isLegacySvgEntry(fileName, rawContentType) ||
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
                                    long lastAcc = item.optLong("lastAccessedAtMs", System.currentTimeMillis());
                                    if (lastAcc > maxSeenAccessMs) {
                                        maxSeenAccessMs = lastAcc;
                                    }
                                    CacheEntry entry = new CacheEntry(
                                        key,
                                        fileName,
                                        actualLength,
                                        normalizedMimeForFileName(fileName, rawContentType),
                                        item.isNull("etag") ? null : item.optString("etag", null),
                                        item.isNull("lastModified")
                                            ? null
                                            : item.optString("lastModified", null),
                                        item.isNull("cacheControl")
                                            ? null
                                            : item.optString("cacheControl", null),
                                        item.optLong("createdAtMs", System.currentTimeMillis()),
                                        lastAcc
                                    );
                                    entriesByKey.put(key, entry);
                                    sumBytes += actualLength;
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        entriesByKey.clear();
                        sumBytes = 0L;
                    }
                }

                logicalAccessClock.set(Math.max(logicalAccessClock.get(), maxSeenAccessMs));

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

    private List<String> enforceBudgetLocked() {
        List<String> evictedKeys = new ArrayList<>();
        long maxBytes = Math.max(MIN_MAX_BYTES, configuredMaxBytes.get());
        if (totalStoredBytes.get() <= maxBytes) {
            return evictedKeys;
        }

        List<CacheEntry> sorted = new ArrayList<>(entriesByKey.values());
        Collections.sort(
            sorted,
            new Comparator<CacheEntry>() {
                @Override
                public int compare(CacheEntry a, CacheEntry b) {
                    int cmp = Long.compare(a.lastAccessedAtMs, b.lastAccessedAtMs);
                    if (cmp != 0) return cmp;
                    int createdCmp = Long.compare(a.createdAtMs, b.createdAtMs);
                    if (createdCmp != 0) return createdCmp;
                    return a.key.compareTo(b.key);
                }
            }
        );

        for (CacheEntry candidate : sorted) {
            if (totalStoredBytes.get() <= maxBytes) {
                break;
            }
            CacheEntry removed = entriesByKey.remove(candidate.key);
            if (removed != null) {
                evictedKeys.add(removed.key);
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
        return evictedKeys;
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
                long nowMs = System.currentTimeMillis();
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
                            item.put("etag", entry.etag != null ? entry.etag : JSONObject.NULL);
                            item.put("lastModified", entry.lastModified != null ? entry.lastModified : JSONObject.NULL);
                            item.put("cacheControl", entry.cacheControl != null ? entry.cacheControl : JSONObject.NULL);
                            item.put("createdAtMs", entry.createdAtMs);
                            item.put("lastAccessedAtMs", entry.lastAccessedAtMs);
                            item.put("needsRevalidation", needsHttpRevalidation(entry, nowMs));
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
    public void touchEntries(final PluginCall call) {
        final JSArray keys = call.getArray("keys", new JSArray());
        downloadExecutor.execute(() -> {
            ensureInitialized();
            synchronized (indexLock) {
                applyRecentAccessedKeysLocked(keys);
                persistIndexLocked();
            }
            JSObject ret = new JSObject();
            ret.put("touched", keys != null ? keys.length() : 0);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void configureCache(final PluginCall call) {
        final Long maxBytesOpt = call.getLong("maxBytes");
        final JSArray recentKeys = call.getArray("recentAccessedKeys", new JSArray());
        if (maxBytesOpt != null && maxBytesOpt >= MIN_MAX_BYTES) {
            configuredMaxBytes.set(maxBytesOpt);
        }
        downloadExecutor.execute(() -> {
            ensureInitialized();
            List<String> evictedKeys;
            synchronized (indexLock) {
                applyRecentAccessedKeysLocked(recentKeys);
                evictedKeys = enforceBudgetLocked();
                persistIndexLocked();
            }
            JSObject ret = new JSObject();
            ret.put("maxBytes", configuredMaxBytes.get());
            ret.put("totalBytes", totalStoredBytes.get());
            ret.put("storedEntriesCount", entriesByKey.size());
            ret.put("evictedEntriesCount", evictedEntriesCount.get());
            JSArray evictedArr = new JSArray();
            for (String k : evictedKeys) {
                evictedArr.put(k);
            }
            ret.put("evictedKeys", evictedArr);
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
        // Incrementa a época e limpa imediatamente a tabela em memória sob lock para impedir
        // que qualquer nova sessão reutilize entradas antigas enquanto a limpeza do disco ocorre
        final int newEpoch = sessionEpoch.incrementAndGet();

        synchronized (indexLock) {
            entriesByKey.clear();
            totalStoredBytes.set(0L);
        }

        List<InFlightDownload> toCancel = new ArrayList<>();
        synchronized (inFlightByKey) {
            toCancel.addAll(inFlightByKey.values());
            inFlightByKey.clear();
        }
        for (InFlightDownload inflight : toCancel) {
            inflight.abortConnection();
            rejectAllWaiting(inflight, "Cache limpo no logout.", "SESSION_CLEARED");
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
        final JSArray recentKeys = call.getArray("recentAccessedKeys", new JSArray());

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

            synchronized (indexLock) {
                applyRecentAccessedKeysLocked(recentKeys);
            }

            CacheEntry cachedEntry = entriesByKey.get(key);
            if (cachedEntry != null && isLegacySvgEntry(cachedEntry.fileName, cachedEntry.contentType)) {
                synchronized (indexLock) {
                    CacheEntry removedLegacy = entriesByKey.remove(key);
                    if (removedLegacy != null) {
                        totalStoredBytes.addAndGet(-removedLegacy.byteSize);
                        if (totalStoredBytes.get() < 0L) totalStoredBytes.set(0L);
                        try {
                            File cacheDir = getPersistentImageCacheDir();
                            safeDeleteFile(new File(cacheDir, removedLegacy.fileName));
                        } catch (Exception ignored) {
                            // Ignora falha ao remover SVG legado
                        }
                        persistIndexLocked();
                    }
                }
                cachedEntry = null;
            }
            boolean expiredOrMustRevalidate =
                cachedEntry != null && needsHttpRevalidation(cachedEntry, System.currentTimeMillis());

            if (cachedEntry != null && !forceRefresh && !revalidate && !expiredOrMustRevalidate) {
                try {
                    File imgFile = resolveValidatedImageFile(cachedEntry.fileName);
                    if (imgFile != null && imgFile.exists() && imgFile.isFile() && imgFile.length() > 0L) {
                        cachedEntry.lastAccessedAtMs = nextLogicalAccessStamp();
                        File cacheDir = getPersistentImageCacheDir();
                        JSObject hitResult = new JSObject();
                        hitResult.put("hit", true);
                        hitResult.put("revalidated304", false);
                        hitResult.put("bypassedNoStore", false);
                        hitResult.put("bypassedCache", false);
                        hitResult.put("key", key);
                        hitResult.put("fileName", cachedEntry.fileName);
                        hitResult.put("filePath", imgFile.getPath());
                        hitResult.put("cacheDir", cacheDir.getPath());
                        hitResult.put("byteSize", cachedEntry.byteSize);
                        hitResult.put("contentType", cachedEntry.contentType);
                        hitResult.put("etag", cachedEntry.etag != null ? cachedEntry.etag : JSONObject.NULL);
                        hitResult.put("lastModified", cachedEntry.lastModified != null ? cachedEntry.lastModified : JSONObject.NULL);
                        hitResult.put("cacheControl", cachedEntry.cacheControl != null ? cachedEntry.cacheControl : JSONObject.NULL);
                        hitResult.put("createdAtMs", cachedEntry.createdAtMs);
                        hitResult.put("lastAccessedAtMs", cachedEntry.lastAccessedAtMs);
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
                        cachedEntry = null;
                    }
                } catch (Exception ignored) {
                    // Prossegue para download sob demanda
                }
            }

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
                    String newCacheControl = getHeaderIgnoreCase(connection, "Cache-Control");
                    String newEtag = getHeaderIgnoreCase(connection, "ETag");
                    String newLastMod = getHeaderIgnoreCase(connection, "Last-Modified");
                    long nowMs = System.currentTimeMillis();
                    long nextAcc = nextLogicalAccessStamp();
                    synchronized (indexLock) {
                        if (newCacheControl != null && !newCacheControl.isEmpty()) {
                            previousEntry.cacheControl = newCacheControl;
                        }
                        if (newEtag != null && !newEtag.isEmpty()) {
                            previousEntry.etag = newEtag;
                        }
                        if (newLastMod != null && !newLastMod.isEmpty()) {
                            previousEntry.lastModified = newLastMod;
                        }
                        previousEntry.createdAtMs = nowMs;
                        previousEntry.lastAccessedAtMs = nextAcc;
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
                    res304.put("etag", previousEntry.etag != null ? previousEntry.etag : JSONObject.NULL);
                    res304.put("lastModified", previousEntry.lastModified != null ? previousEntry.lastModified : JSONObject.NULL);
                    res304.put("cacheControl", previousEntry.cacheControl != null ? previousEntry.cacheControl : JSONObject.NULL);
                    res304.put("createdAtMs", previousEntry.createdAtMs);
                    res304.put("lastAccessedAtMs", previousEntry.lastAccessedAtMs);
                    res304.put("totalBytes", totalStoredBytes.get());
                    res304.put("storedEntriesCount", entriesByKey.size());
                    res304.put("evictedEntriesCount", evictedEntriesCount.get());
                    resolveAllWaiting(inflight, res304);
                    return;
                }
            }

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

            if (isExplicitlyRejectedContentType(contentType)) {
                rejectAllWaiting(
                    inflight,
                    "Content-Type inválido para imagem: " + contentType,
                    "INVALID_CONTENT_TYPE"
                );
                return;
            }

            // Se o servidor exigir Cache-Control: no-store, ler em memória e retornar Data URI
            // com MIME real identificado (apenas formatos raster) sem persistir arquivo em disco
            if (hasNoStoreDirective(cacheControl)) {
                ByteArrayOutputStream memOut = new ByteArrayOutputStream();
                byte[] headerBytes = new byte[HEADER_INSPECTION_BYTES];
                int headerLen = 0;
                long bytesReadTotal = 0L;
                boolean exceededInlineCap = false;

                try (InputStream is = connection.getInputStream()) {
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
                        bytesReadTotal += readCount;
                        if (bytesReadTotal <= MAX_NO_STORE_INLINE_BYTES) {
                            memOut.write(buffer, 0, readCount);
                        } else {
                            exceededInlineCap = true;
                            break;
                        }
                    }
                }

                if (bytesReadTotal <= 0L) {
                    rejectAllWaiting(inflight, "Corpo da imagem no-store vazio.", "EMPTY_BODY");
                    return;
                }
                if (
                    !exceededInlineCap &&
                    declaredLength != null &&
                    declaredLength > 0L &&
                    bytesReadTotal != declaredLength
                ) {
                    rejectAllWaiting(inflight, "Download no-store truncado.", "TRUNCATED_BODY");
                    return;
                }

                IdentifiedImageFormat identified = identifyImageFormat(headerBytes, headerLen, contentType);
                if (!identified.persistentEligible) {
                    if (identified.directFallbackEligible) {
                        JSObject directRes = new JSObject();
                        directRes.put("hit", false);
                        directRes.put("revalidated304", false);
                        directRes.put("bypassedNoStore", true);
                        directRes.put("bypassedCache", true);
                        directRes.put(
                            "bypassReason",
                            identified.bypassReason != null ? identified.bypassReason : "unrecognized_format"
                        );
                        directRes.put("key", key);
                        directRes.put("fileName", JSONObject.NULL);
                        directRes.put("filePath", JSONObject.NULL);
                        directRes.put("inlineDataUrl", JSONObject.NULL);
                        directRes.put("byteSize", bytesReadTotal);
                        directRes.put(
                            "contentType",
                            identified.mimeType != null ? identified.mimeType : JSONObject.NULL
                        );
                        directRes.put("totalBytes", totalStoredBytes.get());
                        directRes.put("storedEntriesCount", entriesByKey.size());
                        directRes.put("evictedEntriesCount", evictedEntriesCount.get());
                        resolveAllWaiting(inflight, directRes);
                        return;
                    }
                    rejectAllWaiting(inflight, "Assinatura binária inválida em resposta no-store.", "INVALID_IMAGE_SIGNATURE");
                    return;
                }

                String effectiveMime = identified.mimeType;
                String inlineDataUrl = null;
                if (!exceededInlineCap) {
                    String b64 = Base64.encodeToString(memOut.toByteArray(), Base64.NO_WRAP);
                    inlineDataUrl = "data:" + effectiveMime + ";base64," + b64;
                }

                JSObject bypassRes = new JSObject();
                bypassRes.put("hit", false);
                bypassRes.put("revalidated304", false);
                bypassRes.put("bypassedNoStore", true);
                bypassRes.put("bypassedCache", false);
                bypassRes.put("key", key);
                bypassRes.put("fileName", JSONObject.NULL);
                bypassRes.put("filePath", JSONObject.NULL);
                bypassRes.put(
                    "inlineDataUrl",
                    inlineDataUrl != null ? inlineDataUrl : JSONObject.NULL
                );
                bypassRes.put("byteSize", bytesReadTotal);
                bypassRes.put("contentType", effectiveMime);
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

            byte[] headerBytes = new byte[HEADER_INSPECTION_BYTES];
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

            IdentifiedImageFormat identified = identifyImageFormat(headerBytes, headerLen, contentType);
            if (!identified.persistentEligible) {
                safeDeleteFile(tempFile);
                if (identified.directFallbackEligible) {
                    synchronized (indexLock) {
                        CacheEntry staleEntry = entriesByKey.remove(key);
                        if (staleEntry != null) {
                            totalStoredBytes.addAndGet(-staleEntry.byteSize);
                            if (totalStoredBytes.get() < 0L) totalStoredBytes.set(0L);
                            try {
                                File oldFile = resolveValidatedImageFile(staleEntry.fileName);
                                safeDeleteFile(oldFile);
                            } catch (Exception ignored) {
                                // Ignora falha ao remover arquivo anterior
                            }
                            persistIndexLocked();
                        }
                    }
                    JSObject directRes = new JSObject();
                    directRes.put("hit", false);
                    directRes.put("revalidated304", false);
                    directRes.put("bypassedNoStore", false);
                    directRes.put("bypassedCache", true);
                    directRes.put(
                        "bypassReason",
                        identified.bypassReason != null ? identified.bypassReason : "unrecognized_format"
                    );
                    directRes.put("key", key);
                    directRes.put("fileName", JSONObject.NULL);
                    directRes.put("filePath", JSONObject.NULL);
                    directRes.put("inlineDataUrl", JSONObject.NULL);
                    directRes.put("byteSize", bytesWritten);
                    directRes.put(
                        "contentType",
                        identified.mimeType != null ? identified.mimeType : JSONObject.NULL
                    );
                    directRes.put("totalBytes", totalStoredBytes.get());
                    directRes.put("storedEntriesCount", entriesByKey.size());
                    directRes.put("evictedEntriesCount", evictedEntriesCount.get());
                    resolveAllWaiting(inflight, directRes);
                    return;
                }
                rejectAllWaiting(
                    inflight,
                    "Assinatura binária inválida (resposta não é uma imagem íntegra).",
                    "INVALID_IMAGE_SIGNATURE"
                );
                return;
            }

            String ext = identified.extension;
            String normalizedMime = identified.mimeType;
            String finalFileName = "img_" + key + "." + ext;
            File finalFile = resolveValidatedImageFile(finalFileName);
            if (finalFile == null) {
                safeDeleteFile(tempFile);
                rejectAllWaiting(inflight, "Nome de arquivo final inválido.", "INVALID_FILE_NAME");
                return;
            }

            List<String> evictedKeys;
            long createdAtMs = System.currentTimeMillis();
            long accessStamp = nextLogicalAccessStamp();

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

                CacheEntry newEntry = new CacheEntry(
                    key,
                    finalFileName,
                    bytesWritten,
                    normalizedMime,
                    etag,
                    lastModified,
                    cacheControl,
                    createdAtMs,
                    accessStamp
                );
                entriesByKey.put(key, newEntry);
                totalStoredBytes.addAndGet(bytesWritten);
                evictedKeys = enforceBudgetLocked();
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
            successRes.put("bypassedCache", false);
            successRes.put("key", key);
            successRes.put("fileName", finalFileName);
            successRes.put("filePath", verifiedFinal.getPath());
            successRes.put("cacheDir", cacheDir.getPath());
            successRes.put("byteSize", bytesWritten);
            successRes.put("contentType", normalizedMime);
            successRes.put("etag", etag != null ? etag : JSONObject.NULL);
            successRes.put("lastModified", lastModified != null ? lastModified : JSONObject.NULL);
            successRes.put("cacheControl", cacheControl != null ? cacheControl : JSONObject.NULL);
            successRes.put("createdAtMs", createdAtMs);
            successRes.put("lastAccessedAtMs", accessStamp);
            successRes.put("totalBytes", totalStoredBytes.get());
            successRes.put("storedEntriesCount", entriesByKey.size());
            successRes.put("evictedEntriesCount", evictedEntriesCount.get());
            JSArray evictedArr = new JSArray();
            for (String k : evictedKeys) {
                evictedArr.put(k);
            }
            successRes.put("evictedKeys", evictedArr);
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
