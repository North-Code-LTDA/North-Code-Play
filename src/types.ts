export type XtreamId = string | number;
export type XtreamImageField = string | string[] | null | undefined;
export type XtreamTextOrList = string | string[] | null | undefined;

export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
  playlistName?: string;
  avatar?: string;
  allowed_output_formats?: string[];
  user_info?: XtreamUserInfo;
  server_info?: XtreamServerInfo | Record<string, any>;
}

export interface XtreamServerInfo {
  url?: string | null;
  port?: string | number | null;
  https_port?: string | number | null;
  server_protocol?: string | null;
  rtmp_port?: string | number | null;
  timezone?: string | null;
  timestamp_now?: number | string | null;
  time_now?: string | null;
  xui?: boolean | number | string | null;
  version?: string | null;
  revision?: number | string | null;
  process?: boolean | number | string | null;
  [key: string]: any;
}

export interface XtreamUserInfo {
  username?: string | null;
  password?: string | null;
  message?: string | null;
  auth?: number | string | boolean | null;
  status?: string | null;
  exp_date?: string | number | null;
  is_trial?: string | number | boolean | null;
  active_cons?: string | number | null;
  created_at?: string | number | null;
  max_connections?: string | number | null;
  allowed_output_formats?: string[] | string | Record<string, unknown> | null;
  [key: string]: any;
}

export interface XtreamAuthResponse {
  user_info: XtreamUserInfo;
  server_info?: XtreamServerInfo | null;
  [key: string]: any;
}

export interface Category {
  category_id: XtreamId;
  category_name: string;
  parent_id?: number | string | null;
  [key: string]: any;
}

export interface LiveStream {
  num?: number | string | null;
  name: string;
  stream_type?: string | null;
  stream_id: XtreamId;
  stream_icon?: XtreamImageField;
  epg_channel_id?: string | null;
  added?: string | number | null;
  category_id?: XtreamId | null;
  category_ids?: XtreamId[] | null;
  custom_sid?: string | null;
  tv_archive?: number | string | boolean | null;
  direct_source?: string | null;
  tv_archive_duration?: number | string | null;
  container_extension?: string | null;
  [key: string]: any;
}

export interface VodStream {
  num?: number | string | null;
  name: string;
  stream_type?: string | null;
  stream_id: XtreamId;
  stream_icon?: XtreamImageField;
  rating?: string | number | null;
  rating_5based?: number | string | null;
  added?: string | number | null;
  category_id?: XtreamId | null;
  category_ids?: XtreamId[] | null;
  container_extension?: string | null;
  custom_sid?: string | null;
  direct_source?: string | null;
  year?: string | number | null;
  [key: string]: any;
}

export interface SeriesStream {
  num?: number | string | null;
  name: string;
  series_id: XtreamId;
  cover?: XtreamImageField;
  plot?: string | null;
  cast?: XtreamTextOrList;
  director?: XtreamTextOrList;
  genre?: XtreamTextOrList;
  releaseDate?: string | null;
  release_date?: string | null;
  releasedate?: string | null;
  last_modified?: string | number | null;
  rating?: string | number | null;
  rating_5based?: number | string | null;
  backdrop_path?: XtreamImageField;
  youtube_trailer?: string | null;
  episode_run_time?: string | number | null;
  category_id?: XtreamId | null;
  category_ids?: XtreamId[] | null;
  [key: string]: any;
}

export interface XtreamVodInfo {
  name?: string | null;
  o_name?: string | null;
  movie_image?: XtreamImageField;
  cover_big?: XtreamImageField;
  backdrop_path?: XtreamImageField;
  plot?: string | null;
  description?: string | null;
  cast?: XtreamTextOrList;
  actors?: XtreamTextOrList;
  director?: XtreamTextOrList;
  genre?: XtreamTextOrList;
  releasedate?: string | null;
  releaseDate?: string | null;
  release_date?: string | null;
  year?: string | number | null;
  duration?: string | number | null;
  duration_secs?: number | string | null;
  rating?: string | number | null;
  youtube_trailer?: string | null;
  container_extension?: string | null;
  direct_source?: string | null;
  subtitles?: unknown;
  [key: string]: any;
}

export interface XtreamVodMovieData {
  stream_id?: XtreamId | null;
  name?: string | null;
  added?: string | number | null;
  category_id?: XtreamId | null;
  category_ids?: XtreamId[] | null;
  container_extension?: string | null;
  custom_sid?: string | null;
  direct_source?: string | null;
  [key: string]: any;
}

export interface XtreamVodInfoResponse {
  info?: XtreamVodInfo | null;
  movie_data?: XtreamVodMovieData | null;
  [key: string]: any;
}

export interface XtreamSeriesSeason {
  season_number?: number | string | null;
  name?: string | null;
  air_date?: string | null;
  episode_count?: number | string | null;
  overview?: string | null;
  cover?: XtreamImageField;
  cover_big?: XtreamImageField;
  [key: string]: any;
}

export interface XtreamSeriesEpisodeInfo {
  movie_image?: XtreamImageField;
  cover_big?: XtreamImageField;
  plot?: string | null;
  description?: string | null;
  releasedate?: string | null;
  releaseDate?: string | null;
  air_date?: string | null;
  rating?: string | number | null;
  duration?: string | number | null;
  duration_secs?: number | string | null;
  direct_source?: string | null;
  subtitles?: unknown;
  [key: string]: any;
}

export interface XtreamSeriesEpisode {
  id: XtreamId;
  stream_id?: XtreamId | null;
  episode_num?: number | string | null;
  title?: string | null;
  container_extension?: string | null;
  direct_source?: string | null;
  season?: number | string | null;
  added?: string | number | null;
  custom_sid?: string | null;
  info?: XtreamSeriesEpisodeInfo | null;
  [key: string]: any;
}

export interface XtreamSeriesInfoResponse {
  seasons?: XtreamSeriesSeason[] | Record<string, XtreamSeriesSeason> | null;
  info?: {
    name?: string | null;
    cover?: XtreamImageField;
    cover_big?: XtreamImageField;
    backdrop_path?: XtreamImageField;
    plot?: string | null;
    description?: string | null;
    cast?: XtreamTextOrList;
    actors?: XtreamTextOrList;
    director?: XtreamTextOrList;
    genre?: XtreamTextOrList;
    releasedate?: string | null;
    releaseDate?: string | null;
    release_date?: string | null;
    year?: string | number | null;
    rating?: string | number | null;
    rating_5based?: number | string | null;
    episode_run_time?: string | number | null;
    youtube_trailer?: string | null;
    category_id?: XtreamId | null;
    [key: string]: any;
  } | null;
  episodes?:
    | Record<string, XtreamSeriesEpisode[] | Record<string, XtreamSeriesEpisode>>
    | XtreamSeriesEpisode[]
    | null;
  [key: string]: any;
}
