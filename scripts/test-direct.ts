import assert from 'assert';
import {
  normalizeServerUrl,
  buildDirectMediaUrl,
  buildDirectImageUrl,
  FALLBACK_IMAGE_DATA_URI,
} from '../src/utils/mediaUtils';
import { XtreamCredentials } from '../src/types';

function runTests() {
  console.log('--- Iniciando Testes da Arquitetura Direta (Sem Proxy) ---');

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

  // 2. buildDirectMediaUrl
  console.log('2. Testando buildDirectMediaUrl...');
  const testCreds: XtreamCredentials = {
    serverUrl: 'http://myprovider.xyz:8080',
    username: 'user@test+1',
    password: 'p@ssword#123',
  };

  // 2.1 Live Stream - Default m3u8
  const liveUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1042,
  });
  assert.strictEqual(
    liveUrl1,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1042.m3u8'
  );

  // 2.2 Live Stream - allowed_output_formats with ts only
  const liveUrl2 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: '1043',
    allowedOutputFormats: ['ts'],
  });
  assert.strictEqual(
    liveUrl2,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1043.ts'
  );

  // 2.3 Live Stream - allowed_output_formats with m3u8 and ts (should prefer m3u8)
  const liveUrl3 = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 1044,
    allowedOutputFormats: ['ts', 'm3u8'],
  });
  assert.strictEqual(
    liveUrl3,
    'http://myprovider.xyz:8080/live/user%40test%2B1/p%40ssword%23123/1044.m3u8'
  );

  // 2.4 Movie - custom extension .mkv
  const movieUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'movie',
    streamId: 5520,
    containerExtension: 'mkv',
  });
  assert.strictEqual(
    movieUrl1,
    'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5520.mkv'
  );

  // 2.5 Movie - default mp4
  const movieUrl2 = buildDirectMediaUrl(testCreds, {
    type: 'movie',
    streamId: 5521,
  });
  assert.strictEqual(
    movieUrl2,
    'http://myprovider.xyz:8080/movie/user%40test%2B1/p%40ssword%23123/5521.mp4'
  );

  // 2.6 Series Episode - custom extension
  const seriesUrl1 = buildDirectMediaUrl(testCreds, {
    type: 'series',
    streamId: 9910,
    containerExtension: '.mp4',
  });
  assert.strictEqual(
    seriesUrl1,
    'http://myprovider.xyz:8080/series/user%40test%2B1/p%40ssword%23123/9910.mp4'
  );

  // 2.7 Direct source precedence
  const directSrcUrl = buildDirectMediaUrl(testCreds, {
    type: 'live',
    streamId: 100,
    directSource: 'http://cdn.example.org/stream.m3u8',
  });
  assert.strictEqual(directSrcUrl, 'http://cdn.example.org/stream.m3u8');

  // 3. buildDirectImageUrl
  console.log('3. Testando buildDirectImageUrl...');
  // 3.1 Direct absolute URL (HTTP)
  assert.strictEqual(
    buildDirectImageUrl('http://img.provider.com/poster.jpg'),
    'http://img.provider.com/poster.jpg'
  );

  // 3.2 Direct absolute URL (HTTPS)
  assert.strictEqual(
    buildDirectImageUrl('https://image.tmdb.org/t/p/w500/abc.jpg'),
    'https://image.tmdb.org/t/p/w500/abc.jpg'
  );

  // 3.3 Protocol-relative URL
  assert.strictEqual(
    buildDirectImageUrl('//images.tmdb.org/poster.png', 'http://provider.tv:8080'),
    'http://images.tmdb.org/poster.png'
  );

  // 3.4 Schemeless domain
  assert.strictEqual(
    buildDirectImageUrl('images.tmdb.org/t/p/original/backdrop.jpg'),
    'https://images.tmdb.org/t/p/original/backdrop.jpg'
  );

  // 3.5 Relative URL resolved against serverUrl
  assert.strictEqual(
    buildDirectImageUrl('/images/movie_123.jpg', 'http://iptv.server:8080'),
    'http://iptv.server:8080/images/movie_123.jpg'
  );

  // 3.6 Invalid / empty URL returns SVG fallback
  assert.strictEqual(buildDirectImageUrl(''), FALLBACK_IMAGE_DATA_URI);
  assert.strictEqual(buildDirectImageUrl(null), FALLBACK_IMAGE_DATA_URI);
  assert.strictEqual(buildDirectImageUrl(undefined), FALLBACK_IMAGE_DATA_URI);

  // 4. Verification that no proxy URL is generated
  console.log('4. Verificando ausência de rotas /api/media ou /api/xtream...');
  assert(!liveUrl1.includes('/api/media'), 'liveUrl1 não deve conter /api/media');
  assert(!movieUrl1.includes('/api/media'), 'movieUrl1 não deve conter /api/media');
  assert(!seriesUrl1.includes('/api/media'), 'seriesUrl1 não deve conter /api/media');
  assert(!buildDirectImageUrl('http://example.com/logo.png').includes('/api/media'), 'Imagem não deve conter /api/media');

  console.log('✅ Todos os testes da arquitetura direta passaram com sucesso!');
}

runTests();
