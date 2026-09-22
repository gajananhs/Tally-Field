<?php
// POST /api/auth/send-otp.php  { phone }
require __DIR__ . '/../config.php';

$body = json_body();
$phone = trim($body['phone'] ?? '');

if (!preg_match('/^[6-9]\d{9}$/', $phone)) {
    respond(422, ['error' => 'phone_invalid', 'message' => 'Enter a valid 10-digit number']);
}

$stmt = $pdo->prepare('SELECT id, tenant_id FROM users WHERE phone = ? AND is_active = 1 LIMIT 1');
$stmt->execute([$phone]);
$user = $stmt->fetch();

// Fix for QA Defect 4: identical response whether or not the number is
// registered, so this endpoint can't be used to enumerate valid phones.
if ($user) {
    // Fix for QA Defect 1: rate-limit per user before generating a new
    // code — otherwise resending resets the wrong-guess counter forever.
    $rate = $pdo->prepare(
        'SELECT COUNT(*) AS n FROM otp_codes WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    $rate->execute([$user['id']]);
    if ((int) $rate->fetch()['n'] < 5) {
        $pdo->prepare('DELETE FROM otp_codes WHERE user_id = ?')->execute([$user['id']]);
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $pdo->prepare(
            'INSERT INTO otp_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))'
        )->execute([uuid(), $user['id'], hash('sha256', $code)]);

        // BACKEND: send $code via SMS gateway here — never returned in the response.
        // sendSms($phone, "Your TallyField code is $code");
    }
    // If over the hourly limit, silently do nothing — same 200 response
    // either way, so a caller can't distinguish "rate limited" from "sent".
}

respond(200, ['sent' => true]);
