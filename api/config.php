<?php
// ============================================================
// TallyField — shared config, DB connection, auth helpers
// Every endpoint file requires this first.
// ============================================================

declare(strict_types=1);

// --- .env loader --------------------------------------------------
// Real hosting env vars (set in a control panel) always win; this only
// fills in what isn't already set, so it's safe in any environment.
function loadEnvFile(string $path): void {
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        if (getenv($key) === false) {
            putenv("$key=$value");
        }
    }
}
loadEnvFile(__DIR__ . '/.env');

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// --- CORS -------------------------------------------------------------
// Needed when the frontend (e.g. a GitHub Pages build) and this API run
// on different origins. ALLOWED_ORIGINS is comma-separated; an empty
// value disables cross-origin calls (same-origin deployments don't need
// this at all — the header is simply not sent).
$allowedOrigins = array_filter(array_map('trim', explode(',', getenv('ALLOWED_ORIGINS') ?: '')));
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin && in_array($requestOrigin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: $requestOrigin");
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Vary: Origin');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- DB connection --------------------------------------------------
$DB_HOST = getenv('DB_HOST') ?: 'localhost';
$DB_NAME = getenv('DB_NAME') ?: 'tallyfield';
$DB_USER = getenv('DB_USER') ?: 'tallyfield_user';
$DB_PASS = getenv('DB_PASS') ?: '';

try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    logApiError('db_connection_failed', $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'db_connection_failed']);
    exit;
}

// --- small helpers ----------------------------------------------------
function json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
function respond(int $status, array $body): void {
    http_response_code($status);
    echo json_encode($body);
    exit;
}
function uuid(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}
function logApiError(string $kind, string $detail): void {
    error_log(sprintf('[tallyfield-api] %s: %s', $kind, $detail));
}
set_exception_handler(function (Throwable $e) {
    logApiError('uncaught_exception', $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'internal_error']);
});

// ============================================================
// JWT — hand-rolled HS256, no Composer dependency required.
// Standard three-part base64url(header).base64url(payload).signature.
// ============================================================
function b64urlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function b64urlDecode(string $data): string {
    $pad = strlen($data) % 4;
    if ($pad) $data .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($data, '-_', '+/'));
}

/** Issues a signed JWT. $payload gets iat/exp/jti added automatically. */
function issueJwt(array $payload, ?int $ttlMinutes = null): array {
    $secret = getenv('JWT_SECRET');
    if (!$secret || strlen($secret) < 32) {
        // Fail loudly in dev rather than silently signing with a weak
        // default — a short/missing secret makes every token forgeable.
        throw new RuntimeException('JWT_SECRET is missing or too short — set a 32+ byte value in .env');
    }
    $ttl = $ttlMinutes ?? (int) (getenv('JWT_TTL_MINUTES') ?: 60);
    $jti = uuid();
    $now = time();
    $fullPayload = $payload + ['iat' => $now, 'exp' => $now + $ttl * 60, 'jti' => $jti];

    $header = b64urlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $body = b64urlEncode(json_encode($fullPayload));
    $signature = b64urlEncode(hash_hmac('sha256', "$header.$body", $secret, true));

    return ['token' => "$header.$body.$signature", 'jti' => $jti, 'exp' => $fullPayload['exp']];
}

/** Verifies signature + expiry; returns the payload array, or null if invalid/expired. */
function verifyJwt(string $token): ?array {
    $secret = getenv('JWT_SECRET');
    $parts = explode('.', $token);
    if (count($parts) !== 3 || !$secret) return null;
    [$header, $body, $signature] = $parts;

    $expected = b64urlEncode(hash_hmac('sha256', "$header.$body", $secret, true));
    if (!hash_equals($expected, $signature)) return null;

    $payload = json_decode(b64urlDecode($body), true);
    if (!is_array($payload) || !isset($payload['exp']) || $payload['exp'] < time()) return null;

    return $payload;
}

// --- agent authentication (desktop sync agent, not a user session) ----
// The agent authenticates with the per-tenant agent_key from
// tally_connections, generated by api/settings/tally-connection.php —
// never a user's JWT. Every agent-facing endpoint calls this instead of
// requireAuth().
function requireAgent(PDO $pdo): array {
    // Header first; query-string fallback for hosts that strip custom
    // headers before PHP ever sees them (a known shared-hosting quirk) —
    // the agent tries the header, and if every call 401s with
    // missing_agent_key, falls back to ?key=... automatically (see
    // tally_sync_agent.ps1's Invoke-Api function).
    $key = $_SERVER['HTTP_X_AGENT_KEY'] ?? ($_GET['key'] ?? '');
    if ($key === '') {
        respond(401, ['error' => 'missing_agent_key']);
    }
    $stmt = $pdo->prepare('SELECT tenant_id FROM tally_connections WHERE agent_key = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if (!$row) {
        respond(401, ['error' => 'invalid_agent_key']);
    }
    return ['tenant_id' => $row['tenant_id']];
}

