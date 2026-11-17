/* Scale Business — طبقة التوافق: تجعل التطبيق يعمل فوق واجهة REST بدل منصة Claude.
   توفر window.claude.use('db' | 'user' | 'downloads') بنفس الواجهة التي يستخدمها app.js. */
(function () {
  'use strict';
  const BASE = window.MZ_API || '/api/';
  const MZ = (window.MZ = window.MZ || {});

  async function api(method, route, body) {
    let r;
    try {
      r = await fetch(BASE + route, {
        method, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'mezzan', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const er = new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت.');
      er.code = 'network'; throw er;
    }
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      const er = new Error(j.message || 'حدث خطأ');
      er.code = j.error || 'http_' + r.status; er.status = r.status;
      if (r.status === 401 && route !== 'auth/login') window.dispatchEvent(new Event('mz-unauth'));
      if (r.status === 402) window.dispatchEvent(new CustomEvent('mz-access', { detail: { state: 'expired' } }));
      throw er;
    }
    return j;
  }
  MZ.api = api;

  /* ---------- لقطات (snapshots) ---------- */
  const isDoc = (p) => p.split('/').length % 2 === 0;
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  const docSnap = (id, ex, data) => ({ id, exists: !!ex, data: () => (ex ? JSON.parse(JSON.stringify(data)) : undefined) });
  const colSnap = (docs) => {
    const ds = docs.map((d) => ({ id: d.id, exists: true, data: () => JSON.parse(JSON.stringify(d.data)) }));
    return { docs: ds, size: ds.length, empty: !ds.length, forEach: (f) => ds.forEach(f) };
  };

  /* ---------- الاشتراكات (polling) ---------- */
  const subs = new Map(); // path -> {sig, last, cbs:Set}
  let timer = null, inflight = false, again = false, fast = 0;

  function applyAccess(ac) {
    if (!ac || !MZ.me) return;
    const old = MZ.me.access && MZ.me.access.state;
    MZ.me.access = ac;
    if (old !== ac.state) window.dispatchEvent(new CustomEvent('mz-access', { detail: ac }));
  }

  async function poll() {
    if (inflight) { again = true; return; }
    if (!subs.size) return;
    inflight = true;
    try {
      const sigs = {};
      subs.forEach((v, k) => (sigs[k] = v.sig));
      const r = await api('POST', 'poll', { subs: sigs });
      applyAccess(r.access);
      Object.keys(r.changes || {}).forEach((p) => {
        const s = subs.get(p); if (!s) return;
        const c = r.changes[p];
        s.sig = c.sig;
        s.last = isDoc(p) ? docSnap(p.split('/').pop(), c.exists, c.data) : colSnap(c.docs || []);
        s.cbs.forEach((cb) => { try { cb.ok(s.last); } catch (e) { console.error(e); } });
      });
      Object.keys(r.errors || {}).forEach((p) => {
        const s = subs.get(p); if (!s) return;
        s.cbs.forEach((cb) => { try { cb.err && cb.err({ code: 'permission-denied', message: r.errors[p] }); } catch (e) {} });
      });
    } catch (e) {
      subs.forEach((s) => s.cbs.forEach((cb) => { try { cb.err && cb.err({ code: e.code || 'error', message: e.message }); } catch (x) {} }));
    } finally {
      inflight = false;
      if (again) { again = false; setTimeout(poll, 50); }
    }
  }
  function schedule() {
    if (timer) return;
    timer = setInterval(() => {
      if (document.hidden) return;
      if (fast > 0) fast--;
      poll();
    }, 3500);
  }
  MZ.pollNow = poll;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  function subscribe(path, ok, err) {
    let s = subs.get(path);
    if (!s) { s = { sig: '', last: null, cbs: new Set() }; subs.set(path, s); }
    const cb = { ok, err };
    s.cbs.add(cb);
    if (s.last) setTimeout(() => { if (s.cbs.has(cb)) ok(s.last); }, 0);
    schedule(); poll();
    return () => { s.cbs.delete(cb); };
  }

  /* ---------- db ---------- */
  const enc = encodeURIComponent;
  const db = {
    doc(path) {
      const id = path.split('/').pop();
      return {
        id, path,
        async get() { const r = await api('GET', 'doc?path=' + enc(path)); return docSnap(id, r.exists, r.data); },
        async set(data) { await api('PUT', 'doc?path=' + enc(path), { data }); poll(); },
        async update(data) {
          const g = await this.get();
          await api('PUT', 'doc?path=' + enc(path), { data: Object.assign({}, g.exists ? g.data() : {}, data) }); poll();
        },
        async delete() { await api('DELETE', 'doc?path=' + enc(path)); poll(); },
        onSnapshot(ok, err) { return subscribe(path, ok, err); },
      };
    },
    collection(path) {
      return {
        path,
        doc(id) { return db.doc(path + '/' + id); },
        async add(data) { const id = rid(); await api('PUT', 'doc?path=' + enc(path + '/' + id), { data }); poll(); return { id }; },
        onSnapshot(ok, err) { return subscribe(path, ok, err); },
      };
    },
  };

  /* ---------- user ---------- */
  const user = {
    async id() { return String(MZ.me.user.id); },
    async canEdit() { return MZ.me.user.role === 'owner'; },
    async isOwner() { return MZ.me.user.role === 'owner'; },
    async can(n) { return n === 'data.write' ? true : null; },
    async profiles(ids) {
      const out = {};
      try {
        const t = await api('GET', 'team');
        t.users.forEach((u) => { out[u.id] = { name: u.name }; });
      } catch (e) {}
      (ids || []).forEach((i) => { if (!out[i]) out[i] = { name: '' }; });
      return out;
    },
  };

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const bom = /\.csv$/i.test(filename) && text.charCodeAt(0) !== 0xfeff ? '﻿' : '';
      const type = /\.json$/i.test(filename) ? 'application/json' : 'text/csv;charset=utf-8';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bom + text], { type }));
      a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    },
  };

  window.claude = window.claude || {};
  window.claude.use = async function (name) {
    if (!MZ.me || !MZ.me.user) return null;
    if (name === 'db') return db;
    if (name === 'user') return user;
    if (name === 'downloads') return downloads;
    return null;
  };
})();
