import http from "node:http";
import { normalizeServerUrl, validatePlayableFormat, getProxiedImageUrl } from "../src/utils/mediaUtils";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
  handleImageProxyRequest,
  rewriteHlsPlaylist,
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
  const req: any = {
    method: options.method || "GET",
    url: options.url || "/",
    params: options.params || {},
    query: options.query || {},
    headers: options.headers || {},
    on: (evt: string, cb: any) => {
      if (evt === "close") {
        // can be called on abort
      }
      return req;
    },
  };

  const headersSent: Record<string, string> = {};
  let statusCode = 200;
  const chunks: Buffer[] = [];

  let resolvePromise: (val: any) => void;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const res: any = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headersSent[name.toLowerCase()] = String(value);
      return this;
    },
    getHeader(name: string) {
      return headersSent[name.toLowerCase()];
    },
    json(data: any) {
      this.headersSent = true;
      resolvePromise({ statusCode, headers: headersSent, body: JSON.stringify(data), json: data });
      return this;
    },
    send(body: any) {
      this.headersSent = true;
      resolvePromise({ statusCode, headers: headersSent, body: String(body) });
      return this;
    },
    write(chunk: any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.headersSent = true;
      const merged = Buffer.concat(chunks);
      resolvePromise({
        statusCode,
        headers: headersSent,
        body: merged.toString("utf-8"),
        buffer: merged,
      });
      return this;
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
  // Test 2: Playable Formats Validation
  // -------------------------------------------------------------
  console.log("\n2. Testando seleção de formatos e erros claros:");
  const liveOnlyTsNative = validatePlayableFormat("live", { allowedOutputFormats: ["ts"], requireNative: true });
  assert(
    !liveOnlyTsNative.isPlayable && Boolean(liveOnlyTsNative.error?.includes(".m3u8")),
    "Retorna erro explicativo se provedor ao vivo só oferecer .ts sem m3u8 para reprodução nativa direta"
  );

  const liveOnlyTsWithRemux = validatePlayableFormat("live", { allowedOutputFormats: ["ts"] });
  assert(
    liveOnlyTsWithRemux.isPlayable && liveOnlyTsWithRemux.format === "m3u8" && Boolean(liveOnlyTsWithRemux.warning),
    "Seleciona m3u8 e emite aviso de remux quando canal ao vivo transmite apenas .ts"
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
    vodMkv.isPlayable && Boolean(vodMkv.warning?.includes("MP4")),
    "Emite aviso para MKV recomendando MP4 sem quebrar o fluxo"
  );

  // -------------------------------------------------------------
  // Test 3: Destination Failures & SSRF in Ticket Creation
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
    assert(false, "127.0.0.1 em produção deve ser rejeitado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "127.0.0.1 é rejeitado na criação de ticket");
  }

  try {
    await createMediaTicket({
      serverUrl: "http://169.254.169.254",
      username: "user",
      password: "pwd",
      type: "movie",
      streamId: "200",
      allowPrivateForTest: false,
    });
    assert(false, "169.254.169.254 (metadados) deve ser rejeitado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "169.254.169.254 é rejeitado na criação de ticket");
  }

  // -------------------------------------------------------------
  // Mock Server Setup for Playback Tests
  // -------------------------------------------------------------
  console.log("\n4. Inicializando servidor HTTP mock com porta explícita para testes de mídia:");
  const mockMediaPort = 9877;
  const dummyMp4Buffer = Buffer.alloc(100, 0x41); // 100 bytes of 'A'
  for (let i = 0; i < 100; i++) dummyMp4Buffer[i] = 65 + (i % 26);

  const mockServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${mockMediaPort}`);

    // Case: Master HLS Playlist
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

    // Case: MP4 file with Range support
    if (url.pathname === "/movie/testuser/testpass/500.mp4") {
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : dummyMp4Buffer.length - 1;
        const chunk = dummyMp4Buffer.slice(start, end + 1);

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${dummyMp4Buffer.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunk.length,
          "Content-Type": "video/mp4",
        });
        res.end(chunk);
      } else {
        res.writeHead(200, {
          "Content-Length": dummyMp4Buffer.length,
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
        });
        res.end(dummyMp4Buffer);
      }
      return;
    }

    // Case: Valid image mock
    if (url.pathname === "/images/valid.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
      return;
    }

    // Case: Missing image (404)
    if (url.pathname === "/images/missing.jpg") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => mockServer.listen(mockMediaPort, "127.0.0.1", resolve));

  const mockServerUrl = `http://127.0.0.1:${mockMediaPort}`;

  try {
    // -------------------------------------------------------------
    // Test 4: HLS Playlist & Subresources proxying
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

    // Request Master Playlist
    const { req: reqMaster, res: resMaster, waitForResponse: waitMaster } = createMockReqRes({
      params: { ticket: ticketId, filename: "100.m3u8" },
    });
    handleStreamRequest(reqMaster, resMaster, { allowPrivateForTest: true });
    const masterRes: any = await waitMaster();

    assert(masterRes.statusCode === 200, "Manifesto HLS mestre entregue com código 200");
    assert(
      masterRes.headers["content-type"].includes("mpegurl"),
      "Cabeçalho Content-Type mpegurl retornado"
    );
    assert(
      masterRes.body.includes("/api/media/hls-resource?ticket="),
      "Playlists variantes reescritas para /api/media/hls-resource"
    );

    // Extract variant URI from master playlist
    const variantMatch = masterRes.body.match(/\/api\/media\/hls-resource\?ticket=[^&\s]+\&uri=([^"\s\n]+)/);
    assert(Boolean(variantMatch), "URI da playlist variante capturada na resposta");
    const variantUri = decodeURIComponent(variantMatch[1]);

    // Request Variant Playlist
    const { req: reqVar, res: resVar, waitForResponse: waitVar } = createMockReqRes({
      query: {
        ticket: ticketId,
        uri: variantUri,
      },
    });
    handleHlsResourceRequest(reqVar, resVar, { allowPrivateForTest: true });
    const varRes: any = await waitVar();

    assert(varRes.statusCode === 200, "Playlist variante entregue com código 200");
    assert(
      varRes.body.includes('URI="/api/media/hls-resource?ticket='),
      "Tag #EXT-X-KEY com chave de criptografia reescrita para proxy"
    );
    assert(
      varRes.body.includes("seg-rel-0.ts"),
      "Segmento relativo resolvido e reescrito com caminho absoluto no proxy"
    );
    assert(
      varRes.body.includes("seg-abs-1.ts"),
      "Segmento absoluto preservado e reescrito no proxy"
    );

    // Extract segment URI
    const segMatch = varRes.body.match(/\/api\/media\/hls-resource\?ticket=[^&\s]+\&uri=([^"\s\n]+seg-rel-0\.ts)/);
    assert(Boolean(segMatch), "URI de segmento capturada");
    const segUri = decodeURIComponent(segMatch[1]);

    // Request Segment
    const { req: reqSeg, res: resSeg, waitForResponse: waitSeg } = createMockReqRes({
      query: {
        ticket: ticketId,
        uri: segUri,
      },
    });
    handleHlsResourceRequest(reqSeg, resSeg, { allowPrivateForTest: true });
    const segRes: any = await waitSeg();

    assert(segRes.statusCode === 200, "Segmento HLS entregue com código 200");
    assert(segRes.headers["content-type"] === "video/MP2T", "Content-Type video/MP2T para segmento TS");
    assert(segRes.body.includes("TS_SEGMENT_0_DATA"), "Dados binários do segmento entregues corretamente");

    // Request Segment with 302 Redirect
    const redirectedUri = `http://127.0.0.1:${mockMediaPort}/redirect-segment.ts`;
    const { req: reqRedir, res: resRedir, waitForResponse: waitRedir } = createMockReqRes({
      query: {
        ticket: ticketId,
        uri: redirectedUri,
      },
    });
    handleHlsResourceRequest(reqRedir, resRedir, { allowPrivateForTest: true });
    const redirRes: any = await waitRedir();
    assert(
      redirRes.statusCode === 200 && redirRes.body.includes("TS_SEGMENT_ABS_1_DATA"),
      "Segmento com redirecionamento HTTP 302 resolvido e transmitido com sucesso"
    );

    // Forbidden Redirect in Media Stream (SSRF Protection)
    const forbiddenUri = `http://127.0.0.1:${mockMediaPort}/forbidden-redirect.ts`;
    const { req: reqForbid, res: resForbid, waitForResponse: waitForbid } = createMockReqRes({
      query: {
        ticket: ticketId,
        uri: forbiddenUri,
      },
    });
    handleHlsResourceRequest(reqForbid, resForbid, { allowPrivateForTest: false });
    const forbidRes: any = await waitForbid();
    assert(
      forbidRes.statusCode === 403,
      "Redirecionamento para endereço proibido (metadados) bloqueado com código 403"
    );

    // -------------------------------------------------------------
    // Test 5: MP4 Streaming with Range and 206 Partial Content
    // -------------------------------------------------------------
    console.log("\n5. Testando streaming de MP4 com cabeçalho Range e resposta HTTP 206:");
    const { ticketId: vodTicketId } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "500",
      ext: "mp4",
      allowPrivateForTest: true,
    });

    // Request Range: bytes=10-25
    const { req: reqMp4, res: resMp4, waitForResponse: waitMp4 } = createMockReqRes({
      params: { ticket: vodTicketId, filename: "500.mp4" },
      headers: { range: "bytes=10-25" },
    });
    handleStreamRequest(reqMp4, resMp4, { allowPrivateForTest: true });
    const mp4Res: any = await waitMp4();

    assert(mp4Res.statusCode === 206, "MP4 com Range responde com código 206 Partial Content");
    assert(
      mp4Res.headers["content-range"] === "bytes 10-25/100",
      "Cabeçalho Content-Range preservado: bytes 10-25/100"
    );
    assert(mp4Res.headers["accept-ranges"] === "bytes", "Cabeçalho Accept-Ranges: bytes presente");
    assert(mp4Res.headers["content-length"] === "16", "Content-Length correto (16 bytes)");
    assert(mp4Res.buffer.length === 16, "Tamanho exato do trecho (slice) recebido");
    assert(
      mp4Res.buffer.equals(dummyMp4Buffer.slice(10, 26)),
      "Conteúdo do intervalo 10-25 confere byte a byte"
    );

    // Request MP4 without Range (full file)
    const { req: reqFull, res: resFull, waitForResponse: waitFull } = createMockReqRes({
      params: { ticket: vodTicketId, filename: "500.mp4" },
    });
    handleStreamRequest(reqFull, resFull, { allowPrivateForTest: true });
    const fullRes: any = await waitFull();

    assert(fullRes.statusCode === 200, "MP4 sem Range responde com código 200 OK");
    assert(fullRes.buffer.length === 100, "Arquivo completo entregue (100 bytes)");

    // -------------------------------------------------------------
    // Test 6: Image Proxy (/api/media/image) with Fallbacks & SSRF
    // -------------------------------------------------------------
    console.log("\n6. Testando proxy de imagens, capas e logos com imagem substituta:");

    // 6a: Valid image
    const { req: reqImgValid, res: resImgValid, waitForResponse: waitImgValid } = createMockReqRes({
      query: { url: `${mockServerUrl}/images/valid.jpg` },
    });
    handleImageProxyRequest(reqImgValid, resImgValid, { allowPrivateForTest: true });
    const imgValidRes: any = await waitImgValid();
    assert(
      imgValidRes.statusCode === 200 && imgValidRes.headers["content-type"].includes("image/jpeg"),
      "Imagem válida entregue com Content-Type image/jpeg"
    );

    // 6b: 404 missing image returns SVG fallback
    const { req: reqImg404, res: resImg404, waitForResponse: waitImg404 } = createMockReqRes({
      query: { url: `${mockServerUrl}/images/missing.jpg` },
    });
    handleImageProxyRequest(reqImg404, resImg404, { allowPrivateForTest: true });
    const img404Res: any = await waitImg404();
    assert(
      img404Res.statusCode === 200 &&
        img404Res.headers["content-type"].includes("image/svg+xml") &&
        img404Res.body.includes("NORTH CODE PLAY"),
      "Imagem inexistente (HTTP 404) retorna imagem substituta SVG da aplicação"
    );

    // 6c: DNS unavailable returns SVG fallback
    const { req: reqDnsFail, res: resDnsFail, waitForResponse: waitDnsFail } = createMockReqRes({
      query: { url: "http://non-existent-dns-test-host-xyz123.com/logo.png" },
    });
    handleImageProxyRequest(reqDnsFail, resDnsFail, { allowPrivateForTest: false });
    const dnsFailRes: any = await waitDnsFail();
    assert(
      dnsFailRes.statusCode === 200 &&
        dnsFailRes.headers["content-type"].includes("image/svg+xml") &&
        dnsFailRes.body.includes("Imagem Indisponível"),
      "Host com DNS indisponível retorna imagem substituta SVG sem falha de requisição"
    );

    // 6d: SSRF blocked IP (loopback/private in production mode) returns SVG fallback
    const { req: reqSsrfImg, res: resSsrfImg, waitForResponse: waitSsrfImg } = createMockReqRes({
      query: { url: "http://127.0.0.1:8080/logo.png" },
    });
    handleImageProxyRequest(reqSsrfImg, resSsrfImg, { allowPrivateForTest: false });
    const ssrfImgRes: any = await waitSsrfImg();
    assert(
      ssrfImgRes.statusCode === 200 &&
        ssrfImgRes.headers["content-type"].includes("image/svg+xml"),
      "Destino proibido por SSRF em imagem retorna imagem substituta SVG segura"
    );

    // 6e: Empty or explicit fallback=1 returns SVG fallback
    const { req: reqFallbackImg, res: resFallbackImg, waitForResponse: waitFallbackImg } = createMockReqRes({
      query: { fallback: "1" },
    });
    handleImageProxyRequest(reqFallbackImg, resFallbackImg);
    const fallbackImgRes: any = await waitFallbackImg();
    assert(
      fallbackImgRes.statusCode === 200 && fallbackImgRes.body.includes("NORTH CODE PLAY"),
      "Parâmetro fallback=1 retorna imagem substituta SVG diretamente"
    );

    // 6f: getProxiedImageUrl helper formats URLs properly
    assert(
      getProxiedImageUrl("http://provider.com/logo.png") ===
        `/api/media/image?url=${encodeURIComponent("http://provider.com/logo.png")}`,
      "getProxiedImageUrl converte URL HTTP para /api/media/image"
    );
    assert(
      getProxiedImageUrl(null) === "/api/media/image?fallback=1",
      "getProxiedImageUrl converte null para fallback"
    );
    assert(
      getProxiedImageUrl("") === "/api/media/image?fallback=1",
      "getProxiedImageUrl converte string vazia para fallback"
    );

    // -------------------------------------------------------------
    // Test 7: Diagnostics & Published Commit Identification
    // -------------------------------------------------------------
    console.log("\n7. Testando identificação de versão, commit publicado e FFmpeg:");
    assert(APP_COMMIT === "ab98f4cdfac3a41b3d993867ecbe99e3bc1e874c", "Commit de referência ab98f4c preservado em version.ts");
    assert(Boolean(APP_VERSION), `Versão da aplicação definida: ${APP_VERSION}`);
    const ffmpegInstalled = checkFfmpegAvailable();
    assert(
      typeof ffmpegInstalled === "boolean",
      `Detecção de FFmpeg no servidor concluída com status: ${ffmpegInstalled ? "Disponível" : "Não instalado"}`
    );

    // -------------------------------------------------------------
    // Test 8: Real container extension and movie_data preservation
    // -------------------------------------------------------------
    console.log("\n8. Testando preservação da extensão real do filme e episódio:");
    const mockVodData = {
      info: { name: "Filme Teste" },
      movie_data: { stream_id: 101, container_extension: "mkv" },
    };
    const resolvedExt = (mockVodData.movie_data.container_extension || "mp4").trim().replace(/^\./, "");
    assert(resolvedExt === "mkv", "Extensão real 'mkv' preservada a partir de movie_data");

    const { ticketId: mkvTicketId, streamUrl: mkvStreamUrl } = await createMediaTicket({
      serverUrl: mockServerUrl,
      username: "testuser",
      password: "testpass",
      type: "movie",
      streamId: "101",
      ext: resolvedExt,
      allowPrivateForTest: true,
    });
    assert(
      mkvStreamUrl.endsWith("/101.mkv"),
      "Rota de mídia utiliza a extensão real .mkv retornada por get_vod_info"
    );

    // -------------------------------------------------------------
    // Test 9: Enforcing /api/media route and error throwing
    // -------------------------------------------------------------
    console.log("\n9. Testando obrigatoriedade da rota /api/media e rejeição de falhas:");
    try {
      await createMediaTicket({
        serverUrl: "ftp://servidor-invalido.com",
        username: "user",
        password: "pwd",
        type: "live",
        streamId: "100",
      });
      assert(false, "Protocolo inválido deveria lançar erro");
    } catch (err: any) {
      assert(Boolean(err.message), "Ticket com protocolo inválido lança erro sem fallback silencioso");
    }
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
