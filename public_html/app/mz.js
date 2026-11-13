/* Scale Business — الحسابات والاشتراكات: الدخول والتسجيل، الخطط والدفع، الفريق، البيانات التجريبية. */
(function () {
  'use strict';
  const MZ = (window.MZ = window.MZ || {});
  const api = MZ.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fdate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—');
  const STATE = { trial: ['تجربة مجانية', 'warn'], active: ['اشتراك نشط', 'good'], expired: ['منتهي', 'bad'], suspended: ['موقوف', 'bad'] };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const cache = { history: null, team: null, busy: false };
  const rerender = () => { if (window.MZ_render) window.MZ_render(); };
  function toast(m) {
    const t = $('#toast'); if (!t) return;
    t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200);
  }
  MZ.toast = toast;
  const errMsg = (e) => (e && e.message) || 'حدث خطأ';

  /* =================== الدخول والتسجيل =================== */
  let mode = 'login', authPlans = [], authMeta = {};
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) mode = 'reset';

  function planCards(plans, cta) {
    const base = plans.length ? plans[0].price / plans[0].months : 0;
    return '<div class="plans">' + plans.map((p) => {
      const pm = p.price / p.months;
      const save = base && p.months > 1 ? Math.round((1 - pm / base) * 100) : 0;
      return '<div class="plan' + (p.months === 12 ? ' best' : '') + '"><div class="pn">' + esc(p.label) + (save > 0 ? '<span class="chip good">وفّر ' + save + '%</span>' : '') + '</div>' +
        '<div class="pp"><b class="num">' + fmt(p.price) + '</b> <span class="muted">ج.م</span></div>' +
        '<div class="muted sm">' + (p.months > 1 ? '≈ ' + fmt(pm) + ' ج.م / شهر' : 'تُجدَّد شهرياً') + '</div>' +
        (cta ? '<button class="btn pri" data-mz="buy" data-plan="' + esc(p.id) + '">اشترك</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function authHTML() {
    const f = {
      login: '<h2>تسجيل الدخول</h2><form data-mzform="login" class="list"><div class="field"><label for="a1">البريد الإلكتروني أو اسم المستخدم</label><input id="a1" name="login" autocomplete="username" required dir="ltr"></div>' +
        '<div class="field"><label for="a2">كلمة المرور</label><input id="a2" name="password" type="password" autocomplete="current-password" required dir="ltr"></div>' +
        '<button class="btn pri" type="submit">دخول</button><button class="linkbtn" type="button" data-mz="mode" data-v="forgot">نسيت كلمة المرور؟</button></form>' +
        '<div class="sw">ليس لديك حساب؟ <button class="linkbtn" data-mz="mode" data-v="signup">ابدأ تجربة مجانية ' + (authMeta.trial_days || 7) + ' أيام</button></div>',
      signup: '<h2>إنشاء حساب جديد</h2><p class="muted sm" style="margin:0">تجربة مجانية لمدة ' + (authMeta.trial_days || 7) + ' أيام. بدون بطاقة دفع.</p>' +
        '<form data-mzform="signup" class="list"><div class="field"><label for="s1">اسم النشاط</label><input id="s1" name="business" required maxlength="120" placeholder="مثال: كافيه النخيل"></div>' +
        '<div class="field"><label for="s2">اسمك</label><input id="s2" name="name" required maxlength="100" autocomplete="name"></div>' +
        '<div class="field"><label for="s3">البريد الإلكتروني</label><input id="s3" name="email" type="email" required autocomplete="email" dir="ltr"></div>' +
        '<div class="field"><label for="s4">كلمة المرور (8 أحرف على الأقل)</label><input id="s4" name="password" type="password" minlength="8" required autocomplete="new-password" dir="ltr"></div>' +
        '<button class="btn pri" type="submit">إنشاء الحساب وبدء التجربة</button></form>' +
        '<div class="sw">لديك حساب؟ <button class="linkbtn" data-mz="mode" data-v="login">سجّل الدخول</button></div>',
      forgot: '<h2>استعادة كلمة المرور</h2><form data-mzform="forgot" class="list"><div class="field"><label for="f1">بريدك الإلكتروني</label><input id="f1" name="email" type="email" required dir="ltr"></div>' +
        '<button class="btn pri" type="submit">إرسال رابط الاستعادة</button></form><div class="sw"><button class="linkbtn" data-mz="mode" data-v="login">رجوع</button></div>',
      reset: '<h2>تعيين كلمة مرور جديدة</h2><form data-mzform="reset" class="list"><div class="field"><label for="r1">كلمة المرور الجديدة</label><input id="r1" name="password" type="password" minlength="8" required dir="ltr" autocomplete="new-password"></div>' +
        '<button class="btn pri" type="submit">حفظ</button></form>',
    }[mode];
    return '<div class="auth"><section class="hero"><div class="logo">' + LOGO + '<span>Scale Business</span></div><h1>محاسبة يومية لمشروعك، من الكاشير إلى الأرباح</h1>' +
      '<ul><li>مبيعات ومشتريات ومصروفات وآجل في مكان واحد</li><li>مخزون وخامات ووصفات بتكلفة فعلية لكل صنف</li><li>شاشة بيع سريعة للكاشير وحسابات منفصلة لكل موظف</li><li>تقارير يومية وأرباح الأصناف وتصدير Excel</li></ul></section>' +
      '<section class="card authcard">' + f + '</section></div>' +
      (authPlans.length ? '<div class="authplans"><h2>الخطط والأسعار</h2><p class="muted sm">كل الخطط بنفس المزايا. اختر مدة الاشتراك الأنسب لك.</p>' + planCards(authPlans, false) + '</div>' : '') +
      '<footer class="authfoot muted sm"><span dir="ltr">Scale Business © ' + new Date().getFullYear() + '</span></footer>';
  }

  function renderAuth() {
    document.title = 'Scale Business — تسجيل الدخول';
    $('#root').className = 'wrap';
    $('#root').innerHTML = authHTML();
  }

  async function submitForm(form) {
    const d = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const k = form.dataset.mzform;
      if (k === 'login') { MZ.me = await api('POST', 'auth/login', d); afterAuth(); }
      else if (k === 'signup') { MZ.me = await api('POST', 'auth/signup', d); afterAuth(); }
      else if (k === 'forgot') { await api('POST', 'auth/forgot', d); form.outerHTML = '<div class="alert" style="background:var(--good-soft);color:var(--good)">إن كان البريد مسجلاً لدينا فسيصلك رابط الاستعادة خلال دقائق. تفقد البريد المزعج أيضاً.</div>'; return; }
      else if (k === 'reset') { await api('POST', 'auth/reset', { token: resetToken, password: d.password }); history.replaceState(null, '', location.pathname); mode = 'login'; renderAuth(); toast('تم تغيير كلمة المرور. سجّل الدخول.'); return; }
    } catch (e) { toast(errMsg(e)); btn.disabled = false; }
  }

  function afterAuth() {
    if (MZ.me.user.role === 'admin') { location.href = 'admin.html'; return; }
    loadApp();
  }

  let appLoaded = false;
  function loadApp() {
    if (appLoaded) return;
    appLoaded = true;
    document.title = 'Scale Business — ' + (MZ.me.tenant ? MZ.me.tenant.name : '');
    $('#root').innerHTML = '<div class="load">جارٍ التحميل…</div>';
    const s = document.createElement('script');
    s.src = 'app.js?v=' + (window.MZ_VER || '3');
    document.body.appendChild(s);
    if (new URLSearchParams(location.search).get('paid')) confirmPayment();
  }

  async function confirmPayment() {
    history.replaceState(null, '', location.pathname);
    toast('جارٍ تأكيد عملية الدفع…');
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const me = await api('GET', 'me');
        if (me.access && me.access.state === 'active') { MZ.me = me; cache.history = null; toast('تم تفعيل اشتراكك. شكراً لك!'); rerender(); return; }
      } catch (e) {}
    }
    toast('لم يصلنا تأكيد الدفع بعد. إن تم الخصم فسيُفعَّل اشتراكك تلقائياً خلال دقائق.');
  }

  /* =================== داخل التطبيق =================== */
  const LOGO = '<svg class="lg" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><rect x="7" y="17" width="4.6" height="8" rx="1.6" fill="var(--accent-ink,#fff)" opacity=".55"/><rect x="13.7" y="12" width="4.6" height="13" rx="1.6" fill="var(--accent-ink,#fff)" opacity=".8"/><rect x="20.4" y="6.5" width="4.6" height="18.5" rx="1.6" fill="var(--accent-ink,#fff)"/></svg>';
  MZ.logo = LOGO;
  MZ.brand = () => LOGO + '<span class="bn">Scale Business</span> <small>' + esc(MZ.me.tenant ? MZ.me.tenant.name : '') + '</small>';
  MZ.locked = () => !!(MZ.me && MZ.me.access && !MZ.me.access.ok);
  MZ.isOwner = () => MZ.me && MZ.me.user.role === 'owner';
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';
  const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; };
  MZ.logoutBtn = () => '<button class="iconbtn" data-mz="theme" aria-label="تبديل المظهر" title="تبديل المظهر">' + (isDark() ? SUN : MOON) + '</button><button class="btn sm" data-mz="logout">خروج</button>';

  MZ.banner = () => {
    const a = MZ.me.access; if (!a) return '';
    const own = MZ.isOwner();
    if (!own && a.ok) return '';
    const go = own ? ' <button class="btn sm" data-act="tab" data-v="account">' + (a.ok ? 'اختر خطة' : 'جدّد الآن') + '</button>' : ' تواصل مع مالك النشاط.';
    if (a.state === 'trial') return '<div class="alert" style="margin-top:16px">تجربتك المجانية تنتهي بعد <b>' + a.days_left + '</b> يوم.' + (own ? go : '') + '</div>';
    if (a.state === 'active' && a.days_left <= 5) return '<div class="alert" style="margin-top:16px">ينتهي اشتراكك بعد <b>' + a.days_left + '</b> يوم.' + (own ? go : '') + '</div>';
    if (a.state === 'expired') return '<div class="alert bad" style="margin-top:16px">انتهى الاشتراك. بياناتك محفوظة ويمكنك تصديرها، وللمتابعة جدّد الاشتراك.' + (own ? '' : ' تواصل مع مالك النشاط.') + '</div>';
    if (a.state === 'suspended') return '<div class="alert bad" style="margin-top:16px">الحساب موقوف. تواصل مع الدعم.</div>';
    return '';
  };
  MZ.lockedMsg = () => '<div class="card empty">الاشتراك الخاص بهذا النشاط غير فعّال حالياً. تواصل مع مالك النشاط لتجديده.</div>';

  /* ---------- الاشتراك ---------- */
  async function loadHistory() {
    if (cache.history || cache.busy) return;
    cache.busy = true;
    try { cache.history = (await api('GET', 'billing/history')).payments; } catch (e) { cache.history = []; }
    cache.busy = false; rerender();
  }
  const PSTAT = { paid: ['مدفوع', 'good'], pending: ['قيد الانتظار', 'warn'], failed: ['فشل', 'bad'], refunded: ['مُسترد', 'gray'], manual: ['تفعيل يدوي', 'gray'] };
  const PLAN_L = (id) => { const p = (MZ.me.plans || []).find((x) => x.id === id); return p ? p.label : id; };

  MZ.accountView = () => {
    loadHistory();
    const a = MZ.me.access || {}, st = STATE[a.state] || ['—', 'gray'], sup = MZ.me.support || {};
    const contact = [sup.whatsapp ? '<a href="https://wa.me/' + esc(String(sup.whatsapp).replace(/\D/g, '')) + '" target="_blank" rel="noopener">واتساب</a>' : '', sup.email ? '<span dir="ltr">' + esc(sup.email) + '</span>' : ''].filter(Boolean).join(' · ');
    const phone = ls.get('mz_phone') || '';
    const h = cache.history || [];
    return '<h2>الاشتراك</h2>' +
      '<div class="card"><header><h3>حالة اشتراكك</h3><span class="sp"></span><span class="chip ' + st[1] + '">' + st[0] + '</span></header>' +
      '<div class="kpis"><div class="kpi"><div class="l">النشاط</div><div class="v" style="font-size:18px">' + esc(MZ.me.tenant.name) + '</div></div>' +
      '<div class="kpi"><div class="l">الخطة الحالية</div><div class="v" style="font-size:18px">' + (a.state === 'active' ? esc(PLAN_L(MZ.me.tenant.plan)) : a.state === 'trial' ? 'تجربة مجانية' : '—') + '</div></div>' +
      '<div class="kpi"><div class="l">' + (a.state === 'active' ? 'يتجدد/ينتهي في' : 'تنتهي في') + '</div><div class="v" style="font-size:18px">' + fdate(a.ends_at) + '</div><div class="s">' + (a.ok ? 'متبقي ' + a.days_left + ' يوم' : 'انتهى') + '</div></div></div></div>' +
      '<div class="card"><header><h3>' + (a.state === 'active' ? 'تجديد أو تمديد الاشتراك' : 'اختر خطتك') + '</h3></header>' +
      '<div class="row" style="margin-bottom:12px"><div class="field" style="max-width:300px"><label for="mzPhone">رقم موبايلك (مطلوب لإتمام الدفع)</label><input id="mzPhone" type="tel" inputmode="tel" dir="ltr" placeholder="01XXXXXXXXX" value="' + esc(phone) + '"></div></div>' +
      planCards(MZ.me.plans || [], true) +
      '<p class="muted sm" style="margin:12px 0 0">الدفع بالبطاقة أو المحفظة عبر بوابة Paymob الآمنة، ولا نحتفظ ببيانات بطاقتك. يُضاف الاشتراك لمدة الاشتراك الحالية دون خسارة الأيام المتبقية.' + (MZ.me.paymob ? '' : ' <b>الدفع الإلكتروني غير مفعّل بعد؛ للاشتراك تواصل معنا.</b>') + (contact ? '<br>للدعم والاشتراك اليدوي: ' + contact : '') + '</p></div>' +
      '<div class="card"><header><h3>سجل المدفوعات</h3></header>' + (h.length ? '<div class="tbl"><table><thead><tr><th>التاريخ</th><th>الخطة</th><th class="n">المبلغ</th><th>الحالة</th></tr></thead><tbody>' +
        h.map((p) => { const s = PSTAT[p.status] || [p.status, 'gray']; return '<tr><td>' + fdate(p.paid_at || p.created_at) + '</td><td>' + esc(PLAN_L(p.plan)) + '</td><td class="n">' + fmt(p.amount_cents / 100) + ' ج.م</td><td><span class="chip ' + s[1] + '">' + s[0] + '</span></td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="empty">' + (cache.history ? 'لا توجد مدفوعات بعد.' : 'جارٍ التحميل…') + '</div>') + '</div>' +
      '<div class="grid g2"><div class="card"><header><h3>نسخة احتياطية من بياناتك</h3></header><p class="muted sm" style="margin-top:0">تنزيل كل بياناتك في ملف واحد. متاحة دائماً حتى بعد انتهاء الاشتراك.</p><button class="btn" data-mz="export">تنزيل النسخة الكاملة (JSON)</button>'+
      '<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><p class="muted sm" style="margin-top:0">نقل بياناتك من نسخة أخرى: اختر ملف نسخة احتياطية (JSON) لاستيراد الأصناف والخامات والوصفات والفواتير. يُنقل البيع القديم تحت اسم «مستورد».</p><input id="mzRestore" type="file" accept=".json,application/json" style="display:none"><button class="btn" data-mz="restore">استيراد من نسخة احتياطية</button></div>' +
      '<div class="card"><header><h3>الحساب</h3></header><div class="list"><div class="muted sm" dir="ltr" style="text-align:right">' + esc(MZ.me.user.email || MZ.me.user.username) + '</div>' +
      '<div class="field"><label for="mzOld">كلمة المرور الحالية</label><input id="mzOld" type="password" dir="ltr" autocomplete="current-password"></div>' +
      '<div class="field"><label for="mzNew">كلمة المرور الجديدة</label><input id="mzNew" type="password" dir="ltr" autocomplete="new-password"></div>' +
      '<div class="row"><button class="btn" data-mz="pw">تغيير كلمة المرور</button><span class="sp"></span><button class="btn bad" data-mz="logout">تسجيل الخروج</button></div></div></div></div>';
  };

  /* ---------- الفريق ---------- */
  async function loadTeam(force) {
    if ((cache.team && !force) || cache.busy) return;
    cache.busy = true;
    try { cache.team = await api('GET', 'team'); } catch (e) { cache.team = { users: [], max_sellers: 0 }; }
    cache.busy = false; rerender();
  }
  MZ.teamHTML = () => {
    loadTeam();
    const t = cache.team;
    const sellers = t ? t.users.filter((u) => u.role === 'seller') : [];
    return '<div class="card"><header><h3>حسابات الموظفين (الكاشير)</h3><span class="sp"></span>' + (t ? '<span class="chip gray">' + sellers.length + ' / ' + t.max_sellers + '</span>' : '') + '</header>' +
      '<p class="muted sm" style="margin-top:0">الموظف يرى شاشة البيع فقط، ولا يرى الأرباح أو المشتريات أو المصروفات. يدخل باسم المستخدم وكلمة المرور من نفس صفحة الدخول.</p>' +
      (sellers.length ? '<div class="tbl"><table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الحالة</th><th>كلمة مرور جديدة</th><th></th></tr></thead><tbody>' +
        sellers.map((u) => '<tr><td>' + esc(u.name) + '</td><td dir="ltr" style="text-align:right">' + esc(u.username) + '</td><td><span class="chip ' + (u.active ? 'good' : 'gray') + '">' + (u.active ? 'مفعّل' : 'متوقف') + '</span></td>' +
          '<td><input id="pw_' + esc(u.id) + '" type="password" dir="ltr" style="width:150px" placeholder="8 أحرف+" autocomplete="new-password"></td>' +
          '<td style="white-space:nowrap"><button class="btn sm" data-mz="sellerpw" data-id="' + esc(u.id) + '">تغيير</button> <button class="btn sm ' + (u.active ? 'bad' : '') + '" data-mz="toggleseller" data-id="' + esc(u.id) + '" data-active="' + (u.active ? 0 : 1) + '">' + (u.active ? 'إيقاف' : 'تفعيل') + '</button></td></tr>').join('') +
        '</tbody></table></div>' : '<div class="empty">' + (t ? 'لم تضف موظفين بعد.' : 'جارٍ التحميل…') + '</div>') +
      '<div class="row" style="margin-top:12px"><div class="field"><label for="tmName">اسم الموظف</label><input id="tmName" maxlength="100"></div>' +
      '<div class="field"><label for="tmUser">اسم المستخدم (إنجليزي)</label><input id="tmUser" dir="ltr" placeholder="مثال: ahmed.nakheel" maxlength="30" autocapitalize="none"></div>' +
      '<div class="field"><label for="tmPass">كلمة المرور</label><input id="tmPass" type="password" dir="ltr" autocomplete="new-password"></div>' +
      '<button class="btn pri" data-mz="addseller">إضافة موظف</button></div></div>';
  };

  /* ---------- بداية سريعة وبيانات تجريبية ---------- */
  MZ.onboard = () => '<div class="card"><header><h3>ابدأ في دقائق</h3></header><div class="list">' +
    '<div>١. أضف أصنافك وأسعارها من تبويب «الأصناف والوصفات»، أو استوردها من ملف Excel من تبويب «استيراد».</div>' +
    '<div>٢. أضف الخامات والوصفات إن أردت حساب التكلفة والمخزون تلقائياً.</div>' +
    '<div>٣. أنشئ حساباً لكل كاشير من تبويب «الفريق والبائعون» ليسجّل المبيعات من هاتفه.</div>' +
    '<div class="row" style="margin-top:6px"><button class="btn pri" data-mz="sample">تحميل بيانات تجريبية لأجرّب</button><button class="btn" data-act="tab" data-v="import">استيراد من Excel</button><button class="btn" data-act="tab" data-v="cat">إضافة الأصناف يدوياً</button></div>' +
    '<div class="muted sm">البيانات التجريبية أصناف وخامات ووصفات لكافيه صغير؛ يمكنك تعديلها أو حذفها.</div></div></div>';

  async function loadSample() {
    const items = [['DRK01', 'إسبريسو', 'مشروبات ساخنة', 40], ['DRK02', 'أمريكانو', 'مشروبات ساخنة', 50], ['DRK03', 'كابتشينو', 'مشروبات ساخنة', 65], ['DRK04', 'لاتيه', 'مشروبات ساخنة', 70], ['DRK05', 'شاي', 'مشروبات ساخنة', 25], ['DRK06', 'آيس لاتيه', 'مشروبات باردة', 80]];
    const raws = [['RM001', 'بن إسبريسو', 'قهوة', 'جرام', 3000, 0.9, 500], ['RM002', 'سكر', 'إضافات', 'جرام', 5000, 0.04, 500], ['RM003', 'حليب', 'ألبان', 'ملليلتر', 10000, 0.03, 2000], ['RM004', 'كوب ورقي', 'تعبئة', 'قطعة', 300, 0.6, 50], ['RM005', 'شاي', 'مشروبات', 'جرام', 1000, 0.2, 100]];
    const rec = { DRK01: [['RM001', 9], ['RM004', 1]], DRK02: [['RM001', 9], ['RM004', 1], ['RM002', 10]], DRK03: [['RM001', 9], ['RM003', 120], ['RM004', 1]], DRK04: [['RM001', 9], ['RM003', 200], ['RM004', 1]], DRK05: [['RM005', 3], ['RM002', 10], ['RM004', 1]], DRK06: [['RM001', 9], ['RM003', 180], ['RM004', 1]] };
    const map = {}; Object.keys(rec).forEach((k) => { map[k] = rec[k].map((x) => ({ raw: x[0], qty: x[1] })); });
    const db = await window.claude.use('db');
    await db.doc('menu/items').set({ list: items.map((i) => ({ code: i[0], name: i[1], cat: i[2], price: i[3], open: 0 })) });
    await db.doc('catalog/raws').set({ list: raws.map((r) => ({ code: r[0], name: r[1], cat: r[2], unit: r[3], open: r[4], price: r[5], min: r[6] })) });
    await db.doc('catalog/recipes').set({ map });
    toast('تم تحميل البيانات التجريبية. جرّب تسجيل بيع من حساب كاشير.');
  }

  /* =================== الأحداث =================== */
  const A = {
    mode(el) { mode = el.dataset.v; renderAuth(); },
    theme() { const n = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); ls.set('mz_theme', n); rerender(); },
    logout: async () => { try { await api('POST', 'auth/logout', {}); } catch (e) {} location.href = location.pathname; },
    async buy(el) {
      const phone = ($('#mzPhone') || {}).value || ''; ls.set('mz_phone', phone);
      el.disabled = true;
      try { const r = await api('POST', 'billing/checkout', { plan: el.dataset.plan, phone }); location.href = r.url; }
      catch (e) { toast(errMsg(e)); el.disabled = false; }
    },
    async export(el) {
      el.disabled = true;
      try { const d = await api('GET', 'export'); const dl = await window.claude.use('downloads'); await dl.save({ filename: 'scale-business-backup-' + new Date().toISOString().slice(0, 10) + '.json', data: d }); toast('تم تنزيل النسخة'); }
      catch (e) { toast(errMsg(e)); }
      el.disabled = false;
    },
    async pw(el) {
      try { await api('POST', 'auth/password', { old: $('#mzOld').value, new: $('#mzNew').value }); $('#mzOld').value = ''; $('#mzNew').value = ''; toast('تم تغيير كلمة المرور'); }
      catch (e) { toast(errMsg(e)); }
    },
    async addseller(el) {
      try {
        await api('POST', 'team', { name: $('#tmName').value, username: $('#tmUser').value, password: $('#tmPass').value });
        toast('تمت إضافة الموظف'); cache.team = null; loadTeam(true);
      } catch (e) { toast(errMsg(e)); }
    },
    async toggleseller(el) {
      try { await api('PATCH', 'team', { id: +el.dataset.id, active: el.dataset.active === '1' }); cache.team = null; loadTeam(true); } catch (e) { toast(errMsg(e)); }
    },
    async sellerpw(el) {
      const v = ($('#pw_' + el.dataset.id) || {}).value || '';
      try { await api('PATCH', 'team', { id: +el.dataset.id, password: v }); toast('تم تغيير كلمة المرور'); } catch (e) { toast(errMsg(e)); }
    },
    restore() { const i = $('#mzRestore'); i.value = ''; i.onchange = async () => {
      const f = i.files && i.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text()); const docs = j.docs; if (!Array.isArray(docs)) throw new Error('ملف غير صالح');
        let batch = [], size = 0, done = 0;
        const flush = async () => { if (!batch.length) return; const r = await api('POST', 'import', { docs: batch }); done += r.imported; batch = []; size = 0; };
        toast('جارٍ الاستيراد…');
        for (const d of docs) { const l = JSON.stringify(d).length; if (size + l > 300000 || batch.length >= 100) await flush(); batch.push(d); size += l; }
        await flush(); toast('تم استيراد ' + done + ' مستند'); MZ.pollNow();
      } catch (e) { toast('تعذر الاستيراد: ' + errMsg(e)); }
    }; i.click(); },
    async sample(el) { el.disabled = true; try { await loadSample(); } catch (e) { toast(errMsg(e)); } el.disabled = false; },
  };
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mz]'); if (!b) return;
    ev.preventDefault(); const f = A[b.dataset.mz]; if (f) f(b);
  });
  document.addEventListener('submit', (ev) => {
    const f = ev.target.closest('[data-mzform]'); if (!f) return;
    ev.preventDefault(); submitForm(f);
  });
  window.addEventListener('mz-unauth', () => { if (appLoaded) location.reload(); });
  window.addEventListener('mz-access', () => { cache.history = null; rerender(); });

  /* =================== بدء التشغيل =================== */
  MZ.start = async function () {
    try {
      const me = await api('GET', 'me');
      MZ.me = me; authPlans = me.plans || []; authMeta = me;
      if (!me.user) { renderAuth(); return; }
      afterAuth();
    } catch (e) {
      $('#root').innerHTML = '<div class="card empty" style="margin-top:24px">تعذر الاتصال بالخادم. أعد تحميل الصفحة.</div>';
    }
  };
})();
