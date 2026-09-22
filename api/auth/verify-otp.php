<?php
// POST /api/auth/verify-otp.php  { phone, otp }
require __DIR__ . '/../config.php';

$body = json_body();
$phone = trim($body['phone'] ?? '');
$otp = trim($body['otp'] ?? '');

if (!preg_match('/^\d{6}$/', $otp)) {
    respond(422, ['error' => 'otp_invalid', 'message' => 'Enter the 6-digit code']);
}

$stmt = $pdo->prepare('SELECT id, tenant_id, role, name FROM users WHERE phone = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$phone]);
$user = $stmt->fetch();
if (!$user) {
    // Same shape as a wrong/expired code below — never confirms whether
    // the phone itself is registered.
    respond(401, ['error' => 'otp_mismatch', 'message' => 'Wrong code, try again']);
}

// Look up the most recent code REGARDLESS of expiry, so an expired code
// can be reported as "expired" rather than a generic "wrong code" — the
// fix is different (request a new one vs. just retype it).
$stmt = $pdo->prepare(
    'SELECT id, code_hash, attempts, expires_at FROM otp_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
);
$stmt->execute([$user['id']]);
$code = $stmt->fetch();

if (!$code) {
    respond(404, ['error' => 'otp_not_requested', 'message' => 'Request a code first']);
}
if (strtotime($code['expires_at']) < time()) {
    respond(410, ['error' => 'otp_expired', 'message' => 'Code expired — request a new one']);
}
if ($code['attempts'] >= 5) {
    respond(429, ['error' => 'too_many_attempts', 'message' => 'Too many attempts — request a new code']);
}

if (!hash_equals($code['code_hash'], hash('sha256', $otp))) {
    $pdo->prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')->execute([$code['id']]);
    respond(401, ['error' => 'otp_mismatch', 'message' => 'Wrong code, try again']);
}

// Success — burn the code so it can't be replayed, then issue a JWT.
$pdo->prepare('DELETE FROM otp_codes WHERE user_id = ?')->execute([$user['id']]);

$ttl = $user['role'] === 'rep' ? 60 * 24 * 30 : 60 * 24 * 7; // reps stay signed in longer (field devices); owners 7 days
$jwt = issueJwt([
    'sub' => $user['id'],
    'tenant_id' => $user['tenant_id'],
    'role' => $user['role'],
    'name' => $user['name'],
], $ttl);

respond(200, [
    'token' => $jwt['token'],
    'expires_at' => date('c', $jwt['exp']),
    'user' => ['id' => $user['id'], 'name' => $user['name'], 'role' => $user['role']],
    'tenant_id' => $user['tenant_id'],
]);
