// 브라우저용 아주 작은 Express — server/app.js·auth.js가 쓰는 기능만 같은 방식으로 흉내 낸다.
// 경로(:name, {*name}), app.use 접두사, 미들웨어·오류 처리(인자 4개), async 오류 전달, req/res 기본 기능.

const TYPES = {
  json: 'application/json; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  html: 'text/html; charset=utf-8', glb: 'model/gltf-binary', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8',
};
const typeOf = (t) => TYPES[String(t).replace(/^\./, '').toLowerCase()] ?? t;

function compile(pattern, prefix) {
  const keys = [];
  const src = pattern.split('/').map((seg) => {
    if (seg.startsWith(':')) {
      keys.push(seg.slice(1));
      return '([^/]+)';
    }
    const star = /^\{\*(\w+)\}$/.exec(seg);
    if (star) {
      keys.push(star[1]);
      return '(.*)';
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  const re = new RegExp(prefix ? `^${src}(?=/|$)` : `^${src}/?$`);
  return (path) => {
    const m = re.exec(path);
    if (!m) return null;
    const params = {};
    keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1] ?? '');
    });
    return { params, rest: prefix ? path.slice(m[0].length) || '/' : path };
  };
}

function createReq(request, path, jar) {
  const url = new URL(path, request.url);
  const headers = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  headers.host = url.host;
  headers.cookie = jar.header();
  const query = {};
  url.searchParams.forEach((v, k) => {
    query[k] = k in query ? [].concat(query[k], v) : v;
  });
  return {
    method: request.method, url: url.pathname + url.search, originalUrl: url.pathname + url.search, fullPath: url.pathname,
    path: url.pathname, query, headers, params: {}, body: undefined, protocol: url.protocol.replace(':', ''), secure: url.protocol === 'https:',
    ip: '127.0.0.1', raw: request,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

function createRes(jar, readFile) {
  let resolve;
  const done = new Promise((r) => {
    resolve = r;
  });
  const res = {
    statusCode: 200, headers: new Headers(), headersSent: false, done, next: null,
    status(n) {
      this.statusCode = n;
      return this;
    },
    set(k, v) {
      if (typeof k === 'object') Object.entries(k).forEach(([a, b]) => this.headers.set(a, b));
      else this.headers.set(k, v);
      return this;
    },
    setHeader(k, v) {
      return this.set(k, v);
    },
    getHeader(k) {
      return this.headers.get(k);
    },
    type(t) {
      this.headers.set('content-type', typeOf(t));
      return this;
    },
    json(obj) {
      if (!this.headers.has('content-type')) this.headers.set('content-type', TYPES.json);
      return this.end(JSON.stringify(obj));
    },
    send(body) {
      if (body != null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof Blob)) return this.json(body);
      if (typeof body === 'string' && !this.headers.has('content-type')) this.headers.set('content-type', TYPES.html);
      return this.end(body);
    },
    end(body) {
      if (this.headersSent) return this;
      this.headersSent = true;
      resolve(new Response(body ?? null, { status: this.statusCode, headers: this.headers }));
      return this;
    },
    cookie(name, value, opts = {}) {
      jar.set(name, String(value), opts);
      return this;
    },
    clearCookie(name) {
      jar.delete(name);
      return this;
    },
    sendFile(file) {
      readFile(file).then((bytes) => {
        if (!bytes) {
          const err = new Error('파일을 찾을 수 없습니다.');
          err.status = 404;
          return this.next(err);
        }
        if (!this.headers.has('content-type')) this.headers.set('content-type', typeOf(file.split('.').pop()));
        this.end(bytes);
      }, (e) => this.next(e));
      return this;
    },
  };
  return res;
}

export default function express() {
  const stack = [];
  const settings = {};
  const add = (method, prefix, path, fns) => {
    [].concat(path).forEach((p) => {
      const match = compile(p, prefix);
      fns.flat().forEach((fn) => stack.push({ method, prefix, match, fn, isErr: fn.length === 4 }));
    });
  };
  const route = (method) => (path, ...fns) => add(method, false, path, fns);
  const app = {
    get(path, ...fns) {
      if (!fns.length) return settings[path];
      return add('GET', false, path, fns);
    },
    post: route('POST'),
    patch: route('PATCH'),
    put: route('PUT'),
    delete: route('DELETE'),
    use(path, ...fns) {
      if (typeof path === 'function') add(null, true, '', [path, ...fns]);
      else add(null, true, path, fns);
    },
    set(k, v) {
      settings[k] = v;
    },
    disable(k) {
      settings[k] = false;
    },
    enable(k) {
      settings[k] = true;
    },
    // 서비스 워커가 부른다: Request → Response
    handle(request, { path, jar, readFile }) {
      const req = createReq(request, path, jar);
      const res = createRes(jar, readFile);
      let i = 0;
      const next = (err) => {
        while (i < stack.length) {
          const layer = stack[i++];
          if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) continue;
          if (Boolean(err) !== layer.isErr) continue;
          const m = layer.match(req.fullPath);
          if (!m) continue;
          req.params = m.params;
          req.path = layer.prefix ? m.rest : req.fullPath;
          res.next = next;
          try {
            const r = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
            if (r && typeof r.then === 'function') r.then(undefined, (e) => next(e ?? new Error('요청 처리 실패')));
          } catch (e) {
            next(e);
          }
          return;
        }
        if (res.headersSent) return;
        if (err) {
          console.error(err);
          res.status(err.status ?? 500).json({ error: err.status ? err.message : '서버 처리에 실패했습니다.' });
        } else res.status(404).json({ error: '찾을 수 없습니다.' });
      };
      next();
      return res.done;
    },
  };
  return app;
}

express.json = () => async (req, res, next) => {
  if (req.bodyParsed || !String(req.headers['content-type'] ?? '').includes('application/json')) return next();
  req.bodyParsed = true;
  const text = await req.raw.text();
  try {
    req.body = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('요청 형식이 올바르지 않습니다.');
    err.status = 400;
    return next(err);
  }
  next();
};
express.static = () => (req, res, next) => next();
