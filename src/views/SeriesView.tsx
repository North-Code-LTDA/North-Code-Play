import React from 'react';
import {
  useXtreamSeries,
  useXtreamCredentials,
  useXtreamSession,
} from '../context/XtreamContext';
import { CatalogShowcaseView } from '../components/CatalogShowcaseView';

export interface SeriesViewProps {
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
  searchQuery?: string;
  isPaused?: boolean;
}

export const SeriesView = React.memo(function SeriesView({
  onPlay,
  searchQuery = '',
  isPaused = false,
}: SeriesViewProps) {
  const { credentials } = useXtreamCredentials();
  const { sessionReady } = useXtreamSession();
  const {
    seriesCategories,
    seriesStreams,
    allSeriesStreams,
    loadingSeries,
    seriesError,
    seriesCategoryError,
    seriesCategoriesStatus,
    seriesCatalogStatus,
    seriesCategoryStatus,
    seriesCategoriesError,
    fetchSeriesCategories,
    fetchSeriesStreams,
    isSeriesCategoryLoaded,
    getSeriesCategoryStreams,
    getPartialSeriesStreamsForSearch,
  } = useXtreamSeries();

  return (
    <CatalogShowcaseView
      section="series"
      credentials={credentials}
      searchQuery={searchQuery}
      isPaused={isPaused}
      onPlay={onPlay}
      seriesCategories={seriesCategories}
      seriesStreams={seriesStreams}
      allSeriesStreams={allSeriesStreams}
      loadingSeries={loadingSeries}
      seriesError={seriesError}
      seriesCategoryError={seriesCategoryError}
      seriesCategoriesStatus={seriesCategoriesStatus}
      seriesCatalogStatus={seriesCatalogStatus}
      seriesCategoryStatus={seriesCategoryStatus}
      seriesCategoriesError={seriesCategoriesError}
      fetchSeriesCategories={fetchSeriesCategories}
      fetchSeriesStreams={fetchSeriesStreams}
      isSeriesCategoryLoaded={isSeriesCategoryLoaded}
      getSeriesCategoryStreams={getSeriesCategoryStreams}
      getPartialSeriesStreamsForSearch={getPartialSeriesStreamsForSearch}
      sessionReady={sessionReady}
    />
  );
});
