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
    onPrevious?: () => void,
    externalSubtitles?: any[]
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
    liveError,
    vodError,
    seriesError,
    fetchLiveStreams,
    fetchVodStreams,
    fetchSeriesStreams,
    sessionReady,
    liveCatalogStatus,
    vodCategoriesStatus,
    vodCatalogStatus,
    vodCategoryStatus,
    vodCategoryError,
    isVodCategoryLoaded,
    getVodCategoryStreams,
    getPartialVodStreamsForSearch,
    seriesCategoriesStatus,
    seriesCatalogStatus,
    seriesCategoryStatus,
    seriesCategoryError,
    isSeriesCategoryLoaded,
    getSeriesCategoryStreams,
    getPartialSeriesStreamsForSearch,
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
      liveError={liveError}
      liveCatalogStatus={liveCatalogStatus}
      fetchLiveStreams={fetchLiveStreams}
      vodCategories={vodCategories}
      vodStreams={vodStreams}
      allVodStreams={allVodStreams}
      loadingVod={loadingVod}
      vodError={vodError}
      vodCategoriesStatus={vodCategoriesStatus}
      vodCatalogStatus={vodCatalogStatus}
      vodCategoryStatus={vodCategoryStatus}
      vodCategoryError={vodCategoryError}
      fetchVodStreams={fetchVodStreams}
      isVodCategoryLoaded={isVodCategoryLoaded}
      getVodCategoryStreams={getVodCategoryStreams}
      getPartialVodStreamsForSearch={getPartialVodStreamsForSearch}
      seriesCategories={seriesCategories}
      seriesStreams={seriesStreams}
      allSeriesStreams={allSeriesStreams}
      loadingSeries={loadingSeries}
      seriesError={seriesError}
      seriesCategoriesStatus={seriesCategoriesStatus}
      seriesCatalogStatus={seriesCatalogStatus}
      seriesCategoryStatus={seriesCategoryStatus}
      seriesCategoryError={seriesCategoryError}
      fetchSeriesStreams={fetchSeriesStreams}
      isSeriesCategoryLoaded={isSeriesCategoryLoaded}
      getSeriesCategoryStreams={getSeriesCategoryStreams}
      getPartialSeriesStreamsForSearch={getPartialSeriesStreamsForSearch}
      sessionReady={sessionReady}
    />
  );
});
