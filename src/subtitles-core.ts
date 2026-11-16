/**
 * Inject a selectable English auto-translated caption track into YouTube TV
 * player responses.
 *
 * The leanback captions menu only lists tracks in
 * `captions.playerCaptionsTracklistRenderer.captionTracks`. Unlike the desktop
 * player, it does not expose an auto-translate submenu from
 * `translationLanguages` (and TV responses often omit that list).
 *
 * Approach adapted from webosbrew/youtube-webos#472: clone an existing
 * caption track — preserving `baseUrl` query params (signature / `pot`) — and
 * add `tlang=en`, the parameter YouTube's timedtext server uses to
 * machine-translate a track. The clone then appears as a normal menu option.
 */

export interface CaptionTrackName {
  simpleText?: string;
  runs?: { text: string }[];
}

export interface CaptionTrack {
  baseUrl: string;
  name: CaptionTrackName;
  vssId?: string;
  languageCode: string;
  kind?: string;
  rtl?: boolean;
  isTranslatable?: boolean;
  trackName?: string;
}

export interface AudioTrack {
  captionTrackIndices?: number[];
  defaultCaptionTrackIndex?: number;
}

export interface CaptionsTracklistRenderer {
  captionTracks?: CaptionTrack[];
  audioTracks?: AudioTrack[];
  translationLanguages?: unknown;
}

export interface PlayerCaptionsPayload {
  captions?: {
    playerCaptionsTracklistRenderer?: CaptionsTracklistRenderer;
  };
}

export const ENGLISH_CAPTION_LABEL = 'English (auto-translated)';

export function isEnglishLanguage(languageCode: string | undefined): boolean {
  return /^en\b/i.test(languageCode ?? '');
}

export function isAsrTrack(track: CaptionTrack): boolean {
  return track.kind === 'asr' || (track.vssId?.startsWith('a.') ?? false);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getCaptionsRenderer(
  payload: unknown
): CaptionsTracklistRenderer | undefined {
  if (!isObject(payload)) return undefined;

  const captions = payload.captions;
  if (!isObject(captions)) return undefined;

  const renderer = captions.playerCaptionsTracklistRenderer;
  if (!isObject(renderer)) return undefined;

  return renderer as CaptionsTracklistRenderer;
}

function makeName(source: CaptionTrackName | undefined): CaptionTrackName {
  if (source && Array.isArray(source.runs)) {
    return { runs: [{ text: ENGLISH_CAPTION_LABEL }] };
  }

  return { simpleText: ENGLISH_CAPTION_LABEL };
}

export function buildTranslatedUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl, 'https://www.youtube.com');
    url.searchParams.set('tlang', 'en');
    return url.toString();
  } catch (err) {
    console.warn('[subtitles] Could not parse caption baseUrl', baseUrl, err);
    return null;
  }
}

function pickTranslationSource(
  tracks: CaptionTrack[]
): CaptionTrack | undefined {
  const sources = tracks.filter(
    (track) => !isEnglishLanguage(track.languageCode)
  );
  return (
    sources.find((track) => !isAsrTrack(track)) ??
    sources.find((track) => isAsrTrack(track)) ??
    sources[0]
  );
}

/**
 * Mutates `renderer` in place. Returns whether a track was injected.
 */
export function injectEnglishTranslatedTrack(
  renderer: CaptionsTracklistRenderer
): boolean {
  const tracks = renderer.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return false;

  // Manual or ASR English is already offered — nothing to do.
  if (tracks.some((track) => isEnglishLanguage(track.languageCode))) {
    return false;
  }

  const source = pickTranslationSource(tracks);
  if (!source) return false;

  const baseUrl = buildTranslatedUrl(source.baseUrl);
  if (!baseUrl) return false;

  // Build a clean English track rather than spreading `...source`: the auth is
  // carried by `baseUrl`, and copying the source would drag along wrong fields
  // (e.g. `rtl: true` from an Arabic track, or `kind: "asr"`). A distinct
  // `vssId`/`languageCode` is required so the menu doesn't collapse it into the
  // source track as a duplicate.
  const newIndex =
    tracks.push({
      baseUrl,
      name: makeName(source.name),
      vssId: '.en',
      languageCode: 'en',
      isTranslatable: true,
      trackName: ENGLISH_CAPTION_LABEL
    }) - 1;

  // The caption menu is built from each audio track's `captionTrackIndices`,
  // not from `captionTracks` directly — so a freshly pushed track is invisible
  // until its index is registered here.
  const audioTracks = renderer.audioTracks;
  if (Array.isArray(audioTracks)) {
    for (const audioTrack of audioTracks) {
      if (
        Array.isArray(audioTrack.captionTrackIndices) &&
        !audioTrack.captionTrackIndices.includes(newIndex)
      ) {
        audioTrack.captionTrackIndices.push(newIndex);
      }
    }
  }

  return true;
}

function needsEnglishTranslatedTrack(
  renderer: CaptionsTracklistRenderer
): boolean {
  const tracks = renderer.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return false;
  return !tracks.some((track) => isEnglishLanguage(track.languageCode));
}

/**
 * Returns the original payload unless an English auto-translated track should
 * be injected, in which case a structured clone is mutated and returned so
 * frozen player-response objects are left untouched (see #469).
 */
export function processPlayerResponse(payload: unknown): unknown {
  const renderer = getCaptionsRenderer(payload);
  if (!renderer || !needsEnglishTranslatedTrack(renderer)) {
    return payload;
  }

  const cloned = structuredClone(payload) as PlayerCaptionsPayload;
  const clonedRenderer = getCaptionsRenderer(cloned);
  if (!clonedRenderer) return payload;

  if (injectEnglishTranslatedTrack(clonedRenderer)) {
    console.info('[subtitles] Injected auto-translated English caption track');
  }

  return cloned;
}
