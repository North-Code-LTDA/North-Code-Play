package com.northcode.play;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler;
import com.getcapacitor.plugin.util.ICapacitorHttpUrlConnection;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Plugin Android dedicado para transferência dos catálogos completos (P3.3) no APK.
 *
 * Responsabilidades:
 * - Executa o HTTP GET fora da thread principal da UI.
 * - Transfere o corpo da resposta em fluxo (streaming com buffer limitado de 16 KB) diretamente
 *   para um arquivo temporário na pasta dedicada `<cacheDir>/nc_catalog_transfers/`.
 * - Nunca interpreta o JSON do catálogo na camada Java (JSONObject/JSONArray) e nunca trafega
 *   o conteúdo do catálogo pela ponte do Capacitor como objeto, texto ou Base64.
 * - Preserva as regras de HTTP, HTTPS, redirecionamento, SSLSocketFactory, User-Agent e timeouts
 *   (`connectTimeout` e `readTimeout`) do CapacitorHttp.
 * - Permite cancelamento em andamento (`cancelTransfer`) e remoção imediata do arquivo temporário
 *   (`cleanupTransferFile`) com validação estrita de caminho dentro da pasta dedicada do cache.
 */
@CapacitorPlugin(name = "CatalogFileTransfer")
public class CatalogFileTransferPlugin extends Plugin {

    public static final String CACHE_SUBDIR_NAME = "nc_catalog_transfers";
    private static final int STREAM_BUFFER_SIZE = 16384;
    private static final Pattern SAFE_FILE_ID_PATTERN = Pattern.compile(
        "^nc_catalog_[a-zA-Z0-9_-]+\\.json(?:\\.tmp)?$"
    );

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, ActiveTransfer> activeTransfers = new ConcurrentHashMap<>();
    private final Set<String> activeFileNames = ConcurrentHashMap.newKeySet();
    private final AtomicLong transferSequence = new AtomicLong(0L);

    private static final class ActiveTransfer {
        final String transferId;
        final String tempFileName;
        final String finalFileName;
        final File tempFile;
        final File finalFile;
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile CapacitorHttpUrlConnection connection;
        volatile Future<?> future;

        ActiveTransfer(
            String transferId,
            String tempFileName,
            String finalFileName,
            File tempFile,
            File finalFile
        ) {
            this.transferId = transferId;
            this.tempFileName = tempFileName;
            this.finalFileName = finalFileName;
            this.tempFile = tempFile;
            this.finalFile = finalFile;
        }

        boolean isCancelled() {
            return cancelled.get();
        }

        void cancel() {
            if (!cancelled.compareAndSet(false, true)) {
                return;
            }
            Future<?> runningFuture = this.future;
            if (runningFuture != null) {
                runningFuture.cancel(true);
            }
            CapacitorHttpUrlConnection activeConn = this.connection;
            if (activeConn != null) {
                try {
                    activeConn.disconnect();
                } catch (Exception ignored) {
                    // Ignora erro ao desconectar socket abortado
                }
            }
            safeDeleteFile(this.tempFile);
            safeDeleteFile(this.finalFile);
        }
    }

    @Override
    public void load() {
        super.load();
        executor.execute(this::cleanupStaleFiles);
    }

