<?php
// Scale Business — مكتبة الخادم (قاعدة البيانات، الجلسات، الصلاحيات، الاشتراكات).
// يجب أن يبقى هذا المجلد خارج public_html.

function cfg($k = null)
{
    static $c = null;
    if ($c === null) {
        $file = getenv('MEZZAN_CONFIG') ?: (MZ_PRIVATE . '/config.php');
        if (!is_file($file)) {
            fail('not_configured', 'لم يتم إعداد الخادم بعد (config.php غير موجود).', 500);
        }
        $c = require $file;
    }
    return $k === null ? $c : ($c[$k] ?? null);
}

function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $d = cfg('db');
        $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
        if (strpos($d['dsn'], 'mysql:') === 0) {
            $opts[PDO::MYSQL_ATTR_FOUND_ROWS] = true;
        }
        $pdo = new PDO($d['dsn'], $d['user'] ?? null, $d['pass'] ?? null, $opts);
        if (strpos($d['dsn'], 'mysql:') === 0) {
            $pdo->exec("SET NAMES utf8mb4");
        }
    }
    return $pdo;
}

function q($sql, $args = [])
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}
function one($sql, $args = [])
{
    $r = q($sql, $args)->fetch();
    return $r === false ? null : $r;
}
function all($sql, $args = [])
{
    return q($sql, $args)->fetchAll();
}

function nowms()
{
    return (int) floor(microtime(true) * 1000);
}

function out($data, $code = 200)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
function fail($code, $msg, $status = 400)
{
    out(['error' => $code, 'message' => $msg], $status);
}

function body()
{
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input');
        if (strlen($raw) > 1000000) {
            fail('too_large', 'حجم البيانات كبير جداً.', 413);
        }
        $j = json_decode($raw, true);
        $b = is_array($j) ? $j : [];
    }
    return $b;
}

function client_ip()
{
    return $_SERVER['REMOTE_ADDR'] ?? '0';
}

/* ---------------- حماية الطلبات ---------------- */
function csrf_guard()
{
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m === 'GET' || $m === 'HEAD' || $m === 'OPTIONS') {
        return;
    }
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'mezzan') {
        fail('csrf', 'طلب غير مسموح.', 403);
    }
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($o !== '') {
        $h = parse_url($o, PHP_URL_HOST);
        $p = parse_url($o, PHP_URL_PORT);
        $origin = $h . ($p ? ':' . $p : '');
        if (strcasecmp($origin, $_SERVER['HTTP_HOST'] ?? '') !== 0) {
            fail('csrf', 'طلب غير مسموح.', 403);
        }
    }
}

function throttle_count($key, $window)
{
    $r = one("SELECT COUNT(*) c FROM login_attempts WHERE k=? AND ts>?", [$key, time() - $window]);
    return (int) $r['c'];
}
function throttle_hit($key)
{
    q("INSERT INTO login_attempts (k,ts) VALUES (?,?)", [$key, time()]);
}
function housekeeping()
{
    if (random_int(1, 50) !== 1) {
        return;
    }
    q("DELETE FROM login_attempts WHERE ts<?", [time() - 86400]);
    q("DELETE FROM sessions WHERE expires_at<?", [time()]);
    q("DELETE FROM resets WHERE expires_at<?", [time()]);
}

/* ---------------- المستخدمون والجلسات ---------------- */
function make_session($uid)
{
    $tok = bin2hex(random_bytes(32));
    $exp = time() + 30 * 86400;
    q("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)", [hash('sha256', $tok), $uid, $exp, time()]);
    set_cookie($tok, $exp);
}
function set_cookie($val, $exp)
{
    setcookie('mz_s', $val, [
        'expires' => $exp, 'path' => '/', 'secure' => (bool) cfg('cookie_secure'),
        'httponly' => true, 'samesite' => 'Lax',
    ]);
}

function current_user($required = true)
{
    static $u = false;
    if ($u === false) {
        $u = null;
        $tok = $_COOKIE['mz_s'] ?? '';
        if (is_string($tok) && strlen($tok) === 64) {
            $u = one("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1", [hash('sha256', $tok), time()]);
        }
    }
    if ($required && !$u) {
        fail('auth', 'يلزم تسجيل الدخول.', 401);
    }
    return $u;
}
function current_tenant($u)
{
    if (!$u || !(int) $u['tenant_id']) {
        return null;
    }
    return one("SELECT * FROM tenants WHERE id=?", [$u['tenant_id']]);
}

