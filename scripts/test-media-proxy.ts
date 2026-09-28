import http from "node:http";
import { normalizeServerUrl, validatePlayableFormat } from "../src/utils/mediaUtils";
import {
  createMediaTicket,
  handleStreamRequest,
  handleHlsResourceRequest,
  rewriteHlsPlaylist,
  ticketStore,
} from "../server/mediaProxy";
import { validateTargetUrl } from "../server/ssrf";

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
    on: () => req,
  };

  const headersSent: Record<string, string> = {};
  let statusCode = 200;
  const chunks: Buffer[] = [];
  let finished = false;

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
      finished = true;
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
  const liveOnlyTs = validatePlayableFormat("live", { allowedOutputFormats: ["ts"] });
  assert(
    !liveOnlyTs.isPlayable && liveOnlyTs.error?.includes(".m3u8"),
    "Retorna erro explicativo se provedor ao vivo só oferecer .ts sem m3u8"
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
    vodMkv.isPlayable && vodMkv.warning?.includes("MP4"),
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

    // Case: MP4 Video with Range support
    if (url.pathname === "/movie/testuser/testpass/500.mp4") {
      const rangeHeader = req.headers["range"];
      const totalSize = dummyMp4Buffer.length;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunk = dummyMp4Buffer.slice(start, end + 1);

        res.writeHead(206, {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
        });
        res.end(chunk);
        return;
      }

      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalSize),
      });
      res.end(dummyMp4Buffer);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(mockMediaPort, "127.0.0.1", resolve));

  try {
    const mockServerUrl = `http://127.0.0.1:${mockMediaPort}`;

    // -------------------------------------------------------------
    // Test 4a: Create Ticket on HTTP server with explicit port
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
    assert(
      ticketId.startsWith("t_") && streamUrl.includes(`/api/media/stream/${ticketId}/100.m3u8`),
      "Ticket criado com sucesso em servidor HTTP com porta explícita"
    );

    // -------------------------------------------------------------
    // Test 4b: Stream Master HLS Manifest and Verify Variant Rewriting
    // -------------------------------------------------------------
    const { req: req1, res: res1, waitForResponse: wait1 } = createMockReqRes({
      params: { ticket: ticketId, filename: "100.m3u8" },
    });
    handleStreamRequest(req1, res1, { allowPrivateForTest: true });
    const masterRes: any = await wait1();

    assert(masterRes.statusCode === 200, "Manifesto HLS mestre entregue com código 200");
    assert(
      masterRes.headers["content-type"].includes("mpegurl"),
      "Cabeçalho Content-Type mpegurl retornado"
    );
    assert(
      masterRes.body.includes("/api/media/hls-resource?ticket="),
      "Playlists variantes reescritas para /api/media/hls-resource"
    );

    // Extract the rewritten variant URI
    const variantMatch = masterRes.body.match(/\/api\/media\/hls-resource\?[^\s\r\n]+/);
    assert(!!variantMatch, "URI da playlist variante capturada na resposta");
    const variantUrlObj = new URL(variantMatch[0], "http://localhost");

    // -------------------------------------------------------------
    // Test 4c: Fetch Rewritten Variant Manifest and Check Segment & Key Rewriting
    // -------------------------------------------------------------
    const { req: req2, res: res2, waitForResponse: wait2 } = createMockReqRes({
      query: {
        ticket: variantUrlObj.searchParams.get("ticket")!,
        uri: variantUrlObj.searchParams.get("uri")!,
      },
    });
    handleHlsResourceRequest(req2, res2, { allowPrivateForTest: true });
    const variantRes: any = await wait2();

    assert(variantRes.statusCode === 200, "Playlist variante entregue com código 200");
    assert(
      variantRes.body.includes('URI="/api/media/hls-resource?ticket='),
      "Tag #EXT-X-KEY com chave de criptografia reescrita para proxy"
    );
    assert(
      variantRes.body.includes("seg-rel-0.ts"),
      "Segmento relativo resolvido e reescrito com caminho absoluto no proxy"
    );
    assert(
      variantRes.body.includes("seg-abs-1.ts"),
      "Segmento absoluto preservado e reescrito no proxy"
    );

    // -------------------------------------------------------------
    // Test 4d: Fetch Relative Segment through Proxy
    // -------------------------------------------------------------
    const segMatch = variantRes.body.match(/\/api\/media\/hls-resource\?[^\s\r\n"']*seg-rel-0\.ts[^\s\r\n"']*/);
    assert(!!segMatch, "URI de segmento capturada");
    const segUrlObj = new URL(segMatch[0], "http://localhost");

    const { req: req3, res: res3, waitForResponse: wait3 } = createMockReqRes({
      query: {
        ticket: segUrlObj.searchParams.get("ticket")!,
        uri: segUrlObj.searchParams.get("uri")!,
      },
    });
    handleHlsResourceRequest(req3, res3, { allowPrivateForTest: true });
    const segRes: any = await wait3();

    assert(segRes.statusCode === 200, "Segmento HLS entregue com código 200");
    assert(segRes.headers["content-type"] === "video/MP2T", "Content-Type video/MP2T para segmento TS");
    assert(segRes.body.includes("TS_SEGMENT_"), "Dados binários do segmento entregues corretamente");

    // -------------------------------------------------------------
    // Test 4e: Redirected Segment Resource
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // Test 4f: Forbidden Redirect in Media Stream (SSRF Protection)
    // -------------------------------------------------------------
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
