/**
 * BrainSweep — Central Configuration (Phase 0)
 * Update the PLACEHOLDER_* values below before commercial launch.
 */
window.BRAINSWEEP_CONFIG = {
  brandName: 'BrainSweep',
  legalEntity: 'PLACEHOLDER_REGISTERED_BUSINESS_NAME', // CAC-registered business/company name
  country: 'Nigeria',
  contactEmail: 'PLACEHOLDER_WORKING_EMAIL', // Working support/privacy inbox
  siteUrl: 'https://brainsweep-tau.vercel.app',
  leaderboardApiUrl:
    'https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec',
  dailyLaunchDate: '2026-11-01', // PLACEHOLDER_DAILY_LAUNCH_DATE (YYYY-MM-DD in Africa/Lagos)
  analytics: {
    provider: 'plausible', // 'plausible' | 'umami' | 'posthog' | 'ga4'
    domain: 'PLACEHOLDER_DOMAIN',
    scriptUrl: '', // Optional custom script endpoint
    enabled: false,
  },
  allowedEmbedDomains: [], // Empty = allow all but log 'embed_unlicensed_domain'; non-empty = enforce allow-list
};