function access_of($t)
{
    $now = time();
    $trial = (int) $t['trial_ends_at'];
    $pe = (int) ($t['period_end'] ?? 0);
    if ($t['status'] === 'suspended') {
        $st = 'suspended';
        $end = max($trial, $pe);
    } elseif ($pe > $now) {
        $st = 'active';
        $end = $pe;
    } elseif ($trial > $now) {
        $st = 'trial';
        $end = $trial;
    } else {
        $st = 'expired';
        $end = max($trial, $pe);
    }
    return ['state' => $st, 'ends_at' => $end, 'days_left' => max(0, (int) ceil(($end - $now) / 86400)), 'ok' => ($st === 'active' || $st === 'trial')];
}

function valid_email($e)
{
    return is_string($e) && strlen($e) <= 190 && filter_var($e, FILTER_VALIDATE_EMAIL);
}
function check_password($p)
{
    if (!is_string($p) || strlen($p) < 8) {
        fail('weak_password', 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
    }
    if (strlen($p) > 200) {
        fail('weak_password', 'كلمة المرور طويلة جداً.');
    }
}

function public_user($u)
{
    return ['id' => (string) $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'email' => $u['email'], 'username' => $u['username']];
}

function plans_public()
{
    $out = [];
    foreach ((cfg('plans') ?: []) as $k => $p) {
        if (!empty($p['enabled'])) {
            $out[] = ['id' => $k, 'label' => $p['label'], 'months' => $p['months'], 'price' => $p['price'],
                'per_month' => round($p['price'] / max(1, $p['months']), 2)];
        }
    }
    return $out;
}

/* ---------------- المسارات والصلاحيات (تعكس قواعد نسخة Claude) ---------------- */
function parse_path($p)
{
    $p = trim((string) $p, '/');
    if ($p === '') {
        fail('bad_path', 'مسار غير صالح.');
    }
    $seg = explode('/', $p);
    if (count($seg) > 4) {
        fail('bad_path', 'مسار غير صالح.');
    }
    foreach ($seg as $s) {
        if (!preg_match('/^[A-Za-z0-9_.\-]{1,64}$/', $s) || $s === '.' || $s === '..') {
            fail('bad_path', 'مسار غير صالح.');
        }
    }
    return $seg;
}
function shape_ok($seg)
{
    $n = count($seg);
    switch ($seg[0]) {
        case 'menu': case 'catalog': case 'lookup':
        case 'purchases': case 'expenses': case 'payments': case 'staff':
            return $n <= 2;
        case 'sales':
            return $n === 1 || ($n >= 3 && $seg[2] === 'lines');
    }
    return false;
}
function can_path($u, $seg, $write)
{
    if (!shape_ok($seg)) {
        return false;
    }
    if ($u['role'] === 'owner') {
        return true;
    }
    if ($u['role'] !== 'seller') {
        return false;
    }
    $self = (string) $u['id'];
    $n = count($seg);
    $r = $seg[0];
    if (!$write && ($r === 'menu' || $r === 'lookup')) {
        return true;
    }
    if ($r === 'sales' && $n >= 3 && $seg[1] === $self) {
        return true;
    }
    if ($r === 'staff' && $n === 2 && $seg[1] === $self) {
        return true;
    }
    return false;
}
function is_doc_path($seg)
{
    return count($seg) % 2 === 0;
}
function split_path($seg)
{
    $id = array_pop($seg);
    return [implode('/', $seg), $id];
}

function data_gate($u, $seg, $write)
{
    if (!in_array($u['role'], ['owner', 'seller'], true)) {
        fail('forbidden', 'غير مسموح.', 403);
    }
    $t = current_tenant($u);
    if (!$t) {
        fail('forbidden', 'غير مسموح.', 403);
    }
    $ac = access_of($t);
    if (!$ac['ok'] && ($write || $u['role'] !== 'owner')) {
        fail('subscription_required', 'انتهى الاشتراك أو التجربة المجانية. جدّد اشتراكك للمتابعة.', 402);
    }
    if (!can_path($u, $seg, $write)) {
        fail('forbidden', 'ليست لديك صلاحية على هذا المسار.', 403);
    }
    return $t;
}

/* ---------------- مخزن المستندات ---------------- */
function doc_get($tid, $parent, $id)
{
    return one("SELECT data,version FROM docs WHERE tenant_id=? AND parent=? AND id=?", [$tid, $parent, $id]);
}
function doc_put($tid, $parent, $id, $json)
{
    $now = nowms();
    $n = q("UPDATE docs SET data=?, version=version+1, updated_at=? WHERE tenant_id=? AND parent=? AND id=?", [$json, $now, $tid, $parent, $id])->rowCount();
    if ($n === 0) {
        try {
            q("INSERT INTO docs (tenant_id,parent,id,data,version,updated_at) VALUES (?,?,?,?,1,?)", [$tid, $parent, $id, $json, $now]);
        } catch (PDOException $e) {
            q("UPDATE docs SET data=?, version=version+1, updated_at=? WHERE tenant_id=? AND parent=? AND id=?", [$json, $now, $tid, $parent, $id]);
        }
    }
}
function doc_del($tid, $parent, $id)
{
    q("DELETE FROM docs WHERE tenant_id=? AND parent=? AND id=?", [$tid, $parent, $id]);
}
function sig_doc($tid, $path)
{
    $seg = explode('/', $path);
    list($par, $id) = split_path($seg);
    $r = doc_get($tid, $par, $id);
    return $r ? 'v' . $r['version'] . ':' . md5($r['data']) : '0';
}
function sig_col($tid, $path)
{
    $r = one("SELECT COUNT(*) c, COALESCE(MAX(updated_at),0) m, COALESCE(SUM(version),0) s FROM docs WHERE tenant_id=? AND parent=?", [$tid, $path]);
    return $r['c'] . ':' . $r['m'] . ':' . $r['s'];
}
function col_docs($tid, $path)
{
    $rows = all("SELECT id,data FROM docs WHERE tenant_id=? AND parent=? ORDER BY updated_at", [$tid, $path]);
    $out = [];
    foreach ($rows as $r) {
        $d = json_decode($r['data'], true);
        $out[] = ['id' => $r['id'], 'data' => is_array($d) ? (count($d) ? $d : new stdClass()) : new stdClass()];
    }
    return $out;
}

/* ---------------- الدفع ---------------- */
function add_months($ts, $m)
{
    return (new DateTimeImmutable('@' . $ts))->modify('+' . (int) $m . ' months')->getTimestamp();
}
function apply_payment($pid)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $p = one("SELECT * FROM payments WHERE id=?", [$pid]);
        if (!$p || $p['status'] === 'paid' || $p['status'] === 'manual') {
            $pdo->commit();
            return false;
        }
        $plans = cfg('plans');
        $months = (int) (($plans[$p['plan']]['months'] ?? 0));
        if ($months <= 0) {
            $months = 1;
        }
        $t = one("SELECT * FROM tenants WHERE id=?", [$p['tenant_id']]);
        $base = max(time(), (int) ($t['period_end'] ?? 0));
        $end = add_months($base, $months);
        q("UPDATE tenants SET period_end=?, plan=? WHERE id=?", [$end, $p['plan'], $t['id']]);
        q("UPDATE payments SET status='paid', paid_at=? WHERE id=?", [time(), $pid]);
        $pdo->commit();
        return true;
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function http_json($url, $headers, $payload)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json', 'Accept: application/json'], $headers),
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    $res = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return [$code, $res === false ? null : json_decode($res, true), $err];
}

function paymob_hmac_string($o)
{
    $b = function ($v) {
        return $v === true ? 'true' : ($v === false ? 'false' : (string) $v);
    };
    $g = function ($path) use ($o, $b) {
        $cur = $o;
        foreach (explode('.', $path) as $k) {
            if (!is_array($cur) || !array_key_exists($k, $cur)) {
                return '';
            }
            $cur = $cur[$k];
        }
        return $b($cur);
    };
    $keys = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
        'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner',
        'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];
    $s = '';
    foreach ($keys as $k) {
        $s .= $g($k);
    }
    return $s;
}
