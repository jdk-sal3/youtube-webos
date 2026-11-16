import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENGLISH_CAPTION_LABEL,
  buildTranslatedUrl,
  injectEnglishTranslatedTrack,
  processPlayerResponse,
  type CaptionTrack,
  type CaptionsTracklistRenderer
} from './subtitles-core.ts';

const SIGNED_QUERY =
  'v=dQw4w9WgXcQ&caps=asr&opi=112496729&xoaf=5&ip=0.0.0.0&ipbits=0&expire=1999999999&sparams=ip,ipbits,expire,v,caps,opi,xoaf&signature=ABCDEF.123456&key=yt8';

function timedtextUrl(extra: string): string {
  return `https://www.youtube.com/api/timedtext?${SIGNED_QUERY}&${extra}`;
}

function asrTrack(languageCode: string, languageName: string): CaptionTrack {
  return {
    baseUrl: timedtextUrl(`kind=asr&lang=${languageCode}`),
    name: { simpleText: `${languageName} (auto-generated)` },
    vssId: `a.${languageCode}`,
    languageCode,
    kind: 'asr',
    isTranslatable: true
  };
}

function manualTrack(
  languageCode: string,
  languageName: string,
  extras: Partial<CaptionTrack> = {}
): CaptionTrack {
  return {
    baseUrl: timedtextUrl(`lang=${languageCode}&name=${languageName}`),
    name: { simpleText: languageName },
    vssId: `.${languageCode}`,
    languageCode,
    isTranslatable: true,
    ...extras
  };
}

function rendererWith(
  tracks: CaptionTrack[],
  audioTracks?: CaptionsTracklistRenderer['audioTracks']
): CaptionsTracklistRenderer {
  const renderer: CaptionsTracklistRenderer = {
    captionTracks: tracks
  };
  if (audioTracks) {
    renderer.audioTracks = audioTracks;
  }
  return renderer;
}

function playerPayload(renderer: CaptionsTracklistRenderer) {
  return {
    videoDetails: { videoId: 'dQw4w9WgXcQ' },
    captions: { playerCaptionsTracklistRenderer: renderer }
  };
}

function injectedTrack(renderer: CaptionsTracklistRenderer) {
  return renderer.captionTracks?.find(
    (track) =>
      track.languageCode === 'en' && track.trackName === ENGLISH_CAPTION_LABEL
  );
}

describe('buildTranslatedUrl', () => {
  it('sets tlang=en and preserves existing signed query params', () => {
    const source = timedtextUrl('kind=asr&lang=id');
    const translated = buildTranslatedUrl(source);

    assert.ok(translated);
    const url = new URL(translated);
    assert.equal(url.searchParams.get('tlang'), 'en');
    assert.equal(url.searchParams.get('lang'), 'id');
    assert.equal(url.searchParams.get('kind'), 'asr');
    assert.equal(url.searchParams.get('signature'), 'ABCDEF.123456');
    assert.equal(url.searchParams.get('key'), 'yt8');
    assert.equal(url.searchParams.get('v'), 'dQw4w9WgXcQ');
  });
});

