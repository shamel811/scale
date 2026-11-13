<?php
// Scale Business — واجهة البرمجة (API). كل الطلبات تمر من هنا عبر .htaccess
define('MZ_PRIVATE', getenv('MEZZAN_PRIVATE') ?: dirname(__DIR__, 2) . '/mezzan_private');
require MZ_PRIVATE . '/lib.php';

mb_internal_encoding('UTF-8');
set_exception_handler(function ($e) {
    error_log('mezzan: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    fail('server', 'حدث خطأ في الخادم. حاول مرة أخرى.', 500);
});

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$pos = strpos($path, '/api/');
$route = trim($pos === false ? '' : substr($path, $pos + 5), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Paymob webhook لا يحمل ترويسات CSRF، ويُتحقق منه بالتوقيع
if ($route !== 'billing/webhook') {
    csrf_guard();
}
housekeeping();

switch ($route) {
    case 'plans':          h_plans(); break;
    case 'me':             h_me(); break;
    case 'auth/signup':    h_signup(); break;
    case 'auth/login':     h_login(); break;
    case 'auth/logout':    h_logout(); break;
    case 'auth/forgot':    h_forgot(); break;
    case 'auth/reset':     h_reset(); break;
    case 'auth/password':  h_password(); break;
    case 'doc':            h_doc($method); break;
    case 'poll':           h_poll(); break;
    case 'team':           h_team($method); break;
    case 'billing/checkout': h_checkout(); break;
    case 'billing/webhook':  h_webhook(); break;
    case 'billing/history':  h_history(); break;
    case 'export':         h_export(); break;
    case 'import':         h_import(); break;
    case 'admin/tenants':  h_admin_tenants(); break;
    case 'admin/tenant':   h_admin_tenant(); break;
    case 'admin/payments': h_admin_payments(); break;
    default:               fail('not_found', 'غير موجود.', 404);
}

/* ======================= عام ======================= */
function h_plans()
{
    $pm = cfg('paymob');
    out(['plans' => plans_public(), 'trial_days' => (int) cfg('trial_days'), 'paymob' => !empty($pm['enabled']), 'support' => cfg('support') ?: new stdClass()]);
}

function me_payload($u)
{
    $pm = cfg('paymob');
    $r = ['user' => public_user($u), 'plans' => plans_public(), 'paymob' => !empty($pm['enabled']), 'support' => cfg('support') ?: new stdClass(), 'now' => time()];
    $t = current_tenant($u);
    if ($t) {
        $r['tenant'] = ['id' => (int) $t['id'], 'name' => $t['name'], 'plan' => $t['plan']];
        $r['access'] = access_of($t);
    }
    return $r;
}
function h_me()
{
    $u = current_user(false);
    if (!$u) {
        out(['user' => null, 'plans' => plans_public(), 'trial_days' => (int) cfg('trial_days'), 'support' => cfg('support') ?: new stdClass()]);
    }
    out(me_payload($u));
}

/* ======================= الحسابات ======================= */
function h_signup()
{
    $b = body();
    $ip = client_ip();
    if (throttle_count('su:' . $ip, 3600) >= 10) {
        fail('rate', 'محاولات كثيرة. حاول لاحقاً.', 429);
    }
    $biz = trim((string) ($b['business'] ?? ''));
    $name = trim((string) ($b['name'] ?? ''));
    $email = strtolower(trim((string) ($b['email'] ?? '')));
    $pass = $b['password'] ?? '';
    if ($biz === '' || mb_strlen($biz) > 120) fail('bad_input', 'أدخل اسم النشاط.');
    if ($name === '' || mb_strlen($name) > 100) fail('bad_input', 'أدخل اسمك.');
    if (!valid_email($email)) fail('bad_input', 'بريد إلكتروني غير صالح.');
    check_password($pass);
    if (one("SELECT id FROM users WHERE email=?", [$email])) {
        fail('exists', 'هذا البريد مسجل بالفعل. سجّل الدخول.', 409);
    }
    throttle_hit('su:' . $ip);
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $now = time();
        q("INSERT INTO tenants (name,status,trial_ends_at,created_at) VALUES (?,?,?,?)", [$biz, 'ok', $now + 86400 * (int) cfg('trial_days'), $now]);
        $tid = (int) $pdo->lastInsertId();
        q("INSERT INTO users (tenant_id,role,name,email,pass_hash,active,created_at) VALUES (?,?,?,?,?,1,?)",
            [$tid, 'owner', $name, $email, password_hash($pass, PASSWORD_DEFAULT), $now]);
        $uid = (int) $pdo->lastInsertId();
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
    make_session($uid);
    out(me_payload(one("SELECT * FROM users WHERE id=?", [$uid])), 201);
}

function h_login()
{
    $b = body();
    $login = strtolower(trim((string) ($b['login'] ?? '')));
    $pass = (string) ($b['password'] ?? '');
    if ($login === '' || $pass === '') fail('bad_input', 'أدخل البريد/اسم المستخدم وكلمة المرور.');
    $key = 'li:' . sha1(client_ip() . '|' . $login);
    if (throttle_count($key, 900) >= 8) {
        fail('rate', 'محاولات كثيرة خاطئة. انتظر 15 دقيقة ثم حاول مجدداً.', 429);
    }
    $u = one("SELECT * FROM users WHERE (email=? OR username=?) AND active=1", [$login, $login]);
    if (!$u || !password_verify($pass, $u['pass_hash'])) {
        throttle_hit($key);
        fail('bad_login', 'بيانات الدخول غير صحيحة.', 401);
    }
    q("DELETE FROM login_attempts WHERE k=?", [$key]);
    make_session((int) $u['id']);
    out(me_payload($u));
}

function h_logout()
{
    $tok = $_COOKIE['mz_s'] ?? '';
    if (is_string($tok) && strlen($tok) === 64) {
        q("DELETE FROM sessions WHERE token_hash=?", [hash('sha256', $tok)]);
    }
    set_cookie('', time() - 3600);
    out(['ok' => true]);
}

function h_forgot()
{
    $email = strtolower(trim((string) (body()['email'] ?? '')));
    $ip = client_ip();
    if (valid_email($email) && throttle_count('fp:' . $ip, 3600) < 6) {
        throttle_hit('fp:' . $ip);
        $u = one("SELECT * FROM users WHERE email=? AND active=1", [$email]);
        if ($u) {
            $tok = bin2hex(random_bytes(24));
            q("INSERT INTO resets (token_hash,user_id,expires_at) VALUES (?,?,?)", [hash('sha256', $tok), $u['id'], time() + 3600]);
            $link = rtrim(cfg('app_url'), '/') . '/app/?reset=' . $tok;
            $msg = "مرحباً " . $u['name'] . "،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي (صالح لمدة ساعة):\n" . $link . "\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة.\n\nScale Business";
            $host = parse_url(cfg('app_url'), PHP_URL_HOST);
            $hdr = "From: Scale Business <no-reply@" . $host . ">\r\nContent-Type: text/plain; charset=UTF-8\r\n";
            @mail($email, '=?UTF-8?B?' . base64_encode('إعادة تعيين كلمة المرور - Scale Business') . '?=', $msg, $hdr);
        }
    }
    out(['ok' => true]); // نفس الرد دائماً حتى لا نكشف وجود البريد
}

function h_reset()
{
    $b = body();
    $tok = (string) ($b['token'] ?? '');
    check_password($b['password'] ?? '');
    $r = one("SELECT * FROM resets WHERE token_hash=? AND expires_at>?", [hash('sha256', $tok), time()]);
    if (!$r) fail('bad_token', 'الرابط غير صالح أو منتهي. اطلب رابطاً جديداً.', 400);
    q("UPDATE users SET pass_hash=? WHERE id=?", [password_hash($b['password'], PASSWORD_DEFAULT), $r['user_id']]);
    q("DELETE FROM resets WHERE user_id=?", [$r['user_id']]);
    q("DELETE FROM sessions WHERE user_id=?", [$r['user_id']]);
    out(['ok' => true]);
}

function h_password()
{
    $u = current_user();
    $b = body();
    if (!password_verify((string) ($b['old'] ?? ''), $u['pass_hash'])) {
        fail('bad_login', 'كلمة المرور الحالية غير صحيحة.', 403);
    }
    check_password($b['new'] ?? '');
    q("UPDATE users SET pass_hash=? WHERE id=?", [password_hash($b['new'], PASSWORD_DEFAULT), $u['id']]);
    out(['ok' => true]);
}

/* ======================= البيانات ======================= */
function h_doc($method)
{
    $u = current_user();
    $seg = parse_path($_GET['path'] ?? '');
    if (!is_doc_path($seg)) fail('bad_path', 'المسار ليس مستنداً.');
    list($par, $id) = split_path($seg);
    if ($method === 'GET') {
        $t = data_gate($u, $seg, false);
        $r = doc_get($t['id'], $par, $id);
        out($r ? ['exists' => true, 'data' => json_decode($r['data'], true) ?: new stdClass()] : ['exists' => false]);
    }
    $t = data_gate($u, $seg, true);
    if ($method === 'PUT') {
        $d = body()['data'] ?? null;
        if (!is_array($d) || (count($d) && array_keys($d) === range(0, count($d) - 1))) {
            fail('bad_input', 'صيغة البيانات غير صحيحة.');
        }
        $json = json_encode($d ?: new stdClass(), JSON_UNESCAPED_UNICODE);
        if (strlen($json) > 900000) fail('too_large', 'حجم المستند كبير جداً.', 413);
        doc_put($t['id'], $par, $id, $json);
        out(['ok' => true]);
    }
    if ($method === 'DELETE') {
        doc_del($t['id'], $par, $id);
        out(['ok' => true]);
    }
    fail('method', 'طريقة غير مدعومة.', 405);
}

function h_poll()
{
    $u = current_user();
    $subs = body()['subs'] ?? [];
    if (!is_array($subs) || count($subs) > 60) fail('bad_input', 'طلب غير صالح.');
    if (!in_array($u['role'], ['owner', 'seller'], true)) fail('forbidden', 'غير مسموح.', 403);
    $t = current_tenant($u);
    if (!$t) fail('forbidden', 'غير مسموح.', 403);
    $ac = access_of($t);
    if (!$ac['ok'] && $u['role'] !== 'owner') {
        out(['changes' => new stdClass(), 'errors' => new stdClass(), 'access' => $ac]);
    }
    $tid = (int) $t['id'];
    $changes = [];
    $errors = [];
    foreach ($subs as $p => $sig) {
        $seg = parse_path($p);
        if (!can_path($u, $seg, false)) {
            $errors[$p] = 'forbidden';
            continue;
        }
        $cp = implode('/', $seg);
        if (is_doc_path($seg)) {
            $now = sig_doc($tid, $cp);
            if ($now !== $sig) {
                list($par, $id) = split_path($seg);
                $r = doc_get($tid, $par, $id);
                $changes[$p] = ['sig' => $now, 'exists' => (bool) $r, 'data' => $r ? (json_decode($r['data'], true) ?: new stdClass()) : null];
            }
        } else {
            $now = sig_col($tid, $cp);
            if ($now !== $sig) {
                $changes[$p] = ['sig' => $now, 'docs' => col_docs($tid, $cp)];
            }
        }
    }
    out(['changes' => $changes ?: new stdClass(), 'errors' => $errors ?: new stdClass(), 'access' => $ac]);
}

function h_export()
{
    $u = current_user();
    if ($u['role'] !== 'owner') fail('forbidden', 'للمالك فقط.', 403);
    $rows = all("SELECT parent,id,data FROM docs WHERE tenant_id=? ORDER BY parent,id", [$u['tenant_id']]);
    $docs = [];
    foreach ($rows as $r) {
        $docs[] = ['path' => $r['parent'] . '/' . $r['id'], 'data' => json_decode($r['data'], true)];
    }
    $t = current_tenant($u);
    out(['app' => 'scalebusiness', 'version' => 1, 'business' => $t['name'], 'exported_at' => time(), 'docs' => $docs]);
}

function h_import()
{
    $u = current_user();
    if ($u['role'] !== 'owner') fail('forbidden', 'للمالك فقط.', 403);
    $t = current_tenant($u);
    if (!access_of($t)['ok']) fail('subscription_required', 'جدّد الاشتراك أولاً.', 402);
    $docs = body()['docs'] ?? [];
    if (!is_array($docs) || count($docs) > 300) fail('bad_input', 'عدد المستندات كبير في الطلب الواحد.');
    $n = 0;
    foreach ($docs as $d) {
        if (!is_array($d) || !isset($d['path']) || !isset($d['data']) || !is_array($d['data'])) continue;
        $seg = parse_path($d['path']);
        if (!is_doc_path($seg) || !shape_ok($seg) || $seg[0] === 'staff') continue;
        if ($seg[0] === 'sales') {
            if (count($seg) !== 4) continue;
            $seg[1] = 'import'; // فواتير البائعين القدامى تُنقل إلى «مستورد»
        }
        $json = json_encode($d['data'] ?: new stdClass(), JSON_UNESCAPED_UNICODE);
        if (strlen($json) > 900000) continue;
        list($par, $id) = split_path($seg);
        doc_put($t['id'], $par, $id, $json);
        $n++;
    }
    out(['ok' => true, 'imported' => $n]);
}

/* ======================= الفريق ======================= */
function h_team($method)
{
    $u = current_user();
    if ($u['role'] !== 'owner') fail('forbidden', 'للمالك فقط.', 403);
    $tid = (int) $u['tenant_id'];
    $b = body();
    if ($method === 'GET') {
        $rows = all("SELECT id,name,username,email,role,active FROM users WHERE tenant_id=? ORDER BY id", [$tid]);
        foreach ($rows as &$r) {
            $r['id'] = (string) $r['id'];
            $r['active'] = (bool) $r['active'];
        }
        out(['users' => $rows, 'max_sellers' => (int) cfg('max_sellers')]);
    }
    $t = current_tenant($u);
    if (!access_of($t)['ok']) fail('subscription_required', 'جدّد الاشتراك أولاً.', 402);
    if ($method === 'POST') {
        $name = trim((string) ($b['name'] ?? ''));
        $un = strtolower(trim((string) ($b['username'] ?? '')));
        if ($name === '' || mb_strlen($name) > 100) fail('bad_input', 'أدخل اسم الموظف.');
        if (!preg_match('/^[a-z0-9._-]{3,30}$/', $un)) fail('bad_input', 'اسم المستخدم: 3 إلى 30 حرفاً إنجليزياً صغيراً أو أرقاماً (يسمح بـ . _ -).');
        check_password($b['password'] ?? '');
        $cnt = (int) one("SELECT COUNT(*) c FROM users WHERE tenant_id=? AND role='seller' AND active=1", [$tid])['c'];
        if ($cnt >= (int) cfg('max_sellers')) fail('limit', 'وصلت للحد الأقصى من الموظفين.', 409);
        if (one("SELECT id FROM users WHERE username=? OR email=?", [$un, $un])) fail('exists', 'اسم المستخدم مستخدم بالفعل. اختر اسماً مميزاً (مثل إضافة اسم المحل).', 409);
        q("INSERT INTO users (tenant_id,role,name,username,pass_hash,active,created_at) VALUES (?,?,?,?,?,1,?)",
            [$tid, 'seller', $name, $un, password_hash($b['password'], PASSWORD_DEFAULT), time()]);
        out(['ok' => true], 201);
    }
    if ($method === 'PATCH') {
        $s = one("SELECT * FROM users WHERE id=? AND tenant_id=? AND role='seller'", [(int) ($b['id'] ?? 0), $tid]);
        if (!$s) fail('not_found', 'الموظف غير موجود.', 404);
        if (isset($b['active'])) {
            q("UPDATE users SET active=? WHERE id=?", [$b['active'] ? 1 : 0, $s['id']]);
            if (!$b['active']) q("DELETE FROM sessions WHERE user_id=?", [$s['id']]);
        }
        if (!empty($b['password'])) {
            check_password($b['password']);
            q("UPDATE users SET pass_hash=? WHERE id=?", [password_hash($b['password'], PASSWORD_DEFAULT), $s['id']]);
            q("DELETE FROM sessions WHERE user_id=?", [$s['id']]);
        }
        if (!empty($b['name'])) q("UPDATE users SET name=? WHERE id=?", [mb_substr(trim($b['name']), 0, 100), $s['id']]);
        out(['ok' => true]);
    }
    fail('method', 'طريقة غير مدعومة.', 405);
}

/* ======================= الاشتراك والدفع ======================= */
function h_history()
{
    $u = current_user();
    if ($u['role'] !== 'owner') fail('forbidden', 'للمالك فقط.', 403);
    $rows = all("SELECT plan,amount_cents,currency,status,created_at,paid_at,reference FROM payments WHERE tenant_id=? ORDER BY id DESC LIMIT 50", [$u['tenant_id']]);
    out(['payments' => $rows]);
}

function h_checkout()
{
    $u = current_user();
    if ($u['role'] !== 'owner') fail('forbidden', 'للمالك فقط.', 403);
    $b = body();
    $plans = cfg('plans');
    $pk = (string) ($b['plan'] ?? '');
    if (!isset($plans[$pk]) || empty($plans[$pk]['enabled'])) fail('bad_plan', 'الخطة غير متاحة.');
    $pm = cfg('paymob');
    if (empty($pm['enabled']) || empty($pm['secret_key']) || empty($pm['public_key']) || empty($pm['integration_ids'])) {
        fail('payments_off', 'الدفع الإلكتروني غير مفعّل بعد. تواصل مع الدعم لتفعيل الاشتراك.', 503);
    }
    $phone = preg_replace('/[^0-9+]/', '', (string) ($b['phone'] ?? ''));
    if (strlen($phone) < 10 || strlen($phone) > 16) fail('bad_input', 'أدخل رقم هاتف صحيح للدفع.');
    $plan = $plans[$pk];
    $cents = (int) round($plan['price'] * 100);
    $ref = 'MZ' . $u['tenant_id'] . '-' . bin2hex(random_bytes(6));
    q("INSERT INTO payments (tenant_id,user_id,plan,amount_cents,currency,reference,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
        [$u['tenant_id'], $u['id'], $pk, $cents, $pm['currency'] ?: 'EGP', $ref, time()]);
    $pid = (int) db()->lastInsertId();
    $parts = preg_split('/\s+/', trim($u['name']), 2);
    $first = $parts[0] ?: 'Customer';
    $last = $parts[1] ?? 'NA';
    $base = rtrim(cfg('app_url'), '/');
    $payload = [
        'amount' => $cents,
        'currency' => $pm['currency'] ?: 'EGP',
        'payment_methods' => array_map('intval', $pm['integration_ids']),
        'items' => [['name' => 'Scale Business subscription ' . $pk, 'amount' => $cents, 'description' => 'Scale Business ' . $plan['months'] . ' month(s)', 'quantity' => 1]],
        'billing_data' => [
            'first_name' => $first, 'last_name' => $last, 'email' => $u['email'], 'phone_number' => $phone,
            'apartment' => 'NA', 'floor' => 'NA', 'street' => 'NA', 'building' => 'NA', 'shipping_method' => 'NA',
            'postal_code' => 'NA', 'city' => 'NA', 'country' => 'EG', 'state' => 'NA',
        ],
        'customer' => ['first_name' => $first, 'last_name' => $last, 'email' => $u['email']],
        'special_reference' => $ref,
        'notification_url' => $base . '/api/billing/webhook',
        'redirection_url' => $base . '/app/?paid=1',
    ];
    list($code, $res, $err) = http_json('https://accept.paymob.com/v1/intention/', ['Authorization: Token ' . $pm['secret_key']], $payload);
    if ($code < 200 || $code >= 300 || empty($res['client_secret'])) {
        error_log('mezzan paymob intention failed: ' . $code . ' ' . $err . ' ' . json_encode($res));
        q("UPDATE payments SET status='failed', note=? WHERE id=?", ['intention ' . $code, $pid]);
        fail('gateway', 'تعذر بدء الدفع الآن. حاول لاحقاً.', 502);
    }
    if (!empty($res['intention_order_id'])) {
        q("UPDATE payments SET paymob_order_id=? WHERE id=?", [(string) $res['intention_order_id'], $pid]);
    }
    $cb = $pm['checkout_base'] ?? 'https://accept.paymob.com/unifiedcheckout/';
    out(['url' => $cb . '?publicKey=' . rawurlencode($pm['public_key']) . '&clientSecret=' . rawurlencode($res['client_secret'])]);
}

function h_webhook()
{
    $pm = cfg('paymob');
    $raw = body();
    $o = isset($raw['obj']) && is_array($raw['obj']) ? $raw['obj'] : $raw;
    $given = strtolower((string) ($_GET['hmac'] ?? ($raw['hmac'] ?? '')));
    $secret = (string) ($pm['hmac_secret'] ?? '');
    if ($secret === '' || $given === '') fail('hmac', 'توقيع غير صالح.', 403);
    $calc = hash_hmac('sha512', paymob_hmac_string($o), $secret);
    if (!hash_equals($calc, $given)) fail('hmac', 'توقيع غير صالح.', 403);

    $ref = $o['order']['merchant_order_id'] ?? '';
    $p = $ref !== '' ? one("SELECT * FROM payments WHERE reference=?", [$ref]) : null;
    if (!$p && !empty($o['order']['id'])) {
        $p = one("SELECT * FROM payments WHERE paymob_order_id=?", [(string) $o['order']['id']]);
    }
    if (!$p) out(['ok' => true, 'matched' => false]);
    $success = ($o['success'] ?? false) === true;
    $pending = ($o['pending'] ?? false) === true;
    $bad = ($o['is_refunded'] ?? false) === true || ($o['is_voided'] ?? false) === true;
    if ($success && !$pending && !$bad) {
        if ((int) ($o['amount_cents'] ?? 0) !== (int) $p['amount_cents'] || strtoupper((string) ($o['currency'] ?? '')) !== strtoupper($p['currency'])) {
            q("UPDATE payments SET note='amount mismatch' WHERE id=?", [$p['id']]);
            out(['ok' => true, 'matched' => true, 'applied' => false]);
        }
        if (!empty($o['id'])) q("UPDATE payments SET note=? WHERE id=?", ['txn ' . $o['id'], $p['id']]);
        out(['ok' => true, 'applied' => apply_payment((int) $p['id'])]);
    }
    if ($bad && $p['status'] === 'paid') {
        q("UPDATE payments SET status='refunded' WHERE id=?", [$p['id']]);
    } elseif (!$success && !$pending && $p['status'] === 'pending') {
        q("UPDATE payments SET status='failed' WHERE id=?", [$p['id']]);
    }
    out(['ok' => true]);
}

/* ======================= لوحة مدير المنصة ======================= */
function admin_only()
{
    $u = current_user();
    if ($u['role'] !== 'admin') fail('forbidden', 'غير مسموح.', 403);
    return $u;
}
function h_admin_tenants()
{
    admin_only();
    $rows = all("SELECT t.*, (SELECT email FROM users WHERE tenant_id=t.id AND role='owner' LIMIT 1) owner_email,
                        (SELECT name FROM users WHERE tenant_id=t.id AND role='owner' LIMIT 1) owner_name,
                        (SELECT COUNT(*) FROM users WHERE tenant_id=t.id AND role='seller') sellers
                 FROM tenants t ORDER BY t.id DESC LIMIT 500");
    foreach ($rows as &$r) {
        $r['access'] = access_of($r);
    }
    $stats = [
        'tenants' => count($rows),
        'active' => count(array_filter($rows, function ($r) { return $r['access']['state'] === 'active'; })),
        'trial' => count(array_filter($rows, function ($r) { return $r['access']['state'] === 'trial'; })),
        'revenue_cents' => (int) one("SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE status='paid'")['s'],
    ];
    out(['tenants' => $rows, 'stats' => $stats]);
}
function h_admin_tenant()
{
    admin_only();
    $b = body();
    $t = one("SELECT * FROM tenants WHERE id=?", [(int) ($b['id'] ?? 0)]);
    if (!$t) fail('not_found', 'العميل غير موجود.', 404);
    $a = (string) ($b['action'] ?? '');
    if ($a === 'activate') {
        $m = max(1, min(60, (int) ($b['months'] ?? 1)));
        $end = add_months(max(time(), (int) ($t['period_end'] ?? 0)), $m);
        q("UPDATE tenants SET period_end=?, plan=COALESCE(?,plan), status='ok' WHERE id=?", [$end, $b['plan'] ?? null, $t['id']]);
        q("INSERT INTO payments (tenant_id,user_id,plan,amount_cents,currency,reference,status,created_at,paid_at,note) VALUES (?,?,?,?,?,?,'manual',?,?,?)",
            [$t['id'], 0, (string) ($b['plan'] ?? 'manual'), (int) round(((float) ($b['amount'] ?? 0)) * 100), 'EGP', 'MAN' . $t['id'] . '-' . bin2hex(random_bytes(5)), time(), time(), mb_substr((string) ($b['note'] ?? 'تفعيل يدوي'), 0, 250)]);
    } elseif ($a === 'extend_trial') {
        $d = max(1, min(365, (int) ($b['days'] ?? 7)));
        q("UPDATE tenants SET trial_ends_at=? WHERE id=?", [max(time(), (int) $t['trial_ends_at']) + 86400 * $d, $t['id']]);
    } elseif ($a === 'suspend') {
        q("UPDATE tenants SET status='suspended' WHERE id=?", [$t['id']]);
    } elseif ($a === 'unsuspend') {
        q("UPDATE tenants SET status='ok' WHERE id=?", [$t['id']]);
    } elseif ($a === 'expire') {
        q("UPDATE tenants SET period_end=NULL, trial_ends_at=? WHERE id=?", [time() - 1, $t['id']]);
    } else {
        fail('bad_input', 'إجراء غير معروف.');
    }
    $t = one("SELECT * FROM tenants WHERE id=?", [$t['id']]);
    out(['ok' => true, 'access' => access_of($t)]);
}
function h_admin_payments()
{
    admin_only();
    out(['payments' => all("SELECT p.*, t.name tenant_name FROM payments p JOIN tenants t ON t.id=p.tenant_id ORDER BY p.id DESC LIMIT 300")]);
}
