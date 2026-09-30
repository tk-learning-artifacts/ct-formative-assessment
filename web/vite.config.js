import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import { parseEnv } from 'util'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Dev only: /admin would otherwise resolve to admin.js, the script.
const adminShortcut = {
  name: 'admin-shortcut',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/admin' || req.url === '/admin/') {
        res.statusCode = 302
        res.setHeader('Location', '/admin.html')
        res.end()
        return
      }
      next()
    })
  }
}

// Dev only: one link per role. A page opened as teacher.localhost or
// student.localhost gets a small script that signs it in, so both roles can be
// open at once and neither needs typing. `apply: 'serve'` means the plugin does
// not exist in a build, and the script is served from memory rather than from a
// file under web/, so it cannot reach the production image or its allowlist.
// It uses the ordinary login form's endpoint with the seeded demo account, not
// a server-side bypass. See docs/architecture/LOCAL-DEV.md.
const DEV_LOGIN_PATH = '/__dev-login.js'

function devLoginScript({ email, password, joinCode, name, group }) {
  return `(function () {
  var host = location.hostname;
  var role = host.indexOf('teacher.') === 0 ? 'teacher' : host.indexOf('student.') === 0 ? 'student' : null;
  if (!role) return;
  var path = location.pathname;

  if (role === 'teacher') {
    if (path === '/' || path === '/index.html') { location.replace('/admin.html' + location.search + location.hash); return; }
    if (path !== '/admin.html') return;
    var KEY = 'ct-quest-token';
    var call = function (method, url, body, token) {
      var x = new XMLHttpRequest();
      x.open(method, url, false); // synchronous, so the token is in place before admin.js runs
      x.setRequestHeader('Content-Type', 'application/json');
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.send(body ? JSON.stringify(body) : null);
      return x;
    };
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && call('GET', '/api/auth/me', null, saved).status === 200) return;
      var res = call('POST', '/api/auth/login', { email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} });
      if (res.status === 200) localStorage.setItem(KEY, JSON.parse(res.responseText).token);
      else console.warn('[dev-login] teacher login failed (' + res.status + '); is the backend up, and are SEED_TEACHER_* the seeded account?');
    } catch (e) { console.warn('[dev-login]', e); }
    return;
  }

  if (path !== '/' && path !== '/index.html') return;
  var fields = { joinCode: ${JSON.stringify(joinCode)}, name: ${JSON.stringify(name)}, group: ${JSON.stringify(group)} };
  var fill = function () {
    Object.keys(fields).forEach(function (id) {
      var input = document.getElementById(id);
      if (input && !input.value && !input.dataset.devFilled) { input.value = fields[id]; input.dataset.devFilled = '1'; }
    });
    var start = document.getElementById('joinBtn') || document.getElementById('startBtn');
    if (start && !start.dataset.devFocused) { start.dataset.devFocused = '1'; start.focus(); }
  };
  new MutationObserver(fill).observe(document, { childList: true, subtree: true });
})();`
}

const devRoleLogin = {
  name: 'dev-role-login',
  apply: 'serve',
  configureServer(server) {
    // The dev seed account, from the one file `pnpm run dev` loads. Not
    // loadEnv (it would also read the repo-root .env, the production file), and
    // not the shell for SEED_TEACHER_*: a shell that exports the production
    // seed account would have that password embedded in a script served to the
    // browser, for an account the dev database does not have. Blank means the
    // backend's own defaults. Read once, so a change to the file needs a Vite
    // restart. The DEV_* names may also come from the shell.
    let fromFile = {}
    try {
      fromFile = parseEnv(readFileSync(resolve(__dirname, '../.env.development'), 'utf8'))
    } catch (_error) {
      // no file: defaults
    }
    const setting = key => (key.startsWith('DEV_') && process.env[key]) || fromFile[key]
    const script = devLoginScript({
      email: setting('SEED_TEACHER_EMAIL') || 'teacher@ctquest.local',
      password: setting('SEED_TEACHER_PASSWORD') || 'changeme123',
      joinCode: setting('DEV_JOIN_CODE') || 'DEMO123',
      name: setting('DEV_STUDENT_NAME') || 'Dev Student',
      group: setting('DEV_STUDENT_GROUP') || 'Dev Class'
    })

    // Registered before Vite's own middleware (after it, the SPA fallback
    // answers this path with index.html), which also means it runs before
    // Vite's host check. So it does its own: the script carries the dev
    // password, and a page on another origin that rebinds its DNS to loopback,
    // or a machine on the LAN under `vite --host`, must not be able to read it.
    // Only a loopback socket with a localhost or *.localhost Host gets it.
    server.middlewares.use((req, res, next) => {
      if (req.url !== DEV_LOGIN_PATH) {
        next()
        return
      }
      const local = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')
      const host = String(req.headers.host || '').replace(/:\d+$/, '')
      if (!local || !/(^|\.)localhost$/.test(host)) {
        res.statusCode = 403
        res.end()
        return
      }
      res.setHeader('Content-Type', 'text/javascript')
      res.setHeader('Cache-Control', 'no-store')
      res.end(script)
    })
  },
  transformIndexHtml() {
    return [{ tag: 'script', attrs: { src: DEV_LOGIN_PATH }, injectTo: 'head-prepend' }]
  }
}

export default defineConfig({
  root: __dirname,
  plugins: [adminShortcut, devRoleLogin],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api requests to the backend in dev
      '/api': {
        target: process.env.DEV_API_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
})
