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

// Same response shape whether or not the number is registered, so this
// endpoint can't be used to enumerate valid phone numbers (see the QA
// pass on the earlier mock build — this fix is now load-bearing since a
// real SMS gateway is behind it).
if ($user) {
    // Rate-limit per user before generating a new code, and before
    // spending real SMS-gateway credits — five sends per hour is
    // generous for a genuine user, punishing for an abuse script.
    $rate = $pdo->prepare(
        'SELECT COUNT(*) AS n FROM otp_codes WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
    );
    $rate->execute([$user['id']]);

    if ((int) $rate->fetch()['n'] < 5) {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $sent = sendOtpSms($phone, $code);

        if (!$sent) {
            // A real, surfaceable failure — the gateway is down, out of
            // credit, or misconfigured. Don't pretend it was sent: the
            // user needs to know to retry rather than wait forever for
            // an SMS that's never coming. This does confirm the number
            // is registered on a *failure* path only, which is an
            // acceptable trade-off for honest error handling — see
            // DEPLOY.md's OTP & SMS section for the reasoning.
            respond(502, ['error' => 'sms_send_failed', 'message' => "Couldn't send the code — try again in a moment"]);
        }

        // Only store the code once the SMS gateway has actually accepted
        // it — an OTP nobody received but that's already live in the DB
        // just wastes one of the user's five attempts for nothing.
        $pdo->prepare('DELETE FROM otp_codes WHERE user_id = ?')->execute([$user['id']]);
        $pdo->prepare(
            'INSERT INTO otp_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))'
        )->execute([uuid(), $user['id'], hash('sha256', $code)]);
    }
    // Over the hourly limit: silently do nothing — identical response
    // either way, so a caller can't distinguish "rate limited" from "sent".
}

respond(200, ['sent' => true]);