    @Override
    protected void handleOnDestroy() {
        for (ActiveTransfer transfer : activeTransfers.values()) {
            transfer.cancel();
        }
        activeTransfers.clear();
        activeFileNames.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private File getTransferCacheDir() throws IOException {
        if (getContext() == null || getContext().getCacheDir() == null) {
            throw new IOException("Diretório de cache interno indisponível.");
        }
        File dir = new File(getContext().getCacheDir(), CACHE_SUBDIR_NAME);
        if (!dir.exists() && !dir.mkdirs() && !dir.exists()) {
            throw new IOException("Não foi possível preparar o diretório de cache de catálogos.");
        }
        return dir.getCanonicalFile();
    }

    private File resolveValidatedCacheFile(String fileId) throws IOException {
        if (fileId == null || fileId.isEmpty()) {
            return null;
        }
        if (!SAFE_FILE_ID_PATTERN.matcher(fileId).matches()) {
            return null;
        }
        File cacheDir = getTransferCacheDir();
        File candidate = new File(cacheDir, fileId).getCanonicalFile();
        File parent = candidate.getParentFile();
        if (parent == null || !parent.equals(cacheDir)) {
            return null;
        }
        String cacheDirPath = cacheDir.getPath();
        String candidatePath = candidate.getPath();
        if (!candidatePath.startsWith(cacheDirPath + File.separator)) {
            return null;
        }
        return candidate;
    }

    private static void safeDeleteFile(File file) {
        if (file == null) {
            return;
        }
        try {
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (Exception ignored) {
            // Ignora falha de limpeza residual
        }
    }

    private void cleanupStaleFiles() {
        try {
            File cacheDir = getTransferCacheDir();
            File[] files = cacheDir.listFiles();
            if (files == null) {
                return;
            }
            for (File f : files) {
                if (f == null || !f.isFile()) {
                    continue;
                }
                String name = f.getName();
                if (!activeFileNames.contains(name)) {
                    safeDeleteFile(f);
                }
            }
        } catch (Exception ignored) {
            // Ignora erros durante limpeza de resíduos antigos
        }
    }

    private static double nanosToMillis(long durationNs) {
        return Math.max(0L, durationNs) / 1_000_000.0;
    }

    private static Long parseContentLengthHeader(ICapacitorHttpUrlConnection connection) {
        String raw = connection.getHeaderField("Content-Length");
        if (raw == null) {
            raw = connection.getHeaderField("content-length");
        }
        if (raw == null && connection instanceof CapacitorHttpUrlConnection) {
            Map<String, List<String>> fields = ((CapacitorHttpUrlConnection) connection).getHeaderFields();
            if (fields != null) {
                for (Map.Entry<String, List<String>> entry : fields.entrySet()) {
                    if (entry.getKey() != null && "content-length".equalsIgnoreCase(entry.getKey())) {
                        List<String> values = entry.getValue();
                        if (values != null && !values.isEmpty()) {
                            raw = values.get(0);
                            break;
                        }
                    }
                }
            }
        }
        if (raw == null) {
            return null;
        }
        try {
            long parsed = Long.parseLong(raw.trim());
            return parsed >= 0L ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static String sanitizeTransferToken(String rawTransferId, long seq) {
        if (rawTransferId == null || rawTransferId.isEmpty()) {
            return "t" + seq;
        }
        String cleaned = rawTransferId.replaceAll("[^a-zA-Z0-9_-]", "");
        if (cleaned.isEmpty()) {
            return "t" + seq;
        }
        if (cleaned.length() > 48) {
            cleaned = cleaned.substring(0, 48);
        }
        return cleaned + "_" + seq;
    }

    @PluginMethod
    public void downloadCatalogToTempFile(final PluginCall call) {
        final boolean collectDiagnostics = Boolean.TRUE.equals(
            call.getBoolean("collectDiagnostics", false)
        );
        final long requestStartNs = collectDiagnostics ? System.nanoTime() : 0L;
        final String urlString = call.getString("url", "");
        final String rawTransferId = call.getString("transferId", "");
        final Integer connectTimeout = call.getInt("connectTimeout");
        final Integer readTimeout = call.getInt("readTimeout");
        final Boolean disableRedirects = call.getBoolean("disableRedirects");
        final JSObject headers = call.getObject("headers", new JSObject());

        if (urlString == null || urlString.trim().isEmpty()) {
            call.reject("URL de consulta inválida.", "INVALID_URL");
            return;
        }

        final long seq = transferSequence.incrementAndGet();
        final String safeToken = sanitizeTransferToken(rawTransferId, seq);
        final String transferKey = (rawTransferId != null && !rawTransferId.isEmpty())
            ? rawTransferId
            : ("transfer_" + seq);
        final String tempFileName = "nc_catalog_" + safeToken + ".json.tmp";
        final String finalFileName = "nc_catalog_" + safeToken + ".json";

        final File tempFile;
        final File finalFile;
        try {
            cleanupStaleFiles();
            tempFile = resolveValidatedCacheFile(tempFileName);
            finalFile = resolveValidatedCacheFile(finalFileName);
            if (tempFile == null || finalFile == null) {
                call.reject("Falha ao alocar arquivo temporário de catálogo.", "TEMP_FILE_ERROR");
                return;
            }
        } catch (IOException ioEx) {
            call.reject("Falha ao acessar diretório de cache interno.", "TEMP_FILE_ERROR");
            return;
        }

        activeFileNames.add(tempFileName);
        activeFileNames.add(finalFileName);

        final ActiveTransfer activeTransfer = new ActiveTransfer(
            transferKey,
            tempFileName,
            finalFileName,
            tempFile,
            finalFile
        );
        activeTransfers.put(transferKey, activeTransfer);

        Future<?> taskFuture = executor.submit(() -> {
            CapacitorHttpUrlConnection connection = null;
            boolean keepFinalFileForJsRead = false;

            try {
                if (activeTransfer.isCancelled()) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                    return;
                }

                URL url = new URL(urlString);
                String protocol = url.getProtocol() != null
                    ? url.getProtocol().toLowerCase(Locale.ROOT)
                    : "";
                if (!"http".equals(protocol) && !"https".equals(protocol)) {
                    call.reject("Protocolo não suportado para catálogo.", "INVALID_PROTOCOL");
                    return;
                }

                Bridge currentBridge = getBridge();
                String userAgentValue = headers.getString("x-cap-user-agent");
                if (userAgentValue != null) {
                    headers.put("User-Agent", userAgentValue);
                }
                headers.remove("x-cap-user-agent");

                if (
                    !headers.has("User-Agent") &&
                    !headers.has("user-agent") &&
                    currentBridge != null &&
                    currentBridge.getConfig() != null
                ) {
                    String overriddenUa = currentBridge.getConfig().getOverriddenUserAgentString();
                    if (overriddenUa != null) {
                        headers.put("User-Agent", overriddenUa);
                    }
                }

                HttpRequestHandler.HttpURLConnectionBuilder connectionBuilder =
                    new HttpRequestHandler.HttpURLConnectionBuilder()
                        .setUrl(url)
                        .setMethod("GET")
                        .setHeaders(headers)
                        .setConnectTimeout(connectTimeout)
                        .setReadTimeout(readTimeout)
                        .setDisableRedirects(disableRedirects)
                        .openConnection();

                connection = connectionBuilder.build();
                activeTransfer.connection = connection;

                if (
                    currentBridge != null &&
                    !Boolean.TRUE.equals(HttpRequestHandler.isDomainExcludedFromSSL(currentBridge, url))
                ) {
                    connection.setSSLSocketFactory(currentBridge);
                }

                if (activeTransfer.isCancelled()) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                    return;
                }

                connection.connect();
                int statusCode = connection.getResponseCode();
                double statusAndHeadersMs = collectDiagnostics
                    ? nanosToMillis(System.nanoTime() - requestStartNs)
                    : 0.0;
                Long contentLengthHeaderBytes = collectDiagnostics
                    ? parseContentLengthHeader(connection)
                    : null;

                if (activeTransfer.isCancelled()) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                    return;
                }

                // Se o provedor retornou erro HTTP (ex.: 401, 403, 404, 5xx), preserva o status
                // real sem gravar nem trafegar o corpo pela ponte nativa.
                if (statusCode < 200 || statusCode >= 300) {
                    JSObject errorStatusResult = new JSObject();
                    errorStatusResult.put("status", statusCode);
                    errorStatusResult.put("fileId", JSONObject.NULL);
                    errorStatusResult.put("filePath", JSONObject.NULL);

                    if (collectDiagnostics) {
                        JSObject nativeDiagnostics = new JSObject();
                        nativeDiagnostics.put("statusAndHeadersMs", statusAndHeadersMs);
                        nativeDiagnostics.put("fileWriteMs", 0.0);
                        nativeDiagnostics.put("nativeJsonParseExecuted", false);
                        nativeDiagnostics.put("nativeJsonParseMs", JSONObject.NULL);
                        nativeDiagnostics.put(
                            "contentLengthHeaderBytes",
                            contentLengthHeaderBytes != null
                                ? contentLengthHeaderBytes.longValue()
                                : JSONObject.NULL
                        );
                        nativeDiagnostics.put("bytesWritten", 0L);
                        nativeDiagnostics.put(
                            "nativeTotalMs",
                            nanosToMillis(System.nanoTime() - requestStartNs)
                        );
                        errorStatusResult.put("nativeDiagnostics", nativeDiagnostics);
                    }

                    call.resolve(errorStatusResult);
                    return;
                }

                long writeStartNs = collectDiagnostics ? System.nanoTime() : 0L;
                long bytesWritten = 0L;

                try (
                    InputStream inputStream = connection.getInputStream();
                    FileOutputStream fileOutput = new FileOutputStream(tempFile, false)
                ) {
                    byte[] buffer = new byte[STREAM_BUFFER_SIZE];
                    int readCount;
                    while ((readCount = inputStream.read(buffer)) != -1) {
                        if (activeTransfer.isCancelled() || Thread.currentThread().isInterrupted()) {
                            throw new IOException("TRANSFER_CANCELLED");
                        }
                        fileOutput.write(buffer, 0, readCount);
                        bytesWritten += readCount;
                    }
                    fileOutput.flush();
                }

                if (activeTransfer.isCancelled() || Thread.currentThread().isInterrupted()) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                    return;
                }

                safeDeleteFile(finalFile);
                if (!tempFile.renameTo(finalFile)) {
                    throw new IOException("TEMP_FILE_FINALIZE_FAILED");
                }

                double fileWriteMs = collectDiagnostics
                    ? nanosToMillis(System.nanoTime() - writeStartNs)
                    : 0.0;

                if (activeTransfer.isCancelled()) {
                    safeDeleteFile(finalFile);
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                    return;
                }

                keepFinalFileForJsRead = true;

                JSObject result = new JSObject();
                result.put("status", statusCode);
                result.put("fileId", finalFileName);
                result.put("filePath", finalFile.getAbsolutePath());

                if (collectDiagnostics) {
                    JSObject nativeDiagnostics = new JSObject();
                    nativeDiagnostics.put("statusAndHeadersMs", statusAndHeadersMs);
                    nativeDiagnostics.put("fileWriteMs", fileWriteMs);
                    nativeDiagnostics.put("nativeJsonParseExecuted", false);
                    nativeDiagnostics.put("nativeJsonParseMs", JSONObject.NULL);
                    nativeDiagnostics.put(
                        "contentLengthHeaderBytes",
                        contentLengthHeaderBytes != null
                            ? contentLengthHeaderBytes.longValue()
                            : JSONObject.NULL
                    );
                    nativeDiagnostics.put("bytesWritten", bytesWritten);
                    nativeDiagnostics.put(
                        "nativeTotalMs",
                        nanosToMillis(System.nanoTime() - requestStartNs)
                    );
                    result.put("nativeDiagnostics", nativeDiagnostics);
                }

                call.resolve(result);
            } catch (SocketTimeoutException timeoutEx) {
                if (activeTransfer.isCancelled()) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                } else {
                    call.reject("SocketTimeoutException: Read timed out", "TIMEOUT");
                }
            } catch (Exception ex) {
                if (
                    activeTransfer.isCancelled() ||
                    "TRANSFER_CANCELLED".equals(ex.getMessage()) ||
                    Thread.currentThread().isInterrupted()
                ) {
                    call.reject("Operação cancelada pelo usuário.", "CANCELLED");
                } else {
                    call.reject("Falha de rede durante transferência do catálogo.", "NETWORK_ERROR");
                }
            } finally {
                activeTransfers.remove(transferKey, activeTransfer);
                activeFileNames.remove(tempFileName);
                safeDeleteFile(tempFile);
                if (!keepFinalFileForJsRead || activeTransfer.isCancelled()) {
                    activeFileNames.remove(finalFileName);
                    safeDeleteFile(finalFile);
                }
                if (connection != null) {
                    try {
                        connection.disconnect();
                    } catch (Exception ignored) {
                        // Ignora erro ao encerrar conexão
                    }
                }
            }
        });

        activeTransfer.future = taskFuture;
    }

    @PluginMethod
    public void cancelTransfer(final PluginCall call) {
        String transferId = call.getString("transferId", "");
        if (transferId != null && !transferId.isEmpty()) {
            ActiveTransfer active = activeTransfers.remove(transferId);
            if (active != null) {
                active.cancel();
                activeFileNames.remove(active.tempFileName);
                activeFileNames.remove(active.finalFileName);
            }
        }
        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void cleanupTransferFile(final PluginCall call) {
        String fileId = call.getString("fileId", "");
        try {
            File validatedFile = resolveValidatedCacheFile(fileId);
            if (validatedFile == null) {
                call.reject(
                    "Identificador de arquivo temporário inválido ou fora do diretório permitido.",
                    "INVALID_FILE_ID"
                );
                return;
            }
            activeFileNames.remove(fileId);
            activeFileNames.remove(fileId + ".tmp");
            boolean deleted = false;
            if (validatedFile.exists()) {
                deleted = validatedFile.delete();
            }
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            call.resolve(ret);
        } catch (IOException ex) {
            call.reject("Falha ao remover arquivo temporário de catálogo.", "CLEANUP_ERROR");
        }
    }
}
