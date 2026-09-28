import dns from "node:dns";
import net from "node:net";

export class XtreamError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 502) {
    super(message);
    this.name = "XtreamError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Checks whether an IPv4 address string is in private, reserved, or loopback ranges.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed is unsafe
  }

  const [p0, p1, p2] = parts;

  // 0.0.0.0/8 (Current network)
  if (p0 === 0) return true;

  // 10.0.0.0/8 (Private RFC 1918)
  if (p0 === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT RFC 6598: 100.64.0.0 - 100.127.255.255)
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (p0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata RFC 3927)
  if (p0 === 169 && p1 === 254) return true;

  // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments RFC 6890)
  if (p0 === 192 && p1 === 0 && p2 === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
  if (p0 === 192 && p1 === 0 && p2 === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast RFC 7526)
  if (p0 === 192 && p1 === 88 && p2 === 99) return true;

  // 192.168.0.0/16 (Private RFC 1918)
  if (p0 === 192 && p1 === 168) return true;

  // 198.18.0.0/15 (Network Interconnect Benchmark RFC 2544: 198.18.0.0 - 198.19.255.255)
  if (p0 === 198 && (p1 === 18 || p1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
  if (p0 === 198 && p1 === 51 && p2 === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
  if (p0 === 203 && p1 === 0 && p2 === 113) return true;

  // 224.0.0.0/4 (Multicast RFC 5771: 224 - 239)
  if (p0 >= 224 && p0 <= 239) return true;

  // 240.0.0.0/4 (Reserved RFC 1112 / Broadcast: 240 - 255)
  if (p0 >= 240) return true;

  return false;
}

/**
 * Expands an IPv6 address string into an array of 8 16-bit hex integers.
 */
function parseIPv6Groups(ip: string): number[] | null {
  const cleanIp = ip.toLowerCase().trim();
  // Handle IPv4-mapped IPv6 like ::ffff:192.168.1.1
  if (cleanIp.includes(".")) {
    const lastColon = cleanIp.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v6Part = cleanIp.slice(0, lastColon);
    const v4Part = cleanIp.slice(lastColon + 1);
    const v4Parts = v4Part.split(".").map(Number);
    if (v4Parts.length !== 4 || v4Parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    const g6 = (v4Parts[0] << 8) + v4Parts[1];
    const g7 = (v4Parts[2] << 8) + v4Parts[3];

    const baseGroups = parseIPv6Groups(v6Part ? `${v6Part}:0:0` : "::0:0");
    if (!baseGroups) return null;
    baseGroups[6] = g6;
    baseGroups[7] = g7;
    return baseGroups;
  }

  const parts = cleanIp.split("::");
  if (parts.length > 2) return null; // multiple "::" is invalid

  const left = parts[0] ? parts[0].split(":").map((h) => parseInt(h, 16)) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":").map((h) => parseInt(h, 16)) : [];

  if (left.some(isNaN) || right.some(isNaN)) return null;

  const total = left.length + right.length;
  if (parts.length === 1 && total !== 8) return null;
  if (total > 8) return null;

  const missing = 8 - total;
  const zeros = Array(missing).fill(0);
  return [...left, ...zeros, ...right];
}

/**
 * Checks whether an IPv6 address is in private, reserved, or loopback ranges.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const groups = parseIPv6Groups(ip);
  if (!groups || groups.length !== 8) return true; // Malformed is unsafe

  // Unspecified ::
  if (groups.every((g) => g === 0)) return true;

  // Loopback ::1
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const v4Str = `${(groups[6] >>> 8) & 255}.${groups[6] & 255}.${(groups[7] >>> 8) & 255}.${groups[7] & 255}`;
    return isPrivateOrReservedIPv4(v4Str);
  }

  // NAT64 / Well-Known prefix 64:ff9b::/96
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const v4Str = `${(groups[6] >>> 8) & 255}.${groups[6] & 255}.${(groups[7] >>> 8) & 255}.${groups[7] & 255}`;
    return isPrivateOrReservedIPv4(v4Str);
  }

  // 6to4 2002::/16
  if (groups[0] === 0x2002) {
    const v4Str = `${(groups[1] >>> 8) & 255}.${groups[1] & 255}.${(groups[2] >>> 8) & 255}.${groups[2] & 255}`;
    if (isPrivateOrReservedIPv4(v4Str)) return true;
  }

  // Unique Local Address fc00::/7 (fc00:: - fdff:ffff:...)
  if ((groups[0] & 0xfe00) === 0xfc00) return true;

  // Link-local Unicast fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;

  // Deprecated Site-local fec0::/10
  if ((groups[0] & 0xffc0) === 0xfec0) return true;

  // Multicast ff00::/8
  if ((groups[0] & 0xff00) === 0xff00) return true;

  // Documentation 2001:db8::/32
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

  // Discard prefix 100::/64
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;

  return false;
}

export function isPrivateOrReservedIP(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return isPrivateOrReservedIPv4(ip);
  } else if (version === 6) {
    return isPrivateOrReservedIPv6(ip);
  }
  return true; // Not a valid IP
}

const BLOCKED_HOST_REGEX = /(\.localhost|\.local|\.internal|\.arpa|\.lan|\.home|\.corp|\.test|\.example|\.invalid|\.onion)$/i;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

/**
 * Validates a target URL against SSRF rules:
 * - Only http: and https: protocols
 * - Port must be a valid port number
 * - Host must not be empty or forbidden loopback/metadata
 * - Resolves DNS and blocks any private/reserved IPv4 or IPv6
 */
export async function validateTargetUrl(
  rawUrl: string,
  options: { allowPrivateForTest?: boolean } = {}
): Promise<{ validatedUrl: URL; cleanBaseUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new XtreamError("INVALID_REQUEST", "URL do servidor inválida.", 400);
  }

  // 1. Check protocol
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new XtreamError(
      "FORBIDDEN_HOST",
      "Protocolo não permitido. Apenas HTTP e HTTPS são aceitos.",
      403
    );
  }

  // 2. Prohibit userinfo in URL
  if (url.username || url.password) {
    throw new XtreamError(
      "INVALID_REQUEST",
      "Credenciais embutidas na URL do servidor não são permitidas.",
      400
    );
  }

  // 3. Extract and sanitize hostname
  let hostname = url.hostname.toLowerCase().trim();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (!hostname) {
    throw new XtreamError("INVALID_REQUEST", "Hostname do servidor não especificado.", 400);
  }

  // Check forbidden hostname patterns
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_REGEX.test(hostname)) {
    if (!options.allowPrivateForTest) {
      throw new XtreamError(
        "FORBIDDEN_HOST",
        "O endereço do servidor não é permitido (endereços locais, privados ou reservados são bloqueados por segurança).",
        403
      );
    }
  }

  // 4. IP check or DNS resolution
  const isDirectIP = net.isIP(hostname);
  if (isDirectIP) {
    if (isPrivateOrReservedIP(hostname)) {
      if (!options.allowPrivateForTest) {
        throw new XtreamError(
          "FORBIDDEN_HOST",
          "O endereço do servidor não é permitido (endereços locais, privados ou reservados são bloqueados por segurança).",
          403
        );
      }
    }
  } else {
    // Resolve DNS
    let addresses: dns.LookupAddress[] = [];
    try {
      addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new XtreamError(
        "CONNECTION_FAILED",
        "Falha ao resolver o nome do servidor Xtream (DNS não encontrado).",
        502
      );
    }

    if (!addresses || addresses.length === 0) {
      throw new XtreamError(
        "CONNECTION_FAILED",
        "Nenhum endereço IP encontrado para o servidor Xtream.",
        502
      );
    }

    // Check ALL resolved IP addresses. If ANY is private/reserved, block!
    for (const record of addresses) {
      if (isPrivateOrReservedIP(record.address)) {
        if (!options.allowPrivateForTest) {
          throw new XtreamError(
            "FORBIDDEN_HOST",
            "O endereço do servidor resolve para uma rede local, privada ou reservada protegida.",
            403
          );
        }
      }
    }
  }

  // 5. Build clean base URL without trailing slash or path
  // url.host automatically includes :port if specified (e.g. "example.com:8080" or "[::1]:8080")
  const cleanBaseUrl = `${url.protocol}//${url.host}`;

  return { validatedUrl: url, cleanBaseUrl };
}
