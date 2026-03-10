(() => {
  const SOURCE = 'ka-tracker-page-trace-bridge';

  const isApiUrl = (url) =>
    typeof url === 'string' && url.includes('khanacademy.org/api/');

  const parseBody = (body) => {
    if (typeof body !== 'string') {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch (error) {
      return null;
    }
  };

  const getOperationNameFromUrl = (url) => {
    if (typeof url !== 'string') {
      return null;
    }

    try {
      const parsedUrl = new URL(url, window.location.origin);
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const lastPart = pathParts[pathParts.length - 1] || null;
      if (lastPart && lastPart !== 'graphql') {
        return lastPart;
      }
    } catch (error) {
      return null;
    }

    return null;
  };

  const toDetails = (url, method, body) => {
    const details = { url, method };
    const parsed = parseBody(body);

    if (parsed?.operationName) {
      details.operationName = parsed.operationName;
    } else {
      details.operationName = getOperationNameFromUrl(url);
    }

    if (parsed?.variables) {
      details.variables = parsed.variables;
    }

    if (typeof parsed?.query === 'string') {
      details.queryPreview = parsed.query.slice(0, 160);
    }

    return details;
  };

  const getRequestInfo = async (input, init) => {
    if (typeof input === 'string') {
      return {
        url: input,
        method: init?.method || 'GET',
        body: init?.body || null
      };
    }

    if (input instanceof Request) {
      let body = init?.body || null;
      if (!body) {
        try {
          body = await input.clone().text();
        } catch (error) {
          body = null;
        }
      }

      return {
        url: input.url,
        method: init?.method || input.method || 'GET',
        body
      };
    }

    return {
      url: input?.url || '',
      method: init?.method || input?.method || 'GET',
      body: init?.body || input?.body || null
    };
  };

  const post = (type, details) => {
    window.postMessage({ source: SOURCE, type, details }, '*');
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init] = args;
    const { url, method, body } = await getRequestInfo(input, init);

    if (isApiUrl(url)) {
      post('request', toDetails(url, method, body));
    }

    try {
      const response = await originalFetch(...args);
      if (isApiUrl(url)) {
        post('response', { url, method, status: response.status });
      }
      return response;
    } catch (error) {
      if (isApiUrl(url)) {
        post('error', { url, method, error: String(error) });
      }
      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__kaTraceMethod = method;
    this.__kaTraceUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__kaTraceUrl || '';
    const method = this.__kaTraceMethod || 'GET';

    if (isApiUrl(url)) {
      post('request', toDetails(url, method, body));
      this.addEventListener(
        'loadend',
        () => {
          post('response', { url, method, status: this.status });
        },
        { once: true }
      );
    }

    return originalSend.call(this, body);
  };

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (originalSendBeacon) {
    navigator.sendBeacon = (url, data) => {
      if (isApiUrl(url)) {
        post('request', {
          url,
          method: 'BEACON',
          bodyPreview: typeof data === 'string' ? data.slice(0, 200) : String(data)
        });
      }

      return originalSendBeacon(url, data);
    };
  }

  post('response', { url: window.location.href, method: 'TRACE', status: 'installed' });
})();
