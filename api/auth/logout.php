<?php
// POST /api/auth/logout.php
// JWTs are stateless, so there's nothing to delete by default — this
// endpoint records the token's jti in revoked_tokens so requireAuth()
// rejects it immediately instead of waiting out its natural expiry.
require __DIR__ . '/../config.php';

$header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (preg_match('/Bearer\s+(\S+)/', $header, $m)) {
    $payload = verifyJwt($m[1]);
    if ($payload && !empty($payload['jti'])) {
        $pdo->prepare(
            'INSERT IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))'
        )->execute([$payload['jti'], $payload['sub'], $payload['exp']]);
    }
}
// Always 200, even if the token was already invalid — logout is idempotent.
respond(200, ['ok' => true]);
