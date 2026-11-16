import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteTranslatedTimedtextUrl } from './subtitles-timedtext.ts';

const signed =
  'https://www.youtube.com/api/timedtext?v=vHOCh890px4&ei=abc&caps=asr&sparams=ip,ipbits,expire,v,ei,caps&signature=ABCDEF.123&key=yt8&kind=asr&lang=yue';

describe('rewriteTranslatedTimedtextUrl', () => {
  it('returns null when the URL is not translated timedtext', () => {
    assert.equal(rewriteTranslatedTimedtextUrl(signed), null);
    assert.equal(
      rewriteTranslatedTimedtextUrl(
        'https://www.youtube.com/youtubei/v1/player?tlang=en'
      ),
      null
    );
    assert.equal(
      rewriteTranslatedTimedtextUrl('not a url', 'https://www.youtube.com'),
      null
    );
  });

  it('strips TVHTML5 client params and adds fmt/xorb/xobt/xovt', () => {
    const input =
      signed +
      '&tlang=en&fmt=json3&xorb=2&xobt=3&xovt=3&cbrand=LG&cbr=LG%20Browser&cbrver=8.00.00&c=TVHTML5&cver=7.20261111.09.00&ctheme=CLASSIC&cplayer=UNIPLAYER&cmodel=43NANO80ASA.ATIFLJD&cos=webOS&cosver=2025&cplatform=TV';
    const rewritten = rewriteTranslatedTimedtextUrl(input);
    assert.ok(rewritten);
    const url = new URL(rewritten);
    assert.equal(url.searchParams.get('tlang'), 'en');
    assert.equal(url.searchParams.get('lang'), 'yue');
    assert.equal(url.searchParams.get('kind'), 'asr');
    assert.equal(url.searchParams.get('signature'), 'ABCDEF.123');
    assert.equal(url.searchParams.get('fmt'), 'json3');
    assert.equal(url.searchParams.get('xorb'), '2');
    assert.equal(url.searchParams.get('xobt'), '3');
    assert.equal(url.searchParams.get('xovt'), '3');
    for (const key of [
      'c',
      'cver',
      'cbrand',
      'cbr',
      'cbrver',
      'ctheme',
      'cplayer',
      'cmodel',
      'cos',
      'cosver',
      'cplatform'
    ]) {
      assert.equal(url.searchParams.get(key), null, key);
    }
  });

  it('fills missing fmt and xorb params on a bare tlang URL', () => {
    const rewritten = rewriteTranslatedTimedtextUrl(signed + '&tlang=en');
    assert.ok(rewritten);
    const url = new URL(rewritten);
    assert.equal(url.searchParams.get('fmt'), 'json3');
    assert.equal(url.searchParams.get('xorb'), '2');
    assert.equal(url.searchParams.get('xobt'), '3');
    assert.equal(url.searchParams.get('xovt'), '3');
    assert.equal(url.searchParams.get('tlang'), 'en');
  });

  it('keeps an existing non-json3 fmt', () => {
    const rewritten = rewriteTranslatedTimedtextUrl(
      signed + '&tlang=en&fmt=vtt'
    );
    assert.ok(rewritten);
    assert.equal(new URL(rewritten).searchParams.get('fmt'), 'vtt');
  });
});
