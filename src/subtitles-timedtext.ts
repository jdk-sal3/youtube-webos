/**
 * YouTube TV's player requests auto-translated captions (/api/timedtext with
 * tlang) as same-origin XHR, so cookies are sent, and it also appends TVHTML5
 * client params (`c=TVHTML5`, `cver`, `cbrand`, …). That combination returns
 * HTTP 429 ("Sorry… automated queries") and no cues are rendered.
 *
 * The same signed URL succeeds (HTTP 200, json3 events) when those client
 * params are stripped, `fmt=json3` + `xorb`/`xobt`/`xovt` are present, and the
 * request is made with credentials omitted. Non-translated timedtext (no
 * tlang) already works and is left untouched.
 */

export const TIMEDTEXT_CLIENT_PARAMS = [
  'c',
  'cver',
  'cbrand',
  'cbr',
  'cbrver',
  'ctheme',
  'cplayer',
  'cmodel',
  'cos',
  'cosver',
  'cplatform'
] as const;

export function rewriteTranslatedTimedtextUrl(
  input: string,
  baseHref = 'https://www.youtube.com'
): string | null {
  let url: URL;
  try {
    url = new URL(input, baseHref);
  } catch (err) {
    console.warn('[subtitles] Could not parse timedtext URL', input, err);
    return null;
  }

  if (!url.pathname.includes('/api/timedtext')) return null;
  if (!url.searchParams.has('tlang')) return null;

  for (const key of TIMEDTEXT_CLIENT_PARAMS) {
    url.searchParams.delete(key);
  }

  if (!url.searchParams.get('fmt')) {
    url.searchParams.set('fmt', 'json3');
  }
  if (!url.searchParams.get('xorb')) {
    url.searchParams.set('xorb', '2');
  }
  if (!url.searchParams.get('xobt')) {
    url.searchParams.set('xobt', '3');
  }
  if (!url.searchParams.get('xovt')) {
    url.searchParams.set('xovt', '3');
  }

  return url.toString();
}

function requestUrl(resource: RequestInfo | URL): string {
  if (typeof resource === 'string') return resource;
  if (resource instanceof URL) return resource.toString();
  return resource.url;
}

function define(xhr: XMLHttpRequest, key: string, value: unknown) {
  try {
    Object.defineProperty(xhr, key, {
      configurable: true,
      enumerable: true,
      get: () => value
    });
  } catch {
    (xhr as unknown as Record<string, unknown>)[key] = value;
  }
}

function fire(
  xhr: XMLHttpRequest,
  type: string,
  prop: 'onreadystatechange' | 'onload' | 'onloadend' | 'onerror'
) {
  const event =
    type === 'readystatechange' ? new Event(type) : new ProgressEvent(type);
  const handler = xhr[prop];
  if (typeof handler === 'function') {
    (handler as (this: XMLHttpRequest, ev: Event) => unknown).call(xhr, event);
  }
  xhr.dispatchEvent(event);
}

async function fulfillXhrFromCookielessFetch(xhr: XMLHttpRequest, url: string) {
  const res = await window.fetch(url, { credentials: 'omit' });
  const buffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(buffer);

  const headerText = [...res.headers.entries()]
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  xhr.getAllResponseHeaders = () => headerText;
  xhr.getResponseHeader = (name) => res.headers.get(name);

  let response: unknown = text;
  if (xhr.responseType === 'json') {
    try {
      response = JSON.parse(text) as unknown;
    } catch {
      response = null;
    }
  } else if (xhr.responseType === 'arraybuffer') {
    response = buffer;
  }

  define(xhr, 'status', res.status);
  define(xhr, 'statusText', res.statusText);
  define(xhr, 'responseText', text);
  define(xhr, 'response', response);
  define(xhr, 'readyState', 4);

  fire(xhr, 'readystatechange', 'onreadystatechange');
  fire(xhr, 'load', 'onload');
  fire(xhr, 'loadend', 'onloadend');
}

export function installTranslatedTimedtextHooks() {
  if (typeof XMLHttpRequest === 'undefined') return;

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (
      this as XMLHttpRequest & { __ytafTimedtextUrl?: string }
    ).__ytafTimedtextUrl = String(url);
    return origOpen.apply(
      this,
      arguments as unknown as Parameters<typeof origOpen>
    );
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    const raw = (this as XMLHttpRequest & { __ytafTimedtextUrl?: string })
      .__ytafTimedtextUrl;
    const rewritten = raw ? rewriteTranslatedTimedtextUrl(raw) : null;
    if (!rewritten) {
      return origSend.call(this, body);
    }

    console.info(
      '[subtitles] Rewriting translated timedtext request (cookieless)'
    );
    define(this, 'readyState', 2);
    fire(this, 'readystatechange', 'onreadystatechange');

    void fulfillXhrFromCookielessFetch(this, rewritten).catch((err) => {
      console.warn('[subtitles] Cookieless timedtext fetch failed', err);
      fire(this, 'error', 'onerror');
      fire(this, 'loadend', 'onloadend');
    });
  };

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (
    this: unknown,
    resource: RequestInfo | URL,
    init?: RequestInit
  ) {
    const rewritten = rewriteTranslatedTimedtextUrl(requestUrl(resource));
    if (!rewritten) {
      return origFetch(resource, init);
    }

    console.info(
      '[subtitles] Rewriting translated timedtext fetch (cookieless)'
    );
    const credentials = { credentials: 'omit' as const };
    if (resource instanceof Request) {
      return origFetch(new Request(rewritten, resource), {
        ...init,
        ...credentials
      });
    }
    return origFetch(rewritten, { ...init, ...credentials });
  };
}

if (typeof window !== 'undefined') {
  installTranslatedTimedtextHooks();
}