// --- session / access-rule resolution ---------------------------------
// Every endpoint calls requireAuth() first. It NEVER trusts tenant_id or
// user_id from the request body — only from the verified JWT. This is
// the single choke point every access rule runs through.
function requireAuth(PDO $pdo, ?string $requiredRole = null): array {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/Bearer\s+(\S+)/', $header, $m)) {
        respond(401, ['error' => 'missing_token']);
    }
    $payload = verifyJwt($m[1]);
    if (!$payload) {
        respond(401, ['error' => 'invalid_or_expired_session']);
    }
    if (!empty($payload['jti'])) {
        $stmt = $pdo->prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?');
        $stmt->execute([$payload['jti']]);
        if ($stmt->fetch()) {
            respond(401, ['error' => 'session_revoked']);
        }
    }
    if ($requiredRole && $payload['role'] !== $requiredRole && !($requiredRole === 'owner' && $payload['role'] === 'admin')) {
        respond(403, ['error' => 'forbidden', 'message' => 'This action requires owner/admin access']);
    }
    // Shape matches what every endpoint already expects: user_id, tenant_id, role, name.
    return ['user_id' => $payload['sub'], 'tenant_id' => $payload['tenant_id'], 'role' => $payload['role'], 'name' => $payload['name'] ?? ''];
}

// ============================================================
// SMS gateway — provider chosen via SMS_PROVIDER in .env.
// Every provider function returns true on success; on failure it logs
// the detail (never the OTP itself) and returns false so the caller can
// give the user an honest "couldn't send" error instead of a false
// "sent" they'll never receive.
// ============================================================
function sendOtpSms(string $phone, string $otp): bool {
    $provider = getenv('SMS_PROVIDER') ?: 'msg91';
    try {
        return match ($provider) {
            'msg91' => sendViaMsg91($phone, $otp),
            'twilio' => sendViaTwilio($phone, $otp),
            'fast2sms' => sendViaFast2Sms($phone, $otp),
            default => throw new RuntimeException("Unknown SMS_PROVIDER: $provider"),
        };
    } catch (Throwable $e) {
        logApiError('sms_send_failed', $e->getMessage());
        return false;
    }
}

/** MSG91 OTP API — DLT-template based, the standard choice for Indian SMS. */
function sendViaMsg91(string $phone, string $otp): bool {
    $authKey = getenv('MSG91_AUTH_KEY');
    $templateId = getenv('MSG91_TEMPLATE_ID');
    if (!$authKey || !$templateId) throw new RuntimeException('MSG91_AUTH_KEY or MSG91_TEMPLATE_ID not configured');

    $ch = curl_init('https://control.msg91.com/api/v5/otp');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['authkey: ' . $authKey, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode([
            'template_id' => $templateId,
            'mobile' => '91' . $phone,
            'otp' => $otp,
            'sender' => getenv('MSG91_SENDER_ID') ?: 'TFIELD',
        ]),
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false) throw new RuntimeException('MSG91 request failed: ' . curl_error($ch));
    $data = json_decode($response, true);
    if ($httpCode >= 300 || ($data['type'] ?? '') === 'error') {
        throw new RuntimeException('MSG91 error: ' . ($data['message'] ?? $response));
    }
    return true;
}

/** Twilio — general-purpose, works outside India too. */
function sendViaTwilio(string $phone, string $otp): bool {
    $sid = getenv('TWILIO_ACCOUNT_SID');
    $token = getenv('TWILIO_AUTH_TOKEN');
    $from = getenv('TWILIO_FROM_NUMBER');
    if (!$sid || !$token || !$from) throw new RuntimeException('Twilio credentials not configured');

    $ch = curl_init("https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_USERPWD => "$sid:$token",
        CURLOPT_POSTFIELDS => http_build_query([
            'To' => '+91' . $phone,
            'From' => $from,
            'Body' => "Your TallyField verification code is $otp. It expires in 5 minutes.",
        ]),
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false) throw new RuntimeException('Twilio request failed: ' . curl_error($ch));
    if ($httpCode >= 300) throw new RuntimeException('Twilio error: ' . $response);
    return true;
}

/** Fast2SMS — India, simple API-key auth, no template pre-registration needed for the "otp" route. */
function sendViaFast2Sms(string $phone, string $otp): bool {
    $apiKey = getenv('FAST2SMS_API_KEY');
    if (!$apiKey) throw new RuntimeException('FAST2SMS_API_KEY not configured');

    $ch = curl_init('https://www.fast2sms.com/dev/bulkV2');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['authorization: ' . $apiKey, 'Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS => http_build_query([
            'route' => 'otp',
            'variables_values' => $otp,
            'numbers' => $phone,
        ]),
        CURLOPT_TIMEOUT => 10,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false) throw new RuntimeException('Fast2SMS request failed: ' . curl_error($ch));
    $data = json_decode($response, true);
    if ($httpCode >= 300 || ($data['return'] ?? false) !== true) {
        throw new RuntimeException('Fast2SMS error: ' . ($data['message'][0] ?? $response));
    }
    return true;
}
