const assert = require('assert');
const { classifyLeadEntity, classifyMentionSource, extractLooseCandidateName, isRelevantMentionForProject } = require('../lib/engine');

const config = {
  weights: {
    funding: 3,
    compliance: 3,
    hongKong: 3,
    asia: 2,
    institutional: 2,
    listing: 3,
    exchange: 1,
    hiring: 2,
    rwa: 2,
    stablecoin: 2,
    custody: 2
  }
};

const internalRules = {
  thresholds: {
    minTvlUsd: 5000000,
    minMarketCapUsd: 30000000,
    minDailyVolumeUsd: 500000,
    minDexLiquidityUsd: 1000000
  }
};

const profileList = [
  {
    name: 'Ethena',
    symbol: 'ENA',
    screening: {
      tvlUsd: 7312000000,
      marketCapUsd: 886260000,
      dailyVolumeUsd: 89630000,
      dexLiquidityUsd: 20460000,
      complianceSignals: ['Institutional custody stack'],
      strategicFit: ['Stablecoin infrastructure'],
      passes: true
    }
  }
];

function runCase(title, description) {
  return classifyLeadEntity(
    { title, description, source: 'Test', link: 'https://example.com' },
    profileList,
    config,
    internalRules
  );
}

const rejectCases = [
  ['Consensus Hong Kong', 'Hong Kong crypto conference week agenda'],
  ['BTC', 'bitcoin market update'],
  ['XRP', 'xrp listing outlook'],
  ['0x1234abcd', 'wallet received funds'],
  ['Interactive Brokers', 'brokers launch crypto trading access'],
  ['StanChart', 'bank joins Hong Kong stablecoin license batch']
];

rejectCases.forEach(([title, description]) => {
  const result = runCase(title, description);
  assert.strictEqual(result.allow, false, `${title} should be rejected`);
});

const mantraReject = runCase('MANTRA', 'token update with no clear compliance or Hong Kong signals');
assert.strictEqual(mantraReject.allow, false, 'MANTRA should reject when evidence is insufficient');

const mantraAllow = runCase(
  'MANTRA',
  'RWA protocol expands in Hong Kong with regulated institutional tokenized asset partnerships and compliance-first market access'
);
assert.strictEqual(mantraAllow.allow, true, 'MANTRA should allow if evidence is sufficient');

assert.strictEqual(
  extractLooseCandidateName("Mountain Protocol's USDM Quietly Becomes Largest Treasury-Backed Stablecoin", ''),
  'Mountain Protocol',
  'loose extractor should preserve Mountain Protocol'
);

assert.strictEqual(
  extractLooseCandidateName('Cryptodollar Minting Protocol M^0 Will Allow Institutions to Issue Stablecoins', ''),
  'Cryptodollar Minting Protocol',
  'loose extractor should preserve Cryptodollar Minting Protocol'
);

assert.notStrictEqual(
  extractLooseCandidateName('How Sui Protocol and rcUSD Are Revolutionizing Blockchain with RWA-Backed Tokens - OKX', ''),
  'How Sui Protocol',
  'loose extractor should not preserve question-style title prefixes'
);

assert.strictEqual(
  isRelevantMentionForProject(
    {
      title: 'Tune in now! @TripleVodkaSoda is talking all things Plume, real-world yield and what’s next for RWAs',
      link: 'https://twitter.com/plumenetwork/status/2032503829049258160',
      source: 'Twitter'
    },
    { name: 'Plume', symbol: 'PLUME' },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org', symbol: 'PLUME' }
  ),
  true,
  'official Plume tweet should be considered relevant'
);

assert.strictEqual(
  isRelevantMentionForProject(
    {
      title: 'A plume of smoke was seen over the city as tensions escalated',
      link: 'https://twitter.com/foxnews/status/2033562441833955451',
      source: 'Twitter'
    },
    { name: 'Plume', symbol: 'PLUME' },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org', symbol: 'PLUME' }
  ),
  false,
  'generic fox news plume mention should be rejected'
);

assert.strictEqual(
  classifyMentionSource(
    {
      title: 'Tune in now! @TripleVodkaSoda is talking all things Plume',
      link: 'https://twitter.com/plumenetwork/status/2032503829049258160',
      source: 'Twitter'
    },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org' }
  ).tier,
  'official',
  'official project source should rank as official'
);

assert.strictEqual(
  classifyMentionSource(
    {
      title: 'RWA News: Plume expands institutional yield',
      link: 'https://www.coindesk.com/markets/2026/03/17/plume-expands/',
      source: 'CoinDesk'
    },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org' }
  ).tier,
  'crypto_media',
  'crypto native media should rank above general media'
);

process.stdout.write('entity-classifier tests passed\n');
