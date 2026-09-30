import assert from 'assert';
import {
  normalizeServerUrl,
  normalizeImageSource,
  buildDirectMediaUrl,
  buildDirectImageUrl,
  diagnoseImageUrl,
} from '../src/utils/mediaUtils';
import { XtreamCredentials } from '../src/types';

function runTests() {
  console.log('--- Iniciando Testes da Arquitetura Direta e Padronização de Imagens ---');

  // 1. normalizeServerUrl
  console.log('1. Testando normalizeServerUrl...');
  assert.strictEqual(
    normalizeServerUrl('example.com:8080'),
    'http://example.com:8080'
  );
  assert.strictEqual(
    normalizeServerUrl('http:/example.com:8080/'),
    'http://example.com:8080'
  );
  assert.strictEqual(
    normalizeServerUrl('https://provider.tv:8443/custom/base/'),
    'https://provider.tv:8443/custom/base'
  );
  assert.strictEqual(
    normalizeServerUrl('http://iptv.server.net/'),
    'http://iptv.server.net'
  );

  // 2. normalizeImageSource (array vs string safe boundary)
  console.log('2. Testando normalizeImageSource...');
  assert.strictEqual(
    normalizeImageSource('  https://example.com/cover.jpg  '),
    'https://example.com/cover.jpg'
  );
  // Arrays from backdrop_path
  assert.strictEqual(
    normalizeImageSource(['https://example.com/backdrop1.jpg', 'https://example.com/backdrop2.jpg']),
    'https://example.com/backdrop1.jpg'
  );
  assert.strictEqual(
    normalizeImageSource(['', '   ', 'https://example.com/valid.jpg']),
    'https://example.com/valid.jpg'
  );
  assert.strictEqual(normalizeImageSource([]), null);
  assert.strictEqual(normalizeImageSource(''), null);
  assert.strictEqual(normalizeImageSource('   '), null);
  assert.strictEqual(normalizeImageSource(null), null);
  assert.strictEqual(normalizeImageSource(undefined), null);

  // 3. buildDirectMediaUrl
  console.log('3. Testando buildDirectMediaUrl...');
  const testCreds: XtreamCredentials = {
    serverUrl: 'http://myprovider.xyz:8080',
    username: 'user@test+1',
    password: 'p@ssword#123',
  };

  // 3.1 Live Stream - Default m3u8
  const liveUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1042,
  });
  assert.strictEqual(
    liveUrl1,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1042.m3u8'
  );

  // 3.2 Live Stream - allowed_output_formats with ts only
  const liveUrl2 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: '1043',
    allowedOutputFormats: ['ts'],
  });
  assert.strictEqual(
    liveUrl2,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1043.ts'
  );

  // 3.3 Live Stream - allowed_output_formats with m3u8 and ts (should prefer m3u8)
  const liveUrl3 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1044,
    allowedOutputFormats: ['ts', 'm3u8'],
  });
  assert.strictEqual(
    liveUrl3,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1044.m3u8'
  );

  // 3.4 Movie - custom extension .mkv
  const movieUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'movie',
    streamId: 5520,
    containerExtension: 'mkv',
  });
  assert.strictEqual(
    movieUrl1,
    'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5520.mkv'
  );

  // 3.5 Movie - default mp4
  const movieUrl2 = buildDirectMediaUrl(testCreds, {
    type: 'movie',
    streamId: 5521,
  });
  assert.strictEqual(
    movieUrl2,
    'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5521.mp4'
  );

  // 3.6 Series Episode - custom extension
  const seriesUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'series',
    streamId: 9910,
    containerExtension: '.mp4',
  });
  assert.strictEqual(
    seriesUrl1,
    'http://myprovider.xyz:8080/series/user%40test%2B1/p%40ssword%23123/9910.mp4'
  );

  // 3.7 Direct source precedence
  const directSrcUrl = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 100,
    directSource: 'http://cdn.example.org/stream.m3u8',
  });
  assert.strictEqual(directSrcUrl, 'http://cdn.example.org/stream.m3u8');

  // 4. buildDirectImageUrl
  console.log('4. Testando buildDirectImageUrl...');
  // 4.1 Direct absolute URL (HTTP and HTTPS)
  assert.strictEqual(
    buildDirectImageUrl('http://img.provider.com/poster.jpg'),
    'http://img.provider.com/poster.jpg'
  );
  assert.strictEqual(
    buildDirectImageUrl('https://image.tmdb.org/t/p/w500/abc.jpg'),
    'https://image.tmdb.org/t/p/w500/abc.jpg'
  );

  // 4.2 Absolute provider URL containing ?url= and &sig= must remain 100% intact!
  const providerWithUrlParam =
    'http://logos.exemplo.test/image.php?url=https%3A%2F%2Fstorage.exemplo.test%2Fcanal.png&sig=abc';
  assert.strictEqual(
    buildDirectImageUrl(providerWithUrlParam),
    providerWithUrlParam,
    'URL absoluta do provedor com ?url= e &sig= deve sair rigorosamente intacta!'
  );

  const providerWithComplexQuery =
    'https://images.provider.tv:9000/get.php?token=xyz&url=enc&sig=987#channel';
  assert.strictEqual(
    buildDirectImageUrl(providerWithComplexQuery),
    providerWithComplexQuery,
    'URL com porta, parâmetros e fragmento deve permanecer intacta!'
  );

  // 4.3 Schemeless domain vs relative filename
  assert.strictEqual(
    buildDirectImageUrl('logo.png', 'http://iptv.server:8080'),
    'http://iptv.server:8080/logo.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('/logos/1.png', 'http://iptv.server:8080'),
    'http://iptv.server:8080/logos/1.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('logos/1.png', 'http://iptv.server:8080/base/'),
    'http://iptv.server:8080/base/logos/1.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('/logos/1.png?v=2&sig=abc', 'http://iptv.server:8080'),
    'http://iptv.server:8080/logos/1.png?v=2&sig=abc'
  );
  assert.strictEqual(
    buildDirectImageUrl('./channel_logo.png', 'http://iptv.server:8080/base/'),
    'http://iptv.server:8080/base/channel_logo.png'
  );
  assert.strictEqual(
    buildDirectImageUrl('../logos/ch1.png', 'http://iptv.server:8080/base/sub/'),
    'http://iptv.server:8080/base/logos/ch1.png'
  );

  // 4.4 Array input handled safely through normalizeImageSource
  assert.strictEqual(
    buildDirectImageUrl(['https://image.tmdb.org/t/p/w500/test.jpg']),
    'https://image.tmdb.org/t/p/w500/test.jpg'
  );

  // 4.5 Relative URL resolved against serverUrl
  assert.strictEqual(
    buildDirectImageUrl('/images/movie_123.jpg', 'http://iptv.server:8080'),
    'http://iptv.server:8080/images/movie_123.jpg'
  );

  // 4.6 Recover legacy query params from local proxy route ONLY
  assert.strictEqual(
    buildDirectImageUrl('/api/media/image?url=https%3A%2F%2Fimage.tmdb.org%2Fpic.jpg'),
    'https://image.tmdb.org/pic.jpg'
  );
  assert.strictEqual(
    buildDirectImageUrl('/api/media/image?url=logos%2Fch.png&serverUrl=http%3A%2F%2Fiptv.tv%3A8080'),
    'http://iptv.tv:8080/logos/ch.png'
  );

  // 4.7 Invalid / empty URL returns null (NEVER returns fallback SVG)
  assert.strictEqual(buildDirectImageUrl(''), null);
  assert.strictEqual(buildDirectImageUrl('   '), null);
  assert.strictEqual(buildDirectImageUrl(null), null);
  assert.strictEqual(buildDirectImageUrl(undefined), null);

  // 5. Verification that no proxy URL is generated
  console.log('5. Verificando ausência de rotas /api/media ou /api/xtream...');
  assert(!liveUrl1.includes('/api/media'), 'liveUrl1 não deve conter /api/media');
  assert(!movieUrl1.includes('/api/media'), 'movieUrl1 não deve conter /api/media');
  assert(!seriesUrl1.includes('/api/media'), 'seriesUrl1 não deve conter /api/media');

  // 6. Testando diagnoseImageUrl
  console.log('6. Testando diagnoseImageUrl...');
  const diag1 = diagnoseImageUrl(providerWithUrlParam);
  assert.strictEqual(diag1.wasModifiedByNormalizer, false);
  assert.strictEqual(diag1.isAbsolute, true);
  assert.strictEqual(diag1.diffCategory, 'identical');
  assert.strictEqual(diag1.resolvedUrl, providerWithUrlParam);

  const diag2 = diagnoseImageUrl('logo.png', 'http://iptv.server:8080');
  assert.strictEqual(diag2.diffCategory, 'relative_resolved_to_provider');
  assert.strictEqual(diag2.resolvedUrl, 'http://iptv.server:8080/logo.png');

  const diag3 = diagnoseImageUrl('/api/media/image?url=https%3A%2F%2Fimg.test%2Fa.png');
  assert.strictEqual(diag3.diffCategory, 'legacy_proxy_extracted');
  assert.strictEqual(diag3.resolvedUrl, 'https://img.test/a.png');

  const diag4 = diagnoseImageUrl('');
  assert.strictEqual(diag4.diffCategory, 'empty_source');
  assert.strictEqual(diag4.resolvedUrl, null);

  console.log('✅ Todos os testes de padronização passaram com sucesso!');
}

runTests();
