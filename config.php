<?php
// ============================================================
// TallyField — shared config, DB connection, auth helpers
// Every endpoint file requires this first.
// ============================================================

declare(strict_types=1);
header('Content-Type: application/json');

// --- CORS (same-origin PWA by default; widen only if the API is on a
// different origin from the app shell) ------------------------------
header('X-Content-Type-Options: nosniff');

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

// Every uncaught error lands in one place — see the Launch Checklist's
// "Analytics & error tracking" section. Point this at a real mail/WhatsApp
// webhook in production; a bare error_log is the safe no-op default.
function logApiError(string $kind, string $detail): void {
    error_log(sprintf('[tallyfield-api] %s: %s', $kind, $detail));
}
set_exception_handler(function (Throwable $e) {
    logApiError('uncaught_exception', $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'internal_error']);
});

// --- session / access-rule resolution ---------------------------------
// Every endpoint calls requireAuth() first. It NEVER trusts tenant_id or
// user_id from the request body — only from the session row the token
// resolves to. This is the single choke point every access rule runs through.
function requireAuth(PDO $pdo, ?string $requiredRole = null): array {
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/Bearer\s+(\S+)/', $header, $m)) {
        respond(401, ['error' => 'missing_token']);
    }
    $tokenHash = hash('sha256', $m[1]);

    $stmt = $pdo->prepare(
        'SELECT s.user_id, s.tenant_id, u.role, u.name, u.is_active
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > NOW()'
    );
    $stmt->execute([$tokenHash]);
    $session = $stmt->fetch();

    if (!$session || !$session['is_active']) {
        respond(401, ['error' => 'invalid_or_expired_session']);
    }
    if ($requiredRole && $session['role'] !== $requiredRole && !($requiredRole === 'owner' && $session['role'] === 'admin')) {
        respond(403, ['error' => 'forbidden', 'message' => 'This action requires owner/admin access']);
    }
    return $session; // ['user_id', 'tenant_id', 'role', 'name']
}