describe('injectEnglishTranslatedTrack', () => {
  it('injects English from an ASR-only non-English track', () => {
    const renderer = rendererWith(
      [asrTrack('id', 'Indonesian')],
      [{ captionTrackIndices: [0], defaultCaptionTrackIndex: 0 }]
    );

    assert.equal(injectEnglishTranslatedTrack(renderer), true);
    assert.equal(renderer.captionTracks?.length, 2);

    const added = injectedTrack(renderer);
    assert.ok(added);
    assert.equal(added.vssId, '.en');
    assert.equal(added.languageCode, 'en');
    assert.equal(added.kind, undefined);
    assert.equal(added.rtl, undefined);
    assert.equal(added.isTranslatable, true);
    assert.equal(added.name.simpleText, ENGLISH_CAPTION_LABEL);
    assert.equal(added.trackName, ENGLISH_CAPTION_LABEL);
    assert.equal(new URL(added.baseUrl).searchParams.get('tlang'), 'en');
    assert.equal(new URL(added.baseUrl).searchParams.get('lang'), 'id');
    assert.deepEqual(renderer.audioTracks?.[0]?.captionTrackIndices, [0, 1]);
  });

  it('prefers a manual non-English track over ASR as the translation source', () => {
    const renderer = rendererWith(
      [
        asrTrack('es', 'Spanish'),
        manualTrack('es', 'Spanish'),
        manualTrack('fr', 'French', { rtl: true })
      ],
      [{ captionTrackIndices: [0, 1, 2] }]
    );

    assert.equal(injectEnglishTranslatedTrack(renderer), true);

    const added = injectedTrack(renderer);
    assert.ok(added);
    assert.equal(new URL(added.baseUrl).searchParams.get('lang'), 'es');
    assert.equal(new URL(added.baseUrl).searchParams.get('name'), 'Spanish');
    assert.equal(added.kind, undefined);
    assert.equal(added.rtl, undefined);
    assert.deepEqual(
      renderer.audioTracks?.[0]?.captionTrackIndices,
      [0, 1, 2, 3]
    );
  });

  it('does not inject when a manual English track already exists', () => {
    const tracks = [manualTrack('en', 'English'), asrTrack('es', 'Spanish')];
    const renderer = rendererWith(tracks, [{ captionTrackIndices: [0, 1] }]);
    const before = structuredClone(renderer);

    assert.equal(injectEnglishTranslatedTrack(renderer), false);
    assert.deepEqual(renderer, before);
  });

  it('does not inject when an English ASR track already exists', () => {
    const tracks = [asrTrack('en', 'English'), manualTrack('de', 'German')];
    const renderer = rendererWith(tracks, [{ captionTrackIndices: [0, 1] }]);
    const before = structuredClone(renderer);

    assert.equal(injectEnglishTranslatedTrack(renderer), false);
    assert.deepEqual(renderer, before);
  });

  it('injects into captionTracks when audioTracks is missing', () => {
    const renderer = rendererWith([asrTrack('ja', 'Japanese')]);

    assert.equal(injectEnglishTranslatedTrack(renderer), true);
    assert.equal(renderer.audioTracks, undefined);
    const added = injectedTrack(renderer);
    assert.ok(added);
    assert.equal(added.languageCode, 'en');
    assert.equal(new URL(added.baseUrl).searchParams.get('tlang'), 'en');
    assert.equal(new URL(added.baseUrl).searchParams.get('lang'), 'ja');
  });

  it('mirrors a runs-shaped track name and updates every audio track index list', () => {
    const source: CaptionTrack = {
      baseUrl: timedtextUrl('lang=ar'),
      name: { runs: [{ text: 'Arabic' }] },
      vssId: '.ar',
      languageCode: 'ar',
      rtl: true,
      isTranslatable: true
    };
    const renderer = rendererWith(
      [source],
      [
        { captionTrackIndices: [0] },
        { captionTrackIndices: [0], defaultCaptionTrackIndex: 0 },
        { defaultCaptionTrackIndex: 0 }
      ]
    );

    assert.equal(injectEnglishTranslatedTrack(renderer), true);
    const added = injectedTrack(renderer);
    assert.ok(added);
    assert.deepEqual(added.name, { runs: [{ text: ENGLISH_CAPTION_LABEL }] });
    assert.equal(added.rtl, undefined);
    assert.deepEqual(renderer.audioTracks?.[0]?.captionTrackIndices, [0, 1]);
    assert.deepEqual(renderer.audioTracks?.[1]?.captionTrackIndices, [0, 1]);
    assert.equal(renderer.audioTracks?.[2]?.captionTrackIndices, undefined);
  });
});

describe('processPlayerResponse', () => {
  it('returns a clone with the injected track and leaves a frozen original unchanged', () => {
    const original = playerPayload(
      rendererWith([asrTrack('ko', 'Korean')], [{ captionTrackIndices: [0] }])
    );
    Object.freeze(original);
    Object.freeze(original.captions);
    Object.freeze(original.captions.playerCaptionsTracklistRenderer);
    Object.freeze(
      original.captions.playerCaptionsTracklistRenderer.captionTracks
    );
    Object.freeze(
      original.captions.playerCaptionsTracklistRenderer.captionTracks[0]
    );
    Object.freeze(
      original.captions.playerCaptionsTracklistRenderer.audioTracks
    );
    Object.freeze(
      original.captions.playerCaptionsTracklistRenderer.audioTracks![0]
    );
    Object.freeze(
      original.captions.playerCaptionsTracklistRenderer.audioTracks![0]!
        .captionTrackIndices
    );

    const result = processPlayerResponse(original) as typeof original;
    assert.notEqual(result, original);
    assert.equal(
      original.captions.playerCaptionsTracklistRenderer.captionTracks.length,
      1
    );
    assert.equal(
      result.captions.playerCaptionsTracklistRenderer.captionTracks?.length,
      2
    );
    assert.ok(injectedTrack(result.captions.playerCaptionsTracklistRenderer));
  });

  it('returns the same object when English already exists or captions are absent', () => {
    const withEnglish = playerPayload(
      rendererWith([asrTrack('en', 'English')])
    );
    assert.equal(processPlayerResponse(withEnglish), withEnglish);

    const noCaptions = { videoDetails: { videoId: 'x' } };
    assert.equal(processPlayerResponse(noCaptions), noCaptions);
  });
});
