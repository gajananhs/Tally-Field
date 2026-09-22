<?php
// POST /api/auth/verify-otp.php  { phone, otp }
require __DIR__ . '/../config.php';

$body = json_body();
$phone = trim($body['phone'] ?? '');
$otp = trim($body['otp'] ?? '');

if (!preg_match('/^\d{4,6}$/', $otp)) {
    respond(422, ['error' => 'otp_invalid', 'message' => 'Wrong code, try again']);
}

$stmt = $pdo->prepare('SELECT id, tenant_id, role, name FROM users WHERE phone = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$phone]);
$user = $stmt->fetch();
if (!$user) {
    // Same shape as a wrong code — see send-otp.php's enumeration fix.
    respond(401, ['error' => 'otp_mismatch', 'message' => 'Wrong code, try again']);
}

$stmt = $pdo->prepare(
    'SELECT id, code_hash, attempts FROM otp_codes WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1'
);
$stmt->execute([$user['id']]);
$code = $stmt->fetch();

if (!$code || $code['attempts'] >= 5) {
    respond(429, ['error' => 'too_many_attempts', 'message' => 'Too many attempts — try again in 5 min']);
}

if (!hash_equals($code['code_hash'], hash('sha256', $otp))) {
    $pdo->prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?')->execute([$code['id']]);
    respond(401, ['error' => 'otp_mismatch', 'message' => 'Wrong code, try again']);
}

$pdo->prepare('DELETE FROM otp_codes WHERE user_id = ?')->execute([$user['id']]);

$token = bin2hex(random_bytes(32));
$expiresInterval = $user['role'] === 'rep' ? '30 DAY' : '7 DAY';
$pdo->prepare(
    "INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL $expiresInterval))"
)->execute([uuid(), $user['tenant_id'], $user['id'], hash('sha256', $token)]);

respond(200, [
    'token' => $token,
    'user' => ['id' => $user['id'], 'name' => $user['name'], 'role' => $user['role']],
    'tenant_id' => $user['tenant_id'],
]);
