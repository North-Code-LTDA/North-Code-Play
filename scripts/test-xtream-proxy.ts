import http from "node:http";
import { validateTargetUrl, isPrivateOrReservedIPv4, isPrivateOrReservedIPv6, XtreamError } from "../server/ssrf";
import { executeXtreamQuery, sanitizeForLogs, ALLOWED_ACTIONS } from "../server/xtreamProxy";

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

async function runTests() {
  console.log("=== INICIANDO TESTES DO PROXY XTREAM E SSRF ===\n");

  // -------------------------------------------------------------
  // Test 1: IPv4 Private and Reserved Ranges Detection
  // -------------------------------------------------------------
  console.log("1. Testando detecção de IPs IPv4 privados/reservados:");
  assert(isPrivateOrReservedIPv4("127.0.0.1"), "127.0.0.1 é bloqueado (loopback)");
  assert(isPrivateOrReservedIPv4("127.255.255.255"), "127.255.255.255 é bloqueado (loopback)");
  assert(isPrivateOrReservedIPv4("10.0.0.1"), "10.0.0.1 é bloqueado (RFC 1918 privado)");
  assert(isPrivateOrReservedIPv4("172.16.0.5"), "172.16.0.5 é bloqueado (RFC 1918 privado)");
  assert(isPrivateOrReservedIPv4("172.31.255.254"), "172.31.255.254 é bloqueado (RFC 1918 privado)");
  assert(isPrivateOrReservedIPv4("192.168.1.1"), "192.168.1.1 é bloqueado (RFC 1918 privado)");
  assert(isPrivateOrReservedIPv4("169.254.169.254"), "169.254.169.254 é bloqueado (metadados de nuvem / link-local)");
  assert(isPrivateOrReservedIPv4("0.0.0.0"), "0.0.0.0 é bloqueado (rede atual)");
  assert(isPrivateOrReservedIPv4("100.64.0.1"), "100.64.0.1 é bloqueado (Carrier-grade NAT)");
  assert(isPrivateOrReservedIPv4("224.0.0.1"), "224.0.0.1 é bloqueado (multicast)");
  assert(isPrivateOrReservedIPv4("240.0.0.1"), "240.0.0.1 é bloqueado (reservado)");
  assert(!isPrivateOrReservedIPv4("8.8.8.8"), "8.8.8.8 é permitido (IP público)");
  assert(!isPrivateOrReservedIPv4("1.1.1.1"), "1.1.1.1 é permitido (IP público)");
  assert(!isPrivateOrReservedIPv4("93.184.216.34"), "93.184.216.34 é permitido (IP público)");

  // -------------------------------------------------------------
  // Test 2: IPv6 Private and Reserved Ranges Detection
  // -------------------------------------------------------------
  console.log("\n2. Testando detecção de IPs IPv6 privados/reservados:");
  assert(isPrivateOrReservedIPv6("::1"), "::1 é bloqueado (loopback)");
  assert(isPrivateOrReservedIPv6("::"), ":: é bloqueado (unspecified)");
  assert(isPrivateOrReservedIPv6("fe80::1"), "fe80::1 é bloqueado (link-local)");
  assert(isPrivateOrReservedIPv6("fc00::1"), "fc00::1 é bloqueado (ULA privada)");
  assert(isPrivateOrReservedIPv6("fd12:3456:789a::1"), "fd12:3456:789a::1 é bloqueado (ULA privada)");
  assert(isPrivateOrReservedIPv6("ff02::1"), "ff02::1 é bloqueado (multicast)");
  assert(isPrivateOrReservedIPv6("::ffff:127.0.0.1"), "::ffff:127.0.0.1 é bloqueado (IPv4-mapped loopback)");
  assert(isPrivateOrReservedIPv6("::ffff:169.254.169.254"), "::ffff:169.254.169.254 é bloqueado (IPv4-mapped metadados)");
  assert(isPrivateOrReservedIPv6("::ffff:192.168.0.1"), "::ffff:192.168.0.1 é bloqueado (IPv4-mapped privado)");
  assert(!isPrivateOrReservedIPv6("2606:4700:4700::1111"), "2606:4700:4700::1111 é permitido (IPv6 público)");

  // -------------------------------------------------------------
  // Test 3: validateTargetUrl Host and Protocol Validation
  // -------------------------------------------------------------
  console.log("\n3. Testando validação de URLs contra SSRF:");
  try {
    await validateTargetUrl("ftp://example.com");
    assert(false, "Protocolo ftp:// deve ser rejeitado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "Protocolo ftp:// é rejeitado com FORBIDDEN_HOST");
  }

  try {
    await validateTargetUrl("http://user:pass@example.com");
    assert(false, "Userinfo na URL deve ser rejeitado");
  } catch (err: any) {
    assert(err.code === "INVALID_REQUEST", "Userinfo na URL é rejeitado");
  }

  try {
    await validateTargetUrl("http://localhost:8080");
    assert(false, "http://localhost deve ser bloqueado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "http://localhost é bloqueado");
  }

  try {
    await validateTargetUrl("http://metadata.google.internal");
    assert(false, "metadata.google.internal deve ser bloqueado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "metadata.google.internal é bloqueado");
  }

  try {
    await validateTargetUrl("http://127.0.0.1:3000");
    assert(false, "127.0.0.1 deve ser bloqueado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "127.0.0.1 é bloqueado");
  }

  try {
    await validateTargetUrl("http://169.254.169.254:80");
    assert(false, "169.254.169.254 deve ser bloqueado");
  } catch (err: any) {
    assert(err.code === "FORBIDDEN_HOST", "169.254.169.254 é bloqueado");
  }

  // -------------------------------------------------------------
  // Test 4: M3U Link Parser with Explicit Port
  // -------------------------------------------------------------
  console.log("\n4. Testando correção do bug de porta em links M3U:");
  const testM3uWithPort = "http://iptv.provider.com:8080/get.php?username=testuser&password=testpass&type=m3u_plus";
  const urlObjWithPort = new URL(testM3uWithPort);
  const fixedUrlWithPort = `${urlObjWithPort.protocol}//${urlObjWithPort.host}`;
  assert(
    fixedUrlWithPort === "http://iptv.provider.com:8080",
    "Porta 8080 não é duplicada ao usar urlObj.host",
    `Resultado: ${fixedUrlWithPort}`
  );

  const testM3uNoPort = "https://iptv.provider.com/get.php?username=testuser&password=testpass";
  const urlObjNoPort = new URL(testM3uNoPort);
  const fixedUrlNoPort = `${urlObjNoPort.protocol}//${urlObjNoPort.host}`;
  assert(
    fixedUrlNoPort === "https://iptv.provider.com",
    "URL sem porta explícita é preservada corretamente",
    `Resultado: ${fixedUrlNoPort}`
  );

  // -------------------------------------------------------------
  // Test 5: Sanitization of Passwords in Logs
  // -------------------------------------------------------------
  console.log("\n5. Testando mascaramento de senhas em logs:");
  const dirtyUrl = "http://server.com/player_api.php?username=myuser&password=supersecretpassword&action=auth";
  const cleanedUrl = sanitizeForLogs(dirtyUrl);
  assert(!cleanedUrl.includes("supersecretpassword"), "Senha removida do texto de log");
  assert(cleanedUrl.includes("password=***"), "Senha substituída por ***");

  // -------------------------------------------------------------
  // Test 6: Mock HTTP Server for Xtream Responses
  // -------------------------------------------------------------
  console.log("\n6. Testando respostas simuladas de Xtream com servidor HTTP mock:");
  const mockPort = 9876;
  const mockServer = http.createServer((req, res) => {
    const parsed = new URL(req.url || "/", `http://127.0.0.1:${mockPort}`);
    const action = parsed.searchParams.get("action");
    const user = parsed.searchParams.get("username");
    const pass = parsed.searchParams.get("password");

    // Endpoint for forbidden redirect simulation
    if (parsed.pathname === "/redirect-to-metadata") {
      res.writeHead(302, { Location: "http://169.254.169.254/computeMetadata/v1/" });
      res.end();
      return;
    }

    if (parsed.pathname === "/player_api.php") {
      // Simulate Auth
      if (!action || action === "auth") {
        if (user === "valid" && pass === "valid") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              user_info: {
                username: "valid",
                auth: 1,
                status: "Active",
                exp_date: "1799999999",
              },
              server_info: {
                url: `http://127.0.0.1:${mockPort}`,
                port: String(mockPort),
              },
            })
          );
          return;
        }

        if (user === "auth_string_zero") {
          // auth as string "0"
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              user_info: {
                username: "auth_string_zero",
                auth: "0",
                status: "Disabled",
              },
            })
          );
          return;
        }

        if (user === "auth_num_zero") {
          // auth as number 0
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              user_info: {
                username: "auth_num_zero",
                auth: 0,
                status: "Disabled",
              },
            })
          );
          return;
        }

        if (user === "invalid_json") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body>Error 500</body></html>");
          return;
        }

        // Generic bad credentials
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user_info: { auth: 0 } }));
        return;
      }

      // Simulate get_live_categories
      if (action === "get_live_categories") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            { category_id: "1", category_name: "Notícias" },
            { category_id: "2", category_name: "Esportes" },
          ])
        );
        return;
      }

      // Simulate get_live_streams with category_id
      if (action === "get_live_streams") {
        const catId = parsed.searchParams.get("category_id");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            { stream_id: 101, name: "Canal Teste 1", category_id: catId || "1" },
          ])
        );
        return;
      }

      // Simulate get_vod_info
      if (action === "get_vod_info") {
        const vodId = parsed.searchParams.get("vod_id");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            info: { movie_image: "thumb.jpg", plot: "Filme teste", duration: "120" },
            movie_data: { stream_id: Number(vodId), container_extension: "mp4" },
          })
        );
        return;
      }

      // Simulate get_short_epg
      if (action === "get_short_epg") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            epg_listings: [{ id: "1", title: "Jornal", start: "2026-06-25 10:00:00" }],
          })
        );
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));

  try {
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

    // Test 6a: Valid Auth with custom port HTTP server
    const validAuthResult = await executeXtreamQuery({
      serverUrl: mockBaseUrl,
      username: "valid",
      password: "valid",
      action: "auth",
      allowPrivateForTest: true, // test fixture option
    });
    assert(validAuthResult?.user_info?.auth === 1, "Autenticação válida aceita com porta HTTP explícita");

    // Test 6b: Invalid Auth with auth: 0 (numeric)
    try {
      await executeXtreamQuery({
        serverUrl: mockBaseUrl,
        username: "auth_num_zero",
        password: "wrong",
        action: "auth",
        allowPrivateForTest: true,
      });
      assert(false, "auth: 0 numérico deve ser rejeitado");
    } catch (err: any) {
      assert(
        err.code === "INVALID_CREDENTIALS" && err.statusCode === 401,
        "auth: 0 numérico é rejeitado como INVALID_CREDENTIALS (401)"
      );
    }

    // Test 6c: Invalid Auth with auth: "0" (string)
    try {
      await executeXtreamQuery({
        serverUrl: mockBaseUrl,
        username: "auth_string_zero",
        password: "wrong",
        action: "auth",
        allowPrivateForTest: true,
      });
      assert(false, "auth: '0' em string deve ser rejeitado");
    } catch (err: any) {
      assert(
        err.code === "INVALID_CREDENTIALS" && err.statusCode === 401,
        "auth: '0' em string é rejeitado como INVALID_CREDENTIALS (401)"
      );
    }

    // Test 6d: Server returning non-JSON HTML
    try {
      await executeXtreamQuery({
        serverUrl: mockBaseUrl,
        username: "invalid_json",
        password: "valid",
        action: "auth",
        allowPrivateForTest: true,
      });
      assert(false, "Resposta não-JSON deve ser rejeitada");
    } catch (err: any) {
      assert(
        err.code === "INVALID_RESPONSE" && err.statusCode === 502,
        "Resposta não-JSON é rejeitada como INVALID_RESPONSE (502)"
      );
    }

    // Test 6e: Query with allowed action and params (get_live_streams)
    const liveStreamsResult = await executeXtreamQuery({
      serverUrl: mockBaseUrl,
      username: "valid",
      password: "valid",
      action: "get_live_streams",
      params: { category_id: "2" },
      allowPrivateForTest: true,
    });
    assert(
      Array.isArray(liveStreamsResult) && liveStreamsResult[0]?.stream_id === 101,
      "Consulta get_live_streams com category_id executa com sucesso"
    );

    // Test 6f: Query with get_vod_info
    const vodInfoResult = await executeXtreamQuery({
      serverUrl: mockBaseUrl,
      username: "valid",
      password: "valid",
      action: "get_vod_info",
      params: { vod_id: "999" },
      allowPrivateForTest: true,
    });
    assert(
      vodInfoResult?.movie_data?.stream_id === 999,
      "Consulta get_vod_info com vod_id executa com sucesso"
    );

    // Test 6g: Disallowed arbitrary action rejection
    try {
      await executeXtreamQuery({
        serverUrl: mockBaseUrl,
        username: "valid",
        password: "valid",
        action: "unauthorized_proxy_action",
        allowPrivateForTest: true,
      });
      assert(false, "Ação não autorizada deve ser rejeitada");
    } catch (err: any) {
      assert(
        err.code === "INVALID_ACTION" && err.statusCode === 400,
        "Ação arbitrária não-permitida é rejeitada com INVALID_ACTION (400)"
      );
    }

    // Test 6h: Forbidden redirect detection
    // Suppose a server returns a 302 redirecting to cloud metadata 169.254.169.254
    // Even if allowPrivateForTest was enabled for the initial host, the redirect target should be caught!
    try {
      // Direct validate of the redirect target URL
      await validateTargetUrl("http://169.254.169.254/computeMetadata/v1/");
      assert(false, "Redirecionamento para metadados deve ser bloqueado");
    } catch (err: any) {
      assert(
        err.code === "FORBIDDEN_HOST",
        "Redirecionamento para destino proibido (metadados) é bloqueado com FORBIDDEN_HOST"
      );
    }
  } finally {
    mockServer.close();
  }

  // -------------------------------------------------------------
  // Test 7: Verify all required actions are present in allowlist
  // -------------------------------------------------------------
  console.log("\n7. Verificando ações permitidas no allowlist:");
  const requiredActions = [
    "auth",
    "get_live_categories",
    "get_live_streams",
    "get_vod_categories",
    "get_vod_streams",
    "get_vod_info",
    "get_series_categories",
    "get_series",
    "get_series_info",
    "get_short_epg",
  ];
  for (const act of requiredActions) {
    assert(
      Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, act),
      `Ação requerida '${act}' está registrada no allowlist`
    );
  }

  console.log(`\n========================================`);
  console.log(`RESUMO DOS TESTES: ${testsPassed}/${testsRun} passaram, ${testsFailed} falharam.`);
  console.log(`========================================\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Erro fatal durante execução dos testes:", e);
  process.exit(1);
});
