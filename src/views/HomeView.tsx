import React from 'react';
import { useXtreamContext } from '../context/XtreamContext';
import { CatalogShowcaseView } from '../components/CatalogShowcaseView';

export interface HomeViewProps {
  onPlay: (
    url: string,
    title: string,
    startAt?: number,
    streamId?: string | number,
    contentType?: 'live' | 'movie' | 'episode',
    channelName?: string,
    programTitle?: string,
    onNext?: () => void,
    onPrevious?: () => void
  ) => void;
  onSelectLiveChannel?: (stream: any) => void;
  searchQuery?: string;
  isPaused?: boolean;
}

export const HomeView = React.memo(function HomeView({
  onPlay,
  onSelectLiveChannel,
  searchQuery = '',
  isPaused = false,
}: HomeViewProps) {
  const {
    credentials,
    liveStreams,
    vodStreams,
    seriesStreams,
    allLiveStreams,
    allVodStreams,
    allSeriesStreams,
    vodCategories,
    seriesCategories,
    loadingLive,
    loadingVod,
    loadingSeries,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
    sessionReady,
    liveCatalogStatus,
    vodCatalogStatus,
    seriesCatalogStatus,
  } = useXtreamContext();

  return (
    <CatalogShowcaseView
      section="inicio"
      credentials={credentials}
      searchQuery={searchQuery}
      isPaused={isPaused}
      onPlay={onPlay}
      onSelectLiveChannel={onSelectLiveChannel}
      liveStreams={liveStreams}
      allLiveStreams={allLiveStreams}
      loadingLive={loadingLive}
      liveCatalogStatus={liveCatalogStatus}
      fetchLiveStreams={fetchLiveStreams}
      vodCategories={vodCategories}
      vodStreams={vodStreams}
      allVodStreams={allVodStreams}
      loadingVod={loadingVod}
      vodCatalogStatus={vodCatalogStatus}
      fetchVodStreams={fetchVodStreams}
      seriesCategories={seriesCategories}
      seriesStreams={seriesStreams}
      allSeriesStreams={allSeriesStreams}
      loadingSeries={loadingSeries}
      seriesCatalogStatus={seriesCatalogStatus}
      fetchSeriesStreams={fetchSeriesStreams}
      sessionReady={sessionReady}
    />
  );
});
