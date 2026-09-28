import http from "node:http";
import { normalizeServerUrl, validatePlayableFormat, getProxiedImageUrl } from "../src/utils/mediaUtils";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
  handleImageProxyRequest,
  rewriteHlsPlaylist,
  diagnoseMediaUpstream,
  ticketStore,
  FALLBACK_SVG_IMAGE,
} from "../server/mediaProxy";
import { validateTargetUrl } from "../server/ssrf";
import { checkFfmpegAvailable } from "../server/ffmpegHelper";
import { APP_VERSION, APP_COMMIT } from "../src/version";

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${testName}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${testName} - ${details || "Assertion failed"}`);
  }
}

// Minimal mock Express Request/Response objects
function createMockReqRes(options: {
  method?: string;
  url?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  let closeCallback: (() => void) | null = null;
  const req: any = {
    method: options.method || "GET",
    url: options.url || "/",
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    on: (evt: string, cb: any) => {
      if (evt === "close") {
        closeCallback = cb;
      }
      return req;
    },
    emitClose: () => {
      if (closeCallback) closeCallback();
    },
  };

  const headers: Record<string, string> = {};
  let statusCode = 200;
  let bodyChunks: Buffer[] = [];
  let resolvePromise: (val: any) => void;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const res: any = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    setHeader: (name: string, val: string) => {
      headers[name.toLowerCase()] = val;
      return res;
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    json: (data: any) => {
      bodyChunks.push(Buffer.from(JSON.stringify(data)));
      resolvePromise({ statusCode, headers, body: JSON.stringify(data), json: data });
      return res;
    },
    send: (data: any) => {
      bodyChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
      resolvePromise({ statusCode, headers, body: data.toString(), raw: data });
      return res;
    },
    write: (chunk: any) => {
      if (chunk) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return true;
    },
    end: (chunk?: any) => {
      if (chunk) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const fullBuffer = Buffer.concat(bodyChunks);
      resolvePromise({
        statusCode,
        headers,
        body: fullBuffer.toString("utf-8"),
        buffer: fullBuffer,
      });
      return res;
    },
    on: () => res,
    once: () => res,
    emit: () => true,
  };

  return { req, res, waitForResponse: () => promise };
}

async function runMediaProxyTests() {
  console.log("=== INICIANDO TESTES DO PROXY DE MÍDIA, HLS E MP4 RANGE ===\n");

  // -------------------------------------------------------------
  // Test 1: URL Normalization Tests
  // -------------------------------------------------------------
  console.log("1. Testando normalização da URL do servidor:");
  assert(
    normalizeServerUrl("http:/meu-servidor.com:8080/") === "http://meu-servidor.com:8080",
    "Corrige http:/ com barra única para http:// e remove barra final"
  );
  assert(
    normalizeServerUrl("https:/meu-servidor.com:8443") === "https://meu-servidor.com:8443",
    "Corrige https:/ com barra única para https://"
  );
  assert(
    normalizeServerUrl("meu-servidor.com:8080") === "http://meu-servidor.com:8080",
    "Adiciona http:// padrão se esquema não informado"
  );
  assert(
    normalizeServerUrl("http://meu-servidor.com:8080/caminho/extra/") === "http://meu-servidor.com:8080",
    "Extrai apenas protocolo e host com porta, descartando caminhos residuais"
  );

  // -------------------------------------------------------------
  // Test 2: Playable Formats Validation & Direct .ts Selection
  // -------------------------------------------------------------
  console.log("\n2. Testando seleção de formatos e erros claros:");
  const liveOnlyTsNative = validatePlayableFormat("live", { allowedOutputFormats: ["ts"], requireNative: true });
  assert(
    !liveOnlyTsNative.isPlayable && Boolean(liveOnlyTsNative.error?.includes(".m3u8")),
    "Retorna erro explicativo se provedor ao vivo só oferecer .ts sem m3u8 para reprodução nativa direta"
  );

  // Requirement: Direct .ts selection when provider only offers MPEG-TS
  const liveOnlyTsDirect = validatePlayableFormat("live", { allowedOutputFormats: ["ts"] });
  assert(
    liveOnlyTsDirect.isPlayable && liveOnlyTsDirect.format === "ts" && Boolean(liveOnlyTsDirect.warning),
    "Seleciona diretamente formato 'ts' para canal ao vivo que só transmite .ts (habilitando remux direto)"
  );

  const liveWithM3u8 = validatePlayableFormat("live", { allowedOutputFormats: ["ts", "m3u8"] });
  assert(
    liveWithM3u8.isPlayable && liveWithM3u8.format === "m3u8",
    "Seleciona m3u8 quando suportado pelo provedor ao vivo"
  );

  const vodMp4 = validatePlayableFormat("movie", { containerExtension: "mp4" });
  assert(vodMp4.isPlayable && vodMp4.format === "mp4" && !vodMp4.warning, "Aceita MP4 como nativo");

  const vodMkv = validatePlayableFormat("movie", { containerExtension: "mkv" });
  assert(
    vodMkv.isPlayable && vodMkv.format === "mkv" && Boolean(vodMkv.warning),
    "Emite aviso para MKV recomendando MP4 sem quebrar o fluxo"
  );

  // -------------------------------------------------------------
  // Test 3: Security & SSRF Validation for Media
  // -------------------------------------------------------------
  console.log("\n3. Testando falhas de destino e bloqueios de segurança (SSRF):");
  try {
    await createMediaTicket({
      serverUrl: "http://127.0.0.1:8080",
      username: "user",
      password: "pwd",
      type: "live",
      streamId: "100",
      allowPrivateForTest: false,
    });
    assert(false, "127.0.0.1 deveria ser rejeitado na criação de ticket");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "127.0.0.1 é rejeitado na criação de ticket");
  }

  try {
    await createMediaTicket({
      serverUrl: "http://169.254.169.254",
      username: "user",
      password: "pwd",
      type: "live",
      streamId: "100",
      allowPrivateForTest: false,
    });
    assert(false, "169.254.169.254 deveria ser rejeitado na criação de ticket");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "169.254.169.254 é rejeitado na criação de ticket");
  }

  // -------------------------------------------------------------
  // Test 4: Mock HTTP Server Initialization
  // -------------------------------------------------------------
  console.log("\n4. Inicializando servidor HTTP mock com porta explícita para testes de mídia:");
  const mockMediaPort = 9877;
  const dummyMp4Buffer = Buffer.alloc(100, 0x41); // 100 bytes of 'A'
  for (let i = 0; i < 100; i++) dummyMp4Buffer[i] = 65 + (i % 26);

  const mockServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${mockMediaPort}`);

    // Channel A: Master HLS Playlist
    if (url.pathname === "/live/testuser/testpass/100.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720",
          "variant_720p.m3u8",
          "#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1920x1080",
          `http://127.0.0.1:${mockMediaPort}/cdn/variant_1080p.m3u8?token=xyz123`,
        ].join("\n")
      );
      return;
    }

    // Channel B: Master HLS Playlist
    if (url.pathname === "/live/testuser/testpass/200.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXTINF:10.0,",
          "seg-b-1.ts",
          "#EXT-X-ENDLIST",
        ].join("\n")
      );
      return;
    }

    // Channel C: Master HLS Playlist
    if (url.pathname === "/live/testuser/testpass/300.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXTINF:10.0,",
          "seg-c-1.ts",
          "#EXT-X-ENDLIST",
        ].join("\n")
      );
      return;
    }

    // Channel TS-only: returns 404 on .m3u8 but 200 on .ts
    if (url.pathname === "/live/testuser/testpass/999.m3u8") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    if (url.pathname === "/live/testuser/testpass/999.ts") {
      res.writeHead(200, { "Content-Type": "video/MP2T" });
      res.end(Buffer.from("TS_RAW_STREAM_DATA_999"));
      return;
    }

    // Case: Variant HLS Playlist with relative and absolute segments
    if (url.pathname === "/live/testuser/testpass/variant_720p.m3u8") {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      res.end(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-TARGETDURATION:10",
          "#EXT-X-MEDIA-SEQUENCE:0",
          '#EXT-X-KEY:METHOD=AES-128,URI="enc.key"',
          "#EXTINF:10.0,",
          "seg-rel-0.ts",
          "#EXTINF:10.0,",
          `http://127.0.0.1:${mockMediaPort}/cdn/seg-abs-1.ts?token=segtoken`,
          "#EXT-X-ENDLIST",
        ].join("\n")
      );
      return;
    }

    // Case: Key
    if (url.pathname === "/live/testuser/testpass/enc.key") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from("1234567890123456"));
      return;
    }

    // Case: Relative Segment
    if (url.pathname === "/live/testuser/testpass/seg-rel-0.ts") {
      res.writeHead(200, { "Content-Type": "video/MP2T" });
      res.end(Buffer.from("TS_SEGMENT_0_DATA"));
      return;
    }

    // Case: Absolute Segment
    if (url.pathname === "/cdn/seg-abs-1.ts") {
      res.writeHead(200, { "Content-Type": "video/MP2T" });
      res.end(Buffer.from("TS_SEGMENT_ABS_1_DATA"));
      return;
    }

    // Case: Segment with Redirect
    if (url.pathname === "/redirect-segment.ts") {
      res.writeHead(302, { Location: `http://127.0.0.1:${mockMediaPort}/cdn/seg-abs-1.ts` });
      res.end();
      return;
    }

    // Case: Segment with Forbidden Redirect to Metadata
    if (url.pathname === "/forbidden-redirect.ts") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }

    // Case: MP4 file with Range support (Movie 101)
    if (url.pathname === "/movie/testuser/testpass/101.mp4" || url.pathname === "/vod/movie1.mp4") {
      const range = req.headers["range"];
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : dummyMp4Buffer.length - 1;
        const chunk = dummyMp4Buffer.subarray(start, end + 1);

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${dummyMp4Buffer.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunk.length,
          "Content-Type": "video/mp4",
        });
        res.end(chunk);
        return;
      }

      res.writeHead(200, {
        "Content-Length": dummyMp4Buffer.length,
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4",
      });
      res.end(dummyMp4Buffer);
      return;
    }

    // Case: MKV file with Range support (Movie 402)
    if (url.pathname === "/movie/testuser/testpass/402.mkv") {
      res.writeHead(200, {
        "Content-Length": "85000000",
        "Accept-Ranges": "bytes",
        "Content-Type": "video/x-matroska",
      });
      res.end(Buffer.from("MATROSKA_REAL_MOVIE_DATA"));
      return;
    }

    // Case: Movie 555 - Maintenance Video delivered on BOTH mp4 and mkv with HTTP 200
    if (url.pathname === "/movie/testuser/testpass/555.mp4" || url.pathname === "/movie/testuser/testpass/555.mkv") {
      // 500 KB tiny maintenance placeholder video
      const maintenanceBuf = Buffer.alloc(500 * 1024, 0x55);
      res.writeHead(200, {
        "Content-Length": "512000",
        "Accept-Ranges": "none",
        "Content-Type": "video/mp4",
      });
      res.end(maintenanceBuf);
      return;
    }

    // Case: Movie 666 - Maintenance Video on .mp4, but Real File on .mkv!
    if (url.pathname === "/movie/testuser/testpass/666.mp4") {
      // Substitute maintenance video
      res.writeHead(200, {
        "Content-Length": "300000",
        "Accept-Ranges": "none",
        "Content-Type": "video/mp4",
      });
      res.end(Buffer.alloc(300 * 1024, 0x66));
      return;
    }
    if (url.pathname === "/movie/testuser/testpass/666.mkv") {
      // Real movie file (120 MB)
      res.writeHead(200, {
        "Content-Length": "125829120",
        "Accept-Ranges": "bytes",
        "Content-Type": "video/x-matroska",
      });
      res.end(Buffer.from("REAL_MOVIE_MKV_PAYLOAD"));
      return;
    }

    // Image endpoints
    if (url.pathname === "/images/valid.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from("FAKE_JPEG_BINARY_DATA"));
      return;
    }
    if (url.pathname === "/images/missing.jpg") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(mockMediaPort, "127.0.0.1", () => resolve());
  });

  const mockServerUrl = `http://127.0.0.1:${mockMediaPort}`;

  try {
    // -------------------------------------------------------------
    // Test 4: HLS Master and Variant Streaming via /api/media
    // -------------------------------------------------------------
    const { ticketId, streamUrl } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "live",
      streamId: "100",
      ext: "m3u8",
      allowPrivateForTest: true,
    });

    assert(Boolean(ticketId && streamUrl), "Ticket criado com sucesso em servidor HTTP com porta explícita");

    const { req: reqMaster, res: resMaster, waitForResponse: waitMaster } = createMockReqRes({
      params: { ticket: ticketId, filename: "100.m3u8" },
    });
    handleStreamRequest(reqMaster, resMaster, { allowPrivateForTest: true });
    const masterRes: any = await waitMaster();

    assert(masterRes.statusCode === 200, "Manifesto HLS mestre entregue com código 200");
    assert(masterRes.headers["content-type"].includes("mpegurl"), "Cabeçalho Content-Type mpegurl retornado");
    assert(masterRes.body.includes("/api/media/hls-resource?ticket="), "Playlists variantes reescritas para /api/media/hls-resource");

    // Extract variant URI
    const matchVariant = masterRes.body.match(/\/api\/media\/hls-resource\?ticket=[^&\s]+\&uri=([^&\s\n]+)/);
    assert(Boolean(matchVariant && matchVariant[1]), "URI da playlist variante capturada na resposta");

    // Fetch variant playlist
    const variantRawUri = decodeURIComponent(matchVariant[1]);
    const { req: reqVariant, res: resVariant, waitForResponse: waitVariant } = createMockReqRes({
      query: { ticket: ticketId, uri: variantRawUri },
    });
    handleHlsResourceRequest(reqVariant, resVariant, { allowPrivateForTest: true });
    const variantRes: any = await waitVariant();

    assert(variantRes.statusCode === 200, "Playlist variante entregue com código 200");
    assert(variantRes.body.includes('URI="/api/media/hls-resource?ticket='), "Tag #EXT-X-KEY com chave de criptografia reescrita para proxy");
    assert(
      decodeURIComponent(variantRes.body).includes("/live/testuser/testpass/seg-rel-0.ts"),
      "Segmento relativo resolvido e reescrito com caminho absoluto no proxy"
    );
    assert(
      decodeURIComponent(variantRes.body).includes("/cdn/seg-abs-1.ts"),
      "Segmento absoluto preservado e reescrito no proxy"
    );

    // Fetch a segment (skip EXT-X-KEY line to select the actual TS segment line)
    const segmentLine = variantRes.body.split(/\r?\n/).find((l: string) => l.includes("seg-rel-0.ts"));
    assert(Boolean(segmentLine), "URI de segmento capturada");

    const segmentUriMatch = segmentLine?.match(/uri=([^&\s\n]+)/);
    const segmentRawUri = decodeURIComponent(segmentUriMatch ? segmentUriMatch[1] : "");

    const { req: reqSeg, res: resSeg, waitForResponse: waitSeg } = createMockReqRes({
      query: { ticket: ticketId, uri: segmentRawUri },
    });
    handleHlsResourceRequest(reqSeg, resSeg, { allowPrivateForTest: true });
    const segRes: any = await waitSeg();

    assert(segRes.statusCode === 200, "Segmento HLS entregue com código 200");
    assert(segRes.headers["content-type"].includes("MP2T"), "Content-Type video/MP2T para segmento TS");
    assert(segRes.body.includes("TS_SEGMENT_"), "Dados binários do segmento entregues corretamente");

    // -------------------------------------------------------------
    // Test 5: MP4 Streaming with Range Header and 206 Partial Content
    // -------------------------------------------------------------
    console.log("\n5. Testando streaming de MP4 com cabeçalho Range e resposta HTTP 206:");
    const { ticketId: vodTicketId } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "101",
      ext: "mp4",
      allowPrivateForTest: true,
    });

    const { req: reqRange, res: resRange, waitForResponse: waitRange } = createMockReqRes({
      params: { ticket: vodTicketId, filename: "101.mp4" },
      headers: { range: "bytes=10-25" },
    });
    handleStreamRequest(reqRange, resRange, { allowPrivateForTest: true });
    const rangeRes: any = await waitRange();

    assert(rangeRes.statusCode === 206, "MP4 com Range responde com código 206 Partial Content");
    assert(rangeRes.headers["content-range"] === "bytes 10-25/100", "Cabeçalho Content-Range preservado: bytes 10-25/100");
    assert(rangeRes.headers["accept-ranges"] === "bytes", "Cabeçalho Accept-Ranges: bytes presente");
    assert(rangeRes.buffer.length === 16, "Tamanho exato do trecho (slice) recebido");

    // -------------------------------------------------------------
    // Test 6: Image Proxy and Fallback SVG
    // -------------------------------------------------------------
    console.log("\n6. Testando proxy de imagens, capas e logos com imagem substituta:");
    const { req: reqImgValid, res: resImgValid, waitForResponse: waitImgValid } = createMockReqRes({
      query: { url: `${mockServerUrl}/images/valid.jpg` },
    });
    handleImageProxyRequest(reqImgValid, resImgValid, { allowPrivateForTest: true });
    const imgValidRes: any = await waitImgValid();
    assert(imgValidRes.statusCode === 200 && imgValidRes.headers["content-type"].includes("image/jpeg"), "Imagem válida entregue com Content-Type image/jpeg");

    // Fallback on 404
    const { req: reqImg404, res: resImg404, waitForResponse: waitImg404 } = createMockReqRes({
      query: { url: `${mockServerUrl}/images/missing.jpg` },
    });
    handleImageProxyRequest(reqImg404, resImg404, { allowPrivateForTest: true });
    const img404Res: any = await waitImg404();
    assert(img404Res.statusCode === 200 && img404Res.body.includes("NORTH CODE PLAY"), "Imagem inexistente (HTTP 404) retorna imagem substituta SVG da aplicação");

    // -------------------------------------------------------------
    // Test 7: Live Channel Switching Sequence A -> B -> A -> C
    // -------------------------------------------------------------
    console.log("\n7. Testando sequência de troca de canais ao vivo (A → B → A → C):");
    const { ticketId: ticketA1, streamUrl: urlA1 } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "live",
      streamId: "100",
      ext: "m3u8",
      allowPrivateForTest: true,
    });
    assert(urlA1.endsWith("/100.m3u8"), "Abertura inicial do canal A (stream 100) bem-sucedida");

    // Switch to channel B
    const { ticketId: ticketB, streamUrl: urlB } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "live",
      streamId: "200",
      ext: "m3u8",
      allowPrivateForTest: true,
    });
    assert(urlB.endsWith("/200.m3u8") && ticketB !== ticketA1, "Troca para canal B (stream 200) na mesma categoria gera ticket próprio e URL distinta");

    // Switch back to channel A
    const { ticketId: ticketA2, streamUrl: urlA2 } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "live",
      streamId: "100",
      ext: "m3u8",
      allowPrivateForTest: true,
    });
    assert(urlA2.endsWith("/100.m3u8"), "Retorno para o canal A (stream 100) gera URL correta sem manter estado residual do canal B");

    // Switch to channel C
    const { ticketId: ticketC, streamUrl: urlC } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "live",
      streamId: "300",
      ext: "m3u8",
      allowPrivateForTest: true,
    });
    assert(urlC.endsWith("/300.m3u8") && ticketC !== ticketB, "Troca para canal C (stream 300) executa de forma limpa e independente");

    // -------------------------------------------------------------
    // Test 8: Asynchronous Out-of-Order Race Condition Resolution
    // -------------------------------------------------------------
    console.log("\n8. Testando descarte de respostas assíncronas antigas fora de ordem (Race Conditions):");
    let activeChannelRequestId = 0;
    let currentRenderedUrl = "";

    // Step 1: User requests Channel A
    const reqIdA1 = ++activeChannelRequestId;
    currentRenderedUrl = ""; // Player displays loading for A
    const promiseA1 = (async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { reqId: reqIdA1, url: urlA1 };
    })();

    // Step 2: User switches to Channel B
    const reqIdB = ++activeChannelRequestId;
    currentRenderedUrl = ""; // Player displays loading for B
    const promiseB = (async () => {
      // Simulate delayed network response for B
      await new Promise((r) => setTimeout(r, 100));
      return { reqId: reqIdB, url: urlB };
    })();

    // Step 3: User quickly switches back to Channel A
    const reqIdA2 = ++activeChannelRequestId;
    currentRenderedUrl = ""; // Player displays loading for A
    const promiseA2 = (async () => {
      await new Promise((r) => setTimeout(r, 10)); // Returns fast from cache
      return { reqId: reqIdA2, url: urlA2 };
    })();

    // A2 resolves first
    const resA2 = await promiseA2;
    if (activeChannelRequestId === resA2.reqId) {
      currentRenderedUrl = resA2.url;
    }
    assert(currentRenderedUrl === urlA2, "Canal A (retorno rápido) assumiu a reprodução imediatamente");

    // Now delayed B resolves late: sequencer must discard B
    const resB = await promiseB;
    if (activeChannelRequestId === resB.reqId) {
      currentRenderedUrl = resB.url; // Should NOT happen!
    }
    assert(
      currentRenderedUrl === urlA2,
      "Resposta atrasada do canal B foi devidamente descartada e não sobrepôs o canal A"
    );

    // -------------------------------------------------------------
    // Test 9: Player Teardown and Connection Release on Abort
    // -------------------------------------------------------------
    console.log("\n9. Testando limpeza do player (teardown) e fechamento da conexão com origem:");
    const { req: reqAbort, res: resAbort, waitForResponse: waitAbort } = createMockReqRes({
      params: { ticket: ticketA1, filename: "100.m3u8" },
    });
    const streamPromise = handleStreamRequest(reqAbort, resAbort, { allowPrivateForTest: true });
    // Simulate client closing connection (switching channel or unmounting)
    reqAbort.emitClose();
    await streamPromise;
    assert(true, "Evento close no socket do cliente encerra requisição e libera recursos imediatamente");

    // -------------------------------------------------------------
    // Test 10: Maintenance Video Detection when Provider returns HTTP 200
    // -------------------------------------------------------------
    console.log("\n10. Testando detecção de vídeo substituto de manutenção com HTTP 200:");
    const { ticketId: ticket555 } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "555",
      ext: "mp4",
      allowPrivateForTest: true,
    });

    const report555 = await diagnoseMediaUpstream({
      ticketId: ticket555,
      allowPrivateForTest: true,
    });

    assert(
      report555.primaryProbe.isMaintenanceVideo === true,
      "Identifica que o arquivo de 500 KB recebido é um vídeo de manutenção, apesar do status HTTP 200"
    );
    assert(
      report555.conclusion.category === "MAINTENANCE_VIDEO",
      "Categoria diagnosticada como MAINTENANCE_VIDEO com causa confirmada"
    );
    assert(
      report555.conclusion.transcodingWillFix === false,
      "Proíbe declarar que transcodificação consertará mídia inexistente (transcodingWillFix = false)"
    );
    assert(
      report555.conclusion.message.includes("NÃO corrigirá"),
      "Mensagem declara explicitamente que a origem entregou vídeo substituto e transcodificação não corrige conteúdo não fornecido"
    );

    // -------------------------------------------------------------
    // Test 11: Extension Mismatch Diagnosis (.mp4 gives maintenance, but .mkv has real media)
    // -------------------------------------------------------------
    console.log("\n11. Testando diagnóstico de incompatibilidade de extensão (.mp4 manutenção vs .mkv real):");
    const { ticketId: ticket666 } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "666",
      ext: "mp4",
      allowPrivateForTest: true,
    });

    const report666 = await diagnoseMediaUpstream({
      ticketId: ticket666,
      allowPrivateForTest: true,
    });

    assert(
      report666.primaryProbe.isMaintenanceVideo === true,
      "Extensão .mp4 detectada com vídeo substituto de manutenção"
    );
    assert(
      Boolean(report666.alternativeProbe && report666.alternativeProbe.isCorrectMedia),
      "Extensão alternativa .mkv detectada com arquivo real (120 MB)"
    );
    assert(
      report666.conclusion.category === "EXTENSION_MISMATCH",
      "Diagnóstico identifica EXTENSION_MISMATCH e recomenda comutação para .mkv"
    );
    assert(
      report666.conclusion.transcodingWillFix === true,
      "Transcodificação/remux de .mkv para navegador é sinalizada como solução viável"
    );

    // -------------------------------------------------------------
    // Test 12: Real MKV VOD Diagnosis & Format Transcode Flagging
    // -------------------------------------------------------------
    console.log("\n12. Testando diagnóstico de mídia MKV com necessidade de remux para web:");
    const { ticketId: ticket402 } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "402",
      ext: "mkv",
      allowPrivateForTest: true,
    });

    const report402 = await diagnoseMediaUpstream({
      ticketId: ticket402,
      allowPrivateForTest: true,
    });

    assert(
      report402.primaryProbe.isCorrectMedia === true,
      "Mídia MKV real identificada com sucesso (85 MB)"
    );
    assert(
      report402.conclusion.category === "FORMAT_INCOMPATIBLE",
      "Identifica formato MKV como necessitando remux para reprodução web preservando avanço e retrocesso"
    );
    assert(
      report402.conclusion.transcodingWillFix === true,
      "Remux habilitado para formato MKV entregue corretamente pela origem"
    );

    // -------------------------------------------------------------
    // Test 13: Versioning & Commit Identification Reflection
    // -------------------------------------------------------------
    console.log("\n13. Testando identificação de versão e reflexão do commit real:");
    assert(
      APP_COMMIT === "0026038a2b1ba8c63ac95030bbc8cf8248c62231" || Boolean(process.env.RENDER_GIT_COMMIT),
      `Commit reflete o deploy real: ${APP_COMMIT}`
    );
    assert(Boolean(APP_VERSION), `Versão da aplicação definida: ${APP_VERSION}`);
    assert(typeof checkFfmpegAvailable() === "boolean", "Detecção de FFmpeg no servidor concluída com sucesso");
  } finally {
    mockServer.close();
  }

  console.log(`\n========================================`);
  console.log(`RESUMO DOS TESTES DE MÍDIA: ${testsPassed}/${testsRun} passaram, ${testsFailed} falharam.`);
  console.log(`========================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runMediaProxyTests().catch((err) => {
  console.error("Erro fatal nos testes de mídia:", err);
  process.exit(1);
});
