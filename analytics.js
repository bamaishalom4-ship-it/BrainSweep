/**
 * BrainSweep — Consent-Gated Analytics & Publisher Embed Telemetry (Phase 4)
 * Never transmits email or username. Respects NDPA / GDPR / CCPA consent state.
 */
(() => {
  const CONSENT_KEY = 'brainsweep_cookie_consent_v1';
  const LAST_VISIT_KEY = 'brainsweep_last_visit_ts_v1';
  let providerScriptLoaded = false;
  const pendingQueue = [];

  function getConfig() {
    return window.BRAINSWEEP_CONFIG || {};
  }

  function isEmbedContext() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const e = params.get('embed');
      return e === 'true' || e === '1';
    } catch {
      return false;
    }
  }

  function hasHostEmbedConsent() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const c = params.get('consent');
      return c === '1' || c === 'true';
    } catch {
      return false;
    }
  }

  function hasAnalyticsConsent() {
    const cfg = getConfig();
    if (!cfg.analytics || !cfg.analytics.enabled) {
      return false;
    }
    const provider = String(cfg.analytics.provider || 'umami').toLowerCase();
    if (provider === 'umami') {
      if (!cfg.analytics.websiteId || String(cfg.analytics.websiteId).includes('PLACEHOLDER')) {
        return false;
      }
    } else if (
      !cfg.analytics.domain ||
      String(cfg.analytics.domain).includes('PLACEHOLDER')
    ) {
      return false;
    }

    if (isEmbedContext()) {
      // In embed mode, default analytics to OFF unless host passes ?consent=1
      return hasHostEmbedConsent();
    }

    try {
      return localStorage.getItem(CONSENT_KEY) === 'accepted';
    } catch {
      return false;
    }
  }

  function getTrustedEmbedHost() {
    // Licensing ONLY trusts browser-provided ancestorOrigins or document.referrer (never ?domain=).
    try {
      if (
        window.location &&
        window.location.ancestorOrigins &&
        window.location.ancestorOrigins.length > 0
      ) {
        const originUrl = new URL(window.location.ancestorOrigins[0]);
        if (originUrl.hostname) {
          return originUrl.hostname.toLowerCase().replace(/^www\./, '');
        }
      }
    } catch {
      // ignore invalid ancestorOrigins
    }

    try {
      if (document.referrer) {
        const refUrl = new URL(document.referrer);
        if (refUrl.hostname) {
          return refUrl.hostname.toLowerCase().replace(/^www\./, '');
        }
      }
    } catch {
      // ignore invalid referrer URL
    }

    return '';
  }

  function getEmbedHostDomain() {
    // Analytics label only: prefer trusted host, then optional ?domain= label
    const trusted = getTrustedEmbedHost();
    if (trusted) return trusted;

    try {
      const params = new URLSearchParams(window.location.search || '');
      const dom = (params.get('domain') || '').trim().toLowerCase();
      if (dom) {
        return dom.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      }
    } catch {
      // ignore
    }

    return 'unknown';
  }

  function checkEmbedDomainLicense() {
    const cfg = getConfig();
    const allowList = Array.isArray(cfg.allowedEmbedDomains)
      ? cfg.allowedEmbedDomains
          .map((d) => String(d || '').trim().toLowerCase().replace(/^www\./, ''))
          .filter(Boolean)
      : [];
    const trustedHost = getTrustedEmbedHost();
    const hostLabel = trustedHost || 'unknown';

    if (allowList.length === 0) {
      if (isEmbedContext()) {
        track('embed_unlicensed_domain', { embed_domain: getEmbedHostDomain() });
      }
      return { allowed: true, hostDomain: hostLabel, isExplicitlyAllowed: false };
    }

    const isAllowed =
      Boolean(trustedHost) &&
      allowList.some(
        (allowed) => trustedHost === allowed || trustedHost.endsWith(`.${allowed}`)
      );

    return { allowed: isAllowed, hostDomain: hostLabel, isExplicitlyAllowed: isAllowed };
  }

  function isWhitelabelAuthorized() {
    if (!isEmbedContext()) return false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      const wl = params.get('whitelabel');
      if (wl !== '1' && wl !== 'true') return false;
    } catch {
      return false;
    }
    const license = checkEmbedDomainLicense();
    return Boolean(license.isExplicitlyAllowed);
  }

  function dispatchToProvider(eventName, safeProps) {
    try {
      if (window.umami && typeof window.umami.track === 'function') {
        window.umami.track(eventName, safeProps);
        return true;
      }
      if (typeof window.plausible === 'function') {
        window.plausible(eventName, { props: safeProps });
        return true;
      }
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(eventName, safeProps);
        return true;
      }
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, safeProps);
        return true;
      }
    } catch {
      // ignore provider errors
    }
    return false;
  }

  function flushPendingQueue() {
    while (pendingQueue.length > 0) {
      const next = pendingQueue[0];
      if (!dispatchToProvider(next.eventName, next.safeProps)) {
        break;
      }
      pendingQueue.shift();
    }
  }

  function loadProviderScriptIfConsented() {
    if (providerScriptLoaded || !hasAnalyticsConsent()) return;
    const cfg = getConfig();
    const provider = String((cfg.analytics && cfg.analytics.provider) || 'umami').toLowerCase();

    if (provider === 'umami') {
      const websiteId = String((cfg.analytics && cfg.analytics.websiteId) || '').trim();
      if (!websiteId || websiteId.includes('PLACEHOLDER')) return;
      providerScriptLoaded = true;
      const s = document.createElement('script');
      s.defer = true;
      s.src = (cfg.analytics && cfg.analytics.scriptUrl) || 'https://cloud.umami.is/script.js';
      s.setAttribute('data-website-id', websiteId);
      s.addEventListener('load', flushPendingQueue);
      document.head.appendChild(s);
    } else if (provider === 'plausible') {
      const domain = String((cfg.analytics && cfg.analytics.domain) || '').trim();
      if (!domain || domain.includes('PLACEHOLDER')) return;
      providerScriptLoaded = true;
      const s = document.createElement('script');
      s.defer = true;
      s.dataset.domain = domain;
      s.src = (cfg.analytics && cfg.analytics.scriptUrl) || 'https://plausible.io/js/script.js';
      s.addEventListener('load', flushPendingQueue);
      document.head.appendChild(s);
    }
  }

  function sanitizeProps(rawProps) {
    const clean = {};
    if (rawProps && typeof rawProps === 'object') {
      Object.keys(rawProps).forEach((k) => {
        const lower = k.toLowerCase();
        // Never transmit email, username, or PII
        if (
          lower.includes('email') ||
          lower.includes('username') ||
          lower.includes('user') ||
          lower.includes('name')
        ) {
          return;
        }
        const val = rawProps[k];
        if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          clean[k] = val;
        }
      });
    }
    if (isEmbedContext()) {
      clean.embed_domain = getEmbedHostDomain() || 'direct_embed';
    }
    return clean;
  }

  function track(eventName, props = {}) {
    if (!eventName || !hasAnalyticsConsent()) return;
    loadProviderScriptIfConsented();

    const safeProps = sanitizeProps(props);
    if (!dispatchToProvider(eventName, safeProps)) {
      if (pendingQueue.length < 30) {
        pendingQueue.push({ eventName, safeProps });
      }
    }
  }

  function recordVisitTelemetry() {
    try {
      const now = Date.now();
      const prevRaw = localStorage.getItem(LAST_VISIT_KEY);
      localStorage.setItem(LAST_VISIT_KEY, String(now));
      if (prevRaw) {
        const prevTs = parseInt(prevRaw, 10);
        if (Number.isFinite(prevTs) && now > prevTs) {
          const daysSince = Math.floor((now - prevTs) / (1000 * 60 * 60 * 24));
          if (daysSince >= 1) {
            track('return_visit', { days_since_last_play: daysSince });
          }
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  function postEmbedMessage(type, payload = {}) {
    if (!isEmbedContext()) return;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            source: 'brainsweep',
            type,
            payload: sanitizeProps(payload),
          },
          '*'
        );
      }
    } catch {
      // ignore cross-origin postMessage errors
    }
  }

  function enableAfterConsent() {
    loadProviderScriptIfConsented();
    recordVisitTelemetry();
  }

  window.BrainSweepAnalytics = {
    track,
    enableAfterConsent,
    recordVisitTelemetry,
    postEmbedMessage,
    getTrustedEmbedHost,
    getEmbedHostDomain,
    checkEmbedDomainLicense,
    isWhitelabelAuthorized,
    hasAnalyticsConsent,
  };
})();
