import assert from 'node:assert';
import {
  groupLiveStreams,
  getAdjacentLiveChannelGroup,
  LiveChannelGroup,
} from '../src/utils/liveChannelGroups';

function makeStream(id: number, name: string, categoryId = '10') {
  return {
    stream_id: id,
    name,
    category_id: categoryId,
    epg_channel_id: `epg_${name.split(' ')[0].toLowerCase()}`,
    stream_icon: '',
  };
}

function makeSimpleGroup(id: number, name: string, categoryId = '10'): LiveChannelGroup {
  const stream = makeStream(id, name, categoryId);
  return {
    groupId: JSON.stringify(['single', categoryId, String(id)]),
    displayName: name,
    category_id: categoryId,
    epg_channel_id: stream.epg_channel_id,
    stream_icon: '',
    isGrouped: false,
    variants: [],
    primaryStream: stream,
    allStreams: [stream],
  };
}

const g1 = makeSimpleGroup(101, 'Canal Alpha');
const g2 = makeSimpleGroup(102, 'Canal Beta');
const g3 = makeSimpleGroup(103, 'Canal Gama');
const categoryGroups = [g1, g2, g3];

// 1. Próximo canal
assert.strictEqual(
  getAdjacentLiveChannelGroup(categoryGroups, g1.groupId, 1)?.groupId,
  g2.groupId,
  'step=1 deve avançar para o próximo canal'
);

// 2. Canal anterior
assert.strictEqual(
  getAdjacentLiveChannelGroup(categoryGroups, g2.groupId, -1)?.groupId,
  g1.groupId,
  'step=-1 deve recuar para o canal anterior'
);

// 3. Volta do último para o primeiro
assert.strictEqual(
  getAdjacentLiveChannelGroup(categoryGroups, g3.groupId, 1)?.groupId,
  g1.groupId,
  'step=1 no último canal deve voltar ao primeiro'
);

// 4. Volta do primeiro para o último
assert.strictEqual(
  getAdjacentLiveChannelGroup(categoryGroups, g1.groupId, -1)?.groupId,
  g3.groupId,
  'step=-1 no primeiro canal deve ir para o último'
);

// 5. Categoria com um canal
assert.strictEqual(
  getAdjacentLiveChannelGroup([g1], g1.groupId, 1),
  null,
  'Categoria com 1 canal deve retornar null para step=1'
);
assert.strictEqual(
  getAdjacentLiveChannelGroup([g1], g1.groupId, -1),
  null,
  'Categoria com 1 canal deve retornar null para step=-1'
);

// 6. Lista vazia e canal inexistente
assert.strictEqual(
  getAdjacentLiveChannelGroup([], g1.groupId, 1),
  null,
  'Lista vazia deve retornar null'
);
assert.strictEqual(
  getAdjacentLiveChannelGroup(categoryGroups, 'inexistente', 1),
  null,
  'groupId inexistente deve retornar null'
);

// 7. Grupos SD/HD/FHD representam um único canal
const groupedCategory = groupLiveStreams([
  makeStream(201, 'Esporte SD', '20'),
  makeStream(202, 'Esporte HD', '20'),
  makeStream(203, 'Esporte FHD', '20'),
  makeStream(204, 'Noticias SD', '20'),
  makeStream(205, 'Noticias HD', '20'),
]);

assert.strictEqual(
  groupedCategory.length,
  2,
  'Variantes SD/HD/FHD devem formar apenas 1 LiveChannelGroup por canal'
);
assert.strictEqual(
  getAdjacentLiveChannelGroup(groupedCategory, groupedCategory[0].groupId, 1)?.groupId,
  groupedCategory[1].groupId,
  'step=1 deve saltar diretamente para o próximo canal sem passar por SD/HD/FHD'
);
assert.strictEqual(
  getAdjacentLiveChannelGroup(groupedCategory, groupedCategory[1].groupId, 1)?.groupId,
  groupedCategory[0].groupId,
  'step=1 no último canal agrupado deve retornar ao primeiro canal agrupado'
);
assert.strictEqual(
  getAdjacentLiveChannelGroup(groupedCategory, groupedCategory[0].groupId, -1)?.groupId,
  groupedCategory[1].groupId,
  'step=-1 no primeiro canal agrupado deve ir para o último canal agrupado'
);

console.log('Sucesso: todos os testes de getAdjacentLiveChannelGroup passaram em test-live-zapping.');
